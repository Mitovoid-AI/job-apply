"""Answer each form field: profile values by rules, the rest drafted by the LLM.

Every answer gets a source: profile | resume | draft (LLM) | need (only the user knows) | empty
(optional, left blank). Nothing here invents facts: rules only copy profile values, and the LLM is
told to answer only from cv.md + the profile and to leave anything else empty.
"""

import json
import re

from .. import llm, settings, store

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
EEO = re.compile(r"gender|race|ethnic|veteran|disabilit|sexual orientation|pronoun|caste|religion", re.I)
MARKETING = re.compile(r"future (job )?opportunit|newsletter|marketing|talent (pool|community)|keep me updated|stay in touch", re.I)
CONSENT = re.compile(r"agree|consent|acknowledge|privacy|terms|certify|accurate", re.I)
# Facts only the candidate knows: never drafted, always left for them.
ONLY_YOU = re.compile(
    r"(know|heard) (about|of) .{0,40}before|before (our|this) reach|referr|refer(red)? by|"
    r"applied (here|to us|before|previously)|previously (worked|employed|applied|interviewed)|"
    r"relative|family member|friend (who )?works|earliest (start|joining)|joining date|date of joining|"
    r"available to (start|join)|when can you (start|join)|date of birth|\bdob\b|\bage\b|marital|"
    r"passport|pan (card|number)|aadhaar|background (check|verification)|criminal|convict|"
    r"non-?compete|service bond|disciplinary", re.I)


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9+]+", " ", str(s or "").lower()).strip()


def best_option(value, options: list[str]) -> str | None:
    """Pick the option that matches value: exact, then starts-with, then whole-word contains."""
    if value in (None, "") or not options:
        return None
    v = _norm(value)
    norm = [(_norm(o), o) for o in options]
    for n, o in norm:
        if n == v:
            return o
    for n, o in norm:
        if n.startswith(v + " ") or n.startswith(v):
            return o
    for n, o in norm:
        if re.search(rf"\b{re.escape(v)}\b", n):
            return o
    for n, o in norm:
        if n and re.search(rf"\b{re.escape(n)}\b", v):
            return o
    return None


def _years_option(years: float, options: list[str]) -> str | None:
    """'1+ Years' / '1-2 years' / '0-1 Years' style bands: the band that contains `years`."""
    best = None
    for o in options:
        n = _norm(o)
        if "fresher" in n:
            if years < 0.5:
                return o
            continue
        m = re.match(r"(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)", n)
        if m and float(m.group(1)) <= years < float(m.group(2)):
            return o
        m = re.match(r"(\d+(?:\.\d+)?)\s*\+", n)
        if m and float(m.group(1)) <= years and (best is None or float(m.group(1)) > best[0]):
            best = (float(m.group(1)), o)
    return best[1] if best else None


def _yes_no(text) -> str | None:
    t = _norm(text)
    if t.startswith(("yes", "y ")) or t == "y":
        return "Yes"
    if t.startswith(("no", "n ")) or t == "n":
        return "No"
    return None


def _num(text) -> str:
    m = re.search(r"\d+(?:\.\d+)?", str(text or ""))
    return m.group(0) if m else ""


def _profile() -> tuple[dict, dict]:
    prof = store.to_plain(store.read_yaml(settings.PROFILE) or {})
    return prof.get("application_answers") or {}, prof.get("candidate") or {}


