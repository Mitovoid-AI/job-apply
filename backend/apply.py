"""Apply batches: data/apply/<name>.json, written by Claude Code (modes/apply.md) and edited here.

Nothing in this module submits anything. The dashboard only edits answers, approves drafts
and marks jobs ready; submitting stays a chat step ("submit 1, 3 from batch <name>").

Batch schema:
{
  "name": "2026-11-24-batch-1", "created_at": "...", "shown_hash": "<hash Claude last showed>",
  "jobs": [{
    "n": 1, "job_id": "...", "pipeline_id": 1, "company": "...", "role": "...", "url": "...",
    "grade": "C", "resume_pdf": "...", "ready": false, "blockers": [], "consent": [],
    "fields": [{"key": "...", "label": "...", "required": true, "type": "text|select|textarea|file",
                "options": [], "value": "...", "source": "profile|draft|need|resume|edited|empty",
                "approved": false, "note": ""}],
    "result": null
  }]
}
"""

import hashlib
import json
import re
from datetime import datetime

from . import settings, store

_NAME = re.compile(r"^[\w.-]+$")


def _path(name: str):
    if not _NAME.match(name):
        raise ValueError("bad batch name")
    return settings.APPLY_DIR / f"{name}.json"


def content_hash(batch: dict) -> str:
    """Hash of what would be submitted (values, approvals, ready flags)."""
    core = [{"n": j["n"], "ready": j.get("ready"),
             "fields": [(f.get("key"), f.get("value"), f.get("approved")) for f in j.get("fields", [])]}
            for j in batch.get("jobs", [])]
    return hashlib.sha1(json.dumps(core, sort_keys=True).encode()).hexdigest()[:12]


def _field_needs(f: dict) -> bool:
    empty = f.get("value") in (None, "")
    return bool(f.get("required")) and (empty or f.get("source") == "need")


def _job_summary(j: dict) -> dict:
    fields = j.get("fields", [])
    return {
        "needs": sum(1 for f in fields if _field_needs(f)),
        "drafts_pending": sum(1 for f in fields if f.get("source") == "draft" and not f.get("approved")),
    }


def batch_summaries() -> list[dict]:
    out = []
    for p in sorted(settings.APPLY_DIR.glob("*.json"), reverse=True):
        b = store.read_json(p, {}) or {}
        jobs = b.get("jobs", [])
        sums = [_job_summary(j) for j in jobs]
        out.append({
            "name": b.get("name", p.stem),
            "created_at": b.get("created_at"),
            "jobs": len(jobs),
            "ready": sum(1 for j in jobs if j.get("ready")),
            "submitted": sum(1 for j in jobs if (j.get("result") or {}).get("status") == "submitted"),
            "needs": sum(s["needs"] for s in sums),
            "drafts_pending": sum(s["drafts_pending"] for s in sums),
        })
    return out


def get_batch(name: str) -> dict | None:
    b = store.read_json(_path(name), None)
    if b is None:
        return None
    for j in b.get("jobs", []):
        j["summary"] = _job_summary(j)
    b["hash"] = content_hash(b)
    b["changed_since_shown"] = bool(b.get("shown_hash")) and b.get("shown_hash") != b["hash"]
    b["submit_command"] = submit_command(b)
    return b


def submit_command(b: dict) -> str | None:
    nums = [str(j["n"]) for j in b.get("jobs", [])
            if j.get("ready") and not (j.get("result") or {}).get("status")]
    return f"submit {', '.join(nums)} from batch {b.get('name')}" if nums else None


def _snapshot(b: dict) -> dict:
    return {str(j["n"]): {"ready": bool(j.get("ready")),
                          "fields": {f.get("key"): [f.get("value"), f.get("approved")] for f in j.get("fields", [])}}
            for j in b.get("jobs", [])}


def mark_shown(name: str) -> str:
    """Claude calls this right after showing the review table: later dashboard edits show up as changes."""
    def change(b):
        b["shown_hash"] = content_hash(b)
        b["shown_snapshot"] = _snapshot(b)
        b["shown_at"] = datetime.now().isoformat(timespec="seconds")
        return b
    return store.update_json(_path(name), {}, change)["shown_hash"]


