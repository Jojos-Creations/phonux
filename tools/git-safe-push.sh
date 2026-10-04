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

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

TARGET=""
EXPECT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --to)     TARGET="$2"; shift 2 ;;
    --expect) EXPECT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
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
    git -C "$path" fetch -q origin 2>/dev/null || true
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
  git --git-dir="$MODULE_DIR" fetch -q origin 2>/dev/null || true
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
git push origin "HEAD:refs/heads/$TARGET"

# Assert the EFFECT, not the exit code. This is the check that caught
# incidents 2 and 3 after the push had already reported success.
git fetch -q origin
if git merge-base --is-ancestor "$HEAD_SHA" "origin/$TARGET"; then
  echo "verified: ${HEAD_SHA:0:8} is on origin/$TARGET"
else
  echo "FAILED: push reported success but ${HEAD_SHA:0:8} is NOT on origin/$TARGET." >&2
  echo "        Do not trust the push. Investigate before doing anything else." >&2
  exit 1
fi
