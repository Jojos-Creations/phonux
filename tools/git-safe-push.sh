#!/usr/bin/env bash
# Push a branch and PROVE the commits arrived. Refuses the failure modes
# recorded in docs/why/shared-tree.md, where every incident below reported
# success.
#
# WHY THIS EXISTS
# ---------------
# A repo worked on by several agents and a human at once has HEAD moving
# between one command and the next.
#
#   - A push that succeeded and carried nothing. Four commits were made and
#     `git push origin main` reported success each time. None reached
#     origin: another agent had checked out its own branch in the shared
#     checkout, so the commits landed there, and the push shipped an
#     unchanged `main` ref. The push genuinely succeeded --
#     `git push origin <name>` pushes the local ref named `<name>`, not what
#     you are standing on.
#   - A build from a tree someone moved mid-build. A build was made after
#     confirming the source tree was on the expected branch at a known
#     commit. Another agent checked out its own branch during the build
#     window. The result failed in a way that looked like a real bug; about
#     twenty minutes went into diagnosing code that was not actually
#     running.
#
# Full detail -- including a third incident on why ancestry alone is not
# enough proof, and how a shared index or a shared file can contaminate a
# commit even when the branch check above passes -- lives in
# docs/why/shared-tree.md.
#
# WHAT IT ENFORCES
#   - You are on the branch you think you are on.
#   - The working tree has no unstaged changes to tracked files.
#   - Every submodule pointer being shipped points at a commit that is
#     actually pushed. A pointer to an unpushed commit produces a repo
#     nobody else can clone.
#   - After pushing, the commit is genuinely an ancestor of the remote branch.
#     "Push succeeded" is not evidence; ancestry is.
#
# USAGE
#     tools/git-safe-push.sh                # push current branch to same name
#     tools/git-safe-push.sh --to main      # push current branch to main
#     tools/git-safe-push.sh --expect main  # additionally require HEAD == main
#     tools/git-safe-push.sh --help         # print this usage and exit 0
#
# EXIT CODES
#     0  pushed, and the pushed commit is on origin/<target>
#     1  refused (detached HEAD, wrong branch, unstaged changes, an unverifiable
#        submodule pointer) or the push did not land
#     2  bad command line

set -euo pipefail

