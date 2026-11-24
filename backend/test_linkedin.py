"""Checks linkedin.parse_alert on made-up alerts in the shapes LinkedIn sends: python -m backend.test_linkedin

The samples are written by hand, not copied from a real alert, so a real one may still differ."""

import sys

from .linkedin import parse_alert

PLAIN = """Your job alert for machine learning engineer in India
30+ new jobs match your preferences.

Machine Learning Engineer
Acme AI
Bengaluru, Karnataka, India
View job: https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc%3D&refId=x

---------------------------------------------------------

AI Engineer
Beta Labs · Pune, Maharashtra, India (Hybrid)
Actively recruiting
View job: https://www.linkedin.com/comm/jobs/view/4012345679/?trackingId=def

See all jobs on LinkedIn: https://www.linkedin.com/comm/jobs/search?keywords=ml
"""

HTML = """<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4099990001/?trk=eml" style="x">
<img src="logo.png"></a></td><td><a href="https://www.linkedin.com/comm/jobs/view/4099990001/?trk=eml">GenAI Engineer</a>
<p>Gamma Corp &middot; Gurugram, Haryana, India</p><p>Easy Apply</p></td></tr>
<tr><td><a href="https://in.linkedin.com/jobs/view/llm-engineer-at-delta-4099990002?trk=eml">LLM Engineer</a>
<br>Delta Tech<br>Remote</td></tr></table>"""

EML = ("MIME-Version: 1.0\nSubject: ML engineer jobs\nContent-Type: multipart/alternative; boundary=XX\n\n"
       "--XX\nContent-Type: text/plain; charset=utf-8\n\n" + PLAIN + "\n--XX\nContent-Type: text/html; charset=utf-8\n\n"
       + HTML + "\n--XX--\n")

EXPECT_PLAIN = [("4012345678", "Machine Learning Engineer", "Acme AI", "Bengaluru, Karnataka, India"),
                ("4012345679", "AI Engineer", "Beta Labs", "Pune, Maharashtra, India (Hybrid)")]
EXPECT_HTML = [("4099990001", "GenAI Engineer", "Gamma Corp", "Gurugram, Haryana, India"),
               ("4099990002", "LLM Engineer", "Delta Tech", "Remote")]

bad = 0
for name, raw, want in (("plain text", PLAIN, EXPECT_PLAIN), ("html", HTML, EXPECT_HTML),
                        ("eml (the HTML part is used when present)", EML.encode(), EXPECT_HTML)):
    got = [(j["id"], j["title"], j["company"], j["location"]) for j in parse_alert(raw)]
    ok = got == want
    bad += not ok
    print("ok  " if ok else "FAIL", name, "->", got)
print(f"{bad} FAILED" if bad else "all passed")
sys.exit(1 if bad else 0)
