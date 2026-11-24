"""Job descriptions: fetch from the ATS APIs, cache in data/jd/, and read the experience asked.

The scanner only sees titles. Most matches turn out to ask for 3+ years, so after each
scan the full JD is fetched and the first "N years" requirement is pulled out, to show a
fits / stretch / senior badge before anyone spends an evaluation on the job.
"""

import html
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlsplit

import httpx

from . import settings, store

_TIMEOUT = 15


def _strip_html(s: str) -> str:
    s = html.unescape(html.unescape(s or ""))
    s = re.sub(r"<(br|p|li|h\d|div)[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"[ \t ]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def fetch_text(url: str, source: str) -> str | None:
    """Plain-text JD from the board's public API (Greenhouse / Lever / Ashby)."""
    parts = [p for p in urlsplit(url).path.split("/") if p]
    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=True) as c:
            if source == "greenhouse" and "jobs" in parts:
                board, jid = parts[0], parts[parts.index("jobs") + 1]
                d = c.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{jid}").json()
                return _strip_html(d.get("content", ""))
            if source == "lever" and len(parts) >= 2:
                d = c.get(f"https://api.lever.co/v0/postings/{parts[0]}/{parts[1]}").json()
                lists = "\n".join(f"{l.get('text', '')}\n{_strip_html(l.get('content', ''))}" for l in d.get("lists", []))
                return "\n".join([d.get("descriptionPlain", ""), lists, d.get("additionalPlain", "")]).strip()
            if source == "ashby" and len(parts) >= 2:
                d = c.get(f"https://api.ashbyhq.com/posting-api/job-board/{parts[0]}").json()
                job = next((j for j in d.get("jobs", []) if j.get("id") == parts[1]), None)
                if job:
                    return job.get("descriptionPlain") or _strip_html(job.get("descriptionHtml", ""))
    except (httpx.HTTPError, ValueError, IndexError):
        return None
    return None


_RANGE = re.compile(r"(\d{1,2})\s*\+?\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs)", re.I)
_PLUS = re.compile(r"(\d{1,2})\s*(?:\+|plus)\s*(?:years|yrs)", re.I)
_PLAIN = re.compile(r"(?:at least|minimum(?: of)?)?\s*(\d{1,2})\s*(?:years|yrs)", re.I)


def extract_years(text: str) -> dict | None:
    """First experience requirement in the JD: {min, max, quote} or None."""
    if not text:
        return None
    candidates = []
    for rx, kind in ((_RANGE, "range"), (_PLUS, "plus"), (_PLAIN, "plain")):
        for m in rx.finditer(text):
            window = text[max(0, m.start() - 80): m.end() + 60].lower()
            if "experience" not in window and kind == "plain":
                continue
            if re.search(r"year(s)?\s*(degree|old|of age|warranty|history)", text[m.end() - 6: m.end() + 15], re.I):
                continue
            lo = int(m.group(1))
            hi = int(m.group(2)) if kind == "range" else None
            if lo > 20 or (hi is not None and hi > 25):
                continue
            quote = re.sub(r"\s+", " ", text[max(0, m.start() - 50): m.end() + 30]).strip()
            candidates.append((m.start(), {"min": lo, "max": hi, "quote": quote}))
    if not candidates:
        return None
    return min(candidates, key=lambda c: c[0])[1]


def _cache_path(job_id: str):
    return settings.JD_CACHE / f"{job_id}.json"


def get(job_id: str) -> dict | None:
    return store.read_json(_cache_path(job_id), None)


def ensure(job: dict, force: bool = False) -> dict | None:
    """Fetch and cache one job's JD (and years asked) if not cached yet."""
    path = _cache_path(job["id"])
    if not force and path.exists():
        return get(job["id"])
    text = fetch_text(job["url"], job.get("source", ""))
    if text is None:
        return None
    data = {"url": job["url"], "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "years": extract_years(text), "text": text}
    store.update_json(path, {}, lambda _: data)
    return data


def refresh(jobs: list[dict]) -> int:
    """Fetch missing JDs for these jobs in parallel. Returns how many were fetched."""
    todo = [j for j in jobs if not _cache_path(j["id"]).exists()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(ensure, todo))
    # Boards sometimes drop parallel requests: retry the failures one at a time.
    retried = [ensure(j) for j, r in zip(todo, results) if not r]
    return sum(1 for r in results if r) + sum(1 for r in retried if r)


def _experience() -> float:
    prof = store.read_yaml(settings.PROFILE) or {}
    try:
        return float((prof.get("candidate") or {}).get("experience_years") or 0)
    except (TypeError, ValueError):
        return 0.0


def fit_for(job_id: str, exp: float | None = None) -> dict | None:
    """fits: asks <= your years; stretch: up to 1.5 years more; senior: beyond that."""
    cached = get(job_id)
    if cached is None:
        return None
    years = cached.get("years")
    if not years:
        return {"level": "unknown", "min": None, "max": None, "quote": None}
    exp = _experience() if exp is None else exp
    lo = years["min"]
    level = "fits" if lo <= exp else "stretch" if lo <= exp + 1.5 else "senior"
    return {"level": level, **years}
