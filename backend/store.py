"""File store. The JSON/YAML files stay the source of truth, shared with Claude Code.

Every write takes a lock file next to the target, re-reads the current contents,
applies the change, and replaces the file in one step, so the dashboard and a
Claude Code session editing the same file don't overwrite each other.
"""

import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

from filelock import FileLock
from ruamel.yaml import YAML

_yaml = YAML()            # round-trip mode: keeps comments and key order
_yaml.preserve_quotes = True
_yaml.width = 4096


@contextmanager
def _locked(path: Path):
    with FileLock(str(path) + ".lock", timeout=10):
        yield


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with _locked(path):
        text = path.read_text(encoding="utf-8")
    return json.loads(text) if text.strip() else default


def update_json(path: Path, default: Any, change: Callable[[Any], Any]) -> Any:
    """Re-read, apply `change(data)` (it may mutate or return a new value), write back."""
    with _locked(path):
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
        new = change(data)
        data = data if new is None else new
        _atomic_write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return data


def read_yaml(path: Path) -> Any:
    if not path.exists():
        return None
    with _locked(path):
        with path.open(encoding="utf-8") as f:
            return _yaml.load(f)


def update_yaml(path: Path, change: Callable[[Any], None]) -> Any:
    """Round-trip edit: comments and layout in the file are kept."""
    import io
    with _locked(path):
        with path.open(encoding="utf-8") as f:
            data = _yaml.load(f)
        change(data)
        buf = io.StringIO()
        _yaml.dump(data, buf)
        _atomic_write(path, buf.getvalue())
    return data


def to_plain(obj: Any) -> Any:
    """ruamel CommentedMap/Seq -> plain dict/list for JSON responses."""
    if isinstance(obj, dict):
        return {str(k): to_plain(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_plain(v) for v in obj]
    return obj
