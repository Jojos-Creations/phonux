#!/usr/bin/env python3
"""The sanctioned writer of git pipeline v2's issue and pull request bodies
(PLAN-2026-09-27-git-pipeline-v2.md, sections 4-10; the entry that authored
this file is gh-pipeline-queue-tool).

Every subcommand except `init` and `migrate` refuses to run (the tripwire,
section 5) unless the repo's own `.claude/coordinator-config.yaml` carries a
top-level `pipeline: github` line. `init` and `migrate` are tripwire-exempt:
`init` creates the label set and prints the ruleset and never writes a config
file, a repo setting or a ruleset; `migrate` is the one-time cutover that
turns `plans/queue.yaml`'s entries into plan issues and then writes that
marker itself, as its very last write (plan section 14 steps 2 to 4).

EVERY NAME THIS FILE WRITES -- labels, issue and PR body headings -- COMES
FROM `schema.json` beside it (see report_rules.py's docstring for why there
is one copy and no override). Renaming a label or a section there changes
what this tool reads and writes; nothing below spells one out.

STDLIB ONLY except for the sibling `report_rules` module (co-located,
imported by path so a vendored copy of this directory keeps working with no
package `__init__.py` and no install step -- the same reason
`report_rules.py` itself is stdlib-only, see that file's own docstring) and
one exception: `migrate` alone imports PyYAML, lazily, to read the legacy
`plans/queue.yaml` it consumes. Every other verb runs without it.

WHY THE MARKER READER IS ITS OWN COPY, NOT AN IMPORT of
`.claude/hooks/pipeline_marker.py`: a repo that adopts this pipeline vendors
`tools/queue/` on its own (`tools/vendor-queue-tooling.py`'s `TRACKED_
MANIFEST`), without `.claude/hooks/` -- so an import across that boundary
would work in this template's own tree and break for every consumer. This
module carries the exact same logic instead, proven equal by a parity test
(`tools/tests/test_queue_tool_marker.py`) that imports both modules by path
and asserts they return the same mode for every fixture.

READ-BACK, ALWAYS. Section 5's invariant: GitHub's PATCH on an oversized
body returns HTTP 200 and silently writes nothing (the 262,144-character
case, verified in the plan's own probing). Every write in this file re-GETs
what it just wrote and byte-compares before calling itself done; a mismatch
is `WRITE NOT PERSISTED`, never a silent "saved."

`gate-pass` is the one verb that posts a commit status instead of writing a body. It judges the
PR's newest PASS review with this directory's own `report_rules`, so it first proves that this
copy of queue.py, report_rules.py and schema.json is origin/main's, and it prints success only
after a read-back shows the status.
"""

import argparse
import copy
import hashlib
import json
import re
import shlex
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
import report_rules  # noqa: E402  (sibling module, path-imported -- see module docstring)

SCHEMA_PATH = Path(__file__).resolve().with_name("schema.json")
try:
    SCHEMA = report_rules.load_schema(SCHEMA_PATH)
except report_rules.SchemaError as _schema_exc:
    sys.stderr.write("CANNOT LOAD SCHEMA: %s\n" % (_schema_exc,))
    raise SystemExit(2)

LABELS = SCHEMA["labels"]
LABEL_PLAN = LABELS["plan"]["name"]
LABEL_ACCEPTED = LABELS["accepted"]["name"]
LABEL_BLOCKED = LABELS["blocked"]["name"]
PRIORITY_LABEL_BY_NUMBER = {n: LABELS["p%d" % n]["name"] for n in range(1, 6)}
DEFAULT_PRIORITY = 3

ISSUE_MARKER = SCHEMA["issue_body"]["marker"]
ISSUE_HEADINGS = SCHEMA["issue_body"]["sections"]
PR_HEADINGS = SCHEMA["pr_body"]["sections"]


# =============================================================================
# The pipeline marker reader -- own copy of .claude/hooks/pipeline_marker.py's
# exact semantics (module docstring above explains why this is not an import).
# =============================================================================

CONFIG_RELPATH = (".claude", "coordinator-config.yaml")
QUEUE_RELPATH = ("plans", "queue.yaml")

# Matches a `pipeline:` key only at column 0 -- YAML nests solely through
# indentation, so a `pipeline:` line written under another mapping key is
# indented and never matches this.
_TOP_LEVEL_PIPELINE_RE = re.compile(r"^pipeline\s*:\s*(.*)$")


def find_repo_root(start):
    """The nearest ancestor of `start` holding a `.git` entry (directory or
    file, the latter for a linked worktree). No subprocess: mirrors
    pipeline_marker.find_repo_root exactly so the two never drift on this
    one behaviour a parity test cannot otherwise see (the CLI always calls
    this with a concrete --repo-root or cwd, never a path missing `.git`)."""
    start = Path(start)
    try:
        start = start.resolve()
    except OSError:
        pass
    current = start if start.is_dir() else start.parent
    for candidate in (current, *current.parents):
        marker = candidate / ".git"
        if marker.is_dir() or marker.is_file():
            return candidate
    return None


def _parse_top_level_pipeline(text):
    for line in text.splitlines():
        if line[:1] in (" ", "\t"):
            continue  # indented -- nested under some other key, never top-level
        match = _TOP_LEVEL_PIPELINE_RE.match(line)
        if match:
            return match.group(1)
    return None


def _strip_yaml_scalar(raw):
    s = raw.strip()
    if s[:1] in ("'", '"'):
        quote = s[0]
        end = s.find(quote, 1)
        if end != -1:
            return s[1:end]
        return s[1:]  # unterminated quote -- best-effort, not a claimed case
    hash_idx = s.find("#")
    if hash_idx != -1:
        s = s[:hash_idx]
    return s.strip()


# `release_required_checks` lives in the same config file and is read the same way, as text and
# never with PyYAML: `init --print-ruleset` turns it into the release ruleset's required checks.
RELEASE_CHECKS_KEY = "release_required_checks"
_RELEASE_CHECKS_KEY_RE = re.compile(r"^release_required_checks\s*:(.*)$")
_RELEASE_CHECKS_ITEM_RE = re.compile(r"^\s*-(?:\s+(.*))?$")


class ReleaseChecksError(Exception):
    """`release_required_checks` is present but is not a block list of names."""


def _release_check_name(raw, line):
    """One list item's name: quoted text read whole, else the text before any ` #`."""
    stripped = raw.strip()
    if stripped[:1] in ("'", '"'):
        quote = stripped[0]
        end = stripped.find(quote, 1)
        if end == -1:
            raise ReleaseChecksError("%s: unterminated quote: %s" % (RELEASE_CHECKS_KEY, line))
        rest = stripped[end + 1:].strip()
        if rest and not rest.startswith("#"):
            raise ReleaseChecksError("%s: text after the closing quote: %s" % (RELEASE_CHECKS_KEY, line))
        name = stripped[1:end]
    else:
        name = _strip_yaml_scalar(stripped)
        if name[:1] in ("[", "{", "-"):
            raise ReleaseChecksError("%s: a name that starts with %r must be quoted: %s" % (RELEASE_CHECKS_KEY, name[0], line))
        if ": " in name or name.endswith(":"):
            raise ReleaseChecksError("%s: a name containing a colon must be quoted: %s" % (RELEASE_CHECKS_KEY, line))
    if not name:
        raise ReleaseChecksError("%s: empty item: %s" % (RELEASE_CHECKS_KEY, line))
    return name


