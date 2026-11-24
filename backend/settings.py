"""Paths and runtime settings, read from the repo's .env (see .env.example)."""

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env(path: Path) -> None:
    """Minimal .env reader: KEY=value lines; existing environment variables win."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env(ROOT / ".env")

DATA = ROOT / "data"
REPORTS = ROOT / "reports"
APPLY_DIR = DATA / "apply"
JD_CACHE = DATA / "jd"
PROFILE = ROOT / "config" / "profile.yml"
CV = ROOT / "cv.md"
PIPELINE = DATA / "pipeline.json"
SCAN_RESULTS = DATA / "scan_results.json"
TOKEN_FILE = DATA / ".dashboard-token"
FRONTEND_DIST = ROOT / "frontend" / "dist"

# The resume tailor (a separate repo with tailor.py --json).
TAILOR_DIR = Path(os.environ["TAILOR_DIR"]) if os.environ.get("TAILOR_DIR") else None
TAILOR_PYTHON = os.environ.get("TAILOR_PYTHON") or sys.executable
TAILOR_OUTPUT = TAILOR_DIR / "user_data" / "output" if TAILOR_DIR else None

NODE_BIN = os.environ.get("NODE_BIN") or shutil.which("node") or "node"
CLAUDE_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"

HOST = "127.0.0.1"  # local only, never 0.0.0.0
PORT = int(os.environ.get("DASHBOARD_PORT", "8765"))

# Daily scan time "HH:MM" (local), empty = off.
DAILY_SCAN_AT = os.environ.get("DAILY_SCAN_AT", "").strip()

# After each scan, prepare applications for jobs with these experience badges (empty = off).
AUTO_PREPARE = {s.strip() for s in os.environ.get("AUTO_PREPARE", "fits,stretch").split(",") if s.strip()}
# Also grade prepared jobs with headless Claude Code (needs `claude` signed in).
AUTO_EVALUATE = os.environ.get("AUTO_EVALUATE", "1").strip() not in ("0", "false", "no", "")

for d in (DATA, REPORTS, APPLY_DIR, JD_CACHE):
    d.mkdir(parents=True, exist_ok=True)
