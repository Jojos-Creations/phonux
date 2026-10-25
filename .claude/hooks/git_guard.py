#!/usr/bin/env python3
"""PreToolUse (Bash): the git rules that keep a shared checkout sane.

Several agents, and a human, can be working in the same clone at once. None
of the four things this hook denies are style preferences -- each is a git
command that runs cleanly, exits 0, and does something other than what it
looks like it does to whoever reads the transcript afterward.

  1. `git push origin <name>` with no explicit refspec. This does not push
     what HEAD points at -- it pushes the local ref NAMED <name>. If HEAD is
     on a different branch, which is common when several agents share a
     tree, this ships a STALE ref and still exits 0. A real incident did
     exactly that, twice in one day, reporting success both times. Anything
     with an explicit refspec (a ":" in it) or `--dry-run` is unaffected --
     the ambiguity is what gets denied, not the push itself. The remote is
     whatever the first non-flag token is, not a list of known names: a
     remote called `fork` ships the same stale ref as one called `origin`.

  2. `git checkout` / `git switch` (bare, `-b`, or `-c`) while the tree has
     uncommitted changes to tracked files. This carries someone else's
     work-in-progress onto the branch you're moving to and moves HEAD out
     from under them mid-task. `git checkout -- <path>` (restoring a file,
     not moving a branch) is exempted -- see the regex comment below.

     `git worktree add` is deliberately NOT gated on dirtiness: a worktree
     checked out to a path outside the repo never touches the current
     tree's index, and it is the PRESCRIBED FIX for this very rule. Gating
     it on the condition it exists to solve would deny the fix the denial
     message itself recommends. It has its own rule (3) instead.

  3. `git worktree add` whose target resolves INSIDE the current repo. Not
     a dirtiness problem -- a nested worktree breaks anything watching the
     outer tree (a dev server, a file watcher), and removing it later
     leaves whatever was working in it unable to resume. Outside the repo
     it is always allowed, dirty tree or not.

  4. Any wildcard `git add`: `-A`, `--all`, `-u`, `--update`, `.`, `./`,
     `:/` or `*`. A pathspec on `add` only
     scopes what gets STAGED -- `git commit` with no pathspec of its own
     still commits the WHOLE index. In a tree several agents share, a
     wildcard add silently pulls in whatever anyone else staged too. One
     real incident put an unrelated piece of in-progress work inside a
     commit meant to touch a single file.

  5. `git push --force` / `-f` to the repository's default branch. There is
     no un-force-push, and a stale local branch forced onto the shared
     default branch can discard commits a sibling agent or the human is
     already depending on. `--force-with-lease` is NOT blocked here -- it
     already refuses when the remote has moved since your last fetch, which
     is exactly the protection a bare `--force` skips.

Every denial explains the safe alternative in the same message.

This hook FAILS OPEN: any exception in here is treated as "nothing to say",
never as a denial. A guard that crashes closed stops every agent in the repo
dead, which is worse than the mistake it exists to catch.

Text that only APPEARS in a command -- a heredoc body, a commit message, an
echoed string -- is not something the shell will run. Every check below
runs against `invocations_only(command)`, not the raw string; see
shell_text.py for why and its documented limits.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shell_text import invocations_only  # noqa: E402

GIT_PUSH = re.compile(
    r"\bgit\s+(?:-C\s+(?P<cdir>\S+)\s+)?push\b(?P<rest>[^|;&\n]*)")

# The `-- <path>` file-restore form is exempted, but only when the `--`
# belongs to THIS checkout/switch invocation: `rest` stops at the first
# `|`, `;` or `&`, so a later command's `--` (for instance the
# `git commit --only -- <paths>` this repo's own rules prescribe) can no
# longer disable the dirty-tree guard for a `git checkout -b` before it.
GIT_CHECKOUT_SWITCH = re.compile(
    r"\bgit\s+(?:-C\s+(?P<cdir>\S+)\s+)?(?:checkout|switch)\b"
    r"(?P<rest>[^|;&\n]*)")

GIT_WORKTREE_ADD = re.compile(
    r"\bgit\s+(?:-C\s+(?P<cdir>\S+)\s+)?worktree\s+add\b(?P<rest>[^|;&\n]*)")
GIT_ADD = re.compile(
    r"\bgit\s+(?:-C\s+(?P<cdir>\S+)\s+)?add\b(?P<rest>[^|;&\n]*)")

FORCE_TOKENS = ("--force", "-f")
DRY_RUN_TOKENS = ("--dry-run",)

# Every pathspec form that means "stage the wildcard", not "stage this
# file". `-u` is here because it stages every modified tracked file, which
# is the same shared-index hazard as `-A` with a smaller radius, and `:/`
# and `*` because they reach the whole tree from anywhere in it.
WILDCARD_ADD_TOKENS = {"-A", "--all", "-u", "--update", ".", "./", ":/", ":", "*"}

# Known limitation, stated rather than hidden: tokens are split on
# whitespace, so a combined short flag like `-uf` is not recognised as
# carrying `-f`. Write `--force` explicitly, or as its own token, to be
# recognised by rule 5.
_TAKES_VALUE = {
    "-b", "-B", "--reason",
    # push flags that consume the next token -- without these, their value
    # would be mistaken for the remote name.
    "-o", "--push-option", "--repo", "--exec", "--receive-pack",
}


def _git(cwd, *args):
    try:
        r = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else None
    except Exception:
        return None


def is_dirty(cwd):
    """True if `git status --porcelain` reports anything at all.

    Deliberately includes untracked files, not just modified tracked ones --
    a scratch file an agent is about to commit is still evidence the tree
    isn't in the state a HEAD-move should start from.
    """
    return bool(_git(cwd, "status", "--porcelain"))


def default_branch(cwd):
    """Best-effort name of the repository's default branch.

    Prefers the remote's advertised HEAD; falls back to whichever of
    main/master exists locally; falls back to "main" for a brand-new repo
    that has neither a remote nor a first commit yet.
    """
    ref = _git(cwd, "symbolic-ref", "refs/remotes/origin/HEAD")
    if ref:
        return ref.rsplit("/", 1)[-1]
    for candidate in ("main", "master"):
        if _git(cwd, "rev-parse", "--verify", "--quiet", candidate) is not None:
            return candidate
    return "main"


def _current_branch(cwd):
    return _git(cwd, "rev-parse", "--abbrev-ref", "HEAD")


def _repo_root(cwd):
    return _git(cwd, "rev-parse", "--show-toplevel")


def _branch_from_ref(ref):
    """Extract a branch name from a push ref/refspec.

    Strips only a leading "refs/heads/" -- NOT the last "/"-segment, which
    would mangle a branch name that itself contains a slash (e.g.
    "feature/x" must stay "feature/x", not collapse to "x").
    """
    dst = ref.split(":")[-1] or ref.split(":")[0]
    if dst.startswith("refs/heads/"):
        return dst[len("refs/heads/"):]
    return dst


def _tokens(rest):
    """Split an argument span into tokens, dropping shell grouping characters.

    `(cd docs && git add -A)` and `$(git add -A)` both really run the add,
    but leave the closing paren fused to the last token; without stripping
    it, `-A)` is not `-A` and the rule silently does not fire.
    """
    return [t.strip("()") for t in rest.split() if t.strip("()")]


def _effective_cwd(cwd, cdir):
    """The directory a `git -C <dir> ...` invocation actually operates on.

    Every rule below asks git about a tree (is it dirty, where is its root).
    Without this, `git -C /elsewhere checkout -b x` was judged against THIS
    repo: denied for a dirtiness that is not there, and blind to the one
    that is.
    """
    if not cdir:
        return cwd
    return os.path.join(cwd, os.path.expanduser(cdir.strip("\"'")))


def _remote_and_ref(tokens):
    """Walk flag-aware tokens; return (remote, ref) -- either may be None.

    The first non-flag token is the remote, whatever it is called: git's own
    grammar, not a list of names. An earlier version recognised only
    "origin" and "upstream", so `git push fork main` -- a stale-ref push
    exactly like the one rule 1 exists to stop -- was allowed in silence.
    """
    remote = None
    ref = None
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in _TAKES_VALUE:
            i += 2
            continue
        if t.startswith("-"):
            i += 1
            continue
        if remote is None:
            remote = t
            i += 1
            continue
        ref = t
        break
    return remote, ref


def check_push_bare_ref(command):
    """Rule 1: deny `git push origin <name>` with no explicit refspec."""
    for m in GIT_PUSH.finditer(command):
        tokens = _tokens(m.group("rest"))
        if any(t in DRY_RUN_TOKENS for t in tokens):
            continue
        remote, ref = _remote_and_ref(tokens)
        if remote and ref and ":" not in ref:
            return (
                f"BLOCKED: `git push {remote} {ref}` has no explicit refspec, "
                f"so it pushes the local ref NAMED '{ref}' -- not necessarily "
                f"the commit HEAD is standing on. If HEAD is on a different "
                f"branch, this ships a stale ref and still exits 0; a real "
                f"incident did exactly that twice in one day, reporting "
                f"success both times.\n\n"
                f"Use an explicit refspec, then prove it landed:\n"
                f"  git push {remote} HEAD:refs/heads/{ref}\n"
                f"  git fetch -q {remote} && "
                f"git merge-base --is-ancestor HEAD {remote}/{ref}\n\n"
                f"Or use the safe-push script, which does both (global copy, or "
                f"the repo's own):\n"
                f"  ~/.claude/tools/git-safe-push.sh --expect {ref} --to {ref}\n"
                f"  tools/git-safe-push.sh --expect {ref} --to {ref}"
            )
    return None


def check_force_push_default_branch(command, cwd):
    """Rule 5: deny `git push --force`/`-f` targeting the default branch."""
    for m in GIT_PUSH.finditer(command):
        tokens = _tokens(m.group("rest"))
        if any(t in DRY_RUN_TOKENS for t in tokens):
            continue
        if not any(t in FORCE_TOKENS for t in tokens):
            continue
        target_cwd = _effective_cwd(cwd, m.group("cdir"))
        remote, ref = _remote_and_ref(tokens)
        if ref:
            branch = _branch_from_ref(ref)
        else:
            branch = _current_branch(target_cwd)
        default = default_branch(target_cwd)
        if branch and default and branch == default:
            return (
                f"BLOCKED: force push to '{branch}', this repository's "
                f"default branch.\n\n"
                f"There is no un-force-push, and a stale local branch "
                f"forced onto the shared default branch can discard "
                f"commits a sibling agent or the human maintainer is "
                f"already depending on.\n\n"
                f"If you need the remote-hasn't-moved check without the "
                f"blast radius, use `--force-with-lease` instead. If the "
                f"default branch genuinely needs history rewritten, that "
                f"is the repo owner's call, not an agent's."
            )
    return None


def check_dirty_branch_move(command, cwd):
    """Rule 2: deny checkout/switch while tracked files are uncommitted."""
    for m in GIT_CHECKOUT_SWITCH.finditer(command):
        if "--" in _tokens(m.group("rest")):
            continue  # `git checkout -- <path>`: restores a file, never moves HEAD
        target_cwd = _effective_cwd(cwd, m.group("cdir"))
        root = _repo_root(target_cwd)
        if not root:
            continue
        if not is_dirty(target_cwd):
            continue
        return _dirty_move_reason(root)
    return None


def _dirty_move_reason(root):
    return (
        "BLOCKED: this moves HEAD while the tree has uncommitted changes.\n\n"
        f"  repo: {root}\n\n"
        "In a checkout several agents (or an agent and a human) share, "
        "uncommitted changes are very likely someone else's work in "
        "progress. Checking out or switching branches carries them onto "
        "the branch you're moving to and moves HEAD out from under them "
        "mid-task.\n\n"
        "Commit or stash your own changes first. If the changes are not "
        "yours to touch, work in an isolated worktree outside this repo "
        "instead -- this does not require a clean tree:\n"
        "  git worktree add /path/outside/this/repo/wt-<name> -b <branch> <base>"
    )


def check_worktree_add_inside_repo(command, cwd):
    """Rule 3: deny `git worktree add` whose target is inside this repo."""
    m = GIT_WORKTREE_ADD.search(command)
    if not m:
        return None
    cwd = _effective_cwd(cwd, m.group("cdir"))
    root = _repo_root(cwd)
    if not root:
        return None
    tokens = _tokens(m.group("rest"))
    target = None
    i = 0
    while i < len(tokens):
        if tokens[i] in _TAKES_VALUE:
            i += 2
            continue
        if tokens[i].startswith("-"):
            i += 1
            continue
        target = tokens[i]
        break
    if not target or "$" in target or "`" in target:
        # An unresolved variable or command substitution -- do not guess.
        # Guessing wrong here would deny a legitimate worktree, which is the
        # exact failure this rule exists to avoid causing.
        return None
    target = target.strip("\"'")
    # realpath, not abspath: on macOS /tmp and /var are themselves symlinks
    # into /private, and `git rev-parse --show-toplevel` returns the
    # resolved path. Comparing an unresolved cwd-relative path against that
    # would falsely report "outside" for a target that is actually inside.
    abs_root = os.path.realpath(root)
    abs_target = os.path.realpath(os.path.join(cwd, os.path.expanduser(target)))
    if abs_target == abs_root or abs_target.startswith(abs_root + os.sep):
        return (
            f"BLOCKED: worktree target is inside the repo.\n\n"
            f"  repo  : {abs_root}\n"
            f"  target: {abs_target}\n\n"
            "A worktree nested inside the repo breaks anything watching "
            "the outer tree (a dev server, a file watcher), and removing "
            "it later leaves whatever was working in it unable to resume. "
            "Put it outside the repo instead:\n"
            "  git worktree add /path/outside/this/repo/wt-<name> -b <branch> <base>"
        )
    return None


def check_add_all(command):
    """Rule 4: deny every wildcard `git add` form -- see WILDCARD_ADD_TOKENS."""
    for m in GIT_ADD.finditer(command):
        tokens = [t.strip("\"'") for t in _tokens(m.group("rest"))]
        if any(t in WILDCARD_ADD_TOKENS for t in tokens):
            return (
                "BLOCKED: wildcard `git add` stages the whole working tree, "
                "not just what you changed. Every one of `-A`, `--all`, "
                "`-u`, `--update`, `.`, `./`, `:/` and `*` is this same "
                "form -- reaching for another of them is not the fix.\n\n"
                "A pathspec on `add` only scopes what gets STAGED -- `git "
                "commit` with no pathspec of its own still commits the "
                "WHOLE index. In a tree several agents share, that "
                "silently pulls in whatever anyone else staged too; one "
                "real incident put an unrelated piece of in-progress work "
                "inside a commit meant to touch a single file. Stage "
                "explicit paths instead:\n"
                "  git add path/to/file.py another/file.py\n"
                "  git commit --only -- path/to/file.py another/file.py"
            )
    return None


def check(command, cwd):
    """Run every rule in order; return the first denial reason, or None."""
    command = invocations_only(command)
    if "git" not in command:
        return None
    for fn in (
        lambda: check_push_bare_ref(command),
        lambda: check_force_push_default_branch(command, cwd),
        lambda: check_dirty_branch_move(command, cwd),
        lambda: check_worktree_add_inside_repo(command, cwd),
        lambda: check_add_all(command),
    ):
        reason = fn()
        if reason:
            return reason
    return None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # malformed payload: never block on it

    try:
        command = (payload.get("tool_input") or {}).get("command", "")
        if not command:
            sys.exit(0)
        cwd = (
            payload.get("cwd")
            or (payload.get("tool_input") or {}).get("cwd")
            or os.getcwd()
        )
        reason = check(command, cwd)
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)  # fail open: a crash here must never block every agent

    if reason:
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        }))
    sys.exit(0)


if __name__ == "__main__":
    main()