usage() {
  cat <<'USAGE'
usage: tools/git-safe-push.sh [--to BRANCH] [--expect BRANCH]
       tools/git-safe-push.sh --help

Push the current branch and prove the commit is on origin.

  --to BRANCH      push to origin/BRANCH instead of the same name
  --expect BRANCH  refuse unless HEAD is on BRANCH (guards against a moved tree)
  -h, --help       print this usage and exit 0

Exit 0: pushed and proved. Exit 1: refused, or the push did not land.
Exit 2: bad command line.
USAGE
}

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TARGET=""
EXPECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --to|--expect)
      # A branch name cannot start with "-", so a following flag means the
      # value was left off; without this `--to --expect main` would push to a
      # branch named "--expect".
      if [[ $# -lt 2 || -z "$2" || "$2" == -* ]]; then
        echo "error: $1 needs a branch name (e.g. $1 main)" >&2
        exit 2
      fi
      if [[ "$1" == "--to" ]]; then TARGET="$2"; else EXPECT="$2"; fi
      shift 2 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

CURRENT="$(git branch --show-current || true)"
if [[ -z "$CURRENT" ]]; then
  echo "refusing: HEAD is detached. Check out a branch first." >&2
  exit 1
fi
TARGET="${TARGET:-$CURRENT}"

if [[ -n "$EXPECT" && "$CURRENT" != "$EXPECT" ]]; then
  echo "refusing: expected to be on '$EXPECT' but HEAD is on '$CURRENT'." >&2
  echo "         This is the tree-moved-under-you failure mode described in" >&2
  echo "         docs/why/shared-tree.md -- another agent very likely moved" >&2
  echo "         the tree. Do not push; reconcile first." >&2
  exit 1
fi

# Unstaged changes to tracked files mean the commit does not describe the tree
# you are looking at. Untracked files are fine -- agents leave scratch behind.
# Submodule gitlinks are deliberately excluded: agents routinely leave a
# submodule checked out on a feature branch, which shows as a modified
# gitlink but says nothing about the pointer this push would ship. The
# pointer check below is the precise one.
if ! git diff --ignore-submodules=all --quiet; then
  echo "refusing: unstaged changes to tracked files:" >&2
  git diff --ignore-submodules=all --name-only | sed 's/^/         /' >&2
  exit 1
fi

# Submodule pointers: whatever this commit ships must exist on a remote.
#
# This loop was inert from the day it was written until 2026-09-02, and being
# inert is indistinguishable from being satisfied: it never printed a word.
# Two independent reasons. It read `git ls-tree HEAD`, which is NOT recursive,
# so it saw `submodules` as one tree and never the gitlinks at depth two --
# the mode test matched nothing and the body never ran at all. And the body
# skipped any submodule that was not checked out, which is precisely the shape
# a pointer bump takes here: `git update-index --cacheinfo` in a worktree whose
# submodule directories are empty. The guard was blind in exactly the situation
# it was written for. A pointer that cannot be checked is now a refusal, never
# a skip -- an unverified pointer is not a verified one.
FAILED=0
MODULES_ROOT="$(cd "$(git rev-parse --git-common-dir)" && pwd)/modules"
while read -r mode _ sha path; do
  [[ "$mode" == "160000" ]] || continue
  # The invariant is about the pointer being SHIPPED, not about where the
  # working checkout happens to be. A submodule parked on a feature branch is
  # normal here. What is never acceptable is recording a pointer to a commit
  # that is not on any remote -- that produces a repo nobody else can clone.
  if [[ -d "$path/.git" || -f "$path/.git" ]]; then
    # A failed fetch leaves the remote-tracking refs as they were, so the check
    # below would pass on stale data: it is a refusal, not a skip.
    if ! FETCH_ERR="$(git -C "$path" fetch -q origin 2>&1)"; then
      echo "refusing: $path pointer ${sha:0:8} CANNOT BE VERIFIED -- fetching the" >&2
      echo "         submodule's origin failed, so its remote branches may be stale:" >&2
      printf '%s\n' "$FETCH_ERR" | sed 's/^/         /' >&2
      FAILED=1
      continue
    fi
    if ! git -C "$path" branch -r --contains "$sha" 2>/dev/null | grep -q .; then
      echo "refusing: $path pointer ${sha:0:8} is not on any remote branch." >&2
      echo "         A pointer to an unpushed commit produces an unclonable repo." >&2
      FAILED=1
    fi
    continue
  fi
  # Not checked out. The pointer ships regardless of whether anyone bothered to
  # populate the working directory, so it is verified against the submodule's
  # object database, which the superproject keeps under modules/ even when the
  # directory is empty.
  MODULE_DIR="$MODULES_ROOT/$path"
  if [[ ! -d "$MODULE_DIR" ]]; then
    echo "refusing: $path pointer ${sha:0:8} CANNOT BE VERIFIED -- the submodule" >&2
    echo "         is not checked out and there is no object database at" >&2
    echo "         $MODULE_DIR." >&2
    echo "         Run: git submodule update --init $path" >&2
    FAILED=1
    continue
  fi
  if ! FETCH_ERR="$(git --git-dir="$MODULE_DIR" fetch -q origin 2>&1)"; then
    echo "refusing: $path pointer ${sha:0:8} CANNOT BE VERIFIED -- fetching" >&2
    echo "         origin into $MODULE_DIR failed, so its remote branches may be stale:" >&2
    printf '%s\n' "$FETCH_ERR" | sed 's/^/         /' >&2
    FAILED=1
    continue
  fi
  if ! git --git-dir="$MODULE_DIR" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "refusing: $path pointer ${sha:0:8} CANNOT BE VERIFIED -- that commit is" >&2
    echo "         not in $MODULE_DIR," >&2
    echo "         so nothing here can say whether it was ever pushed." >&2
    FAILED=1
    continue
  fi
  if ! git --git-dir="$MODULE_DIR" branch -r --contains "$sha" 2>/dev/null | grep -q .; then
    echo "refusing: $path pointer ${sha:0:8} is not on any remote branch." >&2
    echo "         A pointer to an unpushed commit produces an unclonable repo." >&2
    FAILED=1
  fi
done < <(git ls-tree -r HEAD)
[[ "$FAILED" -eq 0 ]] || exit 1

HEAD_SHA="$(git rev-parse HEAD)"
echo "pushing $CURRENT -> origin/$TARGET  (${HEAD_SHA:0:8})"
# Push the captured SHA, not HEAD: HEAD can move between the line above and
# the push, and the proof below is about HEAD_SHA.
git push origin "$HEAD_SHA:refs/heads/$TARGET"

# Assert the EFFECT, not the exit code: the push-that-carried-nothing incident
# above reported success. The fetch names the target branch explicitly --
# a bare `git fetch origin` follows the remote's configured refspec, and in a
# single-branch clone that never updates origin/$TARGET for any other branch,
# so the check below would read a stale or missing ref.
git fetch -q origin "+refs/heads/$TARGET:refs/remotes/origin/$TARGET"
if git merge-base --is-ancestor "$HEAD_SHA" "origin/$TARGET"; then
  echo "verified: ${HEAD_SHA:0:8} is on origin/$TARGET"
else
  echo "FAILED: push reported success but ${HEAD_SHA:0:8} is NOT on origin/$TARGET." >&2
  echo "        Do not trust the push. Investigate before doing anything else." >&2
  exit 1
fi