def changes(name: str) -> list[str]:
    """What changed since mark_shown, one line per change (empty list = nothing changed)."""
    b = store.read_json(_path(name), {}) or {}
    if "shown_snapshot" not in b:
        return ["This batch was never marked as shown: show the review table and run `shown` first."]
    before, now = b["shown_snapshot"], _snapshot(b)
    labels = {(str(j["n"]), f.get("key")): f.get("label") for j in b.get("jobs", []) for f in j.get("fields", [])}
    out = []
    for n, job in now.items():
        old = before.get(n, {"ready": False, "fields": {}})
        if job["ready"] != old["ready"]:
            out.append(f"#{n} ready: {old['ready']} -> {job['ready']}")
        for key, (value, approved) in job["fields"].items():
            o_value, o_approved = old["fields"].get(key, [None, None])
            label = labels.get((n, key), key)
            if value != o_value:
                out.append(f"#{n} {label}: {o_value!r} -> {value!r}")
            if approved != o_approved:
                out.append(f"#{n} {label}: draft {'approved' if approved else 'unapproved'}")
    return out


def set_result(name: str, n: int, status: str, note: str = "") -> dict:
    """Record what happened to job n: submitted / skipped / failed / unclear."""
    def change(b):
        for j in b.get("jobs", []):
            if j.get("n") == n:
                j["result"] = {"status": status, "at": datetime.now().isoformat(timespec="seconds"), "note": note}
        return b
    return store.update_json(_path(name), {}, change)


def add_job(name: str, job: dict) -> int:
    """Add (or replace, if not yet submitted) a prepared job in batch `name`. Returns its number."""
    out = {}

    def change(b):
        b.setdefault("name", name)
        b.setdefault("created_at", datetime.now().isoformat(timespec="seconds"))
        jobs_ = b.setdefault("jobs", [])
        old = next((j for j in jobs_ if j.get("job_id") == job.get("job_id")
                    and (j.get("result") or {}).get("status") != "submitted"), None)
        n = old["n"] if old else max([j.get("n", 0) for j in jobs_] + [0]) + 1
        if old:
            jobs_.remove(old)
        jobs_.append({**job, "n": n})
        jobs_.sort(key=lambda j: j["n"])
        out["n"] = n
        return b

    store.update_json(_path(name), {}, change)
    return out["n"]


def prepared_job_ids() -> set[str]:
    """Jobs already sitting in some batch (prepared or submitted)."""
    ids = set()
    for p in settings.APPLY_DIR.glob("*.json"):
        for j in (store.read_json(p, {}) or {}).get("jobs", []):
            if j.get("job_id"):
                ids.add(j["job_id"])
    return ids


def update_job(name: str, n: int, fields: list[dict], ready: bool | None) -> dict | None:
    """Edit field values / draft approvals and the ready flag of job n in a batch."""
    def change(b):
        for j in b.get("jobs", []):
            if j.get("n") != n:
                continue
            by_key = {f.get("key"): f for f in j.get("fields", [])}
            for edit in fields:
                f = by_key.get(edit.get("key"))
                if f is None:
                    continue
                if "value" in edit and edit["value"] != f.get("value"):
                    f["value"] = edit["value"]
                    if f.get("source") in ("need", "empty", "profile"):
                        f["source"] = "edited"
                if "approved" in edit and f.get("source") == "draft":
                    f["approved"] = bool(edit["approved"])
            if ready is not None:
                blocked = any(_field_needs(f) for f in j.get("fields", [])) or any(
                    f.get("source") == "draft" and not f.get("approved") for f in j.get("fields", []))
                j["ready"] = bool(ready) and not blocked
            j["edited_at"] = datetime.now().isoformat(timespec="seconds")
        return b

    if not _path(name).exists():
        return None
    store.update_json(_path(name), {}, change)
    return get_batch(name)
