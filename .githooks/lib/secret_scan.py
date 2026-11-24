#!/usr/bin/env python3
"""pre-commit: refuse a commit that stages a secret, or lands directly on
the default branch.

Two guards, one file, both read from the index, never the working tree.
Every check here reads what is actually staged (`git show :<path>`, and
`git diff --cached` for the file list), not the file as it currently sits
on disk. A working-tree scan has a real gap: stage a secret, then edit it
back out of the file without re-staging, and a working-tree scan reports a
clean pass on exactly the content that is about to be committed. Reading
the index closes that gap by construction.

What counts as a secret here: a handful of shapes, deliberately narrow rather
than exhaustive -- a scanner that flags everything trains people to ignore it:

  1. A private key block (`-----BEGIN ... PRIVATE KEY-----`).
  2. An AWS-shaped access key ID (`AKIA`/`ASIA` + 16 more characters).
  3. A GitHub-shaped token (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_` or
     `github_pat_` prefix).
  4. A generic `secret =` / `password =` / `api_key =` / `token =`
     assignment whose value is a long literal (12+ characters) -- short or
     obviously-placeholder values ("changeme", a 4-character stub) are
     exactly the ones a real secret never looks like, so the length floor
     is what keeps this from firing on every config file. The keyword may
     sit inside a longer variable name on either side (`ANTHROPIC_API_KEY`,
     `DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `token_file`): underscore is a
     word character, so a leading `\\b` used to hide every one of them.
     A value that is a call or an index (`os.environ.get(...)`,
     `cfg.token[...]`) is code, not a literal, and is not flagged; neither
     is a shell/CI reference (`$VAR`, `${{ secrets.X }}`) or a `<placeholder>`,
     none of which start with a value character.
  5. An Anthropic API key (`sk-ant-` + a long token).
  6. An OpenAI-style key (`sk-` or `sk-proj-` + 20 or more token
     characters). A bare kebab-case word that starts `sk-` and runs past 20
     characters would match too -- the cost of not demanding a digit, which
     a real key all but always has but a fixture or example may not.
  7. A Slack token (`xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-`).
  8. A bearer JWT (`Bearer eyJ...` with three base64url segments), as in an
     `Authorization: Bearer <jwt>` header.

Known limitation, stated rather than hidden: the generic-assignment
pattern matches on shape, not on entropy, so a sufficiently long
non-secret literal next to one of those words can still trip it. That is
an acceptable false positive rate for a scanner whose job is to make you
look twice, not a promise that everything it flags is a real secret -- or
that everything it doesn't flag is safe.

Default-branch guard: a direct commit to the repository's default branch
is refused unless ALLOW_MAIN_COMMIT=1 is set for that one commit. Commits
to a shared default branch normally arrive through a reviewed merge; a
direct commit skips that review by construction, for a human or an agent
equally. This is a git hook, not a server-side rule -- `--no-verify`
bypasses it, same as it bypasses everything else here. The durable
backstop is a server-side ruleset (see docs/why/ and the repo's setup
script); this hook catches the common, unintentional case cheaply on
every machine that has it installed.

This hook fails open: any exception this file doesn't explicitly turn
into a refusal is swallowed, and the commit proceeds. A secret scanner
that crashes closed blocks every commit in the repo, for everyone, until
someone notices and fixes it by hand -- worse than occasionally missing a
secret it would
otherwise have caught.
"""
import os
import re
import subprocess
import sys

MIN_SECRET_LEN = 12