def rule_value(label: str, ftype: str, options: list[str], a: dict) -> tuple[object, str] | None:
    """(value, note) from the profile for well-known questions, or None."""
    L = label.lower()
    name = str(a.get("full_name") or "").split()
    exp = float(_num(a.get("total_experience_years")) or 0)

    def opt(v):
        return best_option(v, options) if options else v

    if re.search(r"preferred (first )?name", L):
        return (name[0] if name else None), ""
    if re.search(r"first name|given name", L):
        return (name[0] if name else None), ""
    if re.search(r"last name|surname|family name", L):
        return (" ".join(name[1:]) if len(name) > 1 else None), ""
    if re.search(r"^(full )?name\b|your name|full name", L):
        return a.get("full_name"), ""
    if re.search(r"e-?mail", L):
        return a.get("email"), ""
    if re.search(r"phone|mobile|contact number", L):
        return a.get("phone"), ""
    if re.search(r"linkedin", L):
        return a.get("linkedin"), ""
    if re.search(r"github", L):
        return a.get("github"), ""
    if re.search(r"portfolio|personal (web)?site|^website|other website", L):
        return a.get("portfolio"), ""
    if re.search(r"twitter|x\.com", L):
        return None, ""
    if ftype in ("combobox", "select") and re.fullmatch(r"country", L.strip()):
        return opt("India"), ""
    if re.search(r"(current )?(location|city)\b", L) and not re.search(r"prefer|relocat|applying for|willing", L):
        return a.get("current_city"), ""
    if re.search(r"current (company|employer|organi[sz]ation)|^company$|^org", L):
        return a.get("current_company"), ""
    if re.search(r"designation|current (job )?title|current role|job title", L):
        return a.get("current_title"), ""
    numeric_only = bool(re.search(r"lakh|\blpa\b|in days|numeric|number of days", L))
    if re.search(r"notice", L):
        n = str(a.get("notice_period") or "")
        if re.search(r"immediate", n, re.I):
            return ("0" if numeric_only else "Immediate"), ""
        days = _num(n)
        return ((days if numeric_only else (f"{days} days" if days and n.strip() == days else n)) or None), ""
    generic_exp = re.search(r"(total|relevant|overall)\s+(professional\s+|work\s+)?experience"
                            r"|^(how many )?years of (total |professional |work )?experience( do you have)?\??$"
                            r"|^(professional |work )?experience( \(years\))?\??$", L.strip())
    if generic_exp:
        if options:
            return _years_option(exp, options), "counts internships"
        return (str(int(exp)) if exp == int(exp) else str(exp)), "counts internships"
    for pattern, key in ((r"current (ctc|salary|compensation)|present ctc", "current_ctc_lpa"),
                         (r"expected (ctc|salary|compensation)", "expected_ctc_lpa")):
        if re.search(pattern, L):
            v = _num(a.get(key))
            return ((v if numeric_only or ftype != "textarea" else f"{v} LPA") if v else None), ""
    if re.search(r"relocat", L) and options:
        return opt(_yes_no(a.get("willing_to_relocate"))), ""
    if re.search(r"authori[sz]ed to work|work authori[sz]ation|legally (allowed|eligible)", L):
        return (opt(_yes_no(a.get("work_authorization_india"))) if options else a.get("work_authorization_india")), ""
    if re.search(r"sponsor", L):
        yn = _yes_no(a.get("work_authorization_india"))
        return (opt("No") if yn == "Yes" else None), ""
    if re.search(r"how did you (hear|come to know|find)|source|referr?al source", L) and options:
        pick = None
        for want in (a.get("how_did_you_hear"), "Website", "Company website", "Careers page", "Job board", "Other"):
            pick = pick or best_option(want, options)
        return pick, ""
    if EEO.search(L):
        if options:
            for want in (a.get("eeo_default"), "Prefer not to say", "Decline to self-identify", "I don't wish to answer",
                         "Decline", "Prefer not"):
                pick = best_option(want, options)
                if pick:
                    return pick, ""
        return None, ""
    if re.search(r"school|university|college|institut", L):
        return a.get("university"), ""
    if re.fullmatch(r"degree", L.strip()) or re.search(r"highest (degree|qualification)", L):
        if options:
            return best_option("Bachelor's Degree", options) or best_option(a.get("highest_degree"), options), ""
        return a.get("highest_degree"), ""
    if re.search(r"discipline|major|field of study|branch|speciali[sz]ation", L):
        if options:
            return (best_option(a.get("discipline"), options) or best_option("Computer Science", options)), \
                   "closest option to your discipline"
        return a.get("discipline"), ""
    if re.search(r"start (date )?month", L):
        return opt(a.get("education_start_month")), ""
    if re.search(r"start (date )?year", L):
        return str(a.get("education_start_year") or "") or None, ""
    if re.search(r"end (date )?month|graduation month", L):
        return opt(a.get("education_end_month")), ""
    if re.search(r"end (date )?year|graduation year|year of (passing|graduation)", L):
        return str(a.get("education_end_year") or a.get("graduation_year") or "") or None, ""
    if re.search(r"\bc?gpa\b|cgpa", L):
        return (str(a.get("cgpa")) if a.get("cgpa") else None), ""
    if re.search(r"12th|class xii|class 12|higher secondary|intermediate", L):
        return (str(a.get("class_12_percent")) if a.get("class_12_percent") else None), ""
    if re.search(r"10th|class x\b|class 10|secondary school|matric", L):
        return (str(a.get("class_10_percent")) if a.get("class_10_percent") else None), ""
    return None


