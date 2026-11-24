"""The apply window: a Chrome window on this machine with the form filled and the resume attached.

The user checks it, solves a CAPTCHA if one appears, and presses the site's Submit button.
This module never clicks Submit. It watches for the confirmation page and then records the
application (tracker + batch). One window at a time.
"""

import re
import threading
import time
from datetime import datetime

from . import apply, jobs, settings
from .forms import filler, reader
from .forms.answers import _norm

_lock = threading.Lock()
_state: dict = {"status": "idle"}

# "Thanks for your interest" is left out on purpose: many job descriptions end with it.
CONFIRM_TEXT = re.compile(
    r"thank(s| you) for (applying|your application|submitting)|"
    r"application (has been |was )?(submitted|received|sent)|we('ve| have) received your application|"
    r"successfully (submitted|applied)|your application is on its way", re.I)
CONFIRM_URL = re.compile(r"/(confirmation|thanks|thank-you|application_confirmation|submitted)\b", re.I)


def state() -> dict:
    return dict(_state)


def _set(**kw) -> None:
    _state.update(kw, updated_at=datetime.now().isoformat(timespec="seconds"))


def _source(job: dict) -> str:
    if job.get("source") in reader.ATS:
        return job["source"]
    host = job.get("url", "")
    return "greenhouse" if "greenhouse" in host else "lever" if "lever.co" in host else "ashby" if "ashbyhq" in host else ""


def _merge(live: list[dict], saved: list[dict]) -> list[dict]:
    """Saved answers onto the live form, by field key then by label (forms change; old batches have no selectors)."""
    by_key = {f.get("key"): f for f in saved}
    by_label = {_norm(f.get("label")): f for f in saved}
    out = []
    for f in live:
        s = by_key.get(f["key"]) or by_label.get(_norm(f["label"]))
        out.append({**f, "value": s.get("value") if s else None})
    return out


def _submitted(page, start_url: str) -> str | None:
    """Confirmation text if the page now shows a submitted application."""
    try:
        url = page.url
        body = page.inner_text("body", timeout=2000)[:4000]
    except Exception:
        return None
    m = CONFIRM_TEXT.search(body)
    form_gone = page.locator("input[type=email], #email, #_systemfield_email, input[name=email]").count() == 0
    if m and form_gone:  # the text alone isn't proof: the form must be gone too
        return m.group(0)
    if CONFIRM_URL.search(url) and url != start_url:
        return f"confirmation page {url}"
    return None


def run(batch_name: str, n: int, headless: bool = False, max_wait: float = 3 * 3600) -> dict:
    """Open, fill, and wait for the user (up to 3 hours). Runs in a task thread.
    headless / max_wait exist for tests: the dashboard always opens a visible window."""
    if not _lock.acquire(blocking=False):
        raise RuntimeError("A form window is already open. Finish or close it first.")
    try:
        return _run(batch_name, n, headless, max_wait)
    finally:
        _lock.release()


def _run(batch_name: str, n: int, headless: bool, max_wait: float) -> dict:
    from playwright.sync_api import sync_playwright

    batch = apply.get_batch(batch_name)
    job = next((j for j in (batch or {}).get("jobs", []) if j.get("n") == n), None)
    if not job:
        raise RuntimeError("That job isn't in the batch")
    if (job.get("result") or {}).get("status") == "submitted":
        raise RuntimeError("Already submitted")
    source = _source(job)
    if not source:
        raise RuntimeError("Only Greenhouse, Lever and Ashby forms can be filled")
    _set(status="opening", batch=batch_name, n=n, company=job["company"], role=job["role"], problems=[], missing=[])

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(settings.DATA / "browser-profile"), channel="chrome", headless=headless,
            no_viewport=True, args=["--start-maximized"])
        try:
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            reader.open_form(page, job["url"], source)
            _set(status="filling")
            live = reader.read_page(page)["fields"]
            fields = _merge(live, job.get("fields", []))
            if job.get("resume_pdf"):
                for f in fields:
                    if f["type"] == "file" and re.search(r"resume|cv", f["label"], re.I):
                        f["value"] = job["resume_pdf"]
            report = filler.fill(page, fields)
            missing = filler.unfilled_required(page, fields)
            start_url = page.url
            try:
                page.locator("button[type=submit], button:has-text('Submit')").last.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass
            _set(status="waiting", problems=report["problems"], missing=missing)

            deadline = time.time() + max_wait
            while time.time() < deadline:
                if not ctx.pages:
                    _set(status="closed")
                    return {"status": "closed", "company": job["company"]}
                for pg in ctx.pages:
                    proof = _submitted(pg, start_url)
                    if proof:
                        _record(batch_name, job, proof)
                        _set(status="submitted", proof=proof)
                        time.sleep(4)  # let the user see the confirmation
                        return {"status": "submitted", "company": job["company"], "proof": proof}
                try:
                    ctx.pages[0].wait_for_timeout(1500)
                except Exception:
                    time.sleep(1.5)
            _set(status="timeout")
            return {"status": "timeout", "company": job["company"]}
        finally:
            try:
                ctx.close()
            except Exception:
                pass


def _record(batch_name: str, job: dict, proof: str) -> None:
    apply.set_result(batch_name, job["n"], "submitted", f"Submitted by you in the form window ({proof})")
    entry_id = job.get("pipeline_id")
    if entry_id is None:
        entry = next((p for p in jobs.load_pipeline() if jobs.norm_url(p.get("url", "")) == jobs.norm_url(job["url"])), None)
        entry_id = entry and entry.get("id")
    if entry_id is not None:
        jobs.update_entry(entry_id, {"status": "applied", "applied_via": "dashboard", "apply_batch": batch_name,
                                     "resume_pdf": job.get("resume_pdf")})
