"""Checks jd.extract_years on typical JD sentences: python -m backend.test_years"""

import sys

from .jd import extract_years

# (text, expected min, expected max, expected preferred) — None min means "no requirement found"
CASES = [
    ("3+ years of experience in Python.", 3, None, False),
    ("Experience: 0-2 years", 0, 2, False),
    ("EXPERIENCE: 2–4 years TYPE: Full-time", 2, 4, False),
    ("Minimum of three (3) years of professional experience.", 3, None, False),
    ("You have two to four years of experience building APIs.", 2, 4, False),
    ("You'll grow into several roles over the next 1-2 years. What we look for: 10+ years of experience.", 10, None, False),
    ("We have been in business for over 20 years. You have 1+ years of experience.", 1, None, False),
    ("5+ years in ML preferred. 2+ years of experience required.", 2, None, False),
    ("Nice to have: 5+ years in ML.", 5, None, True),
    ("Have 8+ years of experience in support roles, ideally within high-growth startups.", 8, None, False),
    ("Nice to have\n3+ years with Kubernetes", 3, None, True),
    ("Requirements\n2+ years of Python experience", 2, None, False),
    ("Bachelor's degree (4-year degree) and 2 years of experience.", 2, None, False),
    ("Within 2 years you will lead a team. Must be 18 years old.", None, None, None),
    ("Founded 15 years ago, we build tools.", None, None, None),
]

bad = 0
for text, lo, hi, pref in CASES:
    got = extract_years(text)
    ok = (got is None) if lo is None else bool(got) and (got["min"], got["max"], got["preferred"]) == (lo, hi, pref)
    bad += not ok
    print("ok  " if ok else "FAIL", text[:70], "->", got and (got["min"], got["max"], got["preferred"]))
print(f"{bad} FAILED" if bad else "all passed")
sys.exit(1 if bad else 0)
