"""Checks the dashboard Submit logic (window._auto_submit) on fake forms served from this machine:
python -m backend.test_submit

Nothing is sent anywhere: a local server serves the pages, and the "CAPTCHA" frames are local URLs
that only look like CAPTCHA frames to the detector."""

import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

from . import window

FORM = """<html><body><h1>Apply</h1>{extra}
<form action="{action}" method="get">
  <label for="first_name">First name *</label><input id="first_name" name="first_name" required>
  <label for="email">Email *</label><input id="email" type="email" name="email" required>
  {button}
</form></body></html>"""
SUBMIT = '<button type="submit">Submit application</button>'
PAGES = {
    "/ok": FORM.format(extra="", action="/thanks", button=SUBMIT),
    "/captcha": FORM.format(extra='<iframe src="/hcaptcha-frame?checkbox" width="300" height="80"></iframe>',
                            action="/thanks", button=SUBMIT),
    "/invisible": FORM.format(extra='<iframe src="/recaptcha/api2/anchor?k=x&size=invisible" width="256" height="60"></iframe>',
                              action="/thanks", button=SUBMIT),
    "/error": FORM.format(extra="", action="/error-result", button=SUBMIT),
    "/nobutton": FORM.format(extra="", action="/thanks", button=""),
    "/thanks": "<html><body><h1>Thank you for applying!</h1></body></html>",
    "/error-result": FORM.format(extra='<div role="alert">Please enter a valid email address</div>',
                                 action="/thanks", button=SUBMIT).replace('type="email"', 'type="email" aria-invalid="true"'),
}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGES.get(self.path.split("?")[0], "<html><body>frame</body></html>")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


# (page, fill the fields?, missing required list, expected: "proof" or a word in the reason, form must stay unsent)
CASES = [
    ("/ok", True, [], "proof", False),
    ("/invisible", True, [], "proof", False),
    ("/captcha", True, [], "CAPTCHA", True),
    ("/ok", False, ["First name", "Email"], "required", True),
    ("/error", True, [], "flagged", False),
    ("/nobutton", True, [], "find", True),
]

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_port}"
bad = 0
with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    for path, fill, missing, want, stays in CASES:
        page = browser.new_page()
        page.goto(base + path)
        if fill:
            page.fill("#first_name", "Test")
            page.fill("#email", "test@example.com")
        start = page.url
        out = window._auto_submit(page, missing, start, wait=4)
        got = "proof" if out.get("proof") else out.get("reason", "")
        ok = (want == "proof" and got == "proof") or (want != "proof" and want.lower() in got.lower())
        ok = ok and (page.url == start) == stays if want != "flagged" else ok
        bad += not ok
        print("ok  " if ok else "FAIL", path, "->", got[:90])
        page.close()
    browser.close()
server.shutdown()
print(f"{bad} FAILED" if bad else "all passed")
sys.exit(1 if bad else 0)
