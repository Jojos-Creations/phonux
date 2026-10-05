#!/usr/bin/env bash
# Prints N from the last `ℹ tests N` line of an `npm test` run, or of a saved log.
#   tools/testcount.sh               run npm test, print N
#   tools/testcount.sh --log FILE    read FILE instead of running anything
#   tools/testcount.sh --self-test   prove the rules below against planted logs
# Exits non-zero when the run failed, when no summary line exists, or when N is 0: a count nobody can trust
# must never look like a pass.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Only the LAST summary counts: a nested run's own summary may precede the real one.
count_from_log() {
  local log=$1 n
  if [ ! -f "$log" ]; then
    echo "testcount: no such log: $log" >&2
    return 2
  fi
  n=$(awk '/^ℹ tests [0-9]+$/ { n = $3 } END { print n }' "$log")
  if [ -z "$n" ]; then
    echo "testcount: no 'ℹ tests N' line in $log: this run proved nothing" >&2
    return 1
  fi
  if [ "$n" -eq 0 ]; then
    echo "testcount: the summary says 0 tests: this run proved nothing" >&2
    return 1
  fi
  echo "$n"
}

self_test() {
  local scratch passed=0 total=0 out
  scratch=$(mktemp -d)
  trap 'rm -rf "$scratch"' RETURN

  expect() { # name, expected exit (0 or nonzero), expected stdout ('-' to skip), then the command
    local name=$1 want_exit=$2 want_out=$3 got_exit=0
    shift 3
    out=$("$@" 2>/dev/null) || got_exit=$?
    total=$((total + 1))
    local ok=1
    if [ "$want_exit" = 0 ] && [ "$got_exit" -ne 0 ]; then ok=0; fi
    if [ "$want_exit" != 0 ] && [ "$got_exit" -eq 0 ]; then ok=0; fi
    if [ "$want_out" != "-" ] && [ "$out" != "$want_out" ]; then ok=0; fi
    if [ "$ok" = 1 ]; then
      passed=$((passed + 1))
      echo "ok   $name (exit $got_exit, printed '$out')"
    else
      echo "FAIL $name (exit $got_exit, printed '$out', wanted exit $want_exit and '$want_out')"
    fi
  }

  : > "$scratch/empty.log"
  printf 'ℹ tests 7\n' > "$scratch/seven.log"
  printf 'ℹ tests 3\nℹ pass 3\nℹ tests 9\n' > "$scratch/two.log"
  printf 'ℹ tests 0\n' > "$scratch/zero.log"
  printf 'ok\n# tests 5\n' > "$scratch/nolines.log"

  expect 'an empty log exits non-zero' nonzero - "$0" --log "$scratch/empty.log"
  expect "'ℹ tests 7' prints 7" 0 7 "$0" --log "$scratch/seven.log"
  expect 'two summary lines print the last' 0 9 "$0" --log "$scratch/two.log"
  expect "'ℹ tests 0' exits non-zero" nonzero - "$0" --log "$scratch/zero.log"
  expect 'a log with no summary line exits non-zero' nonzero - "$0" --log "$scratch/nolines.log"
  expect 'a missing log exits non-zero' nonzero - "$0" --log "$scratch/absent.log"

  # A stand-in npm on PATH: the run path must take its exit status from npm test itself.
  mkdir "$scratch/failing-bin" "$scratch/passing-bin"
  printf '#!/bin/sh\nprintf "ℹ tests 5\\n"\nexit 1\n' > "$scratch/failing-bin/npm"
  printf '#!/bin/sh\nprintf "ℹ tests 5\\n"\nexit 0\n' > "$scratch/passing-bin/npm"
  chmod +x "$scratch/failing-bin/npm" "$scratch/passing-bin/npm"
  expect 'a failing npm test exits non-zero even with a summary line' nonzero - env PATH="$scratch/failing-bin:$PATH" "$0"
  expect 'a passing npm test prints its count' 0 5 env PATH="$scratch/passing-bin:$PATH" "$0"

  echo "self-test: $passed/$total"
  [ "$passed" -eq "$total" ] && [ "$total" -gt 0 ]
}

case "${1:-}" in
  --self-test)
    self_test
    ;;
  --log)
    if [ $# -ne 2 ]; then
      echo "usage: tools/testcount.sh [--log FILE | --self-test]" >&2
      exit 2
    fi
    count_from_log "$2"
    ;;
  '')
    log=$(mktemp)
    trap 'rm -f "$log"' EXIT
    status=0
    (cd "$here/.." && npm test) > "$log" 2>&1 || status=$?
    if [ "$status" -ne 0 ]; then
      tail -n 40 "$log" >&2
      echo "testcount: npm test exited $status" >&2
      exit "$status"
    fi
    count_from_log "$log"
    ;;
  *)
    echo "usage: tools/testcount.sh [--log FILE | --self-test]" >&2
    exit 2
    ;;
esac
