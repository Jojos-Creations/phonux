#!/usr/bin/env python3
"""A thin CLI over tools/queue/report_rules.py (gh-pipeline-verifier-gate-
workflow's shared rule module): checks a verifier-report file against a PR's
body and head sha, refusing a PASS whose evidence bullet count differs from
the PR's own `Evidence required` list (report_rules.check_report's whole
point -- see that module's docstring for why the rules live there and not
here).

Two ways to point it at a PR body and head sha:

    python3 tools/queue/check_report.py --report v.txt --pr 42
        fetches the PR's live body and headRefOid via `gh pr view`.

    python3 tools/queue/check_report.py --report v.txt \\
        --pr-body body.txt --head <40hex>
        offline: reads the body from a file instead of the network, for a
        human or CI step that already has both on disk.

`--report` may hold either the raw review comment body (the fenced ```json
verifier-report block plus any surrounding prose) or just the fenced block
itself -- report_rules.parse_report() finds the fence either way.

Prints one JSON line, `{"ok": bool, "reason": str}`, and exits 0 on PASS, 1
on a named rule failure, 2 on a usage or fetch error report_rules itself
never sees (a bad --pr number, an unreadable file) -- the same three-way
split report_rules.py's own CLI uses, so a caller never has to guess which
kind of failure it got from the exit code alone. A missing, undecodable or
unparseable schema.json beside report_rules.py is the same exit 2, naming the
file on stderr: the names this tool judges by come only from that file.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
try:
    import report_rules  # noqa: E402
except SystemExit:
    # report_rules names the unreadable schema.json on stderr; this CLI's
    # contract is still one JSON line on stdout, never a bare traceback.
    print(json.dumps({"ok": False, "reason": "CANNOT RUN -- schema.json beside report_rules.py could not be loaded (see stderr)"}))
    raise


def _gh_json(args):
    result = subprocess.run(["gh"] + [str(a) for a in args], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("gh %s failed (exit %d): %s" % (" ".join(str(a) for a in args), result.returncode, result.stderr.strip()))
    return json.loads(result.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, help="path to a file holding the review body or just its fenced verifier-report block")
    parser.add_argument("--pr", type=int, default=None, help="PR number; fetches body and headRefOid live via gh")
    parser.add_argument("--pr-body", default=None, help="path to a file holding the PR's raw body (offline mode, use with --head)")
    parser.add_argument("--head", default=None, help="the PR's head sha, 40hex (offline mode, use with --pr-body)")
    parser.add_argument("--commit-id", default=None, help="the review's native commit_id, if known separately from --report")
    args = parser.parse_args(argv)

    if args.pr is None and not (args.pr_body and args.head):
        print(json.dumps({"ok": False, "reason": "CANNOT RUN -- pass either --pr, or both --pr-body and --head"}))
        return 2

    try:
        if args.pr is not None:
            pr_json = _gh_json(["pr", "view", str(args.pr), "--json", "body,headRefOid"])
            pr_body = pr_json["body"]
            head_sha = pr_json["headRefOid"]
        else:
            with open(args.pr_body, "r", encoding="utf-8") as fh:
                pr_body = fh.read()
            head_sha = args.head
        with open(args.report, "r", encoding="utf-8") as fh:
            report_text = fh.read()
    except (OSError, KeyError, RuntimeError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "reason": "CANNOT RUN -- %s" % (exc,)}))
        return 2

    report = report_rules.parse_report(report_text)
    ok, reason = report_rules.check_report(report, pr_body, head_sha, commit_id=args.commit_id)
    print(json.dumps({"ok": ok, "reason": reason}))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