PATTERNS = [
    ("private key block", re.compile(
        r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("AWS access key ID", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    # An installation token may also be `ghs_<app id>_<JWT>`, ~520 characters
    # with `_`, `-` and `.` in it, which the 36-alphanumeric shape misses.
    ("GitHub token", re.compile(
        r"\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b"
        r"|\bghs_[A-Za-z0-9]+_eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"
        r"\.[A-Za-z0-9_\-]+")),
    # No `\b` on either side of the keyword: `_` is a word character, so
    # `\bapi_key\b` could never match inside `ANTHROPIC_API_KEY=` and every
    # prefixed or suffixed variable name slipped through. `[A-Za-z0-9_]*`
    # after the keyword lets `TOKEN_FILE`/`secrets` stand in the name.
    # The value must END its run of value characters at a non-call: the
    # lookahead is what rejects `os.environ.get(...)` (the backtracking
    # alternative, a shorter run, is rejected too because the next char
    # would then be a value character).
    ("generic secret assignment", re.compile(
        r"(?i)(?:secret|password|passwd|api[_-]?key|token)[A-Za-z0-9_]*"
        r"\s*[:=]\s*"
        r"[\"']?[A-Za-z0-9/+_.\-]{%d,}(?![A-Za-z0-9/+_.\-(\[])[\"']?"
        % MIN_SECRET_LEN)),
    ("Anthropic API key", re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{20,}")),
    ("OpenAI-style API key", re.compile(
        r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9\-]{10,}")),
    ("bearer JWT", re.compile(
        r"(?i)\bbearer\s+eyJ[A-Za-z0-9_\-]{5,}\.[A-Za-z0-9_\-]{5,}"
        r"\.[A-Za-z0-9_\-]{5,}")),
]


def _git_bytes(cwd, args):
    try:
        r = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, timeout=10)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def _git_text(cwd, args):
    out = _git_bytes(cwd, args)
    if out is None:
        return None
    return out.decode("utf-8", errors="replace").strip()


def staged_files(cwd):
    """Paths staged for this commit -- added, copied, modified, or renamed.

    Deliberately excludes pure deletions: a file being removed can't stage
    a NEW secret, and scanning it would just fail to read a path that no
    longer exists in the index.

    Read with `-z` and split on NUL, never on newlines: with git's default
    core.quotePath, a path holding a non-ASCII character comes back
    C-quoted ("src/caf\\303\\251.py"), `git show :<that>` then fails, and
    the file is skipped in silence -- a secret in a file with an accented
    name committed clean while the scanner reported a pass.
    """
    out = _git_bytes(
        cwd, ["diff", "--cached", "-z", "--name-only", "--diff-filter=ACMR"])
    if out is None:
        return []
    return [p.decode("utf-8", errors="surrogateescape")
            for p in out.split(b"\x00") if p]


def find_secrets(cwd):
    """Scan the INDEX version of every staged file. Returns a list of
    (path, line_number, reason) for each match; empty if none."""
    violations = []
    for path in staged_files(cwd):
        content = _git_bytes(cwd, ["show", ":" + path])
        if content is None:
            # A staged path the scanner cannot read is reported, not
            # skipped: a silent skip is indistinguishable from a clean
            # file, which is how an unreadable path became a free pass.
            violations.append((path, 0, "staged file could not be read from the index"))
            continue
        if b"\x00" in content:
            continue  # binary -- never scanned
        text = content.decode("utf-8", errors="replace")
        for lineno, line in enumerate(text.splitlines(), start=1):
            for name, pattern in PATTERNS:
                if pattern.search(line):
                    violations.append((path, lineno, name))
                    break
    return violations


def current_branch(cwd):
    """Return the current branch name, or None on a detached HEAD or git failure."""
    return _git_text(cwd, ["symbolic-ref", "--short", "HEAD"])


def default_branch(cwd):
    """Best-effort name of the repository's default branch. See
    git_guard.py's identical helper for the same reasoning -- duplicated
    here on purpose: this file must run standalone via .githooks, without
    depending on anything under .claude/."""
    ref = _git_text(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"])
    if ref:
        return ref.rsplit("/", 1)[-1]
    for candidate in ("main", "master"):
        if _git_text(cwd, ["rev-parse", "--verify", "--quiet", candidate]) is not None:
            return candidate
    return "main"


def is_default_branch_commit_blocked(cwd, env=None):
    """Return True if this commit would land directly on the default branch.

    Args:
        cwd: Repository root to inspect.
        env: Environment mapping to read; defaults to `os.environ`.
            `ALLOW_MAIN_COMMIT=1` lifts the block, and a detached HEAD is
            never blocked.
    """
    env = os.environ if env is None else env
    if env.get("ALLOW_MAIN_COMMIT") == "1":
        return False
    branch = current_branch(cwd)
    if not branch:
        return False  # detached HEAD is not "the default branch"
    return branch == default_branch(cwd)


def main():
    """Run the pre-commit checks for the repository in the current directory.

    Exits 1 after writing the reason to stderr when the commit targets the
    default branch or stages a possible secret. Exits 0 otherwise,
    including on any unexpected error (fails open).
    """
    try:
        cwd = os.getcwd()  # git runs pre-commit with cwd at the repo root

        if is_default_branch_commit_blocked(cwd):
            branch = current_branch(cwd)
            sys.stderr.write(
                "BLOCKED: direct commit to '%s', this repo's default "
                "branch.\n\n"
                "Commits to the default branch normally arrive through a "
                "reviewed merge, not a direct commit -- that is what keeps "
                "a shared main line from acquiring commits nobody looked "
                "at. If this commit genuinely needs to land directly "
                "(initial repo setup, an emergency fix with no other "
                "reviewer available), say so for this one commit:\n"
                "  ALLOW_MAIN_COMMIT=1 git commit ...\n" % branch)
            sys.exit(1)

        violations = find_secrets(cwd)
        if violations:
            sys.stderr.write("BLOCKED: possible secret(s) staged for commit.\n\n")
            for path, lineno, reason in violations:
                sys.stderr.write("  %s:%d  %s\n" % (path, lineno, reason))
            sys.stderr.write(
                "\nThese are read from the INDEX (git show :path), not the "
                "working tree -- editing the file after staging it does "
                "not clear this warning. Unstage and remove the secret:\n"
                "  git restore --staged <file>\n"
                "If it already landed in history, it needs to be rewritten "
                "out, not just removed from the tip -- that is a "
                "repo-owner decision, not a hook's.\n")
            sys.exit(1)
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)  # fail open: a crash here must never block every commit

    sys.exit(0)


if __name__ == "__main__":
    main()
