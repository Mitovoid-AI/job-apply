"""Jobs from LinkedIn job-alert emails: paste an alert on the Jobs page, or drop .eml files in
data/linkedin-alerts/ (each scan imports them and renames them to .done).

LinkedIn itself is never contacted (its terms forbid scraping): only the job links, titles,
companies and locations already in the email are read. Jobs older than 30 days are dropped.
These jobs can't be auto-prepared or read for a resume; open the posting to apply.
"""

import email
import html
import re
from datetime import datetime, timedelta
from email import policy

from . import settings, store

KEEP_DAYS = 30
_JOB_URL = re.compile(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/(?:comm/)?jobs/view/(?:[^/?\s\"'<>]*?-)?(\d{6,})", re.I)
# Lines in an alert that aren't a title, company or location.
_SKIP = re.compile(
    r"^(?:view job|apply(?: now)?|easy apply|actively recruiting|promoted|new|be an early applicant|"
    r"this company is actively hiring|fast growing|see all jobs.*|your job alert.*|.*jobs? match(?:es)? your.*|"
    r"jobs? similar to.*|unsubscribe.*|manage (?:job )?alerts?.*|help.*|.*linkedin.*|-{3,}|={3,}|"
    r"\d+\s+(?:applicants?|connections?|school alumni|company alumni|alumni).*|.*\b\d+\s+(?:minutes?|hours?|days?|weeks?) ago|"
    r"(?:\d+\s+)?(?:new )?jobs?(?: for you)?|.*\$[\d,.]+.*/yr.*|.*₹[\d,.]+.*)$", re.I)


def _text_parts(raw: str | bytes) -> tuple[str | None, str | None]:
    """(plain, html) bodies of a .eml file (bytes), a pasted raw email, or plain pasted text."""
    if isinstance(raw, bytes) or re.search(r"^content-type:", raw[:5000], re.I | re.M):
        msg = (email.message_from_bytes(raw, policy=policy.default) if isinstance(raw, bytes)
               else email.message_from_string(raw, policy=policy.default))
        plain = msg.get_body(preferencelist=("plain",))
        rich = msg.get_body(preferencelist=("html",))
        return (plain.get_content() if plain else None), (rich.get_content() if rich else None)
    if re.search(r"<a\s[^>]*href=", raw, re.I):
        return None, raw
    return raw, None


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _fill(job: dict, lines: list[str]) -> None:
    """Title, company and location from the lines next to a job link ("Company · Location" too)."""
    lines = [l for l in lines if l and not _SKIP.match(l) and not _JOB_URL.search(l) and len(l) < 120]
    if not job.get("title") and lines:
        job["title"] = lines.pop(0)
    if lines and " · " in lines[0]:
        job["company"], job["location"] = (p.strip() for p in lines[0].split(" · ", 1))
        return
    if lines:
        job["company"] = lines.pop(0)
    if lines:
        job["location"] = lines.pop(0)


def parse_alert(raw: str | bytes) -> list[dict]:
    """Jobs in one alert email: [{id, url, title, company, location}], one per LinkedIn job id."""
    plain, rich = _text_parts(raw or "")
    jobs: dict[str, dict] = {}
    if rich and _JOB_URL.search(rich):
        # HTML alert: the job link's text is the title; company and location follow the link.
        links = list(re.finditer(r"<a\s[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", rich, re.I | re.S))
        hits = [(m, _JOB_URL.search(html.unescape(m.group(1)))) for m in links]
        hits = [(m, u.group(1)) for m, u in hits if u]
        for i, (m, jid) in enumerate(hits):
            job = jobs.setdefault(jid, {"id": jid})
            title = _clean(m.group(2))
            if title and not _SKIP.match(title) and not job.get("title"):
                job["title"] = title
            nxt = next((h.start() for h, j2 in hits[i + 1:] if j2 != jid), len(rich))
            if not job.get("company"):
                after = re.sub(r"<(br|p|div|tr|td|li|table)[^>]*>", "\n", rich[m.end():nxt], flags=re.I)
                _fill(job, [_clean(l) for l in after.split("\n")])
    elif plain:
        # Text alert: title, company and location are the lines just before "View job: <link>".
        lines = [l.strip() for l in plain.splitlines()]
        start = 0
        for i, line in enumerate(lines):
            u = _JOB_URL.search(line)
            if not u:
                continue
            job = jobs.setdefault(u.group(1), {"id": u.group(1)})
            if not job.get("title"):
                block = [l for l in lines[start:i] if l and not _SKIP.match(l)][-3:]
                _fill(job, block)
            start = i + 1
    out = []
    for jid, j in jobs.items():
        if not j.get("title"):
            continue
        out.append({"id": jid, "url": f"https://www.linkedin.com/jobs/view/{jid}/", "title": j["title"],
                    "company": j.get("company", ""), "location": j.get("location", "")})
    return out


def load() -> list[dict]:
    return store.read_json(settings.LINKEDIN_JOBS, []) or []


def import_text(raw: str | bytes) -> dict:
    """Add an alert's jobs to data/linkedin_jobs.json. Returns {found, added}."""
    found = parse_alert(raw)
    now = datetime.now()
    cutoff = (now - timedelta(days=KEEP_DAYS)).isoformat(timespec="seconds")
    added = 0

    def change(saved: list):
        nonlocal added
        known = {j["id"] for j in saved}
        for j in found:
            if j["id"] not in known:
                saved.append({**j, "source": "linkedin", "imported_at": now.isoformat(timespec="seconds")})
                added += 1
        return [j for j in saved if j.get("imported_at", "") >= cutoff]

    store.update_json(settings.LINKEDIN_JOBS, [], change)
    return {"found": len(found), "added": added}


def import_inbox() -> dict:
    """Import every .eml in data/linkedin-alerts/ and rename it to .eml.done."""
    folder = settings.LINKEDIN_INBOX
    folder.mkdir(parents=True, exist_ok=True)
    files = found = added = 0
    for p in sorted(folder.glob("*.eml")):
        r = import_text(p.read_bytes())
        files += 1
        found += r["found"]
        added += r["added"]
        p.rename(p.with_name(p.name + ".done"))
    return {"files": files, "found": found, "added": added}
