"""The long-running work: scan (node), resume (resume-tailor CLI), evaluation (headless Claude Code)."""

import json
import re
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

from . import jd, jobs, settings, store

_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}


def _run(cmd: list[str], cwd: Path, timeout: int, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=timeout, **_NO_WINDOW)


def _tail(s: str, n: int = 600) -> str:
    return (s or "").strip()[-n:]


def scan() -> dict:
    from . import linkedin
    alerts = linkedin.import_inbox()  # LinkedIn alert .eml files dropped in data/linkedin-alerts/
    # Up to 15 min: with a big company list from Find companies there can be hundreds of boards.
    r = _run([settings.NODE_BIN, "scripts/scan.mjs"], settings.ROOT, timeout=900)
    if r.returncode != 0:
        raise RuntimeError(f"Scan failed: {_tail(r.stderr or r.stdout)}")
    found = [j for j in jobs.list_jobs() if j["in_scan"]]
    fetched = jd.refresh(found)
    scan_data = jobs.load_scan()
    if settings.AUTO_PREPARE:  # resumes + form answers for new jobs at your level, in the background
        from . import prepare, tasks
        tasks.start("prepare", "auto", prepare.prepare_new)
    return {"total": scan_data.get("total", 0), "unreachable": scan_data.get("errors", 0),
            "jds_fetched": fetched, "linkedin_added": alerts["added"]}


_LINKEDIN_ONLY = ("This job came from a LinkedIn alert, and LinkedIn pages aren't read automatically "
                  "(LinkedIn doesn't allow it). Open the posting to read it and apply.")


