"""Background tasks (scan, resume build, evaluation) run in threads; the UI polls them."""

import threading
import traceback
import uuid
from datetime import datetime
from typing import Callable

_tasks: dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def start(kind: str, key: str, fn: Callable[[], dict]) -> dict:
    """Run fn in a thread. One task per (kind, key) at a time: a second start returns the running one."""
    with _lock:
        for t in _tasks.values():
            if t["kind"] == kind and t["key"] == key and t["status"] == "running":
                return t
        task = {"id": uuid.uuid4().hex[:12], "kind": kind, "key": key, "status": "running",
                "started_at": _now(), "finished_at": None, "result": None, "error": None}
        _tasks[task["id"]] = task

    def run():
        try:
            task["result"] = fn()
            task["status"] = "done"
        except Exception as e:  # reported to the UI, full trace to the console
            traceback.print_exc()
            task["error"] = str(e) or type(e).__name__
            task["status"] = "error"
        finally:
            task["finished_at"] = _now()

    threading.Thread(target=run, name=f"task-{kind}", daemon=True).start()
    return task


def get(task_id: str) -> dict | None:
    return _tasks.get(task_id)


def running() -> list[dict]:
    return [t for t in _tasks.values() if t["status"] == "running"]
