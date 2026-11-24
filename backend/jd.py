"""Job descriptions: fetch from the ATS APIs, cache in data/jd/, and read the experience asked.

The scanner only sees titles. Most matches turn out to ask for 3+ years, so after each
scan the full JD is fetched and the first "N years" requirement is pulled out, to show a
fits / stretch / senior badge before anyone spends an evaluation on the job.
"""

import html
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from urllib.parse import urlsplit

import httpx

from . import settings, store

_TIMEOUT = 15
# Ashby only serves a whole board at once: keep each board for 10 minutes so fetching 200 jobs from
# one company downloads its board once, not 200 times.
_ASHBY_BOARDS: dict[str, tuple[float, dict]] = {}


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
                hit = _ASHBY_BOARDS.get(parts[0])
                if hit and time.monotonic() - hit[0] < 600:
                    d = hit[1]
                else:
                    d = c.get(f"https://api.ashbyhq.com/posting-api/job-board/{parts[0]}").json()
                    _ASHBY_BOARDS[parts[0]] = (time.monotonic(), d)
                job = next((j for j in d.get("jobs", []) if j.get("id") == parts[1]), None)
                if job:
                    return job.get("descriptionPlain") or _strip_html(job.get("descriptionHtml", ""))
    except (httpx.HTTPError, ValueError, IndexError):
        return None
    return None


_RANGE = re.compile(r"(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs)", re.I)
_PLUS = re.compile(r"(\d{1,2})\s*(?:\+|plus)\s*(?:years|yrs)", re.I)
_PLAIN = re.compile(r"(?:at least|minimum(?: of)?)?\s*(\d{1,2})\s*(?:years|yrs)", re.I)
_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15}
# "three years", "two to four years", "three (3) years": spelled numbers that come just before "years".
_WORD_NUM = re.compile(r"\b(" + "|".join(_NUM_WORDS) + r")\b(?=[^.\n]{0,25}?\b(?:years|yrs)\b)", re.I)
# A time frame or company history, not a requirement: "over the next 1-2 years", "within 2 years",
# "in business for over 20 years".
_NOT_REQUIREMENT_BEFORE = re.compile(
    r"(?:\b(?:next|past|last|first|coming|within|every|per|each|after)\s+(?:the\s+)?|\bover\s+the\s+"
    r"|\bfor\s+(?:over|more\s+than|nearly|almost|about)\s+)$", re.I)
_NOT_REQUIREMENT_AFTER = re.compile(r"^\s*(?:-\s*)?(?:degree|old|of\s+age|warranty|history|ago|in\s+a\s+row|in\s+business)", re.I)
_EXPERIENCE_WORDS = re.compile(r"experience|\bexp\b|hands[- ]on|professional|industry|working|track record|proven|proficien", re.I)
# "Preferred" years: the word comes before the figure in its sentence ("Ideally 3+ years"), right after
# it ("5+ years preferred"), or in a short heading above it ("Nice to have"). Not "8+ years in X, ideally
# at a startup", where "ideally" is about the field.
_PREF_BEFORE = re.compile(r"prefer|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|ideally|desirable", re.I)
_PREF_AFTER = re.compile(r"^[^.\n;,]{0,25}?\b(?:preferred|is a plus|a plus|nice to have|desirable|is an advantage)\b", re.I)
_PREF_HEADING = re.compile(r"prefer|nice[- ]to[- ]have|good[- ]to[- ]have|bonus|\bplus\b", re.I)
_REQ_HEADING = re.compile(r"requir|minimum|basic|must|what you(?:'|’)?ll need|what we(?:'|’)?re looking for|qualifications", re.I)


def _preferred(text: str, sent_start: int, s: int, end: int) -> bool:
    if _PREF_BEFORE.search(text[sent_start:s]) or _PREF_AFTER.search(text[end:end + 60]):
        return True
    line_start = text.rfind("\n", 0, sent_start) + 1  # whole lines above this one only
    for line in reversed(text[max(0, line_start - 600):line_start].split("\n")):  # nearest heading decides
        line = line.strip()
        if not line or len(line) > 60 or re.search(r"\d\s*\+?\s*(?:years|yrs)", line, re.I):
            continue
        if _PREF_HEADING.search(line):
            return True
        if _REQ_HEADING.search(line):
            return False
    return False
YEARS_VERSION = 2  # bump when extract_years changes: cached JDs are re-read


def _sentence(text: str, start: int, end: int) -> tuple[int, str]:
    a = max(text.rfind("\n", 0, start), text.rfind(". ", 0, start)) + 1
    ends = [i for i in (text.find("\n", end), text.find(". ", end)) if i != -1]
    return a, text[a:min(ends) if ends else len(text)]


