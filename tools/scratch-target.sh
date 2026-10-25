#!/usr/bin/env bash
# Reference "sanctioned script" for a protected, per-tree scratch directory
# pool -- the naming convention .claude/hooks/cargo_scratch_guard.py's own
# first protected root (the cargo-scratch pool) recognizes and gives a
# stronger, identity-bound `rm` exception to. Copy and adapt; this is a
# STARTING POINT for your own build tool, not a drop-in for every stack.
#
# OWNER RULING (generalize-protected-dir-guard, 2026-09-14): this template
# ships a GENERIC version of this pattern as a reference script, rather than
# a bare config value a fork would have to reverse-engineer. It is modeled
# on a real, incident-driven, cargo-specific tool
# (cargo-scratch-target.sh -- see cargo_scratch_guard.py's own module
# docstring for the three real incidents that shaped it) but is deliberately
# NOT a verbatim copy: it makes no assumption about which build tool you
# use, or whether there is one at all. Read "WHAT THIS DOES NOT COVER" at
# the bottom before relying on this for anything beyond a starting point --
# a reference script that looks authoritative and is subtly wrong for your
# stack is worse than an absent one.
#
# USAGE
#   eval "$(tools/scratch-target.sh <label>)"
#   <your build/test command>   # now sees SCRATCH_TARGET_DIR, deleted-first
#
# <label> is your own bookkeeping (a mutant id, a branch name, a PID) and
# must be a single path-safe token: letters, digits, '.', '-', '_' only --
# not empty, not '/', not '..'.
#
# WHY THE NAME IS "<label>-<tree-hash>", NOT JUST "<label>"
# -----------------------------------------------------------
# Two checkouts of the same project run with the same label (a common
# mistake -- both could plausibly default to a branch name) must never
# resolve to the same directory. TREE_HASH is derived from THIS checkout's
# own resolved path, so the same label from two different trees lands on
# two different directories. This is also the exact naming convention a
# protected-directory guard can recognize -- see
# .claude/coordinator-config.example.yaml for what a consumer gets
# automatically from this shape versus what needs the guard's own
# sanctioned-script list extended for it.
set -euo pipefail

die() { printf 'scratch-target: REFUSING TO RUN: %s\n' "$*" >&2; exit 1; }

