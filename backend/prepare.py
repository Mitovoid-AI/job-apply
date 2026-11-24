"""Prepare applications: resume + form answers (+ grade), saved to today's auto batch.

After a scan, every job whose experience badge is in AUTO_PREPARE (default: fits, stretch) and that
isn't applied to or prepared yet goes through prepare_job. The user then only checks the filled
form window and presses Submit (see window.py).
"""

import shutil
from datetime import date, datetime
from pathlib import Path

from . import apply, jd, jobs, runners, settings
from .forms import answers, reader


def _batch_name() -> str:
    return f"auto-{date.today().isoformat()}"


def eligible(job: dict, prepared: set[str]) -> bool:
    status = (job.get("pipeline") or {}).get("status")
    return (job.get("in_scan") and job.get("source") in reader.ATS
            and (job.get("fit") or {}).get("level") in settings.AUTO_PREPARE
            and status in (None, "to_apply") and job["id"] not in prepared)


def prepare_job(job: dict, evaluate: bool | None = None) -> dict:
    """Resume, form answers and (optionally) a grade for one job. Returns a short summary."""
    if job.get("source") not in reader.ATS:
        raise RuntimeError("Only Greenhouse, Lever and Ashby forms can be prepared")
    entry = runners._ensure_tracked(job)
    resume_pdf = entry.get("resume_pdf")
    if not resume_pdf or not Path(resume_pdf).exists():
        resume_pdf = runners.resume(job)["pdf"]
        entry = runners._ensure_tracked(job)

    form = reader.read_form(job["url"], job["source"])
    text = (jd.ensure(job) or {}).get("text", "")
    ans = answers.answer_fields(form["fields"], job, text, resume_pdf)

    graded = None
    if (settings.AUTO_EVALUATE if evaluate is None else evaluate) and shutil.which(settings.CLAUDE_BIN) \
            and not entry.get("evaluation"):
        try:
            graded = runners.evaluate(job)
        except Exception as e:  # e.g. Claude not signed in: prepare anyway, without a grade
            graded = {"error": str(e)[:160]}
    entry = next((p for p in jobs.load_pipeline() if p.get("id") == entry.get("id")), entry)

    blockers = ["CAPTCHA on the page: solve it if it appears when you press Submit"] if form["captcha"] else []
    n = apply.add_job(_batch_name(), {
        "job_id": job["id"], "pipeline_id": entry.get("id"), "company": job["company"], "role": job["title"],
        "url": job["url"], "source": job["source"], "apply_url": form["apply_url"], "grade": entry.get("grade"),
        "fit": job.get("fit"), "resume_pdf": resume_pdf, "ready": False, "blockers": blockers,
        "consent": ans["consent"], "fields": ans["fields"], "result": None,
        "prepared_at": datetime.now().isoformat(timespec="seconds"),
        "grade_error": (graded or {}).get("error"),
    })
    return {"batch": _batch_name(), "n": n, "company": job["company"], "role": job["title"],
            "needs": ans["needs"], "drafts": ans["drafts"], "grade": entry.get("grade")}


def prepare_new() -> dict:
    """Prepare up to AUTO_PREPARE_MAX eligible jobs from the latest scan, one at a time: your roles
    before adjacent ones, fits before stretch, newest first."""
    prepared = apply.prepared_job_ids()
    todo = [j for j in jobs.list_jobs() if eligible(j, prepared)]
    todo.sort(key=lambda j: j.get("posted_at") or "", reverse=True)
    todo.sort(key=lambda j: (j.get("match") == "adjacent", (j.get("fit") or {}).get("level") != "fits"))
    waiting = max(0, len(todo) - settings.AUTO_PREPARE_MAX)
    todo = todo[:settings.AUTO_PREPARE_MAX]
    done, failed = [], []
    for job in todo:
        try:
            done.append(prepare_job(job))
        except Exception as e:
            failed.append({"company": job["company"], "role": job["title"], "error": str(e)[:200]})
    return {"prepared": done, "failed": failed, "total": len(todo), "waiting": waiting}
