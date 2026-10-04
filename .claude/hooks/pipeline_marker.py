#!/usr/bin/env python3
# GENERATED FILE -- DO NOT EDIT. Regenerate by running claude-config's tools/publish-template.py (see ADR 0007). Source: ~/.claude/hooks/pipeline_marker.py
"""The one local, no-network migration signal, both directions
(PLAN-2026-09-27-git-pipeline-v2.md section 5, "The pipeline marker").

A repo is on the new GitHub issues/PRs pipeline, the old `plans/queue.yaml`
pipeline, or neither. Every `queue` subcommand but `init`/`migrate`, and the
dual-mode agent specs and hooks, key off `pipeline_mode()` to pick which side
of that fork they are on; the old tools (`validate-queue.py`,
`check-done-gate.py`, `render-queue-docs.py`, `migrate-queue.py`,
`.githooks/pre-commit.queue.sh`) key off the same read to refuse when the
marker is present. Both directions must fail loud, never silently fall
through to the other pipeline's behaviour -- that is the tripwire the plan
names, and why "error" is its own mode, never folded into "none".

STDLIB ONLY, NO SUBPROCESS, NO NETWORK. This module is read by hooks on
every relevant tool call; a `git`/`gh` subprocess here would add latency and
a new way to fail open. `find_repo_root` walks the filesystem itself instead
of shelling out to `git rev-parse --show-toplevel`, and `resolve_repo_for_remote`
reads `.git/config` text directly instead of `git remote -v`.

Usable as a library (by `spawn_guard.py`, `gh_write_guard.py`, and the
`queue` tool once written) and as a CLI:

    python3 pipeline_marker.py [path]

prints the mode for the repo containing `path` (default: cwd) and exits 0,
except exit 2 when the mode is "error" -- a config that exists but cannot be
read or parses to something other than `github`/`yaml` must never be
reported as if it were silently fine.
"""

import re
import sys
from pathlib import Path

CONFIG_RELPATH = (".claude", "coordinator-config.yaml")
QUEUE_RELPATH = ("plans", "queue.yaml")

# Matches a `pipeline:` key only at column 0 -- YAML nests solely through
# indentation, so a `pipeline:` line written under another mapping key is
# indented and never matches this. That is the whole "nested key does not
# count" rule; no YAML parser is needed for one scalar key.
_TOP_LEVEL_PIPELINE_RE = re.compile(r"^pipeline\s*:\s*(.*)$")

_GITHUB_URL_PATTERNS = (
    re.compile(r"^https://github\.com/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$"),
    re.compile(r"^git@github\.com:([^/\s]+)/([^/\s]+?)(?:\.git)?$"),
    re.compile(r"^ssh://git@github\.com/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$"),
)


def find_repo_root(start):
    # type: (Path) -> "Path | None"
    """The nearest ancestor of `start` holding a `.git` entry.

    `.git` is a directory in an ordinary checkout and a FILE (`gitdir: ...`)
    in a linked worktree; either counts, and neither is read for its
    contents here -- existence alone answers "is this a repo root." No
    subprocess: `git rev-parse --show-toplevel` would work too, but costs a
    process spawn on every call site that needs this, several of them on
    every relevant tool call.

    `start` may itself be a file (including a `.git` file, so a worktree's
    OWN linked-worktree marker can be passed directly and still resolves to
    the worktree root, not the file's parent's parent).
    """
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
    """Return the raw text after `pipeline:` on a top-level line, or None
    if no such line exists. Raw text still carries quotes and any trailing
    comment; `_strip_yaml_scalar` peels those off separately so a caller
    that only needs "was the key present at all" does not need to parse the
    value first.
    """
    for line in text.splitlines():
        if line[:1] in (" ", "\t"):
            continue  # indented -- nested under some other key, never top-level
        match = _TOP_LEVEL_PIPELINE_RE.match(line)
        if match:
            return match.group(1)
    return None


def _strip_yaml_scalar(raw):
    """Peel a single-quoted, double-quoted, or bare scalar out of the text
    following a YAML `key:`, dropping a bare trailing `# comment`. Only the
    shapes the plan names are handled: `github`, `"github"`, `'github'`,
    and any of those followed by whitespace and a `#` comment.
    """
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


def pipeline_mode(repo_root):
    # type: (Path) -> str
    """"github" | "yaml" | "none" | "error", per section 5 of the plan.

    "error" is deliberately never folded into "none": a config that exists
    but is unreadable or holds an unrecognized value is a real problem the
    tripwire must surface, not a repo that simply has no marker yet.
    """
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


def _origin_owner_repo(git_config_path):
    """(owner, repo) parsed from the `[remote "origin"]` `url` line of a
    `.git/config` file, https or ssh form, or None. Reads the file
    directly -- no `git remote -v`, no network.
    """
    try:
        text = git_config_path.read_text()
    except OSError:
        return None

    in_origin = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("["):
            in_origin = stripped.lower().replace("'", '"') == '[remote "origin"]'
            continue
        if not in_origin or not stripped.startswith("url"):
            continue
        _, _, value = stripped.partition("=")
        value = value.strip()
        for pattern in _GITHUB_URL_PATTERNS:
            match = pattern.match(value)
            if match:
                return (match.group(1), match.group(2))
        return None
    return None


def resolve_repo_for_remote(owner_repo):
    # type: (str) -> "Path | None"
    """The local checkout under `~/.claude` or a direct child of `~/git`
    whose `origin` remote is `github.com/<owner>/<name>`, https or ssh, or
    None. Local file reads only: this scans a fixed, small set of known
    checkout locations rather than querying GitHub for where the repo lives.
    """
    owner, _, name = owner_repo.partition("/")
    if not name:
        return None

    home = Path.home()
    candidates = [home / ".claude"]
    git_dir = home / "git"
    if git_dir.is_dir():
        try:
            candidates.extend(sorted(p for p in git_dir.iterdir() if p.is_dir()))
        except OSError:
            pass

    for candidate in candidates:
        config_path = candidate / ".git" / "config"
        if not config_path.is_file():
            continue
        if _origin_owner_repo(config_path) == (owner, name):
            return candidate
    return None


def main(argv):
    start = Path(argv[1]) if len(argv) > 1 else Path.cwd()
    repo_root = find_repo_root(start)
    mode = pipeline_mode(repo_root) if repo_root is not None else "none"
    print(mode)
    return 2 if mode == "error" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