_PROMPT = """You fill in a job application for the candidate below. Answer each question using ONLY
facts from the CV and profile. Never invent experience, numbers, dates, preferences or opinions.

Rules:
- Free-text questions ("why us", "describe…"): first person, specific, max 100 words, based on the CV
  and the job description. A one-word question gets one word.
- Questions with options: reply with one option copied exactly from the list.
- If the answer is a fact or preference not in the CV/profile (e.g. "did you know us before",
  dates you can join, things you'd have to guess), set "value": null and "needs_user": true.
- Yes/No about willingness or eligibility: answer only if the profile says it.

Return ONLY JSON: {{"answers": {{"<key>": {{"value": <string or null>, "needs_user": <bool>, "reason": "<short>"}}}}}}

Job: {title} at {company}
Job description (excerpt):
{jd}

Candidate profile:
{profile}

Candidate CV:
{cv}

Questions:
{questions}
"""


def answer_fields(fields: list[dict], job: dict, jd_text: str, resume_pdf: str | None) -> dict:
    """Fill value/source/note on each field. Returns {fields, consent, needs, drafts}."""
    a, cand = _profile()
    out, consent, open_q = [], [], []
    for f in fields:
        f = {**f, "value": None, "source": "empty", "note": ""}
        label, ftype = f["label"], f["type"]
        if ftype == "file":
            if re.search(r"resume|cv", label, re.I) and resume_pdf:
                f.update(value=resume_pdf, source="resume")
            out.append(f)
            continue
        if ftype == "checkbox":
            if MARKETING.search(label) and not f["required"]:
                f["note"] = "marketing opt-in: left unticked"
            elif f["required"] or CONSENT.search(label):
                f.update(value="yes", source="profile", note="consent: ticked")
                consent.append(label)
            out.append(f)
            continue
        hit = rule_value(label, ftype, f.get("options") or [], a)
        if hit is not None:
            value, note = hit
            if value not in (None, ""):
                f.update(value=str(value), source="profile", note=note)
            else:
                f.update(source="need" if f["required"] else "empty")
            out.append(f)
            continue
        out.append(f)
        if ONLY_YOU.search(label):
            f.update(source="need" if f["required"] else "empty", note="only you know this")
            continue
        open_q.append(f)

    if open_q and llm.available():
        cv = settings.CV.read_text(encoding="utf-8") if settings.CV.exists() else ""
        prof_lines = "\n".join(f"- {k}: {v}" for k, v in a.items() if v not in (None, ""))
        prof_lines += f"\n- target_roles: {cand.get('target_roles')}\n- locations: {cand.get('locations')}"
        qs = "\n".join(
            f'- key "{q["key"]}" ({q["type"]}{", required" if q["required"] else ""}): {q["label"]}'
            + (f"\n  options: {json.dumps(q['options'][:40], ensure_ascii=False)}" if q.get("options") else "")
            for q in open_q)
        try:
            data = llm.ask_json(_PROMPT.format(title=job.get("title", ""), company=job.get("company", ""),
                                               jd=(jd_text or "")[:3500], profile=prof_lines, cv=cv[:6000], questions=qs))
            answers = data.get("answers", {})
        except Exception as e:  # LLM down: leave the questions to the user
            answers = {}
            for q in open_q:
                q["note"] = f"AI draft failed ({type(e).__name__}); fill in yourself"
        for q in open_q:
            ans = answers.get(q["key"]) or {}
            val = ans.get("value")
            if q.get("options") and val:
                val = best_option(val, q["options"])
            if val and not ans.get("needs_user"):
                q.update(value=str(val), source="draft", approved=False, note=ans.get("reason", "")[:120])
            else:
                q.update(source="need" if q["required"] else "empty",
                         note=(ans.get("reason") or q.get("note") or "only you can answer this")[:120])
    else:
        for q in open_q:
            q.update(source="need" if q["required"] else "empty", note="no AI key set: fill in yourself")

    return {
        "fields": out,
        "consent": consent,
        "needs": sum(1 for f in out if f["required"] and f["source"] == "need"),
        "drafts": sum(1 for f in out if f["source"] == "draft"),
    }