def extract_years(text: str) -> dict | None:
    """The experience the JD requires: {min, max, quote, preferred} or None.

    The first required figure wins; "preferred" / "nice to have" figures count only when there's no
    required one (preferred: true). Time frames, degrees, ages and company history are skipped."""
    if not text:
        return None
    text = _WORD_NUM.sub(lambda m: str(_NUM_WORDS[m.group(1).lower()]), text)
    text = re.sub(r"(\d{1,2})\s*\(\s*\d{1,2}\s*\)", r"\1", text)  # "3 (3) years" -> "3 years"
    candidates, taken = [], []
    for rx, kind in ((_RANGE, "range"), (_PLUS, "plus"), (_PLAIN, "plain")):
        for m in rx.finditer(text):
            s = m.start(1)
            if any(a <= s < b for a, b in taken):  # "5 years" inside an already-read "2-5 years"
                continue
            sent_start, sentence = _sentence(text, s, m.end())
            if kind == "plain" and not _EXPERIENCE_WORDS.search(sentence[:400]):
                continue
            if _NOT_REQUIREMENT_BEFORE.search(text[max(0, s - 40): s]) or _NOT_REQUIREMENT_AFTER.search(text[m.end(): m.end() + 20]):
                continue
            lo = int(m.group(1))
            hi = int(m.group(2)) if kind == "range" else None
            if lo > 20 or (hi is not None and (hi > 25 or hi < lo)):
                continue
            taken.append((s, m.end()))
            quote = re.sub(r"\s+", " ", text[max(0, s - 50): m.end() + 30]).strip()
            candidates.append((s, {"min": lo, "max": hi, "quote": quote,
                                   "preferred": _preferred(text, sent_start, s, m.end())}))
    if not candidates:
        return None
    required = [c for c in candidates if not c[1]["preferred"]]
    return min(required or candidates, key=lambda c: c[0])[1]


def _cache_path(job_id: str):
    return settings.JD_CACHE / f"{job_id}.json"


def get(job_id: str) -> dict | None:
    """Cached JD; re-reads the years asked when extract_years has changed since it was cached."""
    path = _cache_path(job_id)
    data = store.read_json(path, None)
    if data and data.get("text") and data.get("years_v") != YEARS_VERSION:
        data = {**data, "years": extract_years(data["text"]), "years_v": YEARS_VERSION}
        store.update_json(path, {}, lambda _: data)
    return data


def ensure(job: dict, force: bool = False) -> dict | None:
    """Fetch and cache one job's JD (and years asked) if not cached yet."""
    path = _cache_path(job["id"])
    if not force and path.exists():
        return get(job["id"])
    text = fetch_text(job["url"], job.get("source", ""))
    if text is None:
        return None
    data = {"url": job["url"], "fetched_at": datetime.now().isoformat(timespec="seconds"),
            "years": extract_years(text), "years_v": YEARS_VERSION, "text": text}
    store.update_json(path, {}, lambda _: data)
    return data


def refresh(jobs: list[dict]) -> int:
    """Fetch missing JDs for these jobs in parallel. Returns how many were fetched."""
    todo = [j for j in jobs if not _cache_path(j["id"]).exists()]
    with ThreadPoolExecutor(max_workers=8) as pool:
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


_YEARS: dict[str, tuple[float, dict | None]] = {}  # job id -> (cache file mtime, years)


def _years(job_id: str) -> tuple[bool, dict | None]:
    """(has a cached JD, years asked), remembered until the cache file changes: the job list reads
    thousands of these, and the full JD files are large."""
    path = _cache_path(job_id)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return False, None
    hit = _YEARS.get(job_id)
    if hit and hit[0] == mtime:
        return True, hit[1]
    years = (get(job_id) or {}).get("years")  # get() may re-read the years and rewrite the file
    try:
        _YEARS[job_id] = (path.stat().st_mtime, years)
    except OSError:
        pass
    return True, years


def fit_for(job_id: str, exp: float | None = None) -> dict | None:
    """fits: asks <= your years; stretch: up to 1.5 years more; senior: beyond that."""
    cached, years = _years(job_id)
    if not cached:
        return None
    if not years:
        return {"level": "unknown", "min": None, "max": None, "quote": None}
    exp = _experience() if exp is None else exp
    lo = years["min"]
    level = "fits" if lo <= exp else "stretch" if lo <= exp + 1.5 else "senior"
    if level == "senior" and years.get("preferred"):  # only "preferred" years: not a hard bar
        level = "stretch"
    return {"level": level, **years}