def discover() -> dict:
    """Find companies: check every board in portals/registry.json against the profile, save the ones
    with matching jobs to data/companies.json, then scan them (which also starts auto-prepare)."""
    r = _run([settings.NODE_BIN, "scripts/scan.mjs", "--discover", "--json"], settings.ROOT, timeout=3600)
    if r.returncode != 0:
        raise RuntimeError(f"Find companies failed: {_tail(r.stderr or r.stdout)}")
    try:
        found = json.loads((r.stdout or "").strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        raise RuntimeError(f"Find companies gave no summary: {_tail(r.stdout)}")
    return {**found, "scan": scan()}


def discovery_info() -> dict | None:
    data = store.read_json(settings.COMPANIES, None)
    if not data:
        return None
    return {"at": data.get("discovered_at"), "companies": len(data.get("companies", [])),
            "boards_checked": data.get("boards_checked", 0), "stale": discovery_stale(data)}


def _norm_list(xs) -> list[str]:
    return sorted({str(x).strip().lower() for x in (xs or []) if str(x).strip()})


def discovery_stale(data: dict | None = None) -> str | None:
    """Why the company list needs rebuilding ("missing", "profile_changed", "old"), or None if fresh."""
    from .profile import get_profile
    data = data if data is not None else store.read_json(settings.COMPANIES, None)
    if not data:
        return "missing"
    cand = (get_profile() or {}).get("candidate") or {}
    anywhere = any(str(l).strip().lower() in ("anywhere", "worldwide") for l in cand.get("locations") or [])
    if _norm_list(data.get("roles")) != _norm_list(cand.get("target_roles")) or bool(data.get("anywhere")) != anywhere:
        return "profile_changed"
    try:
        found_at = datetime.fromisoformat(str(data.get("discovered_at")).replace("Z", "+00:00"))
    except ValueError:
        return "old"
    return "old" if (datetime.now().astimezone() - found_at).days >= 7 else None


def _ensure_tracked(job: dict) -> dict:
    jobs.track(job)
    entry = next(p for p in jobs.load_pipeline() if jobs.norm_url(p.get("url", "")) == jobs.norm_url(job["url"]))
    return entry


def resume(job: dict) -> dict:
    if job.get("source") == "linkedin":  # the tailor would open the LinkedIn page
        raise RuntimeError(_LINKEDIN_ONLY)
    if not settings.TAILOR_DIR or not (settings.TAILOR_DIR / "tailor.py").exists():
        raise RuntimeError("TAILOR_DIR in .env doesn't point to the resume tailor repo (tailor.py not found)")
    cmd = [settings.TAILOR_PYTHON, "tailor.py", "--jd", job["url"], "--company", job["company"], "--json"]
    r = _run(cmd, settings.TAILOR_DIR, timeout=600)
    try:
        out = json.loads(r.stdout)  # --json prints only the result JSON on stdout
    except json.JSONDecodeError:
        raise RuntimeError(f"Tailor gave no JSON (exit {r.returncode}): {_tail(r.stderr or r.stdout)}")
    if not out.get("ok"):
        raise RuntimeError(out.get("error") or "Tailor failed")
    entry = _ensure_tracked(job)
    meta = {"base": out.get("base_label") or out.get("base"), "page_count": out.get("page_count"),
            "page_limit": out.get("page_limit", 1), "projects": out.get("projects_kept", []),
            "dropped": out.get("projects_dropped", []), "built_at": datetime.now().isoformat(timespec="seconds")}
    jobs.update_entry(entry["id"], {"resume_pdf": out["pdf"], "resume_meta": meta})
    return {"pdf": out["pdf"], **meta}


_EVAL_PROMPT = """Evaluate one job for me using modes/evaluate.md. Read modes/_shared.md, cv.md and
config/profile.yml first. The job description is below, so don't fetch the URL.

Company: {company}
Role: {title}
Location: {location}
URL: {url}

Write the full report (all blocks, with the 10-dimension score table) to {report}.
Don't create or change any other file. End your reply with one line that is only this JSON:
{{"grade": "A|B|C|D|F", "score": 0.0, "recommendation": "APPLY NOW|APPLY WITH TWEAKS|BORDERLINE|DO NOT APPLY", "summary": "max 2 sentences", "gaps": ["..."]}}

Job description:
{jd_text}
"""


def evaluate(job: dict) -> dict:
    if job.get("source") == "linkedin":
        raise RuntimeError(_LINKEDIN_ONLY)
    cached = jd.ensure(job) or {}
    if not cached.get("text"):
        raise RuntimeError("Couldn't fetch the job description for this posting")
    slug = re.sub(r"[^a-z0-9]+", "-", f"{job['company']}-{job['title']}".lower()).strip("-")[:60]
    report = f"reports/{date.today().isoformat()}-{slug}.md"
    prompt = _EVAL_PROMPT.format(company=job["company"], title=job["title"], location=job.get("location", ""),
                                 url=job["url"], report=report, jd_text=cached["text"][:12000])
    # The prompt goes on stdin: a multi-line argument breaks npm's claude.cmd shim on Windows,
    # and a long JD can pass the 32K command-line limit.
    cmd = [settings.CLAUDE_BIN, "-p", "Evaluate the job described in the input. Follow its instructions exactly.",
           "--output-format", "json", "--permission-mode", "acceptEdits",
           "--allowedTools", "Read", "Write", "Edit", "Glob", "Grep"]
    r = _run(cmd, settings.ROOT, timeout=600, stdin=prompt)
    try:
        envelope = json.loads(r.stdout)
    except json.JSONDecodeError:
        raise RuntimeError(f"Claude Code gave no JSON (exit {r.returncode}): {_tail(r.stderr or r.stdout)}")
    if envelope.get("is_error"):
        msg = str(envelope.get("result") or "")
        if "not logged in" in msg.lower() or "/login" in msg:
            raise RuntimeError("Claude Code isn't signed in on this machine. Run `claude` in a terminal, "
                               "use /login, then try Evaluate again.")
        raise RuntimeError(f"Claude Code error: {_tail(msg)}")
    text = envelope.get("result", "")
    found = re.findall(r"\{[^{}]*\"grade\"[^{}]*\}", text)
    if not found:
        raise RuntimeError("Claude's reply had no grade line")
    verdict = json.loads(found[-1])
    entry = _ensure_tracked(job)
    report_exists = (settings.ROOT / report).exists()
    jobs.update_entry(entry["id"], {
        "grade": verdict.get("grade"), "score": verdict.get("score"),
        "evaluation": {**verdict, "report": report if report_exists else None,
                       "evaluated_at": datetime.now().isoformat(timespec="seconds"),
                       "cost_usd": envelope.get("total_cost_usd")},
    })
    return {**verdict, "report": report if report_exists else None}
