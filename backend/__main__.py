"""Run the dashboard: python -m backend [--no-browser] [--port N]"""

import argparse
import sys
import threading
import time
import webbrowser
from datetime import datetime

import uvicorn

from . import runners, settings, tasks


def _daily_scan(at: str) -> None:
    """Start a scan once a day at HH:MM while the dashboard is running."""
    last = None
    while True:
        now = datetime.now()
        if now.strftime("%H:%M") == at and last != now.date():
            last = now.date()
            tasks.start("scan", "all", runners.scan)
        time.sleep(30)


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m backend")
    ap.add_argument("--no-browser", action="store_true", help="don't open the browser")
    ap.add_argument("--port", type=int, default=settings.PORT)
    args = ap.parse_args()

    if sys.stdout is None:  # started with pythonw (no console): log to one file, opened once
        log = open(settings.DATA / "dashboard.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log

    from .app import TOKEN, app
    url = f"http://{settings.HOST}:{args.port}/#token={TOKEN}"
    print(f"job-apply dashboard: {url}", flush=True)
    if settings.DAILY_SCAN_AT:
        threading.Thread(target=_daily_scan, args=(settings.DAILY_SCAN_AT,), daemon=True).start()
        print(f"Daily scan at {settings.DAILY_SCAN_AT}", flush=True)
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    uvicorn.run(app, host=settings.HOST, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
