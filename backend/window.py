"""The apply window: a Chrome window on this machine with the form filled and the resume attached.

Open filled form: the user checks it, solves a CAPTCHA if one appears, and presses the site's Submit
button. Submit (the dashboard button, one job per click, after the user confirms): the same window
fills the form and presses the site's Submit button itself, but only when no required field is empty
and no CAPTCHA is showing; anything else (a CAPTCHA, an error, no confirmation) hands the window back
to the user. Either way it watches for the confirmation page and then records the application
(tracker + batch). One window at a time. CAPTCHAs are never solved or worked around.
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


_SUBMIT_SELECTORS = ["#submit_app", "#btn-submit", "button.ashby-application-form-submit-button"]
_SUBMIT_NAME = re.compile(r"^\s*submit(\s+(your|my))?(\s+application)?\s*$", re.I)
# A CAPTCHA the user has to answer: a visible challenge or checkbox. Greenhouse's invisible reCAPTCHA
# badge doesn't count (it needs nothing from the user).
_CAPTCHA_FRAMES = ('iframe[src*="recaptcha"][src*="bframe"], iframe[src*="recaptcha"][src*="anchor"]:not([src*="size=invisible"]), '
                   'iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[title*="challenge" i]')


def _visible(loc, limit: int = 8, min_size: int = 2) -> list:
    out = []
    for i in range(min(loc.count(), limit)):
        try:
            el = loc.nth(i)
            if el.is_visible():
                box = el.bounding_box()
                if box and box["width"] > min_size and box["height"] > min_size:
                    out.append(el)
        except Exception:
            continue
    return out


def _captcha_showing(page) -> bool:
    try:
        return bool(_visible(page.locator(_CAPTCHA_FRAMES), min_size=30))  # tiny frames aren't a challenge
    except Exception:
        return False


def _find_submit(page):
    """The form's own Submit button: known ids first, then a button named "Submit (application)",
    then the last visible submit button."""
    for sel in _SUBMIT_SELECTORS:
        found = _visible(page.locator(sel))
        if found:
            return found[-1]
    found = _visible(page.get_by_role("button", name=_SUBMIT_NAME))
    if found:
        return found[-1]
    found = _visible(page.locator("button[type=submit], input[type=submit]"))
    return found[-1] if found else None


def _field_errors(page) -> bool:
    try:
        return bool(_visible(page.locator('[aria-invalid="true"], .field-error, .error-message, [role="alert"]:not(:empty)')))
    except Exception:
        return False


def _auto_submit(page, missing: list[str], start_url: str, wait: float = 45) -> dict:
    """Press the site's Submit when it's safe to; {"proof": ...} once confirmed, else {"reason": ...}."""
    if missing:
        return {"reason": f"{len(missing)} required field{'s are' if len(missing) > 1 else ' is'} still empty "
                          f"({', '.join(missing[:3])}). Fill {'them' if len(missing) > 1 else 'it'} in the window and press Submit."}
    if _captcha_showing(page):
        return {"reason": "The form shows a CAPTCHA. Answer it in the window and press Submit."}
    btn = _find_submit(page)
    if btn is None:
        return {"reason": "Couldn't find the form's Submit button. Press it yourself in the window."}
    _set(status="submitting")
    try:
        btn.scroll_into_view_if_needed(timeout=5000)
        btn.click(timeout=10000)
    except Exception as e:
        return {"reason": f"Couldn't press Submit ({str(e).splitlines()[0][:80]}). Press it yourself in the window."}
    deadline = time.time() + wait
    while time.time() < deadline:
        proof = _submitted(page, start_url)
        if proof:
            return {"proof": proof}
        if _captcha_showing(page):
            return {"reason": "A CAPTCHA appeared after Submit. Answer it in the window; the application is "
                              "recorded when the confirmation page shows."}
        try:
            page.wait_for_timeout(1000)
        except Exception:
            return {"reason": "The window was closed right after Submit. Check whether the application went through."}
    if _field_errors(page):
        return {"reason": "The site flagged a problem with the form. Fix it in the window and press Submit again."}
    return {"reason": "Submit was pressed, but no confirmation page showed yet. Check the window."}


def run(batch_name: str, n: int, headless: bool = False, max_wait: float = 3 * 3600, submit: bool = False) -> dict:
    """Open, fill, (with submit=True) press the site's Submit when safe, and wait for the user (up to
    3 hours). Runs in a task thread. headless / max_wait exist for tests: the dashboard always opens a
    visible window."""
    if not _lock.acquire(blocking=False):
        raise RuntimeError("A form window is already open. Finish or close it first.")
    try:
        return _run(batch_name, n, headless, max_wait, submit)
    finally:
        _lock.release()


def _run(batch_name: str, n: int, headless: bool, max_wait: float, submit: bool = False) -> dict:
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
    _set(status="opening", batch=batch_name, n=n, company=job["company"], role=job["role"], problems=[], missing=[],
         reason=None, proof=None)

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
            if submit:  # the user clicked Submit on the dashboard for this job and confirmed
                outcome = _auto_submit(page, missing, start_url)
                if outcome.get("proof"):
                    _record(batch_name, job, outcome["proof"], by_dashboard=True)
                    _set(status="submitted", proof=outcome["proof"])
                    time.sleep(4)  # let the user see the confirmation
                    return {"status": "submitted", "company": job["company"], "proof": outcome["proof"]}
                _set(status="needs_you", reason=outcome["reason"], problems=report["problems"], missing=missing)
            else:
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


def _record(batch_name: str, job: dict, proof: str, by_dashboard: bool = False) -> None:
    how = "Submitted from the dashboard's Submit button" if by_dashboard else "Submitted by you in the form window"
    apply.set_result(batch_name, job["n"], "submitted", f"{how} ({proof})")
    entry_id = job.get("pipeline_id")
    if entry_id is None:
        entry = next((p for p in jobs.load_pipeline() if jobs.norm_url(p.get("url", "")) == jobs.norm_url(job["url"])), None)
        entry_id = entry and entry.get("id")
    if entry_id is not None:
        jobs.update_entry(entry_id, {"status": "applied", "applied_via": "dashboard", "apply_batch": batch_name,
                                     "resume_pdf": job.get("resume_pdf")})
