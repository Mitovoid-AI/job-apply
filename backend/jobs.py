"""Jobs = scan results merged with the tracker (data/pipeline.json), keyed by URL."""

import hashlib
import time
from datetime import date, datetime
from urllib.parse import urlsplit

from . import settings, store

VALID_STATUSES = ["to_apply", "applied", "hr_screen", "technical", "final_round",
                  "offer", "accepted", "rejected", "withdrawn", "expired"]
APPLIED_OR_LATER = {"applied", "hr_screen", "technical", "final_round", "offer", "accepted"}
INTERVIEWING = {"hr_screen", "technical", "final_round"}


def norm_url(url: str) -> str:
    p = urlsplit((url or "").strip())
    return f"{p.scheme.lower()}://{p.netloc.lower()}{p.path.rstrip('/')}"


def job_id(url: str) -> str:
    return hashlib.sha1(norm_url(url).encode()).hexdigest()[:10]


def load_pipeline() -> list[dict]:
    return store.read_json(settings.PIPELINE, []) or []


def load_scan() -> dict:
    return store.read_json(settings.SCAN_RESULTS, {}) or {}


def _days_since(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        return (date.today() - date.fromisoformat(str(iso)[:10])).days
    except ValueError:
        return None


_LIST_CACHE: dict = {"key": None, "at": 0.0, "rows": []}


def _mtime(p) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def list_jobs() -> list[dict]:
    """Every scanned job plus every tracked job, one row per URL. With thousands of jobs this takes
    seconds, so the result is kept for 30 s, or until a scan, the tracker, the LinkedIn jobs, the
    profile or the JD cache changes. Callers get copies, so they may change them."""
    key = tuple(_mtime(p) for p in (settings.SCAN_RESULTS, settings.PIPELINE, settings.LINKEDIN_JOBS,
                                    settings.PROFILE, settings.JD_CACHE))
    if _LIST_CACHE["key"] == key and time.monotonic() - _LIST_CACHE["at"] < 30:
        return [dict(r) for r in _LIST_CACHE["rows"]]
    rows = _build_list()
    _LIST_CACHE.update(key=key, at=time.monotonic(), rows=rows)
    return [dict(r) for r in rows]


def _build_list() -> list[dict]:
    from .jd import _experience, fit_for  # local import: jd imports jobs helpers

    exp = _experience()  # once, not once per job
    scan = load_scan()
    pipeline = load_pipeline()
    by_url = {norm_url(p.get("url", "")): p for p in pipeline if p.get("url")}
    rows, seen = [], set()

    def row(base: dict, entry: dict | None, in_scan: bool) -> dict:
        url = base.get("url") or (entry or {}).get("url", "")
        jid = job_id(url)
        seen.add(norm_url(url))
        return {
            "id": jid,
            "url": url,
            "company": base.get("company") or (entry or {}).get("company", ""),
            "title": base.get("title") or (entry or {}).get("role", ""),
            "location": base.get("location") or (entry or {}).get("location", ""),
            "source": base.get("source") or (entry or {}).get("source", "manual"),
            "tier": str(base.get("tier", "")) or None,
            "posted_at": base.get("posted_at"),
            "department": base.get("department", ""),
            "remote": bool(base.get("remote")),
            "in_scan": in_scan,
            "match": base.get("match"),  # "core" | "adjacent" from the scan; None if not scanned
            "fit": fit_for(jid, exp),
            "pipeline": entry,
        }

    for j in scan.get("jobs", []):
        rows.append(row(j, by_url.get(norm_url(j.get("url", ""))), True))
    from .linkedin import load as load_linkedin  # jobs from LinkedIn alert emails (dated by import)
    for j in load_linkedin():
        if norm_url(j["url"]) not in seen:
            rows.append(row({**j, "posted_at": j.get("imported_at")}, by_url.get(norm_url(j["url"])), True))
    for p in pipeline:
        if p.get("url") and norm_url(p["url"]) not in seen:
            rows.append(row({}, p, False))
    return rows


def overview() -> dict:
    from .apply import batch_summaries
    from .profile import missing_fields
    from .runners import discovery_info, discovery_stale

    scan = load_scan()
    pipeline = load_pipeline()
    jobs = list_jobs()
    status = lambda s: sum(1 for p in pipeline if p.get("status") == s)
    applied = [p for p in pipeline if p.get("status") in APPLIED_OR_LATER]

    needs = []
    for p in pipeline:
        jid = job_id(p.get("url", ""))
        if p.get("status") == "to_apply" and (_days_since(p.get("date_found")) or 0) > 14:
            needs.append({"kind": "stale_to_apply", "job_id": jid,
                          "text": f"{p.get('company')} · {p.get('role')} has waited {_days_since(p.get('date_found'))} days"})
        if p.get("status") == "applied" and (_days_since(p.get("date_applied")) or 0) > 21:
            needs.append({"kind": "no_reply", "job_id": jid,
                          "text": f"No reply from {p.get('company')} in {_days_since(p.get('date_applied'))} days"})
    stale = discovery_stale()
    if stale in ("missing", "profile_changed"):
        needs.append({"kind": "discover", "job_id": None,
                      "text": "Your company list isn't built yet: run Find companies" if stale == "missing"
                      else "Your roles or locations changed: run Find companies to update your company list"})
    missing = missing_fields()
    if missing:
        needs.append({"kind": "profile", "job_id": None,
                      "text": f"{len(missing)} profile answers are empty: {', '.join(missing[:4])}"
                              + ("…" if len(missing) > 4 else "")})
    for b in batch_summaries():
        if b["needs"]:
            needs.append({"kind": "batch", "job_id": None,
                          "text": f"Batch {b['name']}: {b['needs']} answers still needed"})

    return {
        "last_scan": scan.get("scanned_at"),
        "companies": discovery_info(),
        "scan_errors": scan.get("errors", 0),
        "scan_failed": [f.get("company") for f in scan.get("failed", [])],
        "counts": {
            "matches": len([j for j in jobs if j["in_scan"]]),
            "fits": len([j for j in jobs if j["in_scan"] and (j["fit"] or {}).get("level") == "fits"]),
            "to_apply": status("to_apply"),
            "applied": len(applied),
            "interviewing": sum(1 for p in pipeline if p.get("status") in INTERVIEWING),
            "offers": sum(1 for p in pipeline if p.get("status") in {"offer", "accepted"}),
            "rejected": status("rejected"),
        },
        "funnel": [
            {"stage": "Found", "value": len(jobs)},
            {"stage": "Tracked", "value": len(pipeline)},
            {"stage": "Applied", "value": len(applied)},
            {"stage": "Interview", "value": sum(1 for p in pipeline if p.get("status") in INTERVIEWING | {"offer", "accepted"})},
            {"stage": "Offer", "value": sum(1 for p in pipeline if p.get("status") in {"offer", "accepted"})},
        ],
        "needs_action": needs,
    }


def track(job: dict) -> dict:
    """Add a scanned job to the tracker as to_apply (no-op if it's already there)."""
    def change(pipeline: list):
        if any(norm_url(p.get("url", "")) == norm_url(job["url"]) for p in pipeline):
            return pipeline
        next_id = max([int(p.get("id", 0)) for p in pipeline if str(p.get("id", "")).isdigit()] + [0]) + 1
        pipeline.append({
            "id": next_id, "company": job["company"], "role": job["title"],
            "grade": None, "score": None, "status": "to_apply", "source": job.get("source", "manual"),
            "url": job["url"], "salary_listed": "", "location": job.get("location", ""),
            "date_found": date.today().isoformat(), "date_applied": None,
            "next_action": "", "notes": "",
        })
        return pipeline
    return store.update_json(settings.PIPELINE, [], change)


def update_entry(entry_id: int, fields: dict) -> dict | None:
    """Change status / notes / next_action / grade fields on one tracker entry."""
    found = {}

    def change(pipeline: list):
        for p in pipeline:
            if str(p.get("id")) == str(entry_id):
                for k, v in fields.items():
                    p[k] = v
                if fields.get("status") in APPLIED_OR_LATER and not p.get("date_applied"):
                    p["date_applied"] = date.today().isoformat()
                p["updated_at"] = datetime.now().isoformat(timespec="seconds")
                found.update(p)
        return pipeline

    store.update_json(settings.PIPELINE, [], change)
    return found or None
