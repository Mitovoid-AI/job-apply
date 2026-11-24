"""config/profile.yml: the parts the dashboard can read and edit (comments are kept)."""

from . import settings, store

ANSWER_KEYS = [
    "full_name", "email", "phone", "current_city", "linkedin", "github", "portfolio",
    "current_company", "current_title", "total_experience_years", "highest_degree",
    "university", "graduation_year", "notice_period", "current_ctc_lpa", "expected_ctc_lpa",
    "willing_to_relocate", "work_authorization_india", "how_did_you_hear", "eeo_default",
]
OPTIONAL = {"current_ctc_lpa", "portfolio", "github"}
CANDIDATE_KEYS = ["experience_years", "locations", "target_roles"]
SALARY_KEYS = ["min", "max", "walk_away"]


def _empty(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def get_profile() -> dict:
    prof = store.to_plain(store.read_yaml(settings.PROFILE) or {})
    cand = prof.get("candidate") or {}
    answers = prof.get("application_answers") or {}
    return {
        "exists": settings.PROFILE.exists(),
        "answers": {k: answers.get(k) for k in ANSWER_KEYS},
        "candidate": {k: cand.get(k) for k in CANDIDATE_KEYS},
        "salary": {k: (cand.get("target_salary_lpa") or {}).get(k) for k in SALARY_KEYS},
        "missing": missing_fields(prof),
        "optional": sorted(OPTIONAL),
    }


def missing_fields(prof: dict | None = None) -> list[str]:
    prof = prof if prof is not None else store.to_plain(store.read_yaml(settings.PROFILE) or {})
    answers = prof.get("application_answers") or {}
    missing = [k for k in ANSWER_KEYS if k not in OPTIONAL and _empty(answers.get(k))]
    salary = ((prof.get("candidate") or {}).get("target_salary_lpa") or {})
    if _empty(salary.get("min")):
        missing.append("target_salary_min")
    return missing


def _clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v
    return v


def update_profile(answers: dict | None, candidate: dict | None, salary: dict | None) -> dict:
    """Write only the known keys; anything else in the request is ignored."""
    def change(data):
        if answers:
            block = data.setdefault("application_answers", {})
            for k, v in answers.items():
                if k in ANSWER_KEYS:
                    block[k] = _clean(v) if v is not None else ""
        if candidate or salary:
            cand = data.setdefault("candidate", {})
            for k, v in (candidate or {}).items():
                if k in CANDIDATE_KEYS:
                    cand[k] = v
            if salary:
                sal = cand.setdefault("target_salary_lpa", {})
                for k, v in salary.items():
                    if k in SALARY_KEYS:
                        sal[k] = None if v in ("", None) else float(v)
    store.update_yaml(settings.PROFILE, change)
    return get_profile()