[ $# -eq 1 ] || die 'usage: eval "$(tools/scratch-target.sh <label>)"'
LABEL="$1"
case "$LABEL" in
  */*|''|.|..) die "label must be a single non-empty path-safe token (letters, digits, '.', '-', '_' only; not '/', '..'), got '$LABEL'" ;;
esac
case "$LABEL" in
  *[!A-Za-z0-9._-]*) die "label must contain only letters, digits, '.', '-', '_', got '$LABEL'" ;;
esac

# BASE: env-driven, generalizing the SAME loading shape
# cargo_scratch_guard.py's cargo pool already uses (CARGO_SCRATCH_ROOT
# there, SCRATCH_POOL_ROOT here, both falling back to a name under
# TMPDIR). Rename the env var here if you copy this file for a second,
# independent pool -- see the guard's own "count-only bounding" fallback
# for what a SECOND pool gets automatically (weaker than this one).
_base_too_shallow() {
  case "$1" in
    ""|"/"|"$HOME"|"$HOME/") return 0 ;;
    *) return 1 ;;
  esac
}

BASE="${SCRATCH_POOL_ROOT:-${TMPDIR:-/tmp}/scratch-pool}"
mkdir -p "$BASE" 2>/dev/null || die "cannot create pool root '$BASE' -- refusing to guess what SCRATCH_POOL_ROOT was meant to be"
BASE_REAL="$(cd "$BASE" && pwd -P)" || die "cannot resolve realpath of pool root '$BASE'"
if _base_too_shallow "$BASE_REAL"; then
  die "pool root resolves to '$BASE_REAL', too shallow to be a scratch pool -- SCRATCH_POOL_ROOT is almost certainly wrong, not this script"
fi

# TREE_HASH: derived from THIS CHECKOUT's own resolved path, not from any
# build-tool-specific project marker -- there is no single equivalent to
# call across build tools (npm workspaces, a Python venv, a monorepo
# package), and inventing a stand-in for each is out of scope -- see WHAT
# THIS DOES NOT COVER. Tries shasum/sha256sum/md5/cksum in that order so
# this works with only a POSIX-ish toolset.
TREE_REAL="$(pwd -P)"
if command -v shasum >/dev/null 2>&1; then
  TREE_HASH="$(printf '%s' "$TREE_REAL" | shasum -a 256 | cut -c1-16)"
elif command -v sha256sum >/dev/null 2>&1; then
  TREE_HASH="$(printf '%s' "$TREE_REAL" | sha256sum | cut -c1-16)"
elif command -v md5 >/dev/null 2>&1; then
  TREE_HASH="$(printf '%s' "$TREE_REAL" | md5 | cut -c1-16)"
else
  TREE_HASH="$(printf '%s' "$TREE_REAL" | cksum | tr -d ' \t' | cut -c1-16)"
fi

TARGET_DIR="$BASE_REAL/${LABEL}-${TREE_HASH}"

# Refuse rather than silently delete a suspiciously large pre-existing
# entry: SIZE is a signal this process can still check even when it cannot
# tell "wrong root, right owner" apart from "right root, right owner" from
# a caller's resolved path alone.
MAX_EXISTING_BYTES="${SCRATCH_TARGET_MAX_EXISTING_BYTES:-10737418240}"  # 10GiB; 0 disables
if [ -d "$TARGET_DIR" ] && [ "$MAX_EXISTING_BYTES" != "0" ]; then
  EXISTING_BYTES="$(du -sk "$TARGET_DIR" 2>/dev/null | awk '{print $1 * 1024}')"
  if [ -n "$EXISTING_BYTES" ] && [ "$EXISTING_BYTES" -gt "$MAX_EXISTING_BYTES" ]; then
    die "pre-existing '$TARGET_DIR' is ${EXISTING_BYTES} bytes, over SCRATCH_TARGET_MAX_EXISTING_BYTES=${MAX_EXISTING_BYTES} -- refusing to silently delete it; remove it by hand first if that is really what you want"
  fi
fi

# INCIDENT-SHAPE GUARD: `SCRATCH_POOL_ROOT=x eval "$(tools/scratch-target.sh
# lbl)"` -- the env prefix binds to `eval`, not to the command substitution
# inside it, so an override meant to redirect this AWAY from a shared pool
# never reaches this process, and BASE silently falls back to the real,
# shared default. This process cannot detect that (it never sees what the
# caller typed) -- but it CAN make the caller's own shell re-check its own
# environment at eval time, right before the delete runs, instead of
# trusting what this process already resolved. The emitted text below
# compares what eval's OWN environment says SCRATCH_POOL_ROOT is against the
# realpath this process actually resolved, and refuses instead of deleting
# when they disagree.
cat <<EVAL_TEXT
if [ "\$(cd "\${SCRATCH_POOL_ROOT:-${TMPDIR:-/tmp}/scratch-pool}" 2>/dev/null && pwd -P)" != "$BASE_REAL" ]; then
  printf 'scratch-target: REFUSING TO RUN: SCRATCH_POOL_ROOT as this shell sees it does not match the pool this script resolved -- an env prefix on eval does not reach this script. See tools/scratch-target.sh.\n' >&2
else
  rm -rf "$TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  export SCRATCH_TARGET_DIR="$TARGET_DIR"
fi
EVAL_TEXT

# WHAT THIS COVERS
#   - a single, label-and-tree-identified scratch directory, delete-first,
#     under a configurable pool root (env-driven, the same loading shape
#     cargo_scratch_guard.py's cargo pool uses)
#   - two checkouts of the same project never colliding on the same label
#   - refusing (never silently deleting) a suspiciously large pre-existing
#     entry
#   - the specific "an env prefix does not cross eval $(...)" incident
#     shape, by deferring the actual delete into the caller's own eval'd
#     shell text and re-checking there
#
# WHAT THIS DOES NOT COVER -- read before adopting
#   - NO pruning, size-cap, or LRU eviction policy for the pool as a whole.
#     Every invocation adds one entry and never removes an old one; left
#     alone, the pool grows without bound. A real eviction policy needs age
#     cutoffs, liveness checks via lsof, activity-group protection, and a
#     per-run cap -- a half-ported version that looks complete is worse
#     than an honestly absent one. If your pool needs this, budget real
#     design time for it
#     rather than assuming this script has already done it.
#   - NO liveness check. A build actively running against an entry can
#     still have that entry deleted by a second concurrent invocation using
#     the same label from the same tree (rare, since the hash ties it to
#     one checkout, but possible).
#   - NO build-tool-specific tree identity. TREE_HASH is derived from this
#     checkout's own resolved path, not a project-manifest lookup (the
#     original used `cargo locate-project`) -- fine for "one scratch
#     directory per checkout", wrong if you need "one scratch directory per
#     package inside a monorepo checkout" without further changes.
#   - NOT automatically recognized by name for a SECOND protected root. The
#     shipped guard's label-bounded exception is hardcoded to match one
#     script's filename (cargo_scratch_guard.py's SANCTIONED_SCRIPT_NAME)
#     for the cargo pool specifically. A different, second protected root
#     added via the guard's own CARGO_SCRATCH_GUARD_EXTRA_ROOTS gets the
#     WEAKER, universal count-only bound instead (no naming-convention
#     check at all) unless you also extend the guard itself to recognize
#     this script's name for your own root -- see
#     .claude/coordinator-config.example.yaml for where that trade-off is
#     documented.
#   - Requires bash (uses `set -euo pipefail`, `case` pattern matching);
#     not a portable POSIX `sh` script.