def parse_release_required_checks(text):
    """(checks, state) from a config's text; a stdlib line reader, never PyYAML (this
    file's docstring says why). Only a column-0 key counts: a nested or commented-out
    copy is absent. state is "ok", "key absent", "empty list ([])" or "bare key (no items)".
    Raises ReleaseChecksError for a scalar, a flow list, an empty item or a duplicate key."""
    lines = text.splitlines()
    key_index = None
    for index, line in enumerate(lines):
        if line[:1] in (" ", "\t") or not _RELEASE_CHECKS_KEY_RE.match(line):
            continue
        if key_index is not None:
            raise ReleaseChecksError("%s: duplicate key: %s" % (RELEASE_CHECKS_KEY, line.strip()))
        key_index = index
    if key_index is None:
        return [], "key absent"

    key_line = lines[key_index]
    raw_value = _RELEASE_CHECKS_KEY_RE.match(key_line).group(1)
    value = _strip_yaml_scalar(raw_value)
    if raw_value.strip()[:1] in ("'", '"') or value not in ("", "[]"):
        raise ReleaseChecksError(
            "%s: expected a block list of names, one `- name` per line, found: %s" % (RELEASE_CHECKS_KEY, key_line.strip())
        )

    checks = []
    for line in lines[key_index + 1:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        item = _RELEASE_CHECKS_ITEM_RE.match(line)
        if line[:1] not in (" ", "\t") and not item:
            break  # the next top-level key
        if not item:
            raise ReleaseChecksError("%s: not a `- name` list item: %s" % (RELEASE_CHECKS_KEY, line.strip()))
        if value == "[]":
            raise ReleaseChecksError("%s: an inline [] followed by items: %s" % (RELEASE_CHECKS_KEY, line.strip()))
        checks.append(_release_check_name(item.group(1) or "", line.strip()))
    if checks:
        return checks, "ok"
    return [], ("empty list ([])" if value == "[]" else "bare key (no items)")


def read_release_required_checks(repo_root):
    """(checks, state) from `repo_root`'s own config; state is "no config file" when it is missing."""
    path = Path(repo_root).joinpath(*CONFIG_RELPATH)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return [], "no config file"
    except (OSError, UnicodeDecodeError) as exc:
        raise ReleaseChecksError("%s: cannot read %s: %s" % (RELEASE_CHECKS_KEY, path, exc))
    return parse_release_required_checks(text)


def pipeline_mode(repo_root):
    """"github" | "yaml" | "none" | "error" -- section 5. "error" is never
    folded into "none": a config that exists but is unreadable or holds an
    unrecognized value is the tripwire's whole reason to exist, not a repo
    that simply has no marker yet."""
    repo_root = Path(repo_root)
    config_path = repo_root.joinpath(*CONFIG_RELPATH)
    queue_path = repo_root.joinpath(*QUEUE_RELPATH)

    if not config_path.exists():
        return "yaml" if queue_path.exists() else "none"

    try:
        text = config_path.read_text()
    except OSError:
        return "error"

    raw = _parse_top_level_pipeline(text)
    if raw is None:
        return "yaml"  # config exists, key absent: today's plans/queue.yaml pipeline

    value = _strip_yaml_scalar(raw)
    if value == "github":
        return "github"
    if value == "yaml":
        return "yaml"
    return "error"  # any other value, e.g. a typo -- never silently "yaml"


TRIPWIRE_EXEMPT_VERBS = {"init", "migrate"}


def enforce_tripwire(repo_root, verb):
    """Refuse, loud, non-zero, naming the marker -- every verb but init and
    migrate, in a repo whose marker does not read exactly "github" (section
    5's mutual-exclusion tripwire). Never fails open: "error" (unreadable or
    unrecognized) and "none"/"yaml" (not migrated) are refused identically,
    since guessing which side of the fork a repo is on is exactly the
    failure this tripwire exists to prevent."""
    if verb in TRIPWIRE_EXEMPT_VERBS:
        return
    if repo_root is None:
        sys.stderr.write(
            "REFUSED: queue %s could not find a repo root (no .git ancestor); "
            "the pipeline marker cannot be read\n" % (verb,)
        )
        raise SystemExit(3)
    mode = pipeline_mode(repo_root)
    if mode == "github":
        return
    marker_path = repo_root.joinpath(*CONFIG_RELPATH)
    mode, raw_value = _marker_diagnostic(repo_root, mode, marker_path)
    detail = " (raw value: %r)" % (raw_value,) if raw_value is not None else ""
    sys.stderr.write(
        "REFUSED: queue %s requires `pipeline: github` in %s -- marker reads %r%s, "
        "not \"github\". An unmigrated repo cannot pick up this pipeline by "
        "accident (see gh-pipeline-template-dogfood-cutover).\n" % (verb, marker_path, mode, detail)
    )
    raise SystemExit(3)


def _marker_diagnostic(repo_root, mode, marker_path):
    """A human-readable raw value for enforce_tripwire's refusal message
    (e.g. "bogus" for `pipeline: bogus`), sharing pipeline_mode()'s exact
    parsing. pipeline_mode() itself stays a pure four-way classifier -- the
    parity test needs its return shape untouched -- so this wraps it rather
    than changing it."""
    if mode != "error" or not marker_path.exists():
        return mode, None
    try:
        text = marker_path.read_text()
    except OSError:
        return mode, "unreadable"
    raw = _parse_top_level_pipeline(text)
    return mode, (_strip_yaml_scalar(raw) if raw is not None else None)


# =============================================================================
# gh / git subprocess wrappers
# =============================================================================


class GhError(RuntimeError):
    def __init__(self, args, result):
        self.args_list = list(args)
        self.result = result
        super().__init__(
            "gh %s failed (exit %d): %s"
            % (" ".join(str(a) for a in args), result.returncode, result.stderr.strip())
        )


def run_gh(args, check=True, cwd=None):
    if _REST_TRANSPORT["on"] and str(args[0]) != "api":
        return _rest_run_gh([str(a) for a in args], check, cwd)
    # No `cwd` -> the process's OWN cwd, which is the invoking checkout,
    # not necessarily --repo-root: every production call site threads
    # repo_root through explicitly so `gh` (including its own `{owner}/
    # {repo}` placeholder resolution) always targets the repo the command
    # was given, never wherever the caller happened to be sitting.
    result = subprocess.run(
        ["gh"] + [str(a) for a in args],
        cwd=str(cwd) if cwd is not None else None,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 and str(args[0]) != "api" and GRAPHQL_BLOCKED_TEXT in result.stderr:
        # A cloud session's proxy refused GraphQL before applying anything, so replaying over REST is safe.
        _REST_TRANSPORT["on"] = True
        return _rest_run_gh([str(a) for a in args], check, cwd)
    if check and result.returncode != 0:
        raise GhError(args, result)
    return result


def gh_json(args, cwd=None):
    result = run_gh(args, cwd=cwd)
    return json.loads(result.stdout)


# =============================================================================
# REST transport for `gh` -- Claude Code cloud sessions
#
# Claude Code cloud sessions refuse GraphQL at the egress proxy (HTTP 403), and every `gh issue|pr|repo|
# label` verb is GraphQL underneath. When the transport is "rest", run_gh answers those verbs from
# `gh api repos/{owner}/{repo}/...` (REST, which the proxy allows) and returns the stdout `gh` would have:
# the same --json field names, and the issue/PR URL a create verb prints. Call sites do not change.
#
# Nothing is configured: run_gh runs `gh` as written, and only when the proxy answers a verb with its GraphQL
# refusal does it switch the rest of the process to the shim (the refused call applied nothing, so replaying it
# is safe). A Mac never sees that refusal, so its behaviour is untouched. (This file may not read the environment:
# test_queue_schema forbids it.) An unsupported verb or --json field raises _RestUnsupported -- loudly, never an
# empty answer that reads as "nothing there".
#
# Known differences from GraphQL, each approximated from REST:
#   closingIssuesReferences   GitHub computes it; REST has no field. Read from the PR body's closing keywords
#                             (close/fix/resolve + #n), only when the PR targets the default branch.
#   closedByPullRequestsReferences  [] always: nothing reads it, and REST has no cheap equivalent.
#   statusCheckRollup         check runs (latest per name) + the combined commit status, in the rollup's
#                             CheckRun / StatusContext shapes.
# =============================================================================


class _RestUnsupported(RuntimeError):
    pass


GRAPHQL_BLOCKED_TEXT = "GraphQL is not available"
PROXY_WRITE_BLOCKED_TEXT = "not permitted through this proxy"
_REST_TRANSPORT = {"on": False}


def _rest_call(method, path, cwd, body=None, paginate=False):
    """(parsed JSON or None, CompletedProcess) of one `gh api` call. `path` may hold gh's {owner}/{repo}
    placeholders. A paginated call returns the flattened list of items (check-runs pages are merged)."""
    cmd = ["gh", "api", path, "--method", method]
    if paginate:
        cmd += ["--paginate", "--slurp"]
    if body is not None:
        cmd += ["--input", "-"]
    result = subprocess.run(
        cmd, cwd=str(cwd) if cwd is not None else None, capture_output=True, text=True,
        input=json.dumps(body) if body is not None else None,
    )
    if result.returncode != 0:
        raise GhError(["api", method, path], result)
    text = result.stdout.strip()
    data = json.loads(text) if text else None
    if paginate:
        flat = []
        for page in data or []:
            if isinstance(page, dict) and isinstance(page.get("check_runs"), list):
                flat += page["check_runs"]
            elif isinstance(page, list):
                flat += page
            else:
                flat.append(page)
        data = flat
    return data


_REST_REPO_CACHE = {}


def _rest_repo(cwd):
    """The repo object for the checkout at `cwd` (owner, name, default branch), fetched once per cwd."""
    key = str(cwd)
    if key not in _REST_REPO_CACHE:
        _REST_REPO_CACHE[key] = _rest_call("GET", "repos/{owner}/{repo}", cwd)
    return _REST_REPO_CACHE[key]


def _rest_user(user):
    return {"login": user.get("login")} if isinstance(user, dict) else None


def _rest_label(label):
    return {"id": label.get("node_id"), "name": label.get("name"), "description": label.get("description") or "",
            "color": label.get("color")}


def _rest_comment(comment):
    return {"id": comment.get("node_id"), "author": _rest_user(comment.get("user")), "body": comment.get("body") or "",
            "createdAt": comment.get("created_at"), "url": comment.get("html_url"),
            "authorAssociation": comment.get("author_association")}


def _rest_review(review):
    commit = review.get("commit_id")
    return {"id": review.get("node_id"), "author": _rest_user(review.get("user")), "body": review.get("body") or "",
            "state": review.get("state"), "submittedAt": review.get("submitted_at"),
            "commit": {"oid": commit} if commit else None, "authorAssociation": review.get("author_association")}


_CLOSING_RE = re.compile(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+(?:([\w.-]+/[\w.-]+))?#(\d+)", re.IGNORECASE)


def _rest_closing_refs(pr, cwd):
    repo = _rest_repo(cwd)
    if (pr.get("base") or {}).get("ref") != repo.get("default_branch"):
        return []
    numbers = []
    for slug, number in _CLOSING_RE.findall("%s\n%s" % (pr.get("title") or "", pr.get("body") or "")):
        if slug and slug.lower() != repo["full_name"].lower():
            continue
        if int(number) not in numbers:
            numbers.append(int(number))
    return [{"number": n, "url": "%s/issues/%d" % (repo["html_url"], n),
             "repository": {"name": repo["name"], "owner": {"login": repo["owner"]["login"]}}} for n in numbers]


def _rest_status_rollup(sha, cwd):
    runs = _rest_call("GET", "repos/{owner}/{repo}/commits/%s/check-runs?per_page=100" % sha, cwd, paginate=True)
    entries = [{
        "__typename": "CheckRun", "name": run.get("name"), "status": (run.get("status") or "").upper(),
        "conclusion": (run.get("conclusion") or "").upper(), "detailsUrl": run.get("details_url") or run.get("html_url"),
        "startedAt": run.get("started_at"), "completedAt": run.get("completed_at"),
        "workflowName": ((run.get("app") or {}).get("name") or ""),
    } for run in runs]
    combined = _rest_call("GET", "repos/{owner}/{repo}/commits/%s/status?per_page=100" % sha, cwd)
    for status in (combined or {}).get("statuses") or []:
        entries.append({
            "__typename": "StatusContext", "context": status.get("context"), "state": (status.get("state") or "").upper(),
            "targetUrl": status.get("target_url"), "description": status.get("description"),
            "startedAt": status.get("created_at"),
        })
    return entries


def _rest_state(item):
    if item.get("merged_at"):
        return "MERGED"
    return "OPEN" if item.get("state") == "open" else "CLOSED"


def _rest_pr_object(pr, fields, cwd):
    """One PR in `gh pr view --json` shape for exactly `fields`; the heavy ones are fetched only when asked."""
    number = pr["number"]
    simple = {
        "number": lambda: number,
        "title": lambda: pr.get("title"),
        "body": lambda: pr.get("body") or "",
        "state": lambda: _rest_state(pr),
        "isDraft": lambda: bool(pr.get("draft")),
        "headRefName": lambda: pr["head"]["ref"],
        "headRefOid": lambda: pr["head"]["sha"],
        "baseRefName": lambda: pr["base"]["ref"],
        "mergedAt": lambda: pr.get("merged_at"),
        "mergeCommit": lambda: {"oid": pr["merge_commit_sha"]} if pr.get("merged_at") and pr.get("merge_commit_sha") else None,
        "labels": lambda: [_rest_label(l) for l in pr.get("labels") or []],
        "closingIssuesReferences": lambda: _rest_closing_refs(pr, cwd),
        "reviews": lambda: [_rest_review(r) for r in _rest_call(
            "GET", "repos/{owner}/{repo}/pulls/%d/reviews?per_page=100" % number, cwd, paginate=True)],
        "comments": lambda: [_rest_comment(c) for c in _rest_call(
            "GET", "repos/{owner}/{repo}/issues/%d/comments?per_page=100" % number, cwd, paginate=True)],
        "statusCheckRollup": lambda: _rest_status_rollup(pr["head"]["sha"], cwd),
    }
    unknown = [f for f in fields if f not in simple]
    if unknown:
        raise _RestUnsupported("pr --json field(s) %s have no REST mapping" % ",".join(unknown))
    return {f: simple[f]() for f in fields}


def _rest_issue_object(issue, fields, cwd):
    number = issue["number"]
    simple = {
        "number": lambda: number,
        "title": lambda: issue.get("title"),
        "body": lambda: issue.get("body") or "",
        "state": lambda: "CLOSED" if issue.get("state") == "closed" else "OPEN",
        "updatedAt": lambda: issue.get("updated_at"),
        "labels": lambda: [_rest_label(l) for l in issue.get("labels") or []],
        "comments": lambda: [_rest_comment(c) for c in _rest_call(
            "GET", "repos/{owner}/{repo}/issues/%d/comments?per_page=100" % number, cwd, paginate=True)],
        "closedByPullRequestsReferences": lambda: [],
    }
    unknown = [f for f in fields if f not in simple]
    if unknown:
        raise _RestUnsupported("issue --json field(s) %s have no REST mapping" % ",".join(unknown))
    return {f: simple[f]() for f in fields}


class _ShimParser(argparse.ArgumentParser):
    def error(self, message):
        raise _RestUnsupported("unsupported gh arguments: %s" % message)


def _shim_parse(argv, positionals, **flags):
    """Parse a verb's own argv. `flags` maps a --flag name to "one", "many" or "bool"; any other flag is refused.
    A flag's value is bound with `=` first, so a value that starts with `-` (a comment body) is not read as a flag."""
    parser = _ShimParser(add_help=False, exit_on_error=False)
    for name in positionals:
        parser.add_argument(name)
    for flag, arity in flags.items():
        if arity == "bool":
            parser.add_argument("--" + flag, action="store_true")
        else:
            parser.add_argument("--" + flag, action="append" if arity == "many" else "store",
                                default=[] if arity == "many" else None)
    bound, index = [], 0
    while index < len(argv):
        token = argv[index]
        if token.startswith("--") and flags.get(token[2:]) in ("one", "many") and index + 1 < len(argv):
            bound.append("%s=%s" % (token, argv[index + 1]))
            index += 2
        else:
            bound.append(token)
            index += 1
    return parser.parse_args(bound)


def _shim_split_fields(value):
    return [f for f in (value or "").split(",") if f]


def _rest_read_text(path):
    return Path(path).read_text(encoding="utf-8")


def _rest_list_items(kind, ns, cwd):
    state = ns.state or "open"
    if state not in ("open", "closed", "all"):
        raise _RestUnsupported("--state %r" % state)
    limit = int(ns.limit) if ns.limit else 30
    query = "state=%s&per_page=100" % state
    if kind == "issue":
        if ns.label:
            query += "&labels=" + urllib.parse.quote(",".join(ns.label))
        items = _rest_call("GET", "repos/{owner}/{repo}/issues?" + query, cwd, paginate=True)
        return [i for i in items if "pull_request" not in i][:limit]
    if ns.head:
        query += "&head=%s:%s" % (_rest_repo(cwd)["owner"]["login"], urllib.parse.quote(ns.head, safe=""))
    return _rest_call("GET", "repos/{owner}/{repo}/pulls?" + query, cwd, paginate=True)[:limit]


def _rest_fanout(function, items):
    """[function(item) for item in items], over 8 threads. Not concurrent.futures: this file is named
    queue.py, so when it runs as a script it shadows the stdlib `queue` that module imports."""
    results, errors, lock, cursor = [None] * len(items), [], threading.Lock(), [0]

    def work():
        while True:
            with lock:
                index = cursor[0]
                cursor[0] += 1
            if index >= len(items) or errors:
                return
            try:
                results[index] = function(items[index])
            except BaseException as error:  # re-raised below, on the calling thread
                errors.append(error)
                return

    threads = [threading.Thread(target=work) for _ in range(min(8, len(items)))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    if errors:
        raise errors[0]
    return results


def _rest_dispatch(argv, cwd):
    """(stdout text) for one gh verb answered over REST. Raises _RestUnsupported for anything not mapped."""
    kind, verb, rest = argv[0], argv[1] if len(argv) > 1 else "", argv[2:]
    out = lambda obj: json.dumps(obj) + "\n"
    if kind in ("issue", "pr") and verb == "view":
        ns = _shim_parse(rest, ["number"], json="one")
        fields = _shim_split_fields(ns.json)
        if not fields:
            raise _RestUnsupported("%s view without --json" % kind)
        if kind == "pr":
            return out(_rest_pr_object(_rest_call("GET", "repos/{owner}/{repo}/pulls/%s" % ns.number, cwd), fields, cwd))
        return out(_rest_issue_object(_rest_call("GET", "repos/{owner}/{repo}/issues/%s" % ns.number, cwd), fields, cwd))
    if kind in ("issue", "pr") and verb == "list":
        ns = _shim_parse(rest, [], json="one", label="many", state="one", limit="one", head="one")
        fields = _shim_split_fields(ns.json)
        if not fields:
            raise _RestUnsupported("%s list without --json" % kind)
        build = _rest_pr_object if kind == "pr" else _rest_issue_object
        return out(_rest_fanout(lambda item: build(item, fields, cwd), _rest_list_items(kind, ns, cwd)))
    if kind == "repo" and verb == "view":
        ns = _shim_parse(rest, [], json="one")
        if _shim_split_fields(ns.json) != ["nameWithOwner"]:
            raise _RestUnsupported("repo view --json %s" % ns.json)
        return out({"nameWithOwner": _rest_repo(cwd)["full_name"]})
    if kind == "label" and verb == "list":
        ns = _shim_parse(rest, [], json="one", limit="one")
        labels = _rest_call("GET", "repos/{owner}/{repo}/labels?per_page=100", cwd, paginate=True)
        want = _shim_split_fields(ns.json)
        return out([{f: _rest_label(l)[f] for f in want} for l in labels[:int(ns.limit or 30)]])
    if kind == "label" and verb == "create":
        ns = _shim_parse(rest, ["name"], color="one", description="one", force="bool")
        if not ns.force:
            raise _RestUnsupported("label create without --force")
        body = {"color": ns.color, "description": ns.description or ""}
        quoted = urllib.parse.quote(ns.name, safe="")
        try:
            _rest_call("GET", "repos/{owner}/{repo}/labels/" + quoted, cwd)
        except GhError as error:
            if "404" not in error.result.stderr and "Not Found" not in error.result.stderr:
                raise
            _rest_call("POST", "repos/{owner}/{repo}/labels", cwd, body=dict(body, name=ns.name))
        else:
            _rest_call("PATCH", "repos/{owner}/{repo}/labels/" + quoted, cwd, body=body)
        return ""
    if kind == "issue" and verb == "create":
        ns = _shim_parse(rest, [], title="one", label="many", **{"body-file": "one"})
        body = {"title": ns.title, "body": _rest_read_text(ns.body_file), "labels": ns.label}
        return _rest_call("POST", "repos/{owner}/{repo}/issues", cwd, body=body)["html_url"] + "\n"
    if kind == "pr" and verb == "create":
        ns = _shim_parse(rest, [], title="one", head="one", base="one", draft="bool", **{"body-file": "one"})
        if not ns.draft:
            raise _RestUnsupported("pr create without --draft")
        body = {"title": ns.title, "body": _rest_read_text(ns.body_file), "head": ns.head, "base": ns.base, "draft": True}
        return _rest_call("POST", "repos/{owner}/{repo}/pulls", cwd, body=body)["html_url"] + "\n"
    if kind in ("issue", "pr") and verb == "comment":
        ns = _shim_parse(rest, ["number"], body="one")
        _rest_call("POST", "repos/{owner}/{repo}/issues/%s/comments" % ns.number, cwd, body={"body": ns.body})
        return ""
    if kind in ("issue", "pr") and verb == "edit":
        ns = _shim_parse(rest, ["number"], **{"body-file": "one", "add-label": "many", "remove-label": "many"})
        base = "repos/{owner}/{repo}/issues/%s" % ns.number
        if ns.body_file:
            _rest_call("PATCH", base, cwd, body={"body": _rest_read_text(ns.body_file)})
        if ns.add_label:
            _rest_call("POST", base + "/labels", cwd, body={"labels": ns.add_label})
        for label in ns.remove_label:
            _rest_call("DELETE", base + "/labels/" + urllib.parse.quote(label, safe=""), cwd)
        return ""
    if kind == "issue" and verb == "close":
        ns = _shim_parse(rest, ["number"], reason="one")
        reason = {"completed": "completed", "not planned": "not_planned", None: "completed"}.get(ns.reason)
        if reason is None:
            raise _RestUnsupported("issue close --reason %r" % ns.reason)
        _rest_call("PATCH", "repos/{owner}/{repo}/issues/%s" % ns.number, cwd,
                   body={"state": "closed", "state_reason": reason})
        return ""
    if kind == "pr" and verb == "close":
        ns = _shim_parse(rest, ["number"])
        _rest_call("PATCH", "repos/{owner}/{repo}/pulls/%s" % ns.number, cwd, body={"state": "closed"})
        return ""
    if kind == "pr" and verb == "ready":
        ns = _shim_parse(rest, ["number"])
        _rest_call("POST", "repos/{owner}/{repo}/pulls/%s/ccr/ready_for_review" % ns.number, cwd)
        return ""
    raise _RestUnsupported("gh %s has no REST mapping" % " ".join(argv[:2]))


def _rest_run_gh(argv, check, cwd):
    """run_gh's answer for a verb handled over REST: a CompletedProcess, or GhError when check is set."""
    try:
        stdout = _rest_dispatch(argv, cwd)
        return subprocess.CompletedProcess(["gh"] + argv, 0, stdout, "")
    except GhError as error:
        result = error.result
    except _RestUnsupported as error:
        result = subprocess.CompletedProcess(["gh"] + argv, 1, "", "REST shim: %s" % error)
    if check:
        raise GhError(argv, result)
    return result


class GitError(RuntimeError):
    def __init__(self, args, result):
        self.args_list = list(args)
        self.result = result
        super().__init__(
            "git %s failed (exit %d): %s"
            % (" ".join(str(a) for a in args), result.returncode, result.stderr.strip())
        )


def run_git(args, cwd=None, check=True):
    result = subprocess.run(
        ["git"] + [str(a) for a in args],
        cwd=str(cwd) if cwd is not None else None,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise GitError(args, result)
    return result


def _tracking_refspec(branch):
    return "+refs/heads/%s:refs/remotes/origin/%s" % (branch, branch)


def _fetch_pinned(refspecs, repo_root, check=True):
    """Fetch exactly `refspecs` from origin and write nothing but remote-tracking refs and FETCH_HEAD, whatever the
    user's git config says; returns run_git's result."""
    # --refmap= stops remote.origin.fetch mapping the named refs (a refs/heads one would move a local branch),
    # --no-tags the tag auto-follow, --no-recurse-submodules fetch.recurseSubmodules and submodule.recurse.
    if not refspecs:  # --refmap= with no refspec is fatal, so an empty list is a caller's bug, not a skip
        raise ValueError("_fetch_pinned needs at least one refspec: a fetch with --refmap= and none is fatal")
    return run_git(["fetch", "-q", "--no-tags", "--no-recurse-submodules", "--refmap=", "origin"] + list(refspecs), cwd=repo_root, check=check)


# =============================================================================
# Body-section helpers -- get/replace a `## Heading` or `### Heading`
# section's own text, bounded by the next heading of the same or shallower
# level (section 5's PR/issue body shapes are all flat ##/### nesting).
# =============================================================================


def _heading_level(heading):
    return len(heading) - len(heading.lstrip("#"))


def section_span(body, heading):
    """(start, end) of the section body text for `heading` (a literal
    string like "## Handoff"), starting just after its own line and ending
    just before the next heading whose level is <= this heading's level, or
    end of string. None if the heading is not present at all."""
    heading_re = re.compile(r"^" + re.escape(heading) + r"[ \t]*$", re.MULTILINE)
    match = heading_re.search(body)
    if match is None:
        return None
    level = _heading_level(heading)
    rest_start = match.end() + 1 if body[match.end():match.end() + 1] == "\n" else match.end()
    next_re = re.compile(r"^#{1,%d}[ \t]" % level, re.MULTILINE)
    next_match = next_re.search(body, rest_start)
    end = next_match.start() if next_match else len(body)
    return (rest_start, end)


def get_section(body, heading):
    span = section_span(body, heading)
    return None if span is None else body[span[0]:span[1]]


def set_section(body, heading, new_content):
    span = section_span(body, heading)
    if span is None:
        raise ValueError("section %r not found in body" % (heading,))
    start, end = span
    return body[:start] + new_content + body[end:]


# =============================================================================
# Body composition -- section 5's exact shapes.
# =============================================================================

# A placeholder is a whole line that is one angle-bracket token, with or without a bullet marker.
# A bullet that merely starts with, ends with or contains such a token (argument notation) is not one.
PLACEHOLDER_RE = re.compile(r"^[ \t]*(?:(?:[-*]|\d+\.)[ \t]+)?<[A-Za-z][A-Za-z0-9_ -]*>[ \t\r]*$", re.MULTILINE)

BRIEF_HEADING = report_rules.BRIEF_HEADING  # "## Brief"
HANDOFF_HEADING = PR_HEADINGS["handoff"]
EVIDENCE_REPORT_HEADING = PR_HEADINGS["evidence_report"]
HANDOFF_SENTINEL = "<written by `queue implemented`>"

# A `Depends on:` line, not a heading of its own -- it lives inside the
# issue body's `## Gates` section (`queue research --prereq`'s only write
# target) and, post-accept, inside the PR body's `## Brief` (copied once by
# `queue accept`, then frozen). One shape, matched the same way in both
# places by section text alone, never a heading search.
DEPENDS_ON_LINE_RE = re.compile(r"^Depends on:.*$", re.MULTILINE)
DEPENDS_ON_REF_RE = re.compile(r"#(\d+)")


def _render_depends_on(issue_numbers):
    if not issue_numbers:
        return "Depends on: none"
    return "Depends on: %s" % ", ".join("#%d" % n for n in issue_numbers)


def _set_depends_on_in_gates(gates_section_text, issue_numbers):
    """Replace the `Depends on:` line inside an issue body's `## Gates`
    section text, preserving `resources:`/`gate_override:`. Inserts the
    line at the top if an older body (pre-dating this field) has none, so
    `queue research --prereq` still works against it."""
    new_line = _render_depends_on(issue_numbers)
    if DEPENDS_ON_LINE_RE.search(gates_section_text):
        return DEPENDS_ON_LINE_RE.sub(new_line, gates_section_text, count=1)
    return new_line + "\n" + gates_section_text


def _parse_depends_on_ids(section_text):
    """Issue numbers named by a `Depends on: #a, #b` line inside a section's
    own text (the issue body's `## Gates`, or the PR body's `## Brief` after
    `queue accept` copies it there) -- [] if the line is absent or reads
    `none`."""
    match = DEPENDS_ON_LINE_RE.search(section_text)
    if match is None:
        return []
    return [int(n) for n in DEPENDS_ON_REF_RE.findall(match.group(0))]

# The body-shape reference `lint --offline` checks against LINT_SECTIONS.
SCHEMA_REFERENCE_RELPATH = ("plans", "SCHEMA.md")

# Every body section `queue lint` checks for presence -- read by lint itself
# and by a test that asserts each name appears in SCHEMA_REFERENCE_RELPATH,
# so the doc and the checker cannot silently drift apart.
LINT_SECTIONS = list(ISSUE_HEADINGS.values()) + [
    heading for heading in PR_HEADINGS.values() if heading not in ISSUE_HEADINGS.values()
]


def compose_issue_body(entry_id, intent, touches, evidence_required, local="", online="", api_docs="",
                        resources=None, gate_override=None, depends_on=None):
    """Section 5's issue body shape (candidate stage): the marker, id, and
    six sections, `## Gates` included (`Depends on:`, `resources:`,
    `gate_override:`) -- distinct from the PR body's own `Gates:` line,
    which is a field inside `## Brief`, not a heading of its own.
    `touches`/`evidence_required` are lists of bullet text, numbered for
    evidence_required (check_report.py and report_rules.py both count that
    numbering). `depends_on` is a list of issue numbers this entry depends
    on -- native `blockedBy` has no `gh` read path, so this is a body line
    instead (`queue research --prereq` is the only writer post-stub)."""
    touches_lines = "\n".join("- %s" % t for t in touches) if touches else "- <TODO>"
    evidence_lines = (
        "\n".join("%d. %s" % (i, e) for i, e in enumerate(evidence_required, start=1))
        if evidence_required
        else "1. <TODO>"
    )
    h = ISSUE_HEADINGS
    return (
        "%s\n"
        "id: %s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "resources: %s\n"
        "gate_override: %s\n"
    ) % (
        ISSUE_MARKER, entry_id,
        h["intent"], intent,
        h["touches"], touches_lines,
        h["evidence_required"], evidence_lines,
        h["research"], h["local_insights"], local,
        h["online_insights"], online,
        h["api_docs_needed"], api_docs,
        h["gates"], _render_depends_on(depends_on), json.dumps(resources or []), json.dumps(gate_override or []),
    )


def compose_pr_body_at_accept(entry_id, issue_number, intent, priority, priority_source_label,
                               touches, evidence_required, depends_on, resources, gate_override,
                               local="", online="", api_docs=""):
    """Section 5's PR body shape, as written once at accept time. `##
    Handoff` and `## Evidence report` are left with their placeholder text;
    only `queue implemented` ever overwrites them (the ALREADY IMPLEMENTED
    pre-check keys on HANDOFF_SENTINEL still being present)."""
    touches_lines = "\n".join("- %s" % t for t in touches)
    evidence_lines = "\n".join("%d. %s" % (i, e) for i, e in enumerate(evidence_required, start=1))
    depends_text = ", ".join("#%d" % d for d in depends_on) if depends_on else "none"
    h = PR_HEADINGS
    return (
        "%s\n"
        "Closes #%d  (`%s`)\n"
        "\n"
        "%s\n"
        "Intent: %s\n"
        "Priority: %s (was %s on issue #%d at accept time)\n"
        "Touches:\n"
        "%s\n"
        "%s\n"
        "%s\n"
        "Depends on: %s\n"
        "Gates: resources=%s gate_override=%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "\n"
        "%s\n"
        "%s\n"
        "- [ ] partial   (Split into: #<m> if checked)\n"
        "\n"
        "%s\n"
        "\n"
    ) % (
        h["entry"], issue_number, entry_id,
        h["brief"], intent, PRIORITY_LABEL_BY_NUMBER[priority], priority_source_label, issue_number,
        touches_lines, report_rules.EVIDENCE_REQUIRED_LABEL, evidence_lines, depends_text,
        json.dumps(resources), json.dumps(gate_override),
        h["research"], h["local_insights"], local,
        h["online_insights"], online,
        h["api_docs_needed"], api_docs,
        h["handoff"], HANDOFF_SENTINEL,
        h["evidence_report"],
    )


ENTRY_ID_RE = re.compile(r"Closes #(\d+)\s*\(`([^`]+)`\)")


def parse_entry_header(pr_body):
    """(issue_number, entry_id) from a PR body's `## Entry` section, or
    (None, None) if the header is missing or malformed."""
    match = ENTRY_ID_RE.search(pr_body)
    if match is None:
        return None, None
    return int(match.group(1)), match.group(2)


def compose_handoff_and_evidence(pr_body, handoff_text, evidence_report_text, partial=False, split_into=None):
    """Apply `queue implemented`'s one-time write: overwrite `## Handoff`
    (dropping HANDOFF_SENTINEL, which is what makes a second call refuse
    ALREADY IMPLEMENTED) and `## Evidence report`."""
    checkbox = "[x]" if partial else "[ ]"
    if partial and split_into is not None:
        split_note = "(Split into: #%d)" % split_into
    else:
        split_note = ""
    new_handoff = "%s\n\n- %s partial   %s\n" % (handoff_text.rstrip(), checkbox, split_note)
    body = set_section(pr_body, HANDOFF_HEADING, new_handoff)
    body = set_section(body, EVIDENCE_REPORT_HEADING, evidence_report_text.rstrip() + "\n")
    return body


def check_not_already_implemented(pr_body, pr_number):
    section = get_section(pr_body, HANDOFF_HEADING) or ""
    if HANDOFF_SENTINEL not in section:
        sys.stderr.write("ALREADY IMPLEMENTED: PR #%d's ## Handoff has already been written\n" % pr_number)
        raise SystemExit(1)


# =============================================================================
# Read-back writes (section 5's "read-back after every write, always").
# =============================================================================


def _body_tempfile(body):
    handle = tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8")
    handle.write(body)
    handle.close()
    return handle.name


# A Claude Code cloud session's proxy decorates every PR/issue body it stores: a leading
# `<!-- ccr-projects-attribution: ... -->` block (plus its `_Requested by ..._` line) and a trailing
# `---` / `_Generated by [Claude Code](...)_` footer. Neither is part of what queue.py wrote, so a byte-compare
# read-back would call every cloud write "not persisted". These are removed from BOTH sides before comparing;
# any other difference still fails.
_PROXY_LEAD_RE = re.compile(r"\A<!-- ccr-projects-attribution:.*?-->[ \t]*\n(?:_Requested by [^\n]*_[ \t]*\n)?\s*", re.DOTALL)
_PROXY_FOOT_RE = re.compile(r"\n*---[ \t]*\n_Generated by \[Claude Code\]\([^)\n]*\)_[ \t]*\n*\Z")


# The proxy also wraps a long bare URL in an inline code span (`URL`, or ``URL`` when the body already has
# backticks), and a body re-written from an already-wrapped one piles quotes and backticks around it (PR #96
# stored three backticks, two quotes and two backticks before one URL). The URL itself is what counts, so
# backticks and quotes touching a URL are dropped.
_PROXY_URL_RE = re.compile(r"[`']*(https?://[^\s`']+)[`']*")


def _strip_proxy_decoration(body):
    body = body if isinstance(body, str) else ""
    body = _PROXY_LEAD_RE.sub("", body, count=1)
    body = _PROXY_URL_RE.sub(r"\1", body)
    previous = None
    while previous != body:  # a footer the proxy added over one the body already carried
        previous, body = body, _PROXY_FOOT_RE.sub("", body, count=1)
    return body.rstrip("\n")


def bodies_match(readback_body, written_body):
    """True when a read-back body is what was written, ignoring only the proxy's leading attribution block,
    its trailing Claude Code footer, and trailing newlines."""
    return _strip_proxy_decoration(readback_body) == _strip_proxy_decoration(written_body)


def write_issue_body(number, body, add_labels=None, remove_labels=None, repo_root=None):
    path = _body_tempfile(body)
    args = ["issue", "edit", number, "--body-file", path]
    for label in add_labels or []:
        args += ["--add-label", label]
    for label in remove_labels or []:
        args += ["--remove-label", label]
    run_gh(args, cwd=repo_root)
    readback = gh_json(["issue", "view", number, "--json", "body"], cwd=repo_root)
    if not bodies_match(readback.get("body"), body):
        sys.stderr.write("WRITE NOT PERSISTED: issue #%d body read-back did not match what was written\n" % number)
        raise SystemExit(1)


def _closing_issue_numbers(readback):
    return {ref.get("number") for ref in (readback.get("closingIssuesReferences") or []) if isinstance(ref, dict)}


# One immediate re-read isn't enough: GitHub fills closingIssuesReferences
# some seconds after `pr create` returns, and the lag is not always gone by
# the very next read (cli/cli#11841). Bounded and backed off, not a
# busy-loop, so a real lag is absorbed but a genuine unlink still refuses
# in finite time.
_LINK_RETRY_DELAYS_SECONDS = (1, 2, 4)


def _sleep(seconds):
    """The one seam between `_check_pr_links_issue`'s retry loop and a real
    clock -- tests replace this name on the loaded module so the suite
    proves the backoff schedule without ever actually waiting out ~7s
    worst case per must-fail case."""
    time.sleep(seconds)


def _check_pr_links_issue(readback, issue_number, pr_number, repo_root):
    """Section 5's per-write PR/issue-link check: `closingIssuesReferences`
    must NAME `issue_number`, not merely be non-empty -- a rewrite that
    links some OTHER issue is exactly as wrong as one that links none, and
    a bare non-emptiness check misses it. Applies to every PR body write
    AND to a fresh PR's own creation read-back, both callers passing in the
    read they already have. Re-reads up to `_LINK_RETRY_DELAYS_SECONDS`
    more times, backing off between attempts (cli/cli#11841: a valid
    closing keyword can read back transiently empty, and the lag is not
    always gone by the very next read), returning as soon as any read
    names the issue -- so a slow-to-populate link is absorbed but a real
    unlink still refuses, in bounded time."""
    if issue_number in _closing_issue_numbers(readback):
        return
    for delay in _LINK_RETRY_DELAYS_SECONDS:
        _sleep(delay)
        readback = gh_json(["pr", "view", pr_number, "--json", "closingIssuesReferences"], cwd=repo_root)
        if issue_number in _closing_issue_numbers(readback):
            return
    sys.stderr.write("ISSUE UNLINKED: PR #%d body no longer closes issue #%d\n" % (pr_number, issue_number))
    raise SystemExit(1)


def write_pr_body(number, body, add_labels=None, remove_labels=None, issue_number=None, repo_root=None):
    path = _body_tempfile(body)
    args = ["pr", "edit", number, "--body-file", path]
    for label in add_labels or []:
        args += ["--add-label", label]
    for label in remove_labels or []:
        args += ["--remove-label", label]
    run_gh(args, cwd=repo_root)
    readback = gh_json(["pr", "view", number, "--json", "body,closingIssuesReferences"], cwd=repo_root)
    if not bodies_match(readback.get("body"), body):
        sys.stderr.write("WRITE NOT PERSISTED: PR #%d body read-back did not match what was written\n" % number)
        raise SystemExit(1)
    if issue_number is not None:
        _check_pr_links_issue(readback, issue_number, number, repo_root)


# =============================================================================
# list / status -- the derived state model, section 4.
# =============================================================================

ISSUE_LIST_FIELDS = "number,title,body,labels,comments,updatedAt,closedByPullRequestsReferences"
# No bare "merged" field: gh pr view/list --json has none (live field list,
# 2026-09-28) -- state=="MERGED" plus mergedAt is the real read.
PR_LIST_FIELDS = (
    "number,title,isDraft,headRefName,headRefOid,body,labels,reviews,comments,mergedAt,"
    "closingIssuesReferences,baseRefName,state,mergeCommit,statusCheckRollup"
)

LIVE_STATES = ("stub", "researched", "accepted", "implemented", "verified", "blocked")


def _label_names(labels):
    return {l.get("name") for l in (labels or []) if isinstance(l, dict)}


def _has_label(label_names, name):
    """GitHub label names are case-insensitive (`gh issue list --label
    plan` also matches `Plan`), so every membership test here is too."""
    wanted = name.lower()
    return any(isinstance(existing, str) and existing.lower() == wanted for existing in label_names)


def _priority_of(label_names):
    """(number, label name) of the highest-priority `p<N>` label present
    (lowest number wins), or (None, None) if the issue carries none."""
    for number in range(1, 6):
        if _has_label(label_names, PRIORITY_LABEL_BY_NUMBER[number]):
            return number, PRIORITY_LABEL_BY_NUMBER[number]
    return None, None


def _find_pr_for_issue(issue_number, prs):
    for pr in prs:
        for ref in pr.get("closingIssuesReferences") or []:
            if ref.get("number") == issue_number:
                return pr
    return None


def _rest_shaped_reviews(reviews):
    """New review dicts with the REST names every reader and `check_report` expect. `gh pr view
    --json reviews` is GraphQL: it carries `commit.oid` and `submittedAt`, so without this a reader
    skips the commit check and, with every `submitted_at` missing, picks the oldest review. A null
    `commit` (a force-pushed review) becomes an empty `commit_id`, which never equals a head sha.
    Pure: the input is not mutated, `id` is kept (`_fetch_review_html_url` matches on it), and a
    review that already has the REST names comes back as an unchanged copy."""
    shaped = []
    for review in reviews:
        review = copy.deepcopy(review)
        if "commit_id" not in review and "commit" in review:
            commit = review["commit"]
            review["commit_id"] = (commit.get("oid") if isinstance(commit, dict) else None) or ""
        if "submitted_at" not in review and "submittedAt" in review:
            review["submitted_at"] = review["submittedAt"]
        shaped.append(review)
    return shaped


def _judge_verdict(reviews, pr_body, head_sha):
    """(review, reason) for the PR's newest COMMENTED review: the one place `ship --check` and
    `gate-pass` apply report_rules.check_report. `reason` is None when the review passes, else the
    first rule it failed; `review` is None only when there is no COMMENTED review at all."""
    review = report_rules.newest_comment_review(_rest_shaped_reviews(reviews))
    if review is None:
        return None, "no COMMENTED review (verifier-report) found on the PR"
    report = report_rules.parse_report(review.get("body", ""))
    ok, reason = report_rules.check_report(report, pr_body, head_sha, commit_id=review.get("commit_id"))
    return review, (None if ok else reason)


VERIFIER_GATE_NAME = "verifier-gate"


def _gate_entry_kind(entry):
    """A rollup entry's kind: its `__typename`, else StatusContext when it has a `context` key (the
    shape a commit status has) and CheckRun otherwise."""
    return entry.get("__typename") or ("StatusContext" if "context" in entry else "CheckRun")


def _gate_entry_time(entry):
    """When a rollup entry finished, else when it started; None when neither is a real time. A null,
    missing or 0001-01-01 completedAt is absent: that zero date is what a run that has not finished serves."""
    for field in ("completedAt", "startedAt"):
        value = entry.get(field)
        if not isinstance(value, str) or not value or value.startswith("0001-01-01"):
            continue
        try:
            parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


_GATE_NO_TIME = datetime.min.replace(tzinfo=timezone.utc)


def _gate_entry_rank(position, entry):
    """Sort key of a rollup entry, the largest being the newest. A run that has not ended (a CheckRun with
    no conclusion, or any entry with no usable time) outranks every finished run whatever its position or
    time, because gh serves such a run with the time it started and that can fall inside an older run's span.
    Among the rest the later time wins, then the later list position."""
    when = _gate_entry_time(entry)
    unended = when is None or (_gate_entry_kind(entry) == "CheckRun" and not entry.get("conclusion"))
    return (unended, when or _GATE_NO_TIME, position)


def _newest_gate_entries(rollup):
    """{(kind, name): the newest verifier-gate entry of that kind} over a statusCheckRollup. GitHub
    counts only the newest run of a check, so an older FAILURE is history. Newest is by `_gate_entry_rank`."""
    groups = {}
    for position, entry in enumerate(rollup or []):
        if isinstance(entry, dict) and (entry.get("name") or entry.get("context")) == VERIFIER_GATE_NAME:
            groups.setdefault((_gate_entry_kind(entry), VERIFIER_GATE_NAME), []).append((position, entry))
    return {key: max(members, key=lambda member: _gate_entry_rank(*member))[1] for key, members in groups.items()}


def _gate_entry_succeeded(entry):
    outcome = entry.get("state") if _gate_entry_kind(entry) == "StatusContext" else entry.get("conclusion")
    return outcome == "SUCCESS"


def _verifier_gate_green(pr):
    """True iff at least one verifier-gate entry exists and the newest of each kind is SUCCESS."""
    newest = _newest_gate_entries(pr.get("statusCheckRollup"))
    return bool(newest) and all(_gate_entry_succeeded(entry) for entry in newest.values())


# GitHub counts a SKIPPED or NEUTRAL check as passing, so only a conclusion outside this set blocks a required name.
STALE_CHECK_RUN_PASSING_CONCLUSIONS = frozenset({"SUCCESS", "SKIPPED", "NEUTRAL"})


def _stale_gate_check_run(rollup):
    """The newest verifier-gate CheckRun of a statusCheckRollup when it is not a passing run, else None.
    A check and a status of one name must both pass, so a failed run of the retired cloud gate blocks
    the merge whatever status is posted; a queued or in-progress run has no conclusion and is flagged
    too. Reuses `_newest_gate_entries`, so an older failure that a later run superseded is history."""
    entry = _newest_gate_entries(rollup).get(("CheckRun", VERIFIER_GATE_NAME))
    if entry is None:
        return None
    conclusion = entry.get("conclusion")
    if isinstance(conclusion, str) and conclusion in STALE_CHECK_RUN_PASSING_CONCLUSIONS:
        return None
    return entry


def _stale_check_run_text(pr_number, entry):
    """The one finding line for a stale verifier-gate CheckRun, with the remedy. The run id is the digits
    after /actions/runs/ in the entry's detailsUrl, else the whole URL, else `unknown`. Never raises."""
    url = entry.get("detailsUrl")
    url = url if isinstance(url, str) else ""
    match = re.search(r"/actions/runs/(\d+)", url)
    run_id = match.group(1) if match else (url or "unknown")
    conclusion = entry.get("conclusion")
    ended = "ended %s" % conclusion if conclusion else "has not ended (%s)" % (entry.get("status") or "unknown")
    return (
        "STALE CHECK RUN: PR #%s: the newest %s check run %s %s on this head, and a check and a status "
        "of the same name must both pass; refresh the head with gh pr update-branch (branch behind main) or "
        "any new commit (level with main), then have the verifier audit the new head"
        % (pr_number, VERIFIER_GATE_NAME, run_id, ended)
    )


def _pr_has_pass_verdict(pr):
    review = report_rules.newest_comment_review(_rest_shaped_reviews(pr.get("reviews") or []))
    if review is None:
        return False
    report = report_rules.parse_report(review.get("body", ""))
    ok, _ = report_rules.check_report(
        report, pr.get("body", ""), pr.get("headRefOid", ""), commit_id=review.get("commit_id")
    )
    return ok


def _pr_verdict_status(pr):
    """("ok", None) | ("stale", reason) | ("missing", None) | ("other", reason) -- classifies a
    PR's newest COMMENT review for `doctor` (section 4's `verified` row,
    section 17's checker table), reusing report_rules.check_report for
    every sha/schema rule instead of re-implementing them here.

    "missing": no COMMENT review at all, or its fence does not even parse --
    doctor's CHECK WITHOUT VERDICT is this case with the gate green.
    "stale": a review exists and parses, but check_report refused it on
    EXACTLY the two-part sha check (`commit_id` differing from head, or
    matching while the self-reported `audited_sha` does not) -- doctor's
    STALE VERDICT, both variants the record calls out by name.
    "other": a review exists and parses but fails check_report for some
    OTHER reason (verdict FAIL, evidence-count mismatch, a missing schema
    field) -- doctor reports it as CHECK WITHOUT VERDICT when the gate is
    green, since a green gate over a verdict that is not a PASS is the same hole.
    "ok": a fully matching PASS review.
    """
    head_sha = pr.get("headRefOid", "")
    review = report_rules.newest_comment_review(_rest_shaped_reviews(pr.get("reviews") or []))
    if review is None:
        return "missing", None
    report = report_rules.parse_report(review.get("body", ""))
    if report is None:
        return "missing", None
    ok, reason = report_rules.check_report(report, pr.get("body", ""), head_sha, commit_id=review.get("commit_id"))
    if ok:
        return "ok", None
    if report_rules.AUDITED_SHA_FIELD in reason or "commit_id" in reason:
        return "stale", reason
    return "other", reason


def _parse_ls_remote_branch_names(ls_remote_output):
    """Branch names (e.g. "plan/foo", no "refs/heads/" prefix) out of
    `git ls-remote origin refs/heads/plan/*` output -- tab-separated
    "<sha>\\trefs/heads/<name>" lines, per git's own plumbing format."""
    names = set()
    for line in ls_remote_output.splitlines():
        parts = line.split("\t")
        if len(parts) == 2 and parts[1].startswith("refs/heads/"):
            names.add(parts[1][len("refs/heads/"):])
    return names


ACCEPTED_SNAPSHOT_RE = re.compile(r"<!-- accepted-snapshot: ([0-9a-f]{64}) -->")
# accept's two comments, written by migrate as well for an adopted entry.
ACCEPTED_NOTICE = "Accepted into #%d. This issue is now frozen; the pull request is the record."
ACCEPTED_SNAPSHOT_COMMENT = "<!-- accepted-snapshot: %s -->"
BLOCKED_COMMENT_MARKER = "**Blocked**"


def _non_empty_not_placeholder(section_text):
    return bool(section_text.strip()) and not PLACEHOLDER_RE.search(section_text)


def _stub_body_is_researched(body):
    """True once Touches, Evidence required, AND at least one Research
    subsection all carry real (non-placeholder) content -- section 4's
    stub/researched split. Checked as the three ### subsections
    individually, never `## Research` as a whole: that whole-section span
    also contains the "### Local insights" etc. HEADING TEXT ITSELF (level-3
    headings do not end a level-2 span), which is non-whitespace text even
    when every subsection under it is genuinely empty -- a stub with zero
    research content would misread as "researched" if checked that way."""
    touches_ok = _non_empty_not_placeholder(get_section(body, ISSUE_HEADINGS["touches"]) or "")
    evidence_ok = _non_empty_not_placeholder(get_section(body, ISSUE_HEADINGS["evidence_required"]) or "")
    research_ok = any(
        _non_empty_not_placeholder(get_section(body, heading) or "")
        for heading in (
            ISSUE_HEADINGS["local_insights"], ISSUE_HEADINGS["online_insights"], ISSUE_HEADINGS["api_docs_needed"],
        )
    )
    return touches_ok and evidence_ok and research_ok


def derive_state(issue, prs):
    """One issue's live state, section 4's names restricted to the six an
    open issue can be in (merged/retired issues are CLOSED, not in this
    list at all -- record's list --json contract)."""
    labels = _label_names(issue.get("labels"))
    if _has_label(labels, LABEL_BLOCKED):
        return "blocked"
    if not _has_label(labels, LABEL_ACCEPTED):
        body = issue.get("body", "")
        if _stub_body_is_researched(body):
            return "researched"
        return "stub"
    pr = _find_pr_for_issue(issue["number"], prs)
    if pr is None:
        return "accepted"
    if pr.get("isDraft"):
        return "accepted"
    handoff = get_section(pr.get("body", ""), HANDOFF_HEADING) or ""
    evidence_report = get_section(pr.get("body", ""), EVIDENCE_REPORT_HEADING) or ""
    if HANDOFF_SENTINEL in handoff or not evidence_report.strip():
        return "accepted"
    if _verifier_gate_green(pr) and _pr_has_pass_verdict(pr):
        return "verified"
    return "implemented"


def _only_plan_issues(issues):
    """An issue with no `plan` label is ignored by the whole state model
    (plan section 14 step 2). `--label` already filters server-side; this
    keeps a response that ignored the filter from putting an unlabelled
    issue into the queue."""
    return [issue for issue in issues if _has_label(_label_names(issue.get("labels")), LABEL_PLAN)]


def fetch_live_issues(repo_root=None):
    return _only_plan_issues(gh_json(
        ["issue", "list", "--label", LABEL_PLAN, "--state", "open", "--limit", "500", "--json", ISSUE_LIST_FIELDS],
        cwd=repo_root,
    ))


def fetch_all_prs(repo_root=None):
    return gh_json(["pr", "list", "--state", "all", "--limit", "500", "--json", PR_LIST_FIELDS], cwd=repo_root)


# `doctor` (section 4's negative controls, section 17's checker table) needs
# every plan issue regardless of open/closed state -- a merged entry's issue
# is CLOSED, and "SHIPPED, ISSUE OPEN" / "ISSUE DIVERGED" both need to see
# closed issues too, unlike fetch_live_issues()'s `--state open` filter.
DOCTOR_ISSUE_FIELDS = ISSUE_LIST_FIELDS + ",state"


def fetch_all_plan_issues(repo_root=None):
    return _only_plan_issues(gh_json(
        ["issue", "list", "--label", LABEL_PLAN, "--state", "all", "--limit", "500", "--json", DOCTOR_ISSUE_FIELDS],
        cwd=repo_root,
    ))


PLAN_AUDIT_FENCE_RE = re.compile(r"```json plan-audit\s*\n(.*?)```", re.DOTALL)
LOG_LINE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\b")
UNBLOCKED_COMMENT_TEXT = "Unblocked."


def _classify_log_comment(comment):
    """One issue/PR comment -> its `list --json` log line, or None to skip
    it (the accept notice, the hidden accepted-snapshot marker, ordinary
    chatter -- anything not written by `queue log`/`audit-record`/`block`/
    `unblock`). The date is the comment's own `createdAt`, except for a
    `queue log` comment, which is used exactly as written (it already
    carries its own date, from `queue log`'s own write time)."""
    body = comment.get("body", "") or ""
    created_at = comment.get("createdAt", "") or ""
    comment_date = created_at[:10] if created_at else ""

    fence_match = PLAN_AUDIT_FENCE_RE.search(body)
    if fence_match:
        try:
            payload = json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            return None
        verdict = payload.get("verdict")
        if verdict not in ("APPROVED", "REVISE"):
            return None
        # The literal word REVISE must survive here -- audit_mechanical.py's
        # stuck-loop check matches it as a plain substring against this
        # exact log line, never a semantic verdict field.
        line = "%s plan-audit %s" % (comment_date, verdict)
        note = payload.get("note")
        if note:
            line += ": %s" % note
        return line

    if body.startswith(BLOCKED_COMMENT_MARKER):
        reason = body[len(BLOCKED_COMMENT_MARKER):].lstrip(": ").strip()
        return "%s blocked: %s" % (comment_date, reason)

    if body.strip() == UNBLOCKED_COMMENT_TEXT:
        return "%s unblocked" % comment_date

    if LOG_LINE_RE.match(body):
        return body.strip()

    return None


def _build_log(issue, pr):
    """The issue's own comments, then -- once a PR exists, i.e. once
    accepted -- the PR's own comments too, oldest first by `createdAt`."""
    comments = list(issue.get("comments") or [])
    if pr is not None:
        comments += list(pr.get("comments") or [])
    comments.sort(key=lambda c: c.get("createdAt") or "")
    return [line for line in (_classify_log_comment(c) for c in comments) if line is not None]


def build_live_entries(issues, prs):
    # First pass: every live issue's own entry id, keyed by issue number --
    # prerequisites resolve THROUGH this map (an id absent from it, because
    # the referenced issue is closed/merged/retired, or simply not a plan
    # issue, is "already satisfied" per the record's field map: omitted,
    # never a dangling reference).
    id_by_issue_number = {}
    for issue in issues:
        body = issue.get("body", "")
        pr = _find_pr_for_issue(issue["number"], prs)
        _, entry_id = parse_entry_header(pr["body"]) if pr else (None, None)
        if entry_id is None:
            id_match = re.search(r"^id:\s*(\S+)", body, re.MULTILINE)
            entry_id = id_match.group(1) if id_match else "issue-%d" % issue["number"]
        id_by_issue_number[issue["number"]] = entry_id

    entries = []
    for issue in issues:
        body = issue.get("body", "")
        state = derive_state(issue, prs)
        pr = _find_pr_for_issue(issue["number"], prs)
        entry_id = id_by_issue_number[issue["number"]]
        touches_section = get_section(body, ISSUE_HEADINGS["touches"]) or ""
        touches = [line[2:].strip() for line in touches_section.splitlines() if line.startswith("- ")]
        evidence_section = get_section(body, ISSUE_HEADINGS["evidence_required"]) or ""
        evidence_required = [
            re.sub(r"^\d+\.\s*", "", line).strip()
            for line in evidence_section.splitlines()
            if re.match(r"^\d+\.\s", line)
        ]
        # Pre-accept, `Depends on:` lives in the issue's own `## Gates`;
        # post-accept, `queue accept` has already copied it into the PR's
        # `## Brief`, frozen from then on -- read whichever body is live.
        depends_source = get_section(pr.get("body", ""), BRIEF_HEADING) if pr else get_section(body, ISSUE_HEADINGS["gates"])
        prereq_issue_numbers = _parse_depends_on_ids(depends_source or "")
        prerequisites = [
            id_by_issue_number[n] for n in prereq_issue_numbers if n in id_by_issue_number
        ]
        priority = _priority_of(_label_names(issue.get("labels")))[0] or DEFAULT_PRIORITY
        entries.append({
            "id": entry_id,
            "state": state,
            "priority": priority,
            "touches": touches,
            "evidence_required": evidence_required,
            "prerequisites": prerequisites,
            "log": _build_log(issue, pr),
            "issue": issue["number"],
            "pr": pr["number"] if pr else None,
        })
    return entries


# =============================================================================
# Subcommands
# =============================================================================


def cmd_stub(args, repo_root):
    entry_id = args.id
    body = compose_issue_body(entry_id, args.intent, args.touches or [], args.evidence or [])
    path = _body_tempfile(body)
    create_args = ["issue", "create", "--title", args.title, "--body-file", path, "--label", LABEL_PLAN,
                   "--label", PRIORITY_LABEL_BY_NUMBER[args.priority]]
    result = run_gh(create_args, cwd=repo_root)
    number_match = re.search(r"/issues/(\d+)", result.stdout)
    if number_match is None:
        sys.stderr.write("WRITE NOT PERSISTED: gh issue create did not report a new issue number\n")
        raise SystemExit(1)
    number = int(number_match.group(1))
    readback = gh_json(["issue", "view", number, "--json", "body"], cwd=repo_root)
    if not bodies_match(readback.get("body"), body):
        sys.stderr.write("WRITE NOT PERSISTED: issue #%d body read-back did not match what was written\n" % number)
        raise SystemExit(1)
    if args.successor_of:
        run_gh(["issue", "comment", number, "--body", "%s successor-of %s" % (_today(), args.successor_of)], cwd=repo_root)
    print("stub: issue #%d created for %s" % (number, entry_id))
    return 0


def _research_refuse(flag, value, reason):
    sys.stderr.write("research: refusing %s %r: %s\n" % (flag, value, reason))
    return 1


def _research_list_value_problem(flag, values, line_format):
    """The first (flag, value, reason) among `values` that cannot be written as a section line, else None.
    Each value is checked as the line it will become, so the tool never writes what PLACEHOLDER_RE reads as unfilled."""
    for index, value in enumerate(values, start=1):
        if not value.strip():
            return (flag, value, "the value is empty")
        if "\n" in value or "\r" in value:
            return (flag, value, "the value contains a newline; give one %s per option" % flag.lstrip("-"))
        if PLACEHOLDER_RE.search(line_format(index, value)):
            return (flag, value, "the value would be written as a placeholder line")
    return None


def cmd_research(args, repo_root):
    touches = args.touches
    evidence = args.evidence
    for problem in (
        _research_list_value_problem("--touches", touches or [], lambda i, v: "- %s" % v),
        _research_list_value_problem("--evidence", evidence or [], lambda i, v: "%d. %s" % (i, v)),
    ):
        if problem is not None:
            return _research_refuse(*problem)
    wants_sections = touches is not None or evidence is not None
    json_fields = "body,labels" if wants_sections else "body"
    issue = gh_json(["issue", "view", args.issue, "--json", json_fields], cwd=repo_root)
    body = issue["body"]
    if wants_sections:
        flag = "--touches" if touches is not None else "--evidence"
        if _has_label(_label_names(issue.get("labels")), LABEL_ACCEPTED):
            return _research_refuse(flag, "", "issue #%d is accepted and frozen; its pull request is the record" % args.issue)
        if ISSUE_MARKER not in body:
            return _research_refuse(flag, "", "issue #%d body lacks the %s marker, so it is not a plan issue" % (args.issue, ISSUE_MARKER))
        for given, key, name in ((touches, "touches", "--touches"), (evidence, "evidence_required", "--evidence")):
            if given is not None and section_span(body, ISSUE_HEADINGS[key]) is None:
                return _research_refuse(name, "", "issue #%d body lacks the %s heading" % (args.issue, ISSUE_HEADINGS[key]))
    if touches is not None:
        body = set_section(body, ISSUE_HEADINGS["touches"], "\n".join("- %s" % t for t in touches) + "\n\n")
    if evidence is not None:
        body = set_section(
            body, ISSUE_HEADINGS["evidence_required"],
            "\n".join("%d. %s" % (i, e) for i, e in enumerate(evidence, start=1)) + "\n\n",
        )
    if args.local is not None:
        body = set_section(body, ISSUE_HEADINGS["local_insights"], args.local.rstrip() + "\n")
    if args.online is not None:
        body = set_section(body, ISSUE_HEADINGS["online_insights"], args.online.rstrip() + "\n")
    if args.api_docs is not None:
        body = set_section(body, ISSUE_HEADINGS["api_docs_needed"], args.api_docs.rstrip() + "\n")
    if args.prereq is not None:
        gates_section = get_section(body, ISSUE_HEADINGS["gates"]) or ""
        new_gates = _set_depends_on_in_gates(gates_section, sorted(set(args.prereq)))
        body = set_section(body, ISSUE_HEADINGS["gates"], new_gates)
    write_issue_body(args.issue, body, repo_root=repo_root)
    print("research: issue #%d updated" % args.issue)
    return 0


def cmd_audit_record(args, repo_root):
    payload = {"verdict": args.verdict, "note": args.note}
    fence = "```json plan-audit\n%s\n```" % json.dumps(payload, indent=2)
    run_gh(["issue", "comment", args.issue, "--body", fence], cwd=repo_root)
    print("audit-record: issue #%d %s" % (args.issue, args.verdict))
    return 0


def _today():
    return date.today().isoformat()


def cmd_accept(args, repo_root):
    issue = gh_json(["issue", "view", args.issue, "--json", "number,title,body,labels"], cwd=repo_root)
    body = issue["body"]
    id_match = re.search(r"^id:\s*(\S+)", body, re.MULTILINE)
    entry_id = id_match.group(1) if id_match else "issue-%d" % issue["number"]
    intent = (get_section(body, ISSUE_HEADINGS["intent"]) or "").strip()
    touches_section = get_section(body, ISSUE_HEADINGS["touches"]) or ""
    touches = [line[2:].strip() for line in touches_section.splitlines() if line.startswith("- ")]
    evidence_section = get_section(body, ISSUE_HEADINGS["evidence_required"]) or ""
    evidence_required = [
        re.sub(r"^\d+\.\s*", "", line).strip()
        for line in evidence_section.splitlines()
        if re.match(r"^\d+\.\s", line)
    ]
    priority, priority_label = _priority_of(_label_names(issue.get("labels")))
    if priority is None:
        priority = DEFAULT_PRIORITY
        priority_label = PRIORITY_LABEL_BY_NUMBER[priority]
    local = (get_section(body, ISSUE_HEADINGS["local_insights"]) or "").strip()
    online = (get_section(body, ISSUE_HEADINGS["online_insights"]) or "").strip()
    api_docs = (get_section(body, ISSUE_HEADINGS["api_docs_needed"]) or "").strip()
    gates_section = get_section(body, ISSUE_HEADINGS["gates"]) or ""
    resources_match = re.search(r"^resources:\s*(.*)$", gates_section, re.MULTILINE)
    gate_override_match = re.search(r"^gate_override:\s*(.*)$", gates_section, re.MULTILINE)
    try:
        resources = json.loads(resources_match.group(1)) if resources_match else []
    except (json.JSONDecodeError, AttributeError):
        resources = []
    try:
        gate_override = json.loads(gate_override_match.group(1)) if gate_override_match else []
    except (json.JSONDecodeError, AttributeError):
        gate_override = []
    depends_on = _parse_depends_on_ids(gates_section)

    base = args.base or "main"
    branch = "plan/%s" % entry_id
    _fetch_pinned([_tracking_refspec(base)], repo_root)
    existing_branches = _parse_ls_remote_branch_names(
        run_git(["ls-remote", "origin", "refs/heads/%s" % branch], cwd=repo_root).stdout
    )
    if branch not in existing_branches:
        # An EMPTY commit, built entirely with plumbing so the caller's own
        # HEAD/index/worktree never move (queue.py may run from an
        # implementer's own in-progress checkout): `git commit-tree
        # <base tree> -p <base>` makes a new commit object on top of
        # origin/<base> without touching the working tree at all. Without a
        # real commit between <base> and plan/<id>, `gh pr create` refuses
        # "No commits between main and plan/<id>" -- verified live,
        # gh-pipeline-queue-tool repair round 2 (issue #39/PR #40).
        base_sha = run_git(["rev-parse", "origin/%s" % base], cwd=repo_root).stdout.strip()
        base_tree = run_git(["rev-parse", "%s^{tree}" % base_sha], cwd=repo_root).stdout.strip()
        new_sha = run_git(
            ["commit-tree", base_tree, "-p", base_sha, "-m", "plan/%s: accepted" % entry_id], cwd=repo_root
        ).stdout.strip()
        run_git(["push", "origin", "%s:refs/heads/%s" % (new_sha, branch)], cwd=repo_root)
    # else: a prior run already pushed this branch (and may have crashed
    # before the PR existed, or before the issue was labeled) -- reuse it
    # rather than pushing a second empty commit on top.

    # Order writes so a re-run COMPLETES a failed run instead of repeating
    # it: the PR must exist before the issue is labeled or commented on, so
    # a crash between the branch push and `gh pr create` leaves no stray
    # label behind for `queue doctor` to have to notice.
    existing_prs = gh_json(["pr", "list", "--head", branch, "--state", "open", "--json", "number,body"], cwd=repo_root)
    if existing_prs:
        pr_number = existing_prs[0]["number"]
    else:
        pr_body = compose_pr_body_at_accept(
            entry_id, issue["number"], intent, priority, priority_label, touches, evidence_required,
            depends_on=depends_on, resources=resources, gate_override=gate_override, local=local, online=online, api_docs=api_docs,
        )
        pr_body_path = _body_tempfile(pr_body)
        result = run_gh([
            "pr", "create", "--draft", "--title", issue["title"], "--body-file", pr_body_path,
            "--head", branch, "--base", base,
        ], cwd=repo_root)
        pr_number_match = re.search(r"/pull/(\d+)", result.stdout)
        if pr_number_match is None:
            sys.stderr.write("WRITE NOT PERSISTED: gh pr create did not report a new PR number\n")
            raise SystemExit(1)
        pr_number = int(pr_number_match.group(1))
        readback = gh_json(["pr", "view", pr_number, "--json", "body,closingIssuesReferences"], cwd=repo_root)
        if not bodies_match(readback.get("body"), pr_body):
            sys.stderr.write("WRITE NOT PERSISTED: PR #%d body read-back did not match what was written\n" % pr_number)
            raise SystemExit(1)
        _check_pr_links_issue(readback, issue["number"], pr_number, repo_root)

    if _has_label(_label_names(issue.get("labels")), LABEL_ACCEPTED):
        print("accept: issue #%d -> PR #%d on %s (resumed; already labeled)" % (issue["number"], pr_number, branch))
        return 0

    run_gh(["issue", "edit", issue["number"], "--add-label", LABEL_ACCEPTED], cwd=repo_root)
    run_gh(["issue", "comment", issue["number"], "--body", ACCEPTED_NOTICE % pr_number], cwd=repo_root)
    snapshot = hashlib.sha256(body.encode("utf-8")).hexdigest()
    run_gh(["issue", "comment", issue["number"], "--body", ACCEPTED_SNAPSHOT_COMMENT % snapshot], cwd=repo_root)
    print("accept: issue #%d -> PR #%d on %s" % (issue["number"], pr_number, branch))
    return 0


def cmd_implemented(args, repo_root):
    pr = gh_json(["pr", "view", args.pr, "--json", "number,body"], cwd=repo_root)
    body = pr["body"]
    check_not_already_implemented(body, args.pr)
    _, entry_id = parse_entry_header(body)
    issue_number, _ = parse_entry_header(body)
    evidence_report_text = args.evidence_report
    if args.evidence_report_file:
        with open(args.evidence_report_file, "r", encoding="utf-8") as fh:
            evidence_report_text = fh.read()
    new_body = compose_handoff_and_evidence(
        body, args.handoff, evidence_report_text or "", partial=args.partial, split_into=args.split_into,
    )
    write_pr_body(args.pr, new_body, issue_number=issue_number, repo_root=repo_root)
    run_gh(["pr", "ready", args.pr], cwd=repo_root)
    print("implemented: PR #%d (%s)" % (args.pr, entry_id))
    return 0


def _flatten_paginated_pages(pages):
    """`gh api ... --paginate --slurp` wraps ONE JSON array per page inside
    an outer array (a bare `--paginate` prints one JSON array per page back
    to back, not one flattened array; `--slurp` wraps that into an array of
    those arrays), so the live shape is `[[{review}, ...], [{review}, ...]]`,
    never a flat `[{review}, ...]` -- repair round 3's crash was exactly a
    `.get` on one of these page-lists, one level too shallow. Flattens
    the pages into one list; returns None (never a
    partial list) if `pages` or any page or any element does not have
    EXACTLY that shape, so a caller's refusal is the only way a malformed
    response is ever handled, never a silent partial read."""
    if not isinstance(pages, list):
        return None
    flattened = []
    for page in pages:
        if not isinstance(page, list):
            return None
        for element in page:
            if not isinstance(element, dict):
                return None
            flattened.append(element)
    return flattened


def _fetch_rest_reviews(pr_number, repo_root=None):
    """Every review of the PR over REST (`--paginate --slurp`), flattened, or None when the response
    is not the slurped page-list shape. The only review source `gate-pass` reads: `gh pr view --json
    reviews` is GraphQL and carries no `html_url`."""
    result = run_gh(["api", "repos/{owner}/{repo}/pulls/%d/reviews" % pr_number, "--paginate", "--slurp"], cwd=repo_root)
    try:
        pages = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return _flatten_paginated_pages(pages)


def _fetch_review_html_url(pr_number, target_review, repo_root=None):
    """The verifier review's own web URL, for the merge-body `Verifier-
    Review:` trailer -- `gh pr view --json reviews` (GraphQL) carries no
    `html_url`/`url` field at all (live field list, 2026-09-28; repair
    round 2 shipped this with the field simply absent, silently producing a
    BLANK trailer). The REST endpoint does carry it:
    `gh api repos/{owner}/{repo}/pulls/<n>/reviews --paginate --slurp`
    (`{owner}`/`{repo}` are gh's own placeholder syntax, resolved from the
    invoking repo's context, never hand-resolved here). Matched to
    `target_review` (the GraphQL review `newest_comment_review` already
    picked) by id first -- but GraphQL's `id` is a node id string
    (`PRR_...`) while REST review objects carry a numeric `id` and the SAME
    node id under `node_id` (live shapes, repair round 3), so the match is
    against `node_id`, never the REST numeric `id`, or it can never hit.
    Falls back to "the newest COMMENTED one" by the same rule
    report_rules.newest_comment_review already applies, reused here since
    REST review objects carry the same `state`/`submitted_at` shape.
    Returns None, never "", on any failure to find one -- an empty URL must
    be a refusal, never a blank trailer."""
    rest_reviews = _fetch_rest_reviews(pr_number, repo_root)
    if rest_reviews is None:
        return None

    target_id = target_review.get("id")
    if target_id is not None:
        for rest_review in rest_reviews:
            if str(rest_review.get("node_id")) == str(target_id):
                url = rest_review.get("html_url")
                if url:
                    return url

    newest = report_rules.newest_comment_review(rest_reviews)
    if newest is not None:
        url = newest.get("html_url")
        if url:
            return url
    return None


def cmd_ship_check(args, repo_root):
    pr = gh_json(["pr", "view", args.pr, "--json",
                  "number,title,headRefOid,reviews,body,closingIssuesReferences,statusCheckRollup,baseRefName"], cwd=repo_root)
    head_sha = pr["headRefOid"]
    issue_number, entry_id = parse_entry_header(pr["body"])
    if issue_number is None:
        sys.stderr.write("CANNOT SHIP: PR #%d's ## Entry header does not name a Closes #n / id\n" % args.pr)
        raise SystemExit(1)

    review, reason = _judge_verdict(_rest_shaped_reviews(pr.get("reviews") or []), pr["body"], head_sha)
    if reason is not None:
        sys.stderr.write("CANNOT SHIP: %s\n" % reason)
        raise SystemExit(1)

    # The status reading is information only: the printed gate-pass posts that status, so refusing
    # unless it is already green would be circular. A stale CheckRun is not circular, gate-pass cannot clear it.
    gate_state = "SUCCESS" if _verifier_gate_green(pr) else "not yet SUCCESS"
    print("ship --check: verifier-gate currently reads: %s" % gate_state)

    stale = _stale_gate_check_run(pr.get("statusCheckRollup"))
    if stale is not None:
        sys.stderr.write("CANNOT SHIP: %s\n" % _stale_check_run_text(args.pr, stale))
        raise SystemExit(1)

    overlap = _ship_behind_overlap(pr, head_sha, repo_root)
    if overlap:
        sys.stderr.write("BEHIND AND OVERLAPPING: %s\n" % ", ".join(sorted(overlap)))
        raise SystemExit(1)

    # The merge subject names the actual PR title (copied from the issue
    # title by `queue accept`, section 5) -- entries_audited[0] is the
    # entry id, not a human-readable title, and happened to read the same
    # as entry_id only by fixture coincidence in this file's own tests.
    subject = "plan/%s: %s" % (entry_id, pr.get("title", ""))
    review_url = _fetch_review_html_url(args.pr, review, repo_root=repo_root)
    if not review_url:
        # An empty URL must be a refusal, never a blank Verifier-Review:
        # trailer.
        sys.stderr.write("CANNOT SHIP: could not determine the verifier review's own URL via `gh api .../reviews`\n")
        raise SystemExit(1)
    fence_match = report_rules.FENCE_RE.search(review.get("body", ""))
    fence_block = fence_match.group(0) if fence_match else ""
    partial = bool(re.search(r"-\s*\[[xX]\]\s*partial", pr["body"]))
    split_match = re.search(r"Split into:\s*#(\d+)", pr["body"])
    trailer_lines = [
        "Entry: %s" % entry_id,
        "Issue: #%d" % issue_number,
        "Verified-Sha: %s" % head_sha,
        "Verifier-Review: %s" % review_url,
    ]
    if partial and split_match:
        trailer_lines.append("Split-Into: #%s" % split_match.group(1))
    merge_body = "%s\n\n%s\n" % (fence_block, "\n".join(trailer_lines))

    # Outside the repo, never the invoking cwd or any working tree: this
    # runs from a plan-worker's own checkout as easily as the coordinator's,
    # and neither should ever pick up an untracked merge-body.txt/v.txt.
    out_dir = Path(tempfile.mkdtemp(prefix="queue-ship-%d-" % args.pr))
    merge_body_path = (Path(args.merge_body_out) if args.merge_body_out else out_dir / "merge-body.txt").resolve()
    merge_body_path.write_text(merge_body, encoding="utf-8")

    v_path = (Path(args.verifier_report_out) if args.verifier_report_out else out_dir / "v.txt").resolve()
    v_path.write_text(review.get("body", ""), encoding="utf-8")

    print("ship --check: PR #%d ready. Run exactly, in order:" % args.pr)
    # The PASS review already exists -- it is this command's OWN
    # precondition, checked above -- so it must never be printed as a
    # second, runnable `gh pr review` call: running it again would post a
    # DUPLICATE review. This line is a comment, not a command.
    print("# already posted: %s (gh pr review %d --comment --body-file %s)" % (review_url, args.pr, v_path))
    print("python3 tools/queue/queue.py --repo-root . gate-pass %d" % args.pr)
    print("gh pr merge --merge --match-head-commit %s --subject %s --body-file %s %d" % (
        head_sha, json.dumps(subject), merge_body_path, args.pr,
    ))
    return 0


def _ship_behind_overlap(pr, head_sha, repo_root):
    refspecs = [_tracking_refspec("main")]
    # The PR head is a branch tip on origin: fetched by object name, so no ref is written for it.
    if run_git(["cat-file", "-e", "%s^{commit}" % head_sha], cwd=repo_root, check=False).returncode != 0:
        refspecs.append(head_sha)
    _fetch_pinned(refspecs, repo_root)
    main_sha = run_git(["rev-parse", "origin/main"], cwd=repo_root).stdout.strip()
    merge_base = run_git(["merge-base", "origin/main", head_sha], cwd=repo_root).stdout.strip()
    if merge_base == main_sha:
        return set()  # not behind at all
    main_changed = set(run_git(["diff", "--name-only", merge_base, main_sha], cwd=repo_root).stdout.splitlines())
    pr_changed = set(run_git(["diff", "--name-only", merge_base, head_sha], cwd=repo_root).stdout.splitlines())
    return main_changed & pr_changed


def _fetch_merge_commit_message(merge_sha, repo_root):
    """The merge commit's own message, via the REST commits endpoint (never
    local `git log`: the merge commit may not be fetched into this
    checkout at all) -- `--jq .commit.message` returns the raw string, the
    trailer block `ship --check` wrote into `merge-body.txt` verbatim."""
    result = run_gh(["api", "repos/{owner}/{repo}/commits/%s" % merge_sha, "--jq", ".commit.message"], cwd=repo_root)
    return result.stdout


TRAILER_RE_TEMPLATE = r"^%s:\s*(.+)$"


def _parse_trailer(commit_message, key):
    match = re.search(TRAILER_RE_TEMPLATE % re.escape(key), commit_message, re.MULTILINE)
    return match.group(1).strip() if match else None


def _check_merge_trailers(commit_message, entry_id, issue_number, head_sha):
    """Section 6/17's merge proof, the trailer half: re-reading `merged` and
    `is-ancestor` alone proves A merge happened, never that IT WAS THE
    AUDITED COMMIT -- the trailers `ship --check` wrote are the only record
    of that binding once the branch and the review thread are gone.
    Returns (ok, reason), never raises -- a malformed or missing trailer is
    a named reason, exactly like report_rules.check_report's own contract."""
    entry_trailer = _parse_trailer(commit_message, "Entry")
    if entry_trailer != entry_id:
        return False, "missing or mismatched Entry: trailer (want %r, got %r)" % (entry_id, entry_trailer)
    issue_trailer = _parse_trailer(commit_message, "Issue")
    if issue_trailer != "#%d" % issue_number:
        return False, "missing or mismatched Issue: trailer (want %r, got %r)" % ("#%d" % issue_number, issue_trailer)
    sha_trailer = _parse_trailer(commit_message, "Verified-Sha")
    if sha_trailer != head_sha:
        return False, "Verified-Sha: trailer %r does not match the PR head sha %r" % (sha_trailer, head_sha)
    review_trailer = _parse_trailer(commit_message, "Verifier-Review")
    if not review_trailer or not review_trailer.startswith("https://"):
        return False, "missing or non-URL Verifier-Review: trailer (got %r)" % (review_trailer,)
    return True, "ok"


def cmd_ship_confirm(args, repo_root):
    pr = gh_json(["pr", "view", args.pr, "--json", "number,state,mergeCommit,mergedAt,body,headRefOid"], cwd=repo_root)
    if pr.get("state") != "MERGED":
        sys.stderr.write("NOT MERGED: PR #%d state is %r, not MERGED\n" % (args.pr, pr.get("state")))
        raise SystemExit(1)
    merge_sha = (pr.get("mergeCommit") or {}).get("oid")
    if not merge_sha:
        sys.stderr.write("CANNOT CONFIRM: PR #%d has no mergeCommit.oid\n" % args.pr)
        raise SystemExit(1)
    _fetch_pinned([_tracking_refspec("main")], repo_root)
    run_git(["merge-base", "--is-ancestor", merge_sha, "origin/main"], cwd=repo_root)

    issue_number, entry_id = parse_entry_header(pr["body"])
    if issue_number is None:
        sys.stderr.write("CANNOT CONFIRM: PR #%d's ## Entry header does not name a Closes #n / id\n" % args.pr)
        raise SystemExit(1)

    commit_message = _fetch_merge_commit_message(merge_sha, repo_root)
    ok, reason = _check_merge_trailers(commit_message, entry_id, issue_number, pr.get("headRefOid"))
    if not ok:
        sys.stderr.write("MERGE TRAILERS INVALID: %s\n" % reason)
        raise SystemExit(1)

    issue = gh_json(["issue", "view", issue_number, "--json", "state"], cwd=repo_root)
    if issue.get("state") != "CLOSED":
        print("REPAIR NEEDED: gh issue close %d --reason completed" % issue_number)
        return 1
    print("ship --confirm: PR #%d merged as %s, ancestor of origin/main, issue closed" % (args.pr, merge_sha))
    return 0


# =============================================================================
# gate-pass -- the verifier's local stand-in for the cloud verifier-gate check.
# =============================================================================

# The three files that decide a verdict: this process's own copy of each must be origin/main's.
JUDGED_FILES = ("queue.py", "report_rules.py", "schema.json")
JUDGED_DIR_RELPATH = "tools/queue"


def _gate_pass_refuse(reason):
    sys.stderr.write("gate-pass: REFUSED: %s\n" % reason)
    return 1


def _judge_integrity_problem(repo_root):
    """None when this process's own queue.py, report_rules.py and schema.json have origin/main's
    blob ids, else the reason. The judge must be main's code, not the PR's: `--repo-root` does not
    choose which tools/queue runs. Fetches first, since a stale origin/main would call a changed
    judge unchanged; compares blob ids, so line endings and decoding cannot hide a difference."""
    try:
        _fetch_pinned([_tracking_refspec("main")], repo_root)
    except GitError as exc:
        return "could not fetch origin/main: %s" % exc
    for name in JUDGED_FILES:
        relpath = "%s/%s" % (JUDGED_DIR_RELPATH, name)
        on_main = run_git(["rev-parse", "--verify", "-q", "origin/main:%s" % relpath], cwd=repo_root, check=False)
        if on_main.returncode != 0:
            return "%s is not on origin/main" % relpath
        mine = run_git(["hash-object", "--no-filters", str(THIS_DIR / name)], cwd=repo_root).stdout.strip()
        if mine != on_main.stdout.strip():
            return (
                "the judge differs from origin/main: %s (running %s); run `git merge --ff-only origin/main` "
                "in a clean tree, then run gate-pass again" % (relpath, THIS_DIR / name)
            )
    return None


def _gate_status_posted(rollup, review_url):
    """True when the newest verifier-gate StatusContext is SUCCESS under `review_url`."""
    newest = _newest_gate_entries(rollup).get(("StatusContext", VERIFIER_GATE_NAME))
    return newest is not None and newest.get("state") == "SUCCESS" and newest.get("targetUrl") == review_url


def _gate_pass_read_back(pr_number, head_sha, review_url, repo_root):
    """0 once a read shows the posted status, else a refusal's exit code. A head that moved since the
    post is refused at once (a retry cannot move it back); a status that is not there yet is re-read
    on the same bounded backoff as the PR-link check."""
    for delay in (None,) + _LINK_RETRY_DELAYS_SECONDS:
        if delay is not None:
            _sleep(delay)
        readback = gh_json(["pr", "view", pr_number, "--json", "headRefOid,statusCheckRollup"], cwd=repo_root)
        if readback.get("headRefOid") != head_sha:
            return _gate_pass_refuse(
                "PR #%d's head moved from %s to %s after the status was posted to %s"
                % (pr_number, head_sha, readback.get("headRefOid"), head_sha)
            )
        if _gate_status_posted(readback.get("statusCheckRollup"), review_url):
            return 0
    sys.stderr.write(
        "WRITE NOT PERSISTED: no %s status reading SUCCESS under %s was found on %s after posting\n"
        % (VERIFIER_GATE_NAME, review_url, head_sha)
    )
    return 1


def _post_gate_status(head_sha, review_url, repo_root):
    """0 once the verifier-gate success status is posted; 1 (with a clear refusal) when a cloud session's proxy
    refuses commit-status writes. Any other gh failure raises."""
    try:
        run_gh([
            "api", "repos/{owner}/{repo}/statuses/%s" % head_sha, "--method", "POST",
            "-f", "state=success", "-f", "context=%s" % VERIFIER_GATE_NAME, "-f", "target_url=%s" % review_url,
            "-f", "description=verifier-report PASS audited on %s" % head_sha[:12],
        ], cwd=repo_root)
    except GhError as error:
        if PROXY_WRITE_BLOCKED_TEXT not in error.result.stderr + error.result.stdout:
            raise
        sys.stderr.write(
            "CANNOT POST GATE: this session's proxy refuses commit-status writes (a Claude Code cloud session); "
            "no %s status was posted. Run gate-pass from a machine with direct GitHub access.\n" % VERIFIER_GATE_NAME
        )
        return 1
    return 0


def cmd_gate_pass(args, repo_root):
    problem = _judge_integrity_problem(repo_root)
    if problem is not None:
        return _gate_pass_refuse(problem)

    pr = gh_json(["pr", "view", args.pr, "--json", "headRefOid,body,baseRefName,statusCheckRollup"], cwd=repo_root)
    # `main` is spelled out, as in `_ship_behind_overlap`: this file never reads default_branch.
    if pr.get("baseRefName") != "main":
        return _gate_pass_refuse("PR #%d is based on %r, not 'main'" % (args.pr, pr.get("baseRefName")))
    head_sha = pr.get("headRefOid")
    if not head_sha:
        return _gate_pass_refuse("PR #%d reports no head sha" % args.pr)

    reviews = _fetch_rest_reviews(args.pr, repo_root)
    if reviews is None:
        return _gate_pass_refuse("PR #%d's reviews did not come back as the REST page-list shape" % args.pr)
    review, reason = _judge_verdict(reviews, pr.get("body") or "", head_sha)
    if reason is not None:
        return _gate_pass_refuse(reason)
    review_url = review.get("html_url")
    if not review_url:
        return _gate_pass_refuse("the PASS review on PR #%d carries no html_url to link the status to" % args.pr)

    # Before the already-posted return and the POST: no status can clear a stale CheckRun, and a refusal
    # after the POST would leave a SUCCESS status behind a non-zero exit.
    stale = _stale_gate_check_run(pr.get("statusCheckRollup"))
    if stale is not None:
        return _gate_pass_refuse(_stale_check_run_text(args.pr, stale))

    # A re-run must post nothing: GitHub caps statuses at 1000 per sha and context.
    if _gate_status_posted(pr.get("statusCheckRollup"), review_url):
        print("gate-pass: already posted %s success on %s for %s; posted nothing" % (VERIFIER_GATE_NAME, head_sha, review_url))
        return 0

    posted = _post_gate_status(head_sha, review_url, repo_root)
    if posted != 0:
        return posted
    code = _gate_pass_read_back(args.pr, head_sha, review_url, repo_root)
    if code == 0:
        print("gate-pass: posted %s success on %s for %s" % (VERIFIER_GATE_NAME, head_sha, review_url))
    return code


def cmd_block(args, repo_root):
    kind = "pr" if args.pr else "issue"
    run_gh([kind, "edit", args.number, "--add-label", LABEL_BLOCKED], cwd=repo_root)
    run_gh([kind, "comment", args.number, "--body", "%s: %s" % (BLOCKED_COMMENT_MARKER, args.reason)], cwd=repo_root)
    print("block: %s #%d" % (kind, args.number))
    return 0


def cmd_unblock(args, repo_root):
    kind = "pr" if args.pr else "issue"
    run_gh([kind, "edit", args.number, "--remove-label", LABEL_BLOCKED], cwd=repo_root)
    run_gh([kind, "comment", args.number, "--body", "Unblocked."], cwd=repo_root)
    print("unblock: %s #%d" % (kind, args.number))
    return 0


def cmd_retire(args, repo_root):
    issue = gh_json(["issue", "view", args.issue, "--json", "state"], cwd=repo_root)
    if issue.get("state") == "CLOSED":
        sys.stderr.write("ALREADY CLOSED: issue #%d is already closed; re-closing is a silent no-op\n" % args.issue)
        raise SystemExit(1)
    run_gh(["issue", "close", args.issue, "--reason", "not planned"], cwd=repo_root)
    print("retire: issue #%d" % args.issue)
    return 0


def cmd_retire_pr(args, repo_root):
    pr = gh_json(["pr", "view", args.pr, "--json", "state"], cwd=repo_root)
    if pr.get("state") != "OPEN":
        sys.stderr.write("CANNOT RETIRE: PR #%d state is %r, not OPEN\n" % (args.pr, pr.get("state")))
        raise SystemExit(1)
    run_gh(["pr", "close", args.pr], cwd=repo_root)
    print("retire-pr: PR #%d closed unmerged" % args.pr)
    return 0


def cmd_log(args, repo_root):
    kind = "pr" if args.pr else "issue"
    text = "%s %s" % (_today(), args.text)
    run_gh([kind, "comment", args.number, "--body", text], cwd=repo_root)
    print("log: %s #%d: %s" % (kind, args.number, text))
    return 0


def cmd_status(args, repo_root):
    try:
        issues = fetch_live_issues(repo_root)
        prs = fetch_all_prs(repo_root)
    except (GhError, GitError, json.JSONDecodeError) as exc:
        sys.stderr.write("STALE: a live read failed, not printing possibly-wrong state -- %s\n" % exc)
        raise SystemExit(4)

    if not issues:
        print("queue is empty")
        return 0

    entries = build_live_entries(issues, prs)
    counts = {s: 0 for s in LIVE_STATES}
    for e in entries:
        counts[e["state"]] = counts.get(e["state"], 0) + 1

    if args.json:
        print(json.dumps(counts))
    else:
        for state in LIVE_STATES:
            print("%s: %d" % (state, counts[state]))
    return 0


def cmd_list(args, repo_root):
    issues = fetch_live_issues(repo_root)
    prs = fetch_all_prs(repo_root)
    entries = build_live_entries(issues, prs)
    if args.json:
        print(json.dumps(entries))
    else:
        for e in entries:
            print("%s (#%d) [%s]" % (e["id"], e["issue"], e["state"]))
    return 0


def cmd_order(args, repo_root):
    issues = fetch_live_issues(repo_root)
    prs = fetch_all_prs(repo_root)
    entries = build_live_entries(issues, prs)
    entries.sort(key=lambda e: (e["priority"], e["id"]))
    for e in entries:
        print("p%d %s (#%d) [%s]" % (e["priority"], e["id"], e["issue"], e["state"]))
    return 0


def cmd_lint(args, repo_root):
    if args.offline:
        schema_path = repo_root.joinpath(*SCHEMA_REFERENCE_RELPATH)
        try:
            text = schema_path.read_text(encoding="utf-8")
        except OSError as exc:
            sys.stderr.write("CANNOT LINT: could not read %s -- %s\n" % (schema_path, exc))
            raise SystemExit(2)
        missing = [s for s in LINT_SECTIONS if s not in text]
        if missing:
            sys.stderr.write("LINT FAIL: %s is missing section(s): %s\n" % (schema_path, ", ".join(missing)))
            raise SystemExit(1)
        print("lint --offline: OK, %s names every section" % schema_path)
        return 0

    issues = fetch_live_issues(repo_root)
    problems = []
    for issue in issues:
        body = issue.get("body", "")
        if ISSUE_MARKER not in body:
            problems.append("UNPARSEABLE #%d: missing %s marker" % (issue["number"], ISSUE_MARKER))
            continue
        for heading in (ISSUE_HEADINGS["touches"], ISSUE_HEADINGS["evidence_required"]):
            section = get_section(body, heading) or ""
            if PLACEHOLDER_RE.search(section):
                problems.append("PLACEHOLDER #%d: %s still has a placeholder bullet" % (issue["number"], heading))
    if problems:
        for p in problems:
            sys.stderr.write(p + "\n")
        raise SystemExit(1)
    print("lint: OK, %d issue(s) checked" % len(issues))
    return 0


def _config_reads_github_at(rev, repo_root):
    """True when the config committed at `rev` sets the top-level `pipeline: github`. Parsed, never grepped: a
    comment that names the marker is not the marker."""
    shown = run_git(["show", "%s:%s" % (rev, "/".join(CONFIG_RELPATH))], cwd=repo_root, check=False)
    if shown.returncode != 0:
        return False
    raw = _parse_top_level_pipeline(shown.stdout)
    return raw is not None and _strip_yaml_scalar(raw) == "github"


def _cutover_point(repo_root):
    """(sha, None) for the newest first-parent commit of HEAD whose config reads `pipeline: github` while its first
    parent's did not (a root counts as not); (None, reason) when no point can be proven. A shallow clone shows its
    boundary commit as the one that added the marker, and an uncommitted marker is no commit at all."""
    shallow = run_git(["rev-parse", "--is-shallow-repository"], cwd=repo_root, check=False)
    if shallow.returncode != 0 or shallow.stdout.strip() != "false":
        return None, "shallow clone"
    listed = run_git(["rev-list", "--first-parent", "HEAD", "--", "/".join(CONFIG_RELPATH)], cwd=repo_root, check=False)
    if listed.returncode != 0:
        return None, "could not list the config's history"
    for sha in listed.stdout.split():
        if _config_reads_github_at(sha, repo_root) and not _config_reads_github_at(sha + "^", repo_root):
            return sha, None
    return None, "no committed change set the marker"


def _predates_cutover(sha, cutover_sha, repo_root):
    """True only when `sha` is the cutover point or an ancestor of it; an unknown oid (exit 128) or a later commit
    (exit 1) is not residue."""
    if not sha or not cutover_sha:
        return False
    return run_git(["merge-base", "--is-ancestor", sha, cutover_sha], cwd=repo_root, check=False).returncode == 0


DOCTOR_WAIVERS_RELPATH = ("plans", "doctor-waivers.json")


def _read_doctor_waivers(repo_root):
    """`(data, None)` for a parsed waiver file, `(None, None)` when there is none, `(None, why)` when one is present
    and unusable. A file that is present but ignored would read as green, so the last case is a finding."""
    path = repo_root.joinpath(*DOCTOR_WAIVERS_RELPATH)
    if not path.is_file():
        return None, None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return None, "cannot read %s: %s" % ("/".join(DOCTOR_WAIVERS_RELPATH), error)
    if not isinstance(data, dict) or not isinstance(data.get("closed_at"), str) or not data["closed_at"]:
        return None, "top level must be an object with a non-empty closed_at"
    if not isinstance(data.get("waivers"), list):
        return None, "waivers must be a list"
    for index, entry in enumerate(data["waivers"]):
        if not isinstance(entry, dict) or not isinstance(entry.get("pr"), int):
            return None, "waivers[%d] must be an object with an integer pr" % index
        for key in ("merge", "audited_sha", "reason", "evidence"):
            if not isinstance(entry.get(key), str):
                return None, "waivers[%d] (PR #%d) needs a string %s" % (index, entry["pr"], key)
    return data, None


def _waiver_failure(entry, merged, repo_root, closed_at):
    """The first condition a waiver entry fails, or None when it holds. `merged` is `(merge_sha, trailer_present)` of
    the merged non-release PR with the entry's number, or None when there is no such PR."""
    if entry is None:
        return "no-matching-PR"
    if not entry["reason"].strip():
        return "empty-reason"
    if not entry["evidence"].strip():
        return "empty-evidence"
    if merged is None:
        return "no-matching-PR"
    merge_sha, trailer_present = merged
    if merge_sha != entry["merge"]:
        return "merge-mismatch"
    if trailer_present:
        return "now-has-trailer"
    second = run_git(["rev-parse", "--verify", "-q", merge_sha + "^2"], cwd=repo_root, check=False)
    if second.returncode != 0 or second.stdout.strip() != entry["audited_sha"]:
        return "second-parent-mismatch"
    if not _predates_cutover(merge_sha, closed_at, repo_root):
        return "after-closed_at"
    return None


def _waiver_applies(entry, merged, repo_root, closed_at):
    """True only when `entry` names this exact merge, binds it to the audited head as second parent, and the merge is
    at or before `closed_at`; each check is a closed list so a later merge can never be waived."""
    return _waiver_failure(entry, merged, repo_root, closed_at) is None


def cmd_doctor(args, repo_root):
    """Every negative-control finding section 4's state table and section
    17's checker table name for `doctor`, each printed as its own line
    naming the exact token a test greps for. A STALE BRANCH or SHIPPED
    WITHOUT VERDICT whose commit is at or before the cutover point is listed
    under a PRE-CUTOVER RESIDUE header and not counted; every other finding
    makes it exit 1. A merge listed in plans/doctor-waivers.json, bound to its audited head
    and at or before that file's closed_at, prints under a WAIVED header and is not counted; a listed entry that no
    longer matches GitHub is a WAIVER INVALID finding. It reads committed history and never fetches."""
    findings = []
    residue = []
    waived = []
    merged_prs = {}

    waiver_data, waiver_problem = _read_doctor_waivers(repo_root)
    if waiver_problem:
        findings.append("UNPARSEABLE WAIVERS: %s" % waiver_problem)
    waivers_by_merge = {entry["merge"]: entry for entry in (waiver_data or {}).get("waivers", [])}
    closed_at = (waiver_data or {}).get("closed_at")

    mode = pipeline_mode(repo_root)
    schema_present = repo_root.joinpath(*SCHEMA_REFERENCE_RELPATH).is_file()
    queue_yaml_present = repo_root.joinpath(*QUEUE_RELPATH).is_file()
    marker_consistent = (
        (mode == "github" and schema_present and not queue_yaml_present)
        or (mode != "github" and not schema_present and queue_yaml_present)
        or (mode != "github" and not schema_present and not queue_yaml_present)
    )
    if not marker_consistent:
        findings.append(
            "PIPELINE MARKER MISMATCH: marker=%r plans/SCHEMA.md present=%s plans/queue.yaml present=%s"
            % (mode, schema_present, queue_yaml_present)
        )

    issues = fetch_all_plan_issues(repo_root)
    prs = fetch_all_prs(repo_root)
    ls_remote_output = run_git(["ls-remote", "origin", "refs/heads/plan/*"], cwd=repo_root).stdout
    plan_branches = _parse_ls_remote_branch_names(ls_remote_output)
    branch_tips = _migrate_remote_shas(ls_remote_output)
    cutover_sha, cutover_reason = _cutover_point(repo_root)
    open_prs = [pr for pr in prs if pr.get("state") == "OPEN"]
    open_pr_branches = {pr.get("headRefName") for pr in open_prs}
    issues_by_number = {issue["number"]: issue for issue in issues}

    for issue in issues:
        number = issue["number"]
        body = issue.get("body", "")
        if ISSUE_MARKER not in body:
            findings.append("UNPARSEABLE #%d: missing %s marker" % (number, ISSUE_MARKER))
            continue  # an unparseable body has no reliable id/sections to check further

        labels = _label_names(issue.get("labels"))
        id_match = re.search(r"^id:\s*(\S+)", body, re.MULTILINE)
        entry_id = id_match.group(1) if id_match else None

        # Only an issue still OPEN is expected to have a live branch or PR --
        # a merged entry's issue is CLOSED with its branch long deleted
        # (delete_branch_on_merge) and its PR MERGED, not OPEN, by design,
        # never a sign of INCONSISTENT.
        if _has_label(labels, LABEL_ACCEPTED) and issue.get("state") == "OPEN":
            has_branch = entry_id is not None and ("plan/%s" % entry_id) in plan_branches
            matching_pr = _find_pr_for_issue(number, open_prs)
            if not has_branch and matching_pr is None:
                findings.append("INCONSISTENT #%d: accepted with no matching plan/<id> branch or open PR" % number)

        if _has_label(labels, LABEL_BLOCKED):
            comments = issue.get("comments") or []
            if not any(BLOCKED_COMMENT_MARKER in c.get("body", "") for c in comments):
                findings.append("BLOCKED WITHOUT REASON: issue #%d carries the blocked label with no matching comment" % number)

        comment_text = "\n".join(c.get("body", "") for c in (issue.get("comments") or []))
        snapshot_match = ACCEPTED_SNAPSHOT_RE.search(comment_text)
        if snapshot_match:
            current_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
            if current_hash != snapshot_match.group(1):
                findings.append("ISSUE DIVERGED FROM ACCEPTED SNAPSHOT #%d" % number)

    for branch in sorted(plan_branches):
        if branch not in open_pr_branches:
            line = "STALE BRANCH %s" % branch
            if _predates_cutover(branch_tips.get(branch), cutover_sha, repo_root):
                residue.append(line)
            else:
                findings.append(line)

    for pr in prs:
        pr_number = pr["number"]
        issue_number, _entry_id = parse_entry_header(pr.get("body", ""))

        if pr.get("state") == "OPEN":
            status, reason = _pr_verdict_status(pr)
            if status == "stale":
                findings.append("STALE VERDICT: PR #%d's newest review does not match its head -- %s" % (pr_number, reason))
            elif status in ("missing", "other") and _verifier_gate_green(pr):
                findings.append("CHECK WITHOUT VERDICT: PR #%d's verifier-gate check is green with no matching PASS review" % pr_number)
            # Never an elif of the chain above: a head that was just refreshed can carry both a stale
            # verdict and a stale check, and each needs its own line. `== "main"`, as the merged branch spells `release`.
            if pr.get("baseRefName") == "main":
                stale = _stale_gate_check_run(pr.get("statusCheckRollup"))
                if stale is not None:
                    findings.append("%s (head %s)" % (_stale_check_run_text(pr_number, stale), pr["headRefOid"]))

        elif pr.get("state") == "MERGED":
            # A promote PR has no `## Entry`, so `ship --check` never ran and no Verified-Sha exists.
            # `== "release"`, not `!= "main"`: this file never reads the config's default_branch.
            if pr.get("baseRefName") == "release": continue
            merge_sha = (pr.get("mergeCommit") or {}).get("oid")
            trailer_present = False
            if merge_sha:
                try:
                    commit_message = run_git(["log", "-1", "--format=%B", merge_sha], cwd=repo_root).stdout
                    trailer_present = "Verified-Sha:" in commit_message
                except GitError:
                    trailer_present = False  # e.g. the merge commit isn't fetched locally -- treat as unproven, not silently clean
            merged_prs[pr_number] = (merge_sha, trailer_present)
            if not trailer_present:
                line = "SHIPPED WITHOUT VERDICT: PR #%d's merge commit has no Verified-Sha: trailer" % pr_number
                entry = waivers_by_merge.get(merge_sha)
                if _predates_cutover(merge_sha, cutover_sha, repo_root):
                    residue.append(line)
                elif _waiver_applies(entry, merged_prs[pr_number], repo_root, closed_at):
                    waived.append("  PR #%d %s -- %s" % (pr_number, merge_sha[:7], entry["reason"]))
                else:
                    findings.append(line)

            if issue_number is not None:
                linked_issue = issues_by_number.get(issue_number)
                if linked_issue is not None and linked_issue.get("state") != "CLOSED":
                    findings.append(
                        "SHIPPED, ISSUE OPEN: PR #%d merged but issue #%d is still open -- repair: gh issue close %d --reason completed"
                        % (pr_number, issue_number, issue_number)
                    )

    for entry in (waiver_data or {}).get("waivers", []):
        merged = merged_prs.get(entry["pr"])
        if not _waiver_applies(entry, merged, repo_root, closed_at):
            findings.append(
                "WAIVER INVALID: PR #%d -- %s" % (entry["pr"], _waiver_failure(entry, merged, repo_root, closed_at)))

    if cutover_sha is None and any(f.startswith(("STALE BRANCH", "SHIPPED WITHOUT VERDICT")) for f in findings):
        sys.stderr.write("NOTE: cutover point unknown (%s); nothing is treated as pre-cutover\n" % cutover_reason)
    for finding in findings:
        print(finding)
    if residue:
        print("PRE-CUTOVER RESIDUE at or before cutover point %s: %d line(s), listed and not counted" % (cutover_sha, len(residue)))
        for line in residue:
            print("  " + line)
    if waived:
        print("WAIVED (no Verified-Sha trailer; owner-approved, list closed at %s): %d line(s), listed and not counted"
              % (closed_at[:7], len(waived)))
        for line in waived:
            print(line)
    if findings:
        return 1
    print("doctor: OK, marker=%r agrees with plans/SCHEMA.md and queue.yaml presence, no findings" % mode)
    return 0


# =============================================================================
# init -- the label set, the ruleset printout, and the checks around them
# (plan section 14 steps 2 and 8). Never writes a config file, a repo setting
# or a ruleset: those belong to a repo's cutover and to the owner.
# =============================================================================

# Plan section 7, verbatim. The `pull_request` rule names
# require_extra_approval_for_unattributed_changes explicitly: GitHub turns
# that preview flag on whenever a payload omits it, and a one-account repo
# can never give the extra approval it would then demand.
RULESET = {
    "name": "pipeline",
    "target": "branch",
    "enforcement": "active",
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "bypass_actors": [
        {"actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "pull_request"},
    ],
    "rules": [
        {"type": "pull_request", "parameters": {
            "required_approving_review_count": 0,
            "dismiss_stale_reviews_on_push": False,
            "require_code_owner_review": False,
            "require_last_push_approval": False,
            "required_review_thread_resolution": False,
            "require_extra_approval_for_unattributed_changes": False,
        }},
        # No required status on the default branch: work is verified locally before it lands, and cloud
        # verification gates the promotion to `release` instead (build_release_ruleset).
        {"type": "non_fast_forward"},
        {"type": "deletion"},
    ],
}

# The release ruleset (pipeline-release) is the default-branch ruleset's sibling for
# the `release` branch: a promote PR merges only by a merge commit (a squash would lose
# main's ancestry), and its required checks come from the repo's own config, so a red
# cloud check blocks promotion. Strict stays false because the release tip is never an
# ancestor of a promote branch cut from main.
GITHUB_ACTIONS_INTEGRATION_ID = 15368
RELEASE_RULESET_MARKER = "# === release ruleset (pipeline-release) ==="


def build_release_ruleset(checks):
    pull_request_rule = next(rule for rule in RULESET["rules"] if rule["type"] == "pull_request")
    parameters = dict(pull_request_rule["parameters"])
    parameters["allowed_merge_methods"] = ["merge"]
    # One approval nobody but the owner can give: the pull requests are opened under the owner's own
    # account, which GitHub bars from approving them, so only the owner's admin bypass merges a promote.
    parameters["required_approving_review_count"] = 1
    rules = [{"type": "pull_request", "parameters": parameters}]
    if checks:
        rules.append({"type": "required_status_checks", "parameters": {
            "required_status_checks": [
                {"context": name, "integration_id": GITHUB_ACTIONS_INTEGRATION_ID} for name in checks
            ],
            "strict_required_status_checks_policy": False,
        }})
    rules.append({"type": "non_fast_forward"})
    rules.append({"type": "deletion"})
    return {
        "name": "pipeline-release",
        "target": "branch",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["refs/heads/release"], "exclude": []}},
        "bypass_actors": [dict(actor) for actor in RULESET["bypass_actors"]],
        "rules": rules,
    }


# `gh label list` returns at most this many; a full page may be truncated,
# and a same-name label past the cut would be overwritten without a log line.
INIT_LIST_LIMIT = 200
EXPECTED_HOOKS_PATH = ".githooks"
NON_QUEUE_PR_BRANCH_PREFIX = "plan/"
RULESET_FILE_NAME = "ruleset.json"
RELEASE_RULESET_FILE_NAME = "release-ruleset.json"


def _normalise_color(value):
    return (value or "").lstrip("#").lower()


def _plan_label_changes(existing_labels):
    """(to_create, to_overwrite, unchanged, overwrite_lines) for the schema's
    label set against `gh label list` output. Names match case-insensitively
    (GitHub's own rule); only colour and description count as a difference,
    so a label that already reads right is never written to."""
    existing_by_name = {
        label["name"].lower(): label for label in existing_labels if isinstance(label.get("name"), str)
    }
    to_create, to_overwrite, unchanged, lines = [], [], [], []
    for wanted in LABELS.values():
        current = existing_by_name.get(wanted["name"].lower())
        if current is None:
            to_create.append(wanted)
            continue
        colour_differs = _normalise_color(current.get("color")) != wanted["color"].lower()
        description_differs = (current.get("description") or "") != wanted["description"]
        if not (colour_differs or description_differs):
            unchanged.append(wanted)
            continue
        to_overwrite.append(wanted)
        line = "OVERWRITE label %s: colour %s -> %s" % (
            wanted["name"], _normalise_color(current.get("color")), wanted["color"].lower(),
        )
        if description_differs:
            line += "; description %r -> %r" % (current.get("description") or "", wanted["description"])
        lines.append(line)
    return to_create, to_overwrite, unchanged, lines


def _write_label(label, repo_root):
    # --force turns "already exists" into an update, so a label created by
    # someone else between our read and this write is overwritten, not an error.
    run_gh([
        "label", "create", label["name"], "--color", label["color"],
        "--description", label["description"], "--force",
    ], cwd=repo_root)


def _read_hooks_path(repo_root):
    result = run_git(["config", "--get", "core.hooksPath"], cwd=repo_root, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def _repo_slug(repo_root):
    """`owner/name` from `gh repo view`, or None if gh cannot say."""
    try:
        slug = gh_json(["repo", "view", "--json", "nameWithOwner"], cwd=repo_root).get("nameWithOwner")
    except (GhError, ValueError, AttributeError):
        return None
    return slug if isinstance(slug, str) and "/" in slug else None


def _ruleset_file_arg(repo_root, name):
    # The directory above the repo is where the runbook saves the file, from a worktree as `../name`.
    return "%s/%s" % (shlex.quote(str(Path(repo_root).parent)), name)


def _init_print_ruleset(repo_root):
    config_path = Path(repo_root).joinpath(*CONFIG_RELPATH)
    # Read before anything prints, so a malformed key leaves stdout empty.
    try:
        checks, state = read_release_required_checks(repo_root)
    except ReleaseChecksError as exc:
        sys.stderr.write("REFUSED: %s (in %s)\n" % (exc, config_path))
        return 2
    if state == "ok":
        sys.stderr.write("%s: %d read from %s\n" % (RELEASE_CHECKS_KEY, len(checks), config_path))
    else:
        sys.stderr.write(
            "WARNING: %s (%s): %s. The release ruleset below has no required_status_checks rule, so a red cloud "
            "check will not block promotion. Add the key, then run this again.\n" % (RELEASE_CHECKS_KEY, config_path, state)
        )

    slug = _repo_slug(repo_root)
    ruleset_file = _ruleset_file_arg(repo_root, RULESET_FILE_NAME)
    release_file = _ruleset_file_arg(repo_root, RELEASE_RULESET_FILE_NAME)
    print(json.dumps(RULESET, indent=2))
    print()
    print("# Agent seats are refused ruleset writes. Save the JSON above as %s, then run this"
          " from your own terminal:" % ruleset_file)
    if slug is None:
        print("# (gh could not name this repo, so the commands below leave {owner}/{repo} for gh to fill in"
              " from the clone you run them in)")
        slug = "{owner}/{repo}"
    print("gh api --method POST repos/%s/rulesets --input %s" % (slug, ruleset_file))
    print()
    print(RELEASE_RULESET_MARKER)
    print(json.dumps(build_release_ruleset(checks), indent=2))
    print()
    print("# The release ruleset, for the owner once the release branch exists. Save the JSON above as %s,"
          " then run this from your own terminal:" % release_file)
    print("gh api --method POST repos/%s/rulesets --input %s" % (slug, release_file))
    return 0


def cmd_init(args, repo_root):
    if repo_root is None:
        sys.stderr.write("REFUSED: queue init could not find a repo root (no .git ancestor)\n")
        raise SystemExit(3)
    if args.print_ruleset:
        return _init_print_ruleset(repo_root)

    # Every read comes before the first write, so a read that fails leaves
    # the repo untouched.
    try:
        permissions = gh_json(["api", "repos/{owner}/{repo}/actions/permissions"], cwd=repo_root)
    except (GhError, ValueError) as exc:
        sys.stderr.write(
            "REFUSED: could not read whether GitHub Actions is enabled, so no label was written -- %s\n" % (exc,)
        )
        raise SystemExit(1)
    enabled = permissions.get("enabled") if isinstance(permissions, dict) else None
    if enabled is not True:
        sys.stderr.write(
            "REFUSED: GitHub Actions is not enabled on this repo (actions/permissions enabled=%r); "
            "the release ruleset's agent-config-checks check is an Actions workflow, so nothing could ever pass it. "
            "Enable Actions in the repo settings, then re-run; no label was written.\n" % (enabled,)
        )
        raise SystemExit(1)

    existing = gh_json(
        ["label", "list", "--json", "name,color,description", "--limit", str(INIT_LIST_LIMIT)], cwd=repo_root,
    )
    if len(existing) >= INIT_LIST_LIMIT:
        sys.stderr.write(
            "REFUSED: gh label list returned %d labels, its --limit, so it may be truncated and an overwrite could "
            "go unlogged; no label was written.\n" % len(existing)
        )
        raise SystemExit(1)
    open_prs = gh_json(
        ["pr", "list", "--state", "open", "--limit", str(INIT_LIST_LIMIT), "--json", "number,title,headRefName"],
        cwd=repo_root,
    )

    to_create, to_overwrite, unchanged, overwrite_lines = _plan_label_changes(existing)
    for line in overwrite_lines:
        print(line)
    for label in to_create + to_overwrite:
        _write_label(label, repo_root)
    if to_create or to_overwrite:
        # A write GitHub accepted but did not apply must not read as done.
        after = gh_json(
            ["label", "list", "--json", "name,color,description", "--limit", str(INIT_LIST_LIMIT)], cwd=repo_root,
        )
        _, still_wrong, _, _ = _plan_label_changes(after)
        still_missing = [
            label["name"] for label in LABELS.values()
            if label["name"].lower() not in {l.get("name", "").lower() for l in after}
        ]
        if still_wrong or still_missing:
            sys.stderr.write(
                "WRITE NOT PERSISTED: after `gh label create --force`, label(s) still wrong or missing: %s\n"
                % ", ".join(sorted({l["name"] for l in still_wrong} | set(still_missing)))
            )
            raise SystemExit(1)
    print("init: labels: %d created, %d overwritten, %d already correct" % (
        len(to_create), len(to_overwrite), len(unchanged),
    ))

    hooks_path = _read_hooks_path(repo_root)
    if hooks_path is not None and Path(hooks_path).is_absolute():
        # The value is shared by every linked worktree, so rewriting it would
        # move all of them; the per-command -c form leaves the shared setting alone.
        print(
            "WARNING: core.hooksPath is %s, not %s -- every worktree of this repo "
            "runs the hooks of the checkout that path names, not its own "
            "(to use this checkout's own hooks for one command: git -c core.hooksPath=%s commit)"
            % (repr(hooks_path), EXPECTED_HOOKS_PATH, EXPECTED_HOOKS_PATH)
        )
    elif hooks_path != EXPECTED_HOOKS_PATH:
        print(
            "WARNING: core.hooksPath is %s, not %s -- this clone's git hooks do not run "
            "(fix: git config core.hooksPath %s)"
            % (repr(hooks_path) if hooks_path is not None else "unset", EXPECTED_HOOKS_PATH, EXPECTED_HOOKS_PATH)
        )
    else:
        print("init: core.hooksPath is %s" % EXPECTED_HOOKS_PATH)

    non_queue = [pr for pr in open_prs if not str(pr.get("headRefName") or "").startswith(NON_QUEUE_PR_BRANCH_PREFIX)]
    if non_queue:
        print("init: open pull requests whose head is not %s* (informational: each goes through the verifier like "
              "any pull request, or the owner merges or closes it before the ruleset lands):" % NON_QUEUE_PR_BRANCH_PREFIX)
        for pr in non_queue:
            print("NON-QUEUE PR #%s (%s): %s" % (pr.get("number"), pr.get("headRefName"), pr.get("title")))
    else:
        print("init: no open pull request outside %s*" % NON_QUEUE_PR_BRANCH_PREFIX)
    if len(open_prs) >= INIT_LIST_LIMIT:
        print("WARNING: gh pr list returned %d pull requests, its --limit; the list above may be incomplete" % len(open_prs))

    print("init: wrote no config file, repo setting or ruleset. To apply the ruleset, run `queue init --print-ruleset` "
          "and follow what it prints.")
    return 0


# =============================================================================
# migrate -- the one-time cutover from plans/queue.yaml to plan issues (plan
# section 14 steps 2 to 4). The order, every step after the first only if the
# one before it held:
#   1. pre-flight: every refusal, the conservation check on the composed
#      bodies, the idempotence check and the write cap -- no write at all
#      (a claimed entry's branch is read here, with one fetch by explicit
#      refspecs, which moves only the remote-tracking refs and FETCH_HEAD);
#   2. the issue and comment writes, and for a claimed entry, right after its
#      own issue: the branch push, the draft pull request, then the accepted
#      label and accept's two comments, so the label never precedes the PR;
#   3. a read-back conservation check on the live issues and their PRs;
#   4. the line-based config rewrite, then deleting plans/queue.yaml;
#   5. `pipeline: github`, last, because a repo that reads as migrated must
#      have nothing left to migrate.
# =============================================================================

MIGRATE_DEFAULT_MAX_WRITES = 400
# fetch_all_plan_issues' own --limit: a full page may hide a clashing id.
MIGRATE_LIST_LIMIT = 500
MIGRATE_SOURCE_STATES = ("stub", "researched", "claimed", "blocked")
# An implemented entry, and one blocked from implemented, have no adopt path: no real queue holds one.
MIGRATE_CLAIMED_ONLY = "migrate adopts a claimed entry only; finish it, or return it to claimed, before migrating"
MIGRATE_LEGACY_NO_ADOPT = "--legacy does not adopt a claimed or implemented entry; convert it to the standard schema first"
# The adopted PR targets the default branch: a closing keyword links only there.
MIGRATE_ADOPT_BASE = "main"
# Per adopted entry, beyond its issue and comments: the PR create, the accepted label and accept's two comments.
MIGRATE_ADOPT_WRITES = 4
# What compose_issue_body writes under Touches / Evidence required when it is given none.
MIGRATE_STUB_PLACEHOLDER = "<TODO>"
# GitHub rejects a longer title or body, and trims a title's edge whitespace, none of
# which a fake gh does; a read-back would only find out after the create.
MIGRATE_MAX_TITLE_CHARS = 256
MIGRATE_MAX_TEXT_CHARS = 65536
# Read-back: GitHub can lag on comments and labels right after a write.
MIGRATE_READ_BACK_ATTEMPTS = 3
MIGRATE_READ_BACK_FIRST_WAIT = 2
# GitHub's secondary limit is no more than 80 content-generating requests per
# minute and 500 per hour:
# https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits
# One write per 0.8s is 75 per minute. Small plans stay unpaced.
MIGRATE_PACE_ABOVE_WRITES = 60
MIGRATE_PACE_SECONDS = 0.8

MIGRATE_CONFIG_DROPPED_KEYS = (
    "queue_path", "queue_archive_path", "retired_path", "archived_plans_dir", "queue_states", "batch_budget_tokens",
)
# gh_mode is spelled `on`, as .claude/coordinator-config.example.yaml and the
# coordinator's own config table document it. queue.py never reads the key,
# and a YAML 1.1 loader reads a bare `on` as boolean true.
MIGRATE_CONFIG_ADDED_KEYS = (("verifier_mode", "local"), ("ship_behind_policy", "disjoint-ok"), ("gh_mode", "on"))
MIGRATE_MARKER_LINE = "pipeline: github"

_MIGRATE_COMMON_FIELDS = frozenset(
    ["id", "title", "state", "priority", "log", "prerequisites", "resources", "gate_override", "shared_writes"]
)
# Plain mode: anything outside these sets has no destination in a plan issue, and a plan on a
# blocked entry blocked from a stub has none either, nor has worker_branch on one blocked from
# anything but claimed. None of these checks runs under --legacy. Inlined from the FIELDS table
# of plans/completed/merged.yaml, less handoff and partial, which an implemented entry would
# carry and which have no destination here.
_MIGRATE_FIELDS_BY_STATE = {
    "stub": _MIGRATE_COMMON_FIELDS | {"intent"},
    "researched": _MIGRATE_COMMON_FIELDS | {"plan", "touches", "evidence_required"},
    "claimed": _MIGRATE_COMMON_FIELDS | {"plan", "touches", "evidence_required", "worker_branch"},
    "blocked": _MIGRATE_COMMON_FIELDS | {"blocked_from", "blocked_on", "intent", "plan", "touches", "evidence_required"},
}

# `migrate --legacy`: the old schema's state names (the TRANSITION lines of
# templates/plans/completed/merged.yaml) and where each goes. None refuses: a
# finished entry has no plan issue to become and is archived first. Nothing maps to
# claimed, which needs a real branch and pull request.
MIGRATE_LEGACY_STATES = {
    "queued": "stub", "pending": "stub", "in_progress": "stub", "awaiting-verification": "stub", "parked": "stub",
    "deferred": "blocked",
    "done": None, "dropped": None,
}
# False refuses an entry that has a key with no destination, instead of keeping it in a comment.
MIGRATE_LEGACY_PRESERVE = True
MIGRATE_LEGACY_COMMENT_MARKER = "Legacy fields:"
MIGRATE_LEGACY_NO_REASON = "legacy entry carried no blocked reason"

_CONFIG_TOP_LEVEL_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:")


class MigrateWriteError(RuntimeError):
    pass


class _MigrateDuplicateKey(Exception):
    pass


def _migrate_refuse(problems, code=1):
    if isinstance(problems, str):
        problems = [problems]
    for problem in problems:
        sys.stderr.write("REFUSED: queue migrate: %s\n" % (problem,))
    raise SystemExit(code)


def _migrate_short(value, limit=100):
    text = repr(value)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _migrate_is_str_list(value):
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _migrate_has_open_fence(text):
    fences = [line for line in text.splitlines() if line.lstrip().startswith(("```", "~~~"))]
    return len(fences) % 2 == 1


def _migrate_read_text(path):
    # newline="" keeps every line ending exactly as it is on disk.
    with open(str(path), encoding="utf-8", newline="") as handle:
        return handle.read()


def _migrate_write_text(path, text):
    """The one place migrate writes a file: a same-directory temp file renamed
    over the target, so a crash never leaves a half-written config."""
    path = Path(path)
    mode = path.stat().st_mode & 0o777
    handle = tempfile.NamedTemporaryFile(
        mode="w", dir=str(path.parent), prefix=path.name + ".", suffix=".tmp", delete=False,
        encoding="utf-8", newline="",
    )
    temp = Path(handle.name)
    try:
        with handle:
            handle.write(text)
        temp.chmod(mode)
        temp.replace(path)
    except BaseException:
        temp.unlink()
        raise


def _migrate_unlink(path):
    Path(path).unlink()


def _migrate_retry_sleep(seconds):
    """The seam between the read-back retry and the clock; tests replace it."""
    time.sleep(seconds)


def _migrate_pace_sleep(seconds):
    """The seam between write pacing and the clock; tests replace it."""
    time.sleep(seconds)


def _migrate_split_lines(text):
    # Not str.splitlines(): that also splits on characters a YAML line may hold.
    return re.findall(r"[^\n]*\n|[^\n]+", text)


def _migrate_config_nested(line):
    """True for a line that belongs to the top-level key above it: indented,
    or a column-0 sequence dash, and not blank."""
    body = line.rstrip("\r\n")
    if not body.strip():
        return False
    return body[:1] in (" ", "\t") or re.match(r"^-(\s|$)", body) is not None


def migrate_rewrite_config(text):
    """(new_text, removed_lines, added_lines): drops exactly
    MIGRATE_CONFIG_DROPPED_KEYS (a key's indented block goes with it) and
    appends MIGRATE_CONFIG_ADDED_KEYS that are not already there. Works on
    lines, never through a YAML dumper, because the file is comment-heavy and
    `pipeline_mode` reads it as text."""
    lines = _migrate_split_lines(text)
    kept, removed = [], []
    index = 0
    while index < len(lines):
        match = _CONFIG_TOP_LEVEL_KEY_RE.match(lines[index])
        if match and match.group(1) in MIGRATE_CONFIG_DROPPED_KEYS:
            removed.append(lines[index])
            index += 1
            while index < len(lines):
                if _migrate_config_nested(lines[index]):
                    removed.append(lines[index])
                    index += 1
                    continue
                # A blank line belongs to the block only when an indented line follows it.
                after_blanks = index
                while after_blanks < len(lines) and not lines[after_blanks].strip():
                    after_blanks += 1
                if after_blanks > index and after_blanks < len(lines) and _migrate_config_nested(lines[after_blanks]):
                    removed.extend(lines[index:after_blanks])
                    index = after_blanks
                    continue
                break
            continue
        kept.append(lines[index])
        index += 1
    present = {m.group(1) for m in (_CONFIG_TOP_LEVEL_KEY_RE.match(line) for line in kept) if m}
    newline = "\r\n" if "\r\n" in text else "\n"
    added = ["%s: %s%s" % (key, value, newline) for key, value in MIGRATE_CONFIG_ADDED_KEYS if key not in present]
    if added and kept and not kept[-1].endswith("\n"):
        kept[-1] += newline
    return "".join(kept + added), removed, added


def migrate_set_marker(text):
    """The text with a top-level `pipeline: github` line: an existing
    top-level `pipeline:` line is replaced in place, else one is appended."""
    lines = _migrate_split_lines(text)
    newline = "\r\n" if "\r\n" in text else "\n"
    for index, line in enumerate(lines):
        if line[:1] in (" ", "\t"):
            continue
        bare = line.rstrip("\r\n")
        if _TOP_LEVEL_PIPELINE_RE.match(bare):
            lines[index] = MIGRATE_MARKER_LINE + line[len(bare):]
            return "".join(lines)
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += newline
    return "".join(lines + [MIGRATE_MARKER_LINE + newline])


def _migrate_import_yaml():
    try:
        import yaml
    except ImportError:
        _migrate_refuse("PyYAML is not importable by this python3, and migrate needs it to read plans/queue.yaml and "
                        "to check the rewritten config. Install it (python3 -m pip install pyyaml) and re-run. "
                        "Nothing was written.", 2)
    return yaml


def _migrate_strict_loader(yaml):
    """yaml.SafeLoader that refuses a duplicate mapping key: plain safe_load keeps
    the last one, so a conservation check run on its result never sees the first."""
    class StrictLoader(yaml.SafeLoader):
        def construct_mapping(self, node, deep=False):
            lines = {}
            for key_node, _value_node in node.value:
                if key_node.tag == "tag:yaml.org,2002:merge":
                    continue
                try:
                    key = self.construct_object(key_node, deep=True)
                    first = lines.setdefault(key, key_node.start_mark.line + 1)
                except TypeError:
                    continue  # an unhashable key: the base class refuses it with its own message
                if first != key_node.start_mark.line + 1:
                    raise _MigrateDuplicateKey(key, first, key_node.start_mark.line + 1)
            return super().construct_mapping(node, deep=deep)
    return StrictLoader


def _migrate_load_entries(repo_root):
    queue_path = repo_root.joinpath(*QUEUE_RELPATH)
    if not queue_path.is_file():
        _migrate_refuse("%s does not exist, so there is nothing to migrate (already migrated?). Nothing was written."
                        % (queue_path,))
    yaml = _migrate_import_yaml()
    try:
        data = yaml.load(_migrate_read_text(queue_path), Loader=_migrate_strict_loader(yaml))
    except _MigrateDuplicateKey as exc:
        key, first, second = exc.args
        _migrate_refuse("%s: duplicate mapping key %s at line %d and again at line %d. YAML keeps only the last value, "
                        "so the first would be lost without a word; remove or merge one. Nothing was written."
                        % (queue_path, _migrate_short(key), first, second))
    except (OSError, UnicodeDecodeError, yaml.YAMLError) as exc:
        _migrate_refuse("could not read %s -- %s. Nothing was written." % (queue_path, exc), 2)
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not all(isinstance(entry, dict) for entry in entries):
        _migrate_refuse("%s has no `entries:` list of mappings. Nothing was written." % (queue_path,), 2)
    return entries


def _migrate_legacy_record_path(plan, repo_root):
    """`plan` when it names a readable file inside the repo, else None: prose in
    a plan field never does."""
    if not isinstance(plan, str) or not plan.strip() or plan != plan.strip() or "\n" in plan:
        return None
    relative = Path(plan)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    try:
        return plan if (repo_root / relative).is_file() else None
    except (OSError, ValueError):
        return None


def _migrate_legacy_list(value):
    """A bare string is a one-item list; any other value is left for the field
    check to accept or refuse."""
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    return value


def _migrate_legacy_state_target(value):
    return MIGRATE_LEGACY_STATES.get(value, value) if isinstance(value, str) else value


def _migrate_legacy_archive_problem(name, field, value):
    return "%s: %s %s cannot be migrated: it is finished, so archive it first (a plan issue is for work still to do)" \
           % (name, field, _migrate_short(value))


def _migrate_legacy_translate(raw, repo_root):
    """A legacy entry -> (standard, preserved, defaulted, problems). `standard`
    is the entry under the standard field names, `preserved` every key with no
    destination plus the raw state (verbatim, file order), `defaulted` one
    printed line per value invented, `problems` the refusals. It only moves
    values: the field checks and the ledger prove nothing was lost."""
    entry_id = raw.get("id")
    name = entry_id if isinstance(entry_id, str) and entry_id.strip() else "<entry without an id>"
    state = raw.get("state")
    consumed, standard, defaulted = {"state"}, {}, []

    def take(*keys):
        for key in keys:
            if key in raw:
                consumed.add(key)
                return True, raw[key]
        return False, None

    target = _migrate_legacy_state_target(state)
    if isinstance(state, str) and state in MIGRATE_LEGACY_STATES and target is None:
        return None, {}, [], [_migrate_legacy_archive_problem(name, "state", state)]
    for key in ("id", "title", "priority", "log", "resources", "gate_override", "shared_writes"):
        found, value = take(key)
        if found:
            standard[key] = value
    found, value = take("prerequisites", "depends_on")
    if found:
        standard["prerequisites"] = value
    found, value = take("touches", "scope")
    if found:
        standard["touches"] = _migrate_legacy_list(value)
    found, value = take("evidence_required")
    if found:
        standard["evidence_required"] = _migrate_legacy_list(value)

    record = _migrate_legacy_record_path(raw.get("plan"), repo_root)
    body_state = target
    if target == "blocked":
        standard["state"] = "blocked"
        found, blocked_from = take("blocked_from")
        body_state = _migrate_legacy_state_target(blocked_from) if found else ("researched" if record else "stub")
        if found and isinstance(blocked_from, str) and blocked_from in MIGRATE_LEGACY_STATES and body_state is None:
            return None, {}, [], [_migrate_legacy_archive_problem(name, "blocked_from", blocked_from)]
        standard["blocked_from"] = body_state
        found, reason = take("blocked_on", "blocked_reason", "BLOCKED_ON")
        if found:
            standard["blocked_on"] = reason
        else:
            standard["blocked_on"] = MIGRATE_LEGACY_NO_REASON
            defaulted.append("DEFAULTED blocked_on of %s: %s" % (name, MIGRATE_LEGACY_NO_REASON))
    else:
        if target == "stub" and record:
            body_state = "researched"
        standard["state"] = body_state
    if body_state == "researched":
        found, plan = take("plan")
        if found:
            standard["plan"] = plan

    found, intent = take("intent", "why")
    if found:
        standard["intent"] = intent
    elif body_state == "stub" and isinstance(raw.get("title"), str) and raw["title"].strip():
        standard["intent"] = raw["title"]
        defaulted.append("DEFAULTED intent of %s: the legacy entry has no why, so its title is used as the intent" % name)

    unmapped = [key for key in raw if key not in consumed]
    if not MIGRATE_LEGACY_PRESERVE:
        if unmapped:
            return None, {}, [], ["%s: field(s) %s have no destination in a plan issue, and keeping them is switched "
                                  "off, so migrating would drop them silently"
                                  % (name, ", ".join(sorted(str(key) for key in unmapped)))]
        return standard, {}, defaulted, []
    return standard, {key: raw[key] for key in raw if key not in consumed or key == "state"}, defaulted, []


def _migrate_legacy_state_pair(value, spec):
    found = spec["state"]
    if _migrate_legacy_state_target(value) == "stub" and found == "researched" and spec["record_path"]:
        found = "stub"  # a plan that names a readable record lifts a stub to researched
    return _migrate_legacy_state_target(value), found


# raw key -> (value, spec) -> (what the raw value says, what the spec carries)
_MIGRATE_LEGACY_MAPPED = {
    "id": lambda v, spec: (v, spec["id"]),
    "title": lambda v, spec: (v, spec["title"]),
    "state": _migrate_legacy_state_pair,
    "priority": lambda v, spec: (v, spec["priority"]),
    "log": lambda v, spec: ([line.strip() for line in v or []], spec["log"]),
    "prerequisites": lambda v, spec: (v or [], spec["prerequisites"]),
    "depends_on": lambda v, spec: (v or [], spec["prerequisites"]),
    "intent": lambda v, spec: (v, spec["intent"]),
    "why": lambda v, spec: (v, spec["intent"]),
    "touches": lambda v, spec: ([t.strip() for t in _migrate_legacy_list(v) or []], spec["touches"]),
    "scope": lambda v, spec: ([t.strip() for t in _migrate_legacy_list(v) or []], spec["touches"]),
    "evidence_required": lambda v, spec: ([e.strip() for e in _migrate_legacy_list(v) or []], spec["evidence"]),
    "resources": lambda v, spec: (v or [], spec["resources"]),
    "gate_override": lambda v, spec: (v or [], spec["gate_override"]),
    "shared_writes": lambda v, spec: (v, spec["shared_writes"]),
    "blocked_from": lambda v, spec: (
        _migrate_legacy_state_target(v), spec["body_state"] if spec["state"] == "blocked" else None),
    "blocked_on": lambda v, spec: (v.strip() if isinstance(v, str) else v, spec["blocked_on"]),
    "blocked_reason": lambda v, spec: (v.strip() if isinstance(v, str) else v, spec["blocked_on"]),
    "BLOCKED_ON": lambda v, spec: (v.strip() if isinstance(v, str) else v, spec["blocked_on"]),
    "plan": lambda v, spec: (v, spec["record_path"]),
}


def _migrate_legacy_ledger(raw, spec, preserved):
    """Problems for every raw key of a legacy entry that is neither kept verbatim
    in `preserved` nor mapped to a spec value equal to it. This, not the allowed
    field sets, decides what was lost: under --legacy the normaliser accepts a plan
    on a blocked-from-stub entry and then carries none of it."""
    problems = []

    def bad(key, expected, found):
        problems.append("%s: %s lost or changed -- expected %s, found %s"
                        % (spec["id"], key, _migrate_short(expected, 160), _migrate_short(found, 160)))

    for key, value in raw.items():
        if key in preserved and key != "state":
            if preserved[key] != value:
                bad(key, value, preserved[key])
            continue
        mapped = _MIGRATE_LEGACY_MAPPED.get(key)
        if mapped is None:
            bad(key, value, "no destination: neither mapped nor preserved")
            continue
        expected, found = mapped(value, spec)
        if expected != found:
            bad(key, expected, found)
    if MIGRATE_LEGACY_PRESERVE and "state" in raw and preserved.get("state", object()) != raw["state"]:
        bad("state", raw["state"], preserved.get("state"))
    return problems


def _migrate_legacy_comment(preserved, name):
    """(comment, problems): the one Legacy fields comment an entry carries, which
    must read back as exactly the values it holds."""
    if not preserved:
        return None, []
    yaml = _migrate_import_yaml()
    try:
        dumped = yaml.safe_dump(preserved, sort_keys=False, allow_unicode=True)
        reread = yaml.safe_load(dumped)
    except yaml.YAMLError as exc:
        return None, ["%s: the fields with no destination cannot be written as YAML (%s)" % (name, exc)]
    if reread != preserved:
        return None, ["%s: Legacy fields lost or changed -- they do not read back from the YAML they were written as"
                      % name]
    return (MIGRATE_LEGACY_COMMENT_MARKER + "\n" + dumped).strip(), []


def _migrate_branch_names_entry(branch, entry_id):
    """True only for plan/<id>: accept names an entry's branch that way and doctor looks for it by that name."""
    return isinstance(branch, str) and isinstance(entry_id, str) and bool(entry_id) and branch == "plan/" + entry_id


def _migrate_control_chars(text):
    """Each distinct control character (Cc) or surrogate (Cs) in `text` as U+XXXX, in code point order: none of
    them can be in a branch name or a gh argument, and NUL and a lone surrogate crash subprocess."""
    import unicodedata
    return ["U+%04X" % code for code in sorted({ord(ch) for ch in text if unicodedata.category(ch) in ("Cc", "Cs")})]


def _migrate_normalise_entry(raw, repo_root, legacy=False):
    """One YAML entry -> (spec, problems). `spec` is the entry with every
    value checked and, for a researched one, its record read; None when the
    entry cannot be migrated. `legacy` first maps the entry from its own
    vocabulary onto the standard fields."""
    legacy_raw, preserved, defaulted = raw, {}, []
    if legacy:
        raw, preserved, defaulted, found = _migrate_legacy_translate(legacy_raw, repo_root)
        if found:
            return None, found
    problems = []
    entry_id = raw.get("id")
    controls = _migrate_control_chars(entry_id) if isinstance(entry_id, str) else []
    name = entry_id if isinstance(entry_id, str) and entry_id.strip() else "<entry without an id>"
    if controls:
        name = _migrate_short(entry_id)  # its repr, so an escape sequence in an id never reaches a terminal

    def bad(text):
        problems.append("%s: %s" % (name, text))

    if not isinstance(entry_id, str) or not entry_id.strip() or re.search(r"\s", entry_id):
        bad("id must be one token without whitespace, got %s" % _migrate_short(entry_id))
    if controls:
        bad("id holds control character(s) %s, which no branch name or gh argument can carry, got %s"
            % (", ".join(controls), _migrate_short(entry_id)))
    state = raw.get("state")
    blocked_from = raw.get("blocked_from") if state == "blocked" else None
    if legacy and (state in ("claimed", "implemented") or blocked_from in ("claimed", "implemented")):
        bad(MIGRATE_LEGACY_NO_ADOPT)
        return None, problems
    if state == "implemented":
        bad("state implemented is not adopted; %s" % MIGRATE_CLAIMED_ONLY)
        return None, problems
    if state not in MIGRATE_SOURCE_STATES:
        bad("state %s cannot be migrated (stub, researched, claimed or blocked only; archive merged and retired "
            "entries first)" % _migrate_short(state))
        return None, problems
    body_state = state
    if state == "blocked":
        body_state = blocked_from
        if body_state == "implemented":
            bad("blocked from implemented is not adopted; %s" % MIGRATE_CLAIMED_ONLY)
            return None, problems
        if body_state not in ("stub", "researched", "claimed"):
            bad("blocked_from %s is neither stub, researched nor claimed" % _migrate_short(body_state))
            return None, problems
    adopt = body_state == "claimed"
    allowed = set(_MIGRATE_FIELDS_BY_STATE[state])
    if state == "blocked" and body_state == "stub":
        allowed.discard("plan")
    if state == "blocked" and adopt:
        allowed.add("worker_branch")
    # --legacy has moved every key already, and the ledger below decides what none of them took.
    unmapped = [] if legacy else sorted(str(key) for key in set(raw) - allowed)
    if unmapped:
        bad("field(s) %s have no destination in a plan issue, so migrating would drop them silently (--legacy keeps them)"
            % ", ".join(unmapped))

    title = raw.get("title")
    if not isinstance(title, str) or not title.strip() or "\n" in title:
        bad("title must be one non-empty line, got %s" % _migrate_short(title))
    elif title != title.strip():
        bad("title has leading or trailing whitespace, which GitHub trims, so the read-back would fail after the create")
    elif len(title) > MIGRATE_MAX_TITLE_CHARS:
        bad("title is %d characters, over GitHub's limit of %d" % (len(title), MIGRATE_MAX_TITLE_CHARS))
    priority = raw.get("priority", DEFAULT_PRIORITY)
    if isinstance(priority, bool) or not isinstance(priority, int) or priority not in PRIORITY_LABEL_BY_NUMBER:
        bad("priority %s is not an integer from 1 to 5" % _migrate_short(priority))

    log = raw.get("log") or []
    if not _migrate_is_str_list(log):
        bad("log must be a list of strings")
        log = []
    for line in log:
        if not LOG_LINE_RE.match(line.strip()) or "\n" in line.strip():
            bad("log line %s is not one line starting YYYY-MM-DD, so it could not be read back as a comment"
                % _migrate_short(line))

    prerequisites = raw.get("prerequisites") or []
    if not _migrate_is_str_list(prerequisites):
        bad("prerequisites must be a list of entry ids")
        prerequisites = []
    elif entry_id in prerequisites:
        bad("lists itself as a prerequisite")

    gate_lists = {}
    for key in ("resources", "gate_override"):
        value = raw.get(key) or []
        try:
            json.dumps(value)
        except (TypeError, ValueError):
            value = None
        if not isinstance(value, list):
            bad("%s must be a list that serialises to JSON" % key)
            value = []
        gate_lists[key] = value

    intent = raw.get("intent")
    if intent is not None and (not isinstance(intent, str) or not intent.strip()):
        bad("intent must be a non-empty string")
        intent = None
    touches = raw.get("touches") or []
    evidence = raw.get("evidence_required") or []
    for key, value in (("touches", touches), ("evidence_required", evidence)):
        if not _migrate_is_str_list(value):
            bad("%s must be a list of strings" % key)
    if not _migrate_is_str_list(touches):
        touches = []
    if not _migrate_is_str_list(evidence):
        evidence = []

    local = online = api_docs = ""
    record_path, intent_from_record = None, False
    worker_branch = None
    if body_state == "stub":
        if intent is None:
            bad("a stub needs an intent to migrate")
    else:
        kind = "claimed" if adopt else "researched"
        if not touches:
            bad("a %s entry needs touches" % kind)
        if not evidence:
            bad("a %s entry needs evidence_required" % kind)
        if adopt:
            worker_branch = raw.get("worker_branch")
            if not isinstance(worker_branch, str) or not worker_branch.strip():
                bad("a claimed entry needs worker_branch: the branch its work is on")
                worker_branch = None
            elif not _migrate_branch_names_entry(worker_branch, entry_id):
                bad("worker_branch %s is not this entry's branch: it must be exactly plan/%s"
                    % (_migrate_short(worker_branch), entry_id))
                worker_branch = None
        plan_path = raw.get("plan")
        record = None
        if not isinstance(plan_path, str) or not plan_path.strip():
            bad("a %s entry needs plan: its record path" % kind)
        else:
            try:
                record = _migrate_read_text(repo_root / plan_path)
            except (OSError, UnicodeDecodeError) as exc:
                bad("record %s could not be read -- %s" % (plan_path, exc))
        if record is not None:
            sections = {}
            for key in ("intent", "local_insights", "online_insights", "api_docs_needed"):
                heading = ISSUE_HEADINGS[key]
                text = get_section(record, heading)
                if text is not None and _migrate_has_open_fence(text):
                    bad("record %s: %s ends inside an open code fence, so its text would be cut short"
                        % (plan_path, heading))
                sections[key] = (text or "").strip()
            record_path = plan_path
            if intent is None:
                intent = sections["intent"]
                intent_from_record = True
                if not intent:
                    bad("record %s has no non-empty %s" % (plan_path, ISSUE_HEADINGS["intent"]))
            local, online, api_docs = (
                sections["local_insights"], sections["online_insights"], sections["api_docs_needed"],
            )

    blocked_on = None
    if state == "blocked":
        blocked_on = raw.get("blocked_on")
        if not isinstance(blocked_on, str) or not blocked_on.strip():
            bad("a blocked entry needs blocked_on")
            blocked_on = None
        else:
            blocked_on = blocked_on.strip()

    if problems:
        return None, problems
    spec = {
        "id": entry_id, "title": title, "state": state, "body_state": body_state, "priority": priority,
        "log": [line.strip() for line in log], "intent": intent, "touches": [t.strip() for t in touches],
        "evidence": [e.strip() for e in evidence], "local": local, "online": online, "api_docs": api_docs,
        "prerequisites": list(prerequisites), "resources": gate_lists["resources"],
        "gate_override": gate_lists["gate_override"], "shared_writes": raw.get("shared_writes"),
        "blocked_on": blocked_on, "record_path": record_path, "intent_from_record": intent_from_record,
        "legacy_comment": None, "defaulted": defaulted, "adopt": adopt, "branch": worker_branch,
    }
    if legacy:
        spec["legacy_comment"], problems = _migrate_legacy_comment(preserved, name)
        problems += _migrate_legacy_ledger(legacy_raw, spec, preserved)
        if problems:
            return None, problems
    return spec, []


def _migrate_creation_order(specs):
    """(order, stuck): every in-batch prerequisite ahead of its dependents,
    otherwise in file order; `stuck` names the entries of a cycle."""
    ids = {spec["id"] for spec in specs}
    remaining, done, order = list(specs), set(), []
    while remaining:
        for spec in remaining:
            if all(p in done or p not in ids for p in spec["prerequisites"]):
                order.append(spec)
                done.add(spec["id"])
                remaining.remove(spec)
                break
        else:
            return None, sorted(spec["id"] for spec in remaining)
    return order, []


def _migrate_compose_issue(spec, depends_numbers):
    """The issue one YAML entry becomes: its title, body, label names and
    comment bodies. Every comment is a log line verbatim (cmd_log's
    `<date> <text>` form, the date being the line's own), and a blocked
    entry ends with the Blocked comment so the newest one says why."""
    body = compose_issue_body(
        spec["id"], spec["intent"], spec["touches"], spec["evidence"],
        local=spec["local"], online=spec["online"], api_docs=spec["api_docs"],
        resources=spec["resources"], gate_override=spec["gate_override"], depends_on=depends_numbers,
    )
    labels = [LABEL_PLAN, PRIORITY_LABEL_BY_NUMBER[spec["priority"]]]
    comments = list(spec["log"])
    if spec["legacy_comment"]:
        comments.append(spec["legacy_comment"])
    if spec["state"] == "blocked":
        labels.append(LABEL_BLOCKED)
        comments.append("%s: %s" % (BLOCKED_COMMENT_MARKER, spec["blocked_on"]))
    return {"title": spec["title"], "body": body, "labels": labels, "comments": comments}


def _migrate_issue_state(observed, without_label=None):
    """The state derive_state gives an observed issue. `observed["prs"]` holds the pull requests to derive
    against: none for a plain issue, the real or the synthetic one for an adopted entry."""
    labels = [name for name in observed["labels"] if name.lower() != (without_label or "").lower()]
    return derive_state(
        {"number": observed.get("number", 0), "body": observed["body"], "labels": [{"name": n} for n in labels]},
        list(observed.get("prs") or []),
    )


def _migrate_expected_state(spec):
    """What an issue derives once its entry is migrated: a claimed entry derives accepted, because its draft
    PR and the accepted label are what derive_state reads, and no YAML state names either."""
    return "accepted" if spec["state"] == "claimed" else spec["state"]


def _migrate_expected_state_under_blocked(spec):
    return "accepted" if spec["body_state"] == "claimed" else spec["body_state"]


def _migrate_compose_pr_body(spec, issue_number, depends_numbers):
    """The body accept would give the draft PR of this entry's issue."""
    return compose_pr_body_at_accept(
        spec["id"], issue_number, spec["intent"], spec["priority"], PRIORITY_LABEL_BY_NUMBER[spec["priority"]],
        spec["touches"], spec["evidence"], depends_numbers, spec["resources"], spec["gate_override"],
        local=spec["local"], online=spec["online"], api_docs=spec["api_docs"],
    )


def _migrate_synthetic_pr(issue, pr_body, branch, issue_number):
    """The PR an adopted entry will have once written, for the pre-flight to derive against: a draft, titled
    as its issue the way accept titles it, naming the issue."""
    return {
        "number": issue_number, "title": issue["title"], "isDraft": True, "state": "OPEN", "body": pr_body,
        "headRefName": branch, "baseRefName": MIGRATE_ADOPT_BASE, "closingIssuesReferences": [{"number": issue_number}],
    }


def migrate_check_issue(spec, observed, number_to_id):
    """Section 14 step 4 for one entry: every field the YAML carried, read
    back out of one issue -- the composed one before any write, the live one
    after. Returns the problems, [] only when nothing was lost or changed.
    `observed` is {title, body, labels (names), comments (bodies), number}."""
    problems = []

    def bad(field, expected, found):
        problems.append("%s: %s lost or changed -- expected %s, found %s"
                        % (spec["id"], field, _migrate_short(expected, 160), _migrate_short(found, 160)))

    body = observed.get("body") or ""
    if observed.get("title") != spec["title"]:
        bad("title", spec["title"], observed.get("title"))
    id_match = re.search(r"^id:\s*(\S+)", body, re.MULTILINE)
    found_id = id_match.group(1) if id_match else None
    if found_id != spec["id"]:
        bad("id", spec["id"], found_id)

    labels = {name.lower() for name in observed.get("labels") or []}
    want_priority = PRIORITY_LABEL_BY_NUMBER[spec["priority"]]
    found_priority = sorted(n for n in PRIORITY_LABEL_BY_NUMBER.values() if n.lower() in labels)
    if found_priority != [want_priority]:
        bad("priority label", [want_priority], found_priority)
    if LABEL_PLAN.lower() not in labels:
        bad("plan label", LABEL_PLAN, sorted(labels))
    if (LABEL_BLOCKED.lower() in labels) != (spec["state"] == "blocked"):
        bad("blocked label", spec["state"] == "blocked", LABEL_BLOCKED.lower() in labels)

    found_intent = (get_section(body, ISSUE_HEADINGS["intent"]) or "").strip()
    if found_intent != spec["intent"].strip():
        bad("intent", spec["intent"].strip(), found_intent)

    touches_text = get_section(body, ISSUE_HEADINGS["touches"]) or ""
    found_touches = [line[2:].strip() for line in touches_text.splitlines() if line.startswith("- ")]
    want_touches = spec["touches"] or [MIGRATE_STUB_PLACEHOLDER]
    if found_touches != want_touches:
        bad("touches", want_touches, found_touches)
    evidence_text = get_section(body, ISSUE_HEADINGS["evidence_required"]) or ""
    found_evidence = [
        re.sub(r"^\d+\.\s*", "", line).strip() for line in evidence_text.splitlines() if re.match(r"^\d+\.\s", line)
    ]
    want_evidence = spec["evidence"] or [MIGRATE_STUB_PLACEHOLDER]
    if found_evidence != want_evidence:
        bad("evidence_required", want_evidence, found_evidence)

    for key, field in (("local", "local_insights"), ("online", "online_insights"), ("api_docs", "api_docs_needed")):
        found = (get_section(body, ISSUE_HEADINGS[field]) or "").strip()
        if found != spec[key]:
            bad("research " + field, spec[key], found)

    gates = get_section(body, ISSUE_HEADINGS["gates"]) or ""
    found_depends = sorted(number_to_id.get(n, "#%d" % n) for n in _parse_depends_on_ids(gates))
    if found_depends != sorted(spec["kept_prereqs"]):
        bad("prerequisites", sorted(spec["kept_prereqs"]), found_depends)
    for key in ("resources", "gate_override"):
        match = re.search(r"^%s:\s*(.*)$" % key, gates, re.MULTILINE)
        try:
            found = json.loads(match.group(1)) if match else None
        except json.JSONDecodeError:
            found = None
        if found != spec[key]:
            bad(key, spec[key], found)

    wanted_comments = list(spec["log"])
    if spec["state"] == "blocked":
        wanted_comments.append("%s: %s" % (BLOCKED_COMMENT_MARKER, spec["blocked_on"]))
    missing = Counter(wanted_comments) - Counter((c or "").strip() for c in observed.get("comments") or [])
    if missing:
        bad("log (issue comments)", sorted(missing.elements()), "missing")
    if spec["legacy_comment"] and spec["legacy_comment"] not in [(c or "").strip() for c in observed.get("comments") or []]:
        bad("Legacy fields comment", spec["legacy_comment"], "missing")

    found_state = _migrate_issue_state(observed)
    if found_state != _migrate_expected_state(spec):
        bad("state", _migrate_expected_state(spec), found_state)
    elif spec["state"] == "blocked":
        underneath = _migrate_issue_state(observed, without_label=LABEL_BLOCKED)
        if underneath != _migrate_expected_state_under_blocked(spec):
            bad("state under the blocked label", _migrate_expected_state_under_blocked(spec), underneath)
    return problems


def _migrate_state_counts(states):
    """Counts per live state, a claimed entry counted as accepted (the state it derives once adopted)."""
    counts = Counter("accepted" if state == "claimed" else state for state in states)
    return {state: counts.get(state, 0) for state in LIVE_STATES}


def _migrate_check_labels_exist(specs, repo_root):
    """Every label migrate will put on an issue must already exist: GitHub
    refuses `issue create` with a missing label, after earlier issues were
    already created."""
    needed = [LABEL_PLAN] + [PRIORITY_LABEL_BY_NUMBER[n] for n in sorted({spec["priority"] for spec in specs})]
    if any(spec["state"] == "blocked" for spec in specs):
        needed.append(LABEL_BLOCKED)
    if any(spec["adopt"] for spec in specs):
        needed.append(LABEL_ACCEPTED)
    try:
        existing = gh_json(["label", "list", "--json", "name", "--limit", str(INIT_LIST_LIMIT)], cwd=repo_root)
    except (GhError, OSError, ValueError) as exc:
        _migrate_refuse("could not list the repo's labels (%s), so it cannot be shown that the issues can be labelled. "
                        "Nothing was written." % (exc,))
    names = {label.get("name", "").lower() for label in existing if isinstance(label, dict)}
    missing = [name for name in needed if name.lower() not in names]
    if missing:
        truncated = " (the label list hit its limit and may be truncated)" if len(existing) >= INIT_LIST_LIMIT else ""
        _migrate_refuse("label(s) missing on this repo: %s%s. Run `queue init` (it creates the label set), then "
                        "re-run. Nothing was written." % (", ".join(missing), truncated))


def _migrate_check_rewritten_config(rewritten, final_config):
    """Parse the text the line-based rewrite produced, before anything is
    written: a quoted key or a byte order mark hides a key from the line
    match, and a config that does not parse cannot be migrated safely."""
    yaml = _migrate_import_yaml()
    try:
        loaded, final_loaded = yaml.safe_load(rewritten), yaml.safe_load(final_config)
    except yaml.YAMLError as exc:
        _migrate_refuse("the rewritten config does not parse as YAML (%s). Nothing was written." % (exc,))
    if not isinstance(loaded, dict) or not isinstance(final_loaded, dict):
        _migrate_refuse("the rewritten config does not parse to a mapping. Nothing was written.")
    survivors = [key for key in MIGRATE_CONFIG_DROPPED_KEYS if key in loaded]
    if survivors:
        _migrate_refuse("the rewritten config still holds %s (a quoted key or a byte order mark hides it from the "
                        "line-based rewrite); fix the file by hand first. Nothing was written." % ", ".join(survivors))
    absent = [key for key, _ in MIGRATE_CONFIG_ADDED_KEYS if key not in loaded]
    final_marker = _parse_top_level_pipeline(final_config)
    if absent or final_loaded.get("pipeline") != "github" or final_marker is None \
            or _strip_yaml_scalar(final_marker) != "github":
        _migrate_refuse("internal: the rewritten config lacks %s or a top-level %s line. Nothing was written."
                        % (", ".join(absent) or "nothing", MIGRATE_MARKER_LINE))


def _migrate_remote_shas(listed):
    """{branch: sha} out of `git ls-remote origin refs/heads/<branch>...` output. Exact names only: ls-remote
    matches a pattern against the tail of a ref, so a longer ref name can come back with the one asked for."""
    found = {}
    for line in listed.splitlines():
        parts = line.split("\t")
        if len(parts) == 2 and re.fullmatch(r"[0-9a-f]{40}", parts[0]) and parts[1].startswith("refs/heads/"):
            found[parts[1][len("refs/heads/"):]] = parts[0]
    return found


def _migrate_local_branch_sha(branch, repo_root):
    """(sha, None) for the local branch named exactly `branch`; (None, name) when none is but one differing only
    in case is (the first listed); else (None, None). It reads the names for-each-ref lists: on a volume that
    folds case, rev-parse resolves a differently cased branch for the requested one."""
    listing = run_git(["for-each-ref", "--format=%(refname)%09%(objectname)", "refs/heads/"], cwd=repo_root).stdout
    variant = None
    for line in listing.splitlines():
        refname, _, sha = line.partition("\t")
        listed = refname[len("refs/heads/"):]
        if listed == branch:
            return sha, None
        if variant is None and listed.lower() == branch.lower():
            variant = listed
    return None, variant


def _migrate_ref_conflicts(adopted, origin_branches):
    """Problems for two branches git cannot hold together, a name and a name below it (plan/a and plan/a/b): the
    adopted branches among themselves, and each against the branches origin already has. `origin_branches` holds
    exact names only, because ls-remote tail-matches (plan/a also returns x/refs/heads/plan/a)."""
    problems = []
    for spec in adopted:
        branch = spec["branch"]
        for other in adopted:
            if other["branch"].startswith(branch + "/"):
                problems.append("%s: ref name conflict: branch %s (this entry) cannot exist beside %s (entry %s): git "
                                "cannot hold a branch and a branch below it" % (spec["id"], branch, other["branch"],
                                                                                other["id"]))
        for name in sorted(origin_branches):
            if name.startswith(branch + "/"):
                problems.append("%s: ref name conflict: origin holds branch %s, which cannot exist beside %s (this "
                                "entry's branch): git cannot hold a branch and a branch below it"
                                % (spec["id"], name, branch))
            if branch.startswith(name + "/"):
                problems.append("%s: ref name conflict: origin holds branch %s, which cannot exist beside %s (this "
                                "entry's branch): git cannot hold a branch and a branch below it"
                                % (spec["id"], name, branch))
    return problems


def _migrate_adopt_branch(spec, remote, repo_root):
    """(info, problems) for one adopted entry's branch, read only. `remote` is origin's tip of it or None.
    `info` says where the branch is, the tip the PR will head, and whether a push is needed: a branch on
    neither side gets accept's empty-commit branch, a local-only one is pushed, a local one ahead of origin is
    fast-forwarded, an origin-only or an equal one is reused with no push. Anything that would need a force
    is a problem."""
    branch, name = spec["branch"], spec["id"]
    if run_git(["check-ref-format", "refs/heads/%s" % branch], cwd=repo_root, check=False).returncode != 0:
        return None, ["%s: worker_branch %s is not a valid git branch name" % (name, _migrate_short(branch))]
    base = "refs/remotes/origin/%s" % MIGRATE_ADOPT_BASE
    base_sha = run_git(["rev-parse", "--verify", "-q", "%s^{commit}" % base], cwd=repo_root, check=False).stdout.strip()
    if not base_sha:
        return None, ["%s: origin has no %s branch to open a pull request against" % (name, MIGRATE_ADOPT_BASE)]
    local, variant = _migrate_local_branch_sha(branch, repo_root)
    if variant is not None:
        return None, ["%s: local branch %s differs only in case from this entry's branch %s, and a volume that folds "
                      "case would resolve one for the other and push its commits under this name; rename or delete "
                      "one of them" % (name, variant, branch)]
    if local is None and remote is None:
        return {"branch": branch, "action": "create", "tip": None, "push": True, "where": "new", "base": base_sha}, []
    if remote is not None and run_git(["cat-file", "-e", "%s^{commit}" % remote], cwd=repo_root,
                                      check=False).returncode != 0:
        return None, ["%s: origin's %s is at %s, which this repository does not hold even after a fetch"
                      % (name, branch, remote)]
    tip = local or remote
    if local and remote and local != remote:
        ahead = run_git(["merge-base", "--is-ancestor", remote, local], cwd=repo_root, check=False).returncode
        if ahead != 0:
            return None, ["%s: branch %s on origin (%s) is not an ancestor of the local one (%s): diverged, or "
                          "the local branch is behind. Adopting it would need a force push, and migrate pushes "
                          "fast-forwards only" % (name, branch, remote, local)]
    counted = run_git(["rev-list", "--count", "%s..%s" % (base, tip)], cwd=repo_root, check=False)
    if counted.returncode != 0:
        return None, ["%s: could not count the commits of %s ahead of origin/%s (%s)"
                      % (name, branch, MIGRATE_ADOPT_BASE, counted.stderr.strip())]
    if counted.stdout.strip() == "0":
        return None, ["%s: branch %s has no commits ahead of origin/%s, so a pull request cannot be opened on it"
                      % (name, branch, MIGRATE_ADOPT_BASE)]
    where = "origin only" if local is None else ("local and origin" if local == remote else (
        "local only" if remote is None else "local, ahead of origin"))
    return {"branch": branch, "action": "adopt", "tip": tip, "push": local is not None and local != remote,
            "where": where, "base": base_sha}, []


def _migrate_adopt_preflight(adopted, repo_root):
    """({id: info}, problems) for every adopted entry: the repository is the checkout's own, origin answers
    (one read of its branches, then one fetch by explicit refspecs that moves only the
    remote-tracking refs and FETCH_HEAD, never a local branch or a tag), each branch can be adopted without a
    force and sits beside no ref git cannot hold with it, and no open or merged PR already heads it. A
    closed, unmerged one does not count, so the advice to close a PR leads to a clean re-run."""
    top = run_git(["rev-parse", "--show-toplevel"], cwd=repo_root, check=False)
    if top.returncode != 0 or Path(top.stdout.strip()).resolve() != Path(repo_root).resolve():
        return {}, ["%s: %s is not the top of a git repository, so the branch of an adopted entry cannot be read "
                    "or pushed" % (spec["id"], repo_root) for spec in adopted]
    # plan/* is read too, so a ref that cannot sit beside an adopted branch shows up before any write.
    wanted = ["refs/heads/%s" % MIGRATE_ADOPT_BASE, "refs/heads/plan", "refs/heads/plan/*"]
    listed = run_git(["ls-remote", "origin"] + wanted + ["refs/heads/%s" % spec["branch"] for spec in adopted],
                     cwd=repo_root, check=False)
    remotes = _migrate_remote_shas(listed.stdout)
    # A refspec for a branch origin lacks is fatal, and so is a fetch with none left.
    refspecs = [_tracking_refspec(name)
                for name in [MIGRATE_ADOPT_BASE] + [spec["branch"] for spec in adopted] if name in remotes]
    fetched = subprocess.CompletedProcess([], 0, "", "")
    if refspecs:
        fetched = _fetch_pinned(refspecs, repo_root, check=False)
    if fetched.returncode != 0 or listed.returncode != 0:
        why = (fetched.stderr if fetched.returncode != 0 else listed.stderr).strip() or "git could not read it"
        return {}, ["%s: could not reach origin (%s), so its branch %s cannot be read or pushed"
                    % (spec["id"], why, spec["branch"]) for spec in adopted]
    info, problems = {}, _migrate_ref_conflicts(adopted, remotes)
    for spec in adopted:
        found, issues = _migrate_adopt_branch(spec, remotes.get(spec["branch"]), repo_root)
        problems += issues
        if found is not None:
            info[spec["id"]] = found
        try:
            held = gh_json(["pr", "list", "--head", spec["branch"], "--state", "all", "--json", "number,state"],
                           cwd=repo_root)
        except (GhError, OSError, ValueError) as exc:
            problems.append("%s: could not list the pull requests on %s (%s)" % (spec["id"], spec["branch"], exc))
            continue
        for pr in held:
            state = str(pr.get("state") or "").upper()
            if state in ("OPEN", "MERGED"):
                problems.append("%s: %s %s pull request (#%s) is already on %s%s" % (
                    spec["id"], "an" if state == "OPEN" else "a", state, pr.get("number"), spec["branch"],
                    ": close it first (gh pr close %s)" % pr.get("number") if state == "OPEN"
                    else ": this entry already shipped"))
    return info, problems


def _migrate_preflight(repo_root, max_writes, legacy=False):
    """Everything that can refuse a migration, none of which writes. Reads
    only: the YAML, the records, the config, the list of existing plan
    issues and, for a claimed entry, its branch and pull requests. Returns
    the plan the write phase follows."""
    mode = pipeline_mode(repo_root)
    if mode == "github":
        _migrate_refuse("the marker already reads github: this repo is migrated. Nothing was written.")
    if mode == "error":
        _migrate_refuse("the marker in %s is unreadable or unrecognised; fix or remove it first. Nothing was written."
                        % repo_root.joinpath(*CONFIG_RELPATH))
    config_path = repo_root.joinpath(*CONFIG_RELPATH)
    if not config_path.is_file():
        _migrate_refuse("%s does not exist; create it (from .claude/coordinator-config.example.yaml) before "
                        "migrating, because migrate rewrites it. Nothing was written." % (config_path,))
    try:
        config_text = _migrate_read_text(config_path)
    except (OSError, UnicodeDecodeError) as exc:
        _migrate_refuse("could not read %s -- %s. Nothing was written." % (config_path, exc), 2)

    raw_entries = _migrate_load_entries(repo_root)
    specs, problems = [], []
    for raw in raw_entries:
        spec, found = _migrate_normalise_entry(raw, repo_root, legacy)
        problems += found
        if spec is not None:
            specs.append(spec)
    ids = [spec["id"] for spec in specs]
    problems += ["%s: id appears more than once in plans/queue.yaml" % i for i in sorted(set(ids)) if ids.count(i) > 1]
    if problems:
        _migrate_refuse(problems + ["Nothing was written."])
    _migrate_check_labels_exist(specs, repo_root)

    try:
        existing = fetch_all_plan_issues(repo_root)
    except (GhError, OSError, ValueError) as exc:
        _migrate_refuse("could not list the existing plan issues (%s), so a clash with an existing id cannot be ruled "
                        "out. Nothing was written." % (exc,))
    if len(existing) >= MIGRATE_LIST_LIMIT:
        _migrate_refuse("the issue list returned %d issues, its --limit, so it may hide a clashing id. Nothing was "
                        "written." % len(existing))
    existing_by_id = {}
    for issue in existing:
        id_match = re.search(r"^id:\s*(\S+)", issue.get("body") or "", re.MULTILINE)
        if id_match:
            existing_by_id[id_match.group(1)] = issue
    clashes = ["%s: issue #%d already carries this id: (state %s); a second run would duplicate it"
               % (spec["id"], existing_by_id[spec["id"]]["number"], existing_by_id[spec["id"]].get("state"))
               for spec in specs if spec["id"] in existing_by_id]
    adopted = [spec for spec in specs if spec["adopt"]]
    adopt_info, adopt_problems = _migrate_adopt_preflight(adopted, repo_root) if adopted else ({}, [])
    if clashes or adopt_problems:
        _migrate_refuse(clashes + adopt_problems + ["Nothing was written."])

    live_number_by_id = {
        i: issue["number"] for i, issue in existing_by_id.items() if str(issue.get("state", "OPEN")).upper() == "OPEN"
    }
    batch_ids = set(ids)
    dropped_lines = []
    for spec in specs:
        spec["kept_prereqs"] = [p for p in spec["prerequisites"] if p in batch_ids or p in live_number_by_id]
        for p in spec["prerequisites"]:
            if p not in spec["kept_prereqs"]:
                dropped_lines.append("DROPPED prerequisite %s (of %s): no live issue for it -- merged, retired or "
                                     "absent, so already satisfied" % (p, spec["id"]))
        if spec["shared_writes"]:
            dropped_lines.append("DROPPED shared_writes of %s: %s (allowed drop: a plan issue has no destination for it)"
                                 % (spec["id"], _migrate_short(spec["shared_writes"], 160)))
    order, stuck = _migrate_creation_order(specs)
    if order is None:
        _migrate_refuse("prerequisites form a cycle among: %s. Nothing was written." % ", ".join(stuck))

    provisional = {spec["id"]: 10 ** 6 + index for index, spec in enumerate(order)}
    number_by_id = dict(live_number_by_id)
    number_by_id.update(provisional)
    number_to_id = {number: i for i, number in number_by_id.items()}
    problems, states_after, planned_writes = [], [], 0
    for spec in order:
        depends = sorted(number_by_id[p] for p in spec["kept_prereqs"])
        issue = _migrate_compose_issue(spec, depends)
        observed = dict(issue, number=provisional[spec["id"]])
        planned_writes += 1 + len(issue["comments"])
        if spec["adopt"]:
            # The accepted label is the last write, so it is observed here as if made, beside the draft PR.
            pr_body = _migrate_compose_pr_body(spec, observed["number"], depends)
            observed["labels"] = list(issue["labels"]) + [LABEL_ACCEPTED]
            observed["prs"] = [_migrate_synthetic_pr(issue, pr_body, spec["branch"], observed["number"])]
            planned_writes += MIGRATE_ADOPT_WRITES
            if len(pr_body) > MIGRATE_MAX_TEXT_CHARS:
                problems.append("%s: pull request body is %d characters, over the %d-character limit GitHub enforces"
                                % (spec["id"], len(pr_body), MIGRATE_MAX_TEXT_CHARS))
        found = migrate_check_issue(spec, observed, number_to_id)
        problems += found
        if len(issue["body"]) > MIGRATE_MAX_TEXT_CHARS:
            problems.append("%s: body is %d characters, over the %d-character limit GitHub enforces"
                            % (spec["id"], len(issue["body"]), MIGRATE_MAX_TEXT_CHARS))
        for number, text in enumerate(issue["comments"], start=1):
            if len(text) > MIGRATE_MAX_TEXT_CHARS:
                problems.append("%s: comment %d is %d characters, over the %d-character limit GitHub enforces"
                                % (spec["id"], number, len(text), MIGRATE_MAX_TEXT_CHARS))
        states_after.append(_migrate_issue_state(observed))
    states_before = _migrate_state_counts(spec["state"] for spec in specs)
    if _migrate_state_counts(states_after) != states_before:
        problems.append("state counts changed: YAML %s, composed issues %s"
                        % (states_before, _migrate_state_counts(states_after)))
    if problems:
        _migrate_refuse(problems + ["Conservation check failed before any write; nothing was written."])
    if planned_writes > max_writes:
        counted = "one per issue, one per comment" + (
            ", and per adopted entry a pull request, the accepted label and two comments" if adopted else "")
        _migrate_refuse("%d gh writes are planned (%s) and --max-writes is %d. A partial run would leave issues "
                        "that a re-run then refuses on, so nothing was written. Raise --max-writes or migrate in "
                        "fewer steps." % (planned_writes, counted, max_writes))

    rewritten, removed, added = migrate_rewrite_config(config_text)
    final_config = migrate_set_marker(rewritten)
    _migrate_check_rewritten_config(rewritten, final_config)
    return {
        "order": order, "specs": specs, "states_before": states_before, "planned_writes": planned_writes,
        "dropped_lines": dropped_lines, "live_number_by_id": live_number_by_id, "config_path": config_path,
        "queue_path": repo_root.joinpath(*QUEUE_RELPATH), "config_removed": removed, "config_added": added,
        "max_writes": max_writes, "legacy": legacy, "adopt": adopt_info,
        "pushes_planned": sum(1 for found in adopt_info.values() if found["push"]),
        "ledger": {"pushed": [], "prs": [], "adopted": {}, "attempted": []},
    }


def _migrate_print_plan(plan, dry_run):
    verb = "WOULD CREATE" if dry_run else "WILL CREATE"
    print("migrate: %d entr%s to migrate, state counts %s"
          % (len(plan["specs"]), "y" if len(plan["specs"]) == 1 else "ies", plan["states_before"]))
    for spec in plan["order"]:
        found = plan["adopt"].get(spec["id"])
        print("%s %s [%s] p%d, %d log comment(s)%s%s" % (
            "WOULD ADOPT" if dry_run and found else "WILL ADOPT" if found else verb,
            spec["id"], spec["state"], spec["priority"], len(spec["log"]),
            ", blocked label and comment" if spec["state"] == "blocked" else "",
            ": branch %s %s, base %s, one draft PR" % (
                spec["branch"], "(new)" if found["tip"] is None else "at %s (%s)" % (found["tip"], found["where"]),
                MIGRATE_ADOPT_BASE) if found else "",
        ))
        if found and found["action"] == "create":
            print("%s BRANCH %s from origin/%s" % (verb, spec["branch"], MIGRATE_ADOPT_BASE))
        if spec["record_path"]:
            print("SOURCE %s: %s from %s" % (
                spec["id"], "Intent and Research" if spec["intent_from_record"] else "Research", spec["record_path"],
            ))
        for line in spec["defaulted"]:
            print(line)
    for line in plan["dropped_lines"]:
        print(line)
    writes = "migrate: %d gh write(s) planned, cap %d" % (plan["planned_writes"], plan["max_writes"])
    if plan["legacy"]:
        parts = ["%d issues" % len(plan["specs"]),
                 "%d Legacy fields comments" % sum(1 for spec in plan["specs"] if spec["legacy_comment"]),
                 "%d Blocked comments" % sum(1 for spec in plan["specs"] if spec["state"] == "blocked")]
        logs = sum(len(spec["log"]) for spec in plan["specs"])
        if logs:
            parts.append("%d log comments" % logs)
        writes += " (%s)" % ", ".join(parts)
    print(writes)
    if plan["adopt"]:
        print("migrate: %d git push(es) planned" % plan["pushes_planned"])
    print("%s config: drop %d line(s) for %s; add %s" % (
        "WOULD REWRITE" if dry_run else "WILL REWRITE", len(plan["config_removed"]),
        ", ".join(MIGRATE_CONFIG_DROPPED_KEYS), ", ".join(line.strip() for line in plan["config_added"]) or "nothing",
    ))
    print("%s %s" % ("WOULD DELETE" if dry_run else "WILL DELETE", plan["queue_path"]))
    print("%s %s as the last write" % ("WOULD SET" if dry_run else "WILL SET", MIGRATE_MARKER_LINE))


def _migrate_report_partial(created, reason, ledger=None):
    sys.stderr.write("MIGRATE PARTIAL: %s\n" % (reason,))
    sys.stderr.write("  plans/queue.yaml, the config and the marker are untouched.\n")
    if not created:
        sys.stderr.write("  nothing was created; fix the cause and re-run.\n")
        return
    sys.stderr.write("  issues already created: %s\n" % ", ".join("#%d (%s)" % (n, s["id"]) for s, n, _ in created))
    ledger = ledger or {}
    if ledger.get("pushed"):
        # Never advised away: the branch holds the owner's work, and a re-run reuses it with no push.
        sys.stderr.write("  branches pushed by this run, kept on origin because each holds work; a re-run reuses "
                         "it with no push:\n")
        for branch, sha in ledger["pushed"]:
            sys.stderr.write("  %s at %s\n" % (branch, sha))
    if ledger.get("prs"):
        sys.stderr.write("  Close each pull request this run opened first (a closed, unmerged one no longer "
                         "blocks a re-run):\n")
        for number, branch, _ in ledger["prs"]:
            sys.stderr.write("  gh pr close %d\n" % number)
    recorded = {branch for _, branch, _ in ledger.get("prs") or []}
    unrecorded = [branch for branch in ledger.get("attempted") or [] if branch not in recorded]
    if unrecorded:
        sys.stderr.write("  gh may have created a pull request whose number this run never learned; for each branch "
                         "below, list its open pull requests and close each (a closed, unmerged one no longer "
                         "blocks a re-run):\n")
        for branch in unrecorded:
            sys.stderr.write("  gh pr list --head %s --state open\n" % shlex.quote(branch))
    # The pre-flight lists issues by the plan label and a closed issue keeps its id:, so closing alone
    # leaves the re-run refused; taking the label off is what frees the id.
    sys.stderr.write(
        "  A re-run refuses on these ids. Take each issue out of the queue first: remove its %s label and close it\n"
        % LABEL_PLAN
    )
    for _, number, _ in created:
        sys.stderr.write("  gh issue edit %d --remove-label %s\n" % (number, LABEL_PLAN))
        sys.stderr.write("  gh issue close %d --reason \"not planned\"\n" % number)
    sys.stderr.write("  or, with admin rights, delete each one instead:\n")
    for _, number, _ in created:
        sys.stderr.write("  gh issue delete %d --yes\n" % number)


def _migrate_push_args(branch, sha):
    # The plain SHA refspec: no `+` (a rejected non-fast-forward stays rejected) and no -u, which would
    # write a branch section into .git/config. The pins undo the user's config: remote.origin.mirror makes a
    # refspec push fatal (and --no-mirror does not override it), push.followTags publishes local tags and
    # push.gpgSign needs a signing server, push.pushOption dies on a remote that advertises no push options
    # (the empty value clears every config scope) and push.recurseSubmodules or submodule.recurse push or
    # check the submodules too.
    return ["-c", "remote.origin.mirror=false", "-c", "push.pushOption=", "push", "--no-follow-tags", "--no-signed", "--no-recurse-submodules", "origin", "%s:refs/heads/%s" % (sha, branch)]


def _migrate_empty_commit(branch, repo_root):
    """accept's empty commit on origin's default branch, built with plumbing only, so the checkout's HEAD,
    index and files never move and the commit touches no local branch."""
    base_sha = run_git(["rev-parse", "refs/remotes/origin/%s" % MIGRATE_ADOPT_BASE], cwd=repo_root).stdout.strip()
    base_tree = run_git(["rev-parse", "%s^{tree}" % base_sha], cwd=repo_root).stdout.strip()
    return run_git(["commit-tree", base_tree, "-p", base_sha, "-m", "%s: accepted" % branch],
                   cwd=repo_root).stdout.strip()


def _migrate_snapshot(issue):
    return hashlib.sha256(issue["body"].encode("utf-8")).hexdigest()


def _migrate_adopt_write(spec, number, issue, depends, plan, repo_root, pace):
    """The adopted entry's writes after its own issue and comments: the branch push, the draft PR with the link
    check, then the accepted label and accept's two comments -- the label last, so it never precedes the PR."""
    found, ledger, branch = plan["adopt"][spec["id"]], plan["ledger"], spec["branch"]
    sha = found["tip"] if found["action"] == "adopt" else _migrate_empty_commit(branch, repo_root)
    if found["push"]:
        run_git(_migrate_push_args(branch, sha), cwd=repo_root)
        ledger["pushed"].append((branch, sha))
        landed = _migrate_remote_shas(
            run_git(["ls-remote", "origin", "refs/heads/%s" % branch], cwd=repo_root).stdout).get(branch)
        if landed != sha:
            raise MigrateWriteError("WRITE NOT PERSISTED: origin reads %s at %s after the push of %s"
                                    % (branch, landed, sha))
    pr_body = _migrate_compose_pr_body(spec, number, depends)
    body_path = _body_tempfile(pr_body)
    try:
        pace()
        ledger["attempted"].append(branch)
        result = run_gh(["pr", "create", "--draft", "--title", issue["title"], "--body-file", body_path,
                         "--head", branch, "--base", MIGRATE_ADOPT_BASE], cwd=repo_root)
    finally:
        Path(body_path).unlink()
    pr_match = re.search(r"/pull/(\d+)", result.stdout)
    if pr_match is None:
        raise MigrateWriteError("gh pr create did not report a new PR number for %s" % spec["id"])
    pr_number = int(pr_match.group(1))
    ledger["prs"].append((pr_number, branch, spec["id"]))
    readback = gh_json(["pr", "view", pr_number, "--json", "body,closingIssuesReferences"], cwd=repo_root)
    if not bodies_match(readback.get("body"), pr_body):
        raise MigrateWriteError("WRITE NOT PERSISTED: PR #%d body read-back did not match what was written" % pr_number)
    try:
        _check_pr_links_issue(readback, number, pr_number, repo_root)
    except SystemExit:
        raise MigrateWriteError("PR #%d does not close issue #%d (ISSUE UNLINKED above)" % (pr_number, number))
    ledger["adopted"][spec["id"]] = {"pr": pr_number, "branch": branch, "body": pr_body, "tip": sha}
    pace()
    run_gh(["issue", "edit", number, "--add-label", LABEL_ACCEPTED], cwd=repo_root)
    pace()
    run_gh(["issue", "comment", number, "--body", ACCEPTED_NOTICE % pr_number], cwd=repo_root)
    pace()
    run_gh(["issue", "comment", number, "--body", ACCEPTED_SNAPSHOT_COMMENT % _migrate_snapshot(issue)],
           cwd=repo_root)
    print("migrate: %s adopted: branch %s at %s, PR #%d on issue #%d" % (spec["id"], branch, sha, pr_number, number))


def _migrate_write_issues(plan, repo_root):
    """Create every issue (prerequisites first), then its comments; an adopted entry then gets its branch, its
    draft PR and its accepted label. Returns [(spec, number, composed issue)]."""
    number_by_id = dict(plan["live_number_by_id"])
    created = []
    paced = plan["planned_writes"] > MIGRATE_PACE_ABOVE_WRITES
    writes_made = [0]

    def pace():
        if paced and writes_made[0]:
            _migrate_pace_sleep(MIGRATE_PACE_SECONDS)
        writes_made[0] += 1

    try:
        for spec in plan["order"]:
            depends = sorted(number_by_id[p] for p in spec["kept_prereqs"])
            issue = _migrate_compose_issue(spec, depends)
            body_path = _body_tempfile(issue["body"])
            try:
                create_args = ["issue", "create", "--title", issue["title"], "--body-file", body_path]
                for label in issue["labels"]:
                    create_args += ["--label", label]
                pace()
                result = run_gh(create_args, cwd=repo_root)
            finally:
                Path(body_path).unlink()
            number_match = re.search(r"/issues/(\d+)", result.stdout)
            if number_match is None:
                raise MigrateWriteError("gh issue create did not report a new issue number for %s" % spec["id"])
            number = int(number_match.group(1))
            number_by_id[spec["id"]] = number
            created.append((spec, number, issue))
            for text in issue["comments"]:
                pace()
                run_gh(["issue", "comment", number, "--body", text], cwd=repo_root)
            print("migrate: issue #%d created for %s (%d comment(s))" % (number, spec["id"], len(issue["comments"])))
            if spec["adopt"]:
                _migrate_adopt_write(spec, number, issue, depends, plan, repo_root, pace)
    except (GhError, GitError, MigrateWriteError, ValueError, OSError) as exc:
        _migrate_report_partial(created, exc, plan["ledger"])
        raise SystemExit(1)
    return created


def _migrate_check_adopted_pr(spec, issue_number, adopted, prs):
    """Problems for the draft PR an adopted entry opened, as the PR list now shows it. derive_state counts an
    accepted issue accepted with no PR at all, so the state check cannot see a PR that is gone or unlinked:
    this one asserts the PR itself -- it exists, closes the issue, heads the branch, bases the default branch,
    is a draft and has the body composed for it."""
    problems = []

    def bad(field, expected, found):
        problems.append("%s: pull request %s lost or changed -- expected %s, found %s"
                        % (spec["id"], field, _migrate_short(expected, 160), _migrate_short(found, 160)))

    pr = next((p for p in prs if p.get("number") == adopted["pr"]), None)
    if pr is None:
        bad("#%d" % adopted["pr"], "a draft PR on %s" % adopted["branch"], "none")
        return problems
    linked = sorted(ref.get("number") for ref in pr.get("closingIssuesReferences") or [] if isinstance(ref, dict))
    if issue_number not in linked:
        bad("closing reference", "issue #%d" % issue_number, linked)
    if pr.get("headRefName") != adopted["branch"]:
        bad("head branch", adopted["branch"], pr.get("headRefName"))
    if pr.get("baseRefName") != MIGRATE_ADOPT_BASE:
        bad("base branch", MIGRATE_ADOPT_BASE, pr.get("baseRefName"))
    if pr.get("isDraft") is not True:
        bad("draft flag", True, pr.get("isDraft"))
    if not bodies_match(pr.get("body"), adopted["body"]):
        bad("body", "the composed PR body", "a different body")
    return problems


def _migrate_read_back_one(item, number_to_id, repo_root, plan):
    """(problems, derived state) for one created issue, read live. An adopted entry's PR is read through
    the PR list and asserted itself."""
    spec, number, issue = item
    try:
        view = gh_json(["issue", "view", number, "--json", "title,body,labels,comments"], cwd=repo_root)
    except (GhError, ValueError, OSError) as exc:
        return ["%s: issue #%d could not be read back -- %s" % (spec["id"], number, exc)], None
    observed = {
        "number": number, "title": view.get("title"), "body": view.get("body") or "",
        "labels": sorted(_label_names(view.get("labels"))),
        "comments": [c.get("body") or "" for c in view.get("comments") or []],
    }
    problems = []
    if spec["adopt"]:
        adopted = plan["ledger"]["adopted"].get(spec["id"])
        if adopted is None:
            return ["%s: no pull request was recorded for this adopted entry" % spec["id"]], None
        try:
            observed["prs"] = fetch_all_prs(repo_root)
        except (GhError, ValueError, OSError) as exc:
            return ["%s: the pull requests could not be read back -- %s" % (spec["id"], exc)], None
        problems += _migrate_check_adopted_pr(spec, number, adopted, observed["prs"])
        comments = [(text or "").strip() for text in observed["comments"]]
        for wanted in (ACCEPTED_NOTICE % adopted["pr"], ACCEPTED_SNAPSHOT_COMMENT % _migrate_snapshot(issue)):
            if wanted not in comments:
                problems.append("%s: comment lost or changed -- expected %s, found none"
                                % (spec["id"], _migrate_short(wanted, 160)))
    if not bodies_match(observed["body"], issue["body"]):
        problems.append("%s: WRITE NOT PERSISTED: issue #%d body read-back did not match what was written"
                        % (spec["id"], number))
    problems += migrate_check_issue(spec, observed, number_to_id)
    return problems, _migrate_issue_state(observed)


def _migrate_read_back(plan, created, repo_root):
    """Step 4 of section 14 again, against what GitHub now holds. An issue that
    does not match is read again, up to MIGRATE_READ_BACK_ATTEMPTS times with a
    doubling wait, because GitHub can lag on comments and labels after a write."""
    number_to_id = {number: spec["id"] for spec, number, _ in created}
    number_to_id.update({number: i for i, number in plan["live_number_by_id"].items()})
    pending, states_after, problems = list(created), [], []
    wait = MIGRATE_READ_BACK_FIRST_WAIT
    for attempt in range(1, MIGRATE_READ_BACK_ATTEMPTS + 1):
        problems, still_pending = [], []
        for item in pending:
            found, state = _migrate_read_back_one(item, number_to_id, repo_root, plan)
            if found:
                problems += found
                still_pending.append(item)
            else:
                states_after.append(state)
        pending = still_pending
        if not pending:
            break
        if attempt < MIGRATE_READ_BACK_ATTEMPTS:
            print("migrate: read-back differs on %d issue(s); reading again in %ds (attempt %d of %d)"
                  % (len(pending), wait, attempt + 1, MIGRATE_READ_BACK_ATTEMPTS))
            _migrate_retry_sleep(wait)
            wait *= 2
    if _migrate_state_counts(states_after) != plan["states_before"] and not problems:
        problems.append("state counts changed: YAML %s, live issues %s"
                        % (plan["states_before"], _migrate_state_counts(states_after)))
    if problems:
        for problem in problems:
            sys.stderr.write("READ-BACK CONSERVATION FAILED: %s\n" % (problem,))
        _migrate_report_partial(created, "the live issues do not match the YAML", plan["ledger"])
        raise SystemExit(1)
    print("migrate: read-back ok for %d issue(s); state counts before (YAML) == after (live): %s"
          % (len(created), plan["states_before"]))


def _migrate_finish_files(plan, repo_root):
    """Config rewrite, deleting plans/queue.yaml, then the marker -- each only
    if the one before held, and each re-read to prove it landed."""
    config_path, queue_path = plan["config_path"], plan["queue_path"]
    # (name of the step, what to do by hand if it and the ones after it did not happen)
    steps = (
        ("config rewrite", "rewrite the config"),
        ("deleting plans/queue.yaml", "delete plans/queue.yaml"),
        ("writing the marker", "add the %s line last" % MIGRATE_MARKER_LINE),
    )
    step = 0
    try:
        rewritten, removed, _ = migrate_rewrite_config(_migrate_read_text(config_path))
        _migrate_write_text(config_path, rewritten)
        on_disk = _migrate_read_text(config_path)
        leftovers = [m.group(1) for m in map(_CONFIG_TOP_LEVEL_KEY_RE.match, _migrate_split_lines(on_disk))
                     if m and m.group(1) in MIGRATE_CONFIG_DROPPED_KEYS]
        if on_disk != rewritten or leftovers:
            raise MigrateWriteError("WRITE NOT PERSISTED: %s still reads differently from what was written" % config_path)
        print("migrate: config rewritten: %d line(s) dropped, %d added" % (len(removed), len(plan["config_added"])))
        step = 1
        _migrate_unlink(queue_path)
        if queue_path.exists():
            raise MigrateWriteError("WRITE NOT PERSISTED: %s still exists" % queue_path)
        print("migrate: deleted %s" % queue_path)
        step = 2
        _migrate_write_text(config_path, migrate_set_marker(_migrate_read_text(config_path)))
        if pipeline_mode(repo_root) != "github":
            raise MigrateWriteError("WRITE NOT PERSISTED: the marker does not read github after the write")
    except (OSError, MigrateWriteError) as exc:
        sys.stderr.write(
            "MIGRATE INCOMPLETE: the issues were created and verified, then %s failed -- %s.\n"
            "  Done so far: %s.\n"
            "  Still to do by hand, in this order: %s.\n"
            "  Do not close the issues: they are correct.\n"
            % (steps[step][0], exc, ", ".join(s[0] for s in steps[:step]) or "nothing in the files",
               ", then ".join(s[1] for s in steps[step:]))
        )
        raise SystemExit(1)
    print("migrate: wrote %s as the last write" % MIGRATE_MARKER_LINE)


def cmd_migrate(args, repo_root):
    if repo_root is None:
        sys.stderr.write("REFUSED: queue migrate could not find a repo root (no .git ancestor)\n")
        raise SystemExit(3)
    if args.max_writes < 0:
        _migrate_refuse("--max-writes must not be negative")
    plan = _migrate_preflight(repo_root, args.max_writes, args.legacy)
    _migrate_print_plan(plan, args.dry_run)
    if args.dry_run:
        made = "%d gh write(s)" % plan["planned_writes"]
        if plan["adopt"]:
            made += " and %d git push(es)" % plan["pushes_planned"]
            print("migrate --dry-run: no gh write, no push and no file in the working tree was written; the pre-flight "
                  "git fetch updated only remote-tracking refs and FETCH_HEAD (%s would be made)" % made)
        else:
            print("migrate --dry-run: nothing was written (%s would be made)" % made)
        return 0
    created = _migrate_write_issues(plan, repo_root)
    _migrate_read_back(plan, created, repo_root)
    _migrate_finish_files(plan, repo_root)
    return 0


# =============================================================================
# argparse wiring
# =============================================================================


def build_parser():
    parser = argparse.ArgumentParser(prog="queue.py", description=__doc__.split("\n\n")[0])
    parser.add_argument("--repo-root", default=None, help="repo root (default: nearest .git ancestor of cwd)")
    sub = parser.add_subparsers(dest="verb", required=True)

    p = sub.add_parser("stub", help="file a new plan issue")
    p.add_argument("--id", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--intent", required=True)
    p.add_argument("--touches", action="append")
    p.add_argument("--evidence", action="append")
    p.add_argument("--priority", type=int, choices=sorted(PRIORITY_LABEL_BY_NUMBER), default=DEFAULT_PRIORITY)
    p.add_argument("--successor-of", default=None)

    p = sub.add_parser("research", help="write research, Touches and Evidence required on a plan issue")
    p.add_argument("issue", type=int)
    p.add_argument("--local", default=None)
    p.add_argument("--online", default=None)
    p.add_argument("--api-docs", default=None)
    p.add_argument("--prereq", type=int, action="append", default=None,
                    help="issue number this entry depends on (repeatable); writes Depends on: in ## Gates")
    p.add_argument("--touches", action="append", default=None, metavar="GLOB",
                    help="path or glob this entry touches (repeatable); replaces the whole ## Touches section, one '- GLOB' line each")
    p.add_argument("--evidence", action="append", default=None, metavar="TEXT",
                    help="one required evidence item (repeatable); replaces the whole ## Evidence required section as a numbered list from 1")

    p = sub.add_parser("audit-record", help="post a plan-audit verdict comment")
    p.add_argument("issue", type=int)
    p.add_argument("--verdict", required=True, choices=["APPROVED", "REVISE"])
    p.add_argument("--note", default="")

    p = sub.add_parser("accept", help="open the branch, PR, and freeze the issue")
    p.add_argument("issue", type=int)
    p.add_argument("--base", default="main")

    p = sub.add_parser("implemented", help="write Handoff and Evidence report")
    p.add_argument("pr", type=int)
    p.add_argument("--handoff", required=True)
    p.add_argument("--evidence-report", default=None)
    p.add_argument("--evidence-report-file", default=None)
    p.add_argument("--partial", action="store_true")
    p.add_argument("--split-into", type=int, default=None)

    p = sub.add_parser("ship", help="preflight (--check) or re-prove (--confirm) a merge; never merges")
    p.add_argument("pr", type=int)
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true")
    group.add_argument("--confirm", action="store_true")
    p.add_argument("--merge-body-out", default=None)
    p.add_argument("--verifier-report-out", default=None)

    p = sub.add_parser("gate-pass", help="judge a PR's PASS review with main's own tools/queue, then post the verifier-gate status on its head")
    p.add_argument("pr", type=int)

    p = sub.add_parser("block")
    p.add_argument("number", type=int)
    p.add_argument("reason")
    p.add_argument("--pr", action="store_true")

    p = sub.add_parser("unblock")
    p.add_argument("number", type=int)
    p.add_argument("--pr", action="store_true")

    p = sub.add_parser("retire")
    p.add_argument("issue", type=int)

    p = sub.add_parser("retire-pr")
    p.add_argument("pr", type=int)

    p = sub.add_parser("log")
    p.add_argument("number", type=int)
    p.add_argument("text")
    p.add_argument("--pr", action="store_true")

    p = sub.add_parser("status")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("list")
    p.add_argument("--json", action="store_true")

    p = sub.add_parser("lint")
    p.add_argument("--offline", action="store_true")

    sub.add_parser("order")
    sub.add_parser("doctor")
    p = sub.add_parser("init", help="create the label set and check the repo; --print-ruleset prints the ruleset")
    p.add_argument("--print-ruleset", action="store_true",
                    help="print plan section 7's ruleset JSON, then the release ruleset JSON, each with the owner's "
                         "command to apply it; writes nothing")
    p = sub.add_parser("migrate", help="one-time cutover: plans/queue.yaml entries become plan issues, then the marker")
    p.add_argument("--dry-run", action="store_true",
                    help="run every pre-flight check and print the plan; no gh write, no push and no file write "
                         "(a claimed entry's branch is read with one git fetch that updates only "
                         "remote-tracking refs and FETCH_HEAD)")
    p.add_argument("--legacy", action="store_true",
                    help="map a queue in its own vocabulary (depends_on, why, pending, in_progress) onto the standard "
                         "fields; every key with no destination is kept verbatim in one Legacy fields comment per entry")
    p.add_argument("--max-writes", type=int, default=MIGRATE_DEFAULT_MAX_WRITES,
                    help="refuse, before the first write, when more than N gh writes are planned (default %d)"
                    % MIGRATE_DEFAULT_MAX_WRITES)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve() if args.repo_root else find_repo_root(Path.cwd())
    enforce_tripwire(repo_root, args.verb)

    try:
        if args.verb == "stub":
            return cmd_stub(args, repo_root)
        if args.verb == "research":
            return cmd_research(args, repo_root)
        if args.verb == "audit-record":
            return cmd_audit_record(args, repo_root)
        if args.verb == "accept":
            return cmd_accept(args, repo_root)
        if args.verb == "implemented":
            return cmd_implemented(args, repo_root)
        if args.verb == "ship":
            if args.check:
                return cmd_ship_check(args, repo_root)
            return cmd_ship_confirm(args, repo_root)
        if args.verb == "gate-pass":
            return cmd_gate_pass(args, repo_root)
        if args.verb == "block":
            return cmd_block(args, repo_root)
        if args.verb == "unblock":
            return cmd_unblock(args, repo_root)
        if args.verb == "retire":
            return cmd_retire(args, repo_root)
        if args.verb == "retire-pr":
            return cmd_retire_pr(args, repo_root)
        if args.verb == "log":
            return cmd_log(args, repo_root)
        if args.verb == "status":
            return cmd_status(args, repo_root)
        if args.verb == "list":
            return cmd_list(args, repo_root)
        if args.verb == "lint":
            return cmd_lint(args, repo_root)
        if args.verb == "order":
            return cmd_order(args, repo_root)
        if args.verb == "doctor":
            return cmd_doctor(args, repo_root)
        if args.verb == "init":
            return cmd_init(args, repo_root)
        if args.verb == "migrate":
            return cmd_migrate(args, repo_root)
    except (GhError, GitError) as exc:
        sys.stderr.write("%s\n" % exc)
        return 1

    parser.error("unknown verb %r" % (args.verb,))
    return 2


if __name__ == "__main__":
    sys.exit(main())
