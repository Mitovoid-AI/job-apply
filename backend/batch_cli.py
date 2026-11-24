"""Helpers Claude Code runs during modes/apply.md.

  python -m backend.batch_cli shown   <batch>                  after showing the review table
  python -m backend.batch_cli changes <batch>                  before submitting: dashboard edits since then
  python -m backend.batch_cli result  <batch> <n> <status> [note]   after each job (submitted|skipped|failed|unclear)
"""

import argparse
import json
import sys

from . import apply


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m backend.batch_cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("shown", "changes"):
        p = sub.add_parser(name)
        p.add_argument("batch")
    p = sub.add_parser("result")
    p.add_argument("batch")
    p.add_argument("n", type=int)
    p.add_argument("status", choices=["submitted", "skipped", "failed", "unclear"])
    p.add_argument("note", nargs="?", default="")
    args = ap.parse_args()

    try:
        if args.cmd == "shown":
            print(json.dumps({"shown_hash": apply.mark_shown(args.batch)}))
        elif args.cmd == "changes":
            lines = apply.changes(args.batch)
            print("\n".join(lines) if lines else "No changes since the table was shown.")
        else:
            apply.set_result(args.batch, args.n, args.status, args.note)
            print(f"#{args.n}: {args.status}")
    except (ValueError, FileNotFoundError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
