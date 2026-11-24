"""Double-click (runs with pythonw, no console window): starts the dashboard and opens the browser.
Logs go to data/dashboard.log. To start it at login, put a shortcut to this file in
shell:startup."""
import runpy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
runpy.run_module("backend", run_name="__main__")
