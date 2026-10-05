#!/usr/bin/env bash
# Runs the strict gate from a clean dist/, in the order CI runs it, then checks the build left dist/package.json.
# Stops at the first failing step. The list below must equal strict_gate in .claude/coordinator-config.yaml: when the
# two differ this refuses to run, because a gate that skips a configured step would report a pass it did not earn.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CHAIN=(
  'npm run typecheck'
  'npm test'
  'npm run build'
  'npm run check:api-report'
  'npm run smoke'
  'python3 tools/vendor-queue-tooling.py . --check'
  'python3 tools/queue/queue.py lint --offline'
)

configured=$(awk '/^strict_gate:/ { on = 1; next } on && /^[[:space:]]+-[[:space:]]/ { sub(/^[[:space:]]+-[[:space:]]+/, ""); print; next } on && /^[^[:space:]#]/ { exit }' .claude/coordinator-config.yaml)
expected=$(printf '%s\n' "${CHAIN[@]}")
if [ "$configured" != "$expected" ]; then
  echo "ci-chain: the steps in this script differ from strict_gate in .claude/coordinator-config.yaml:" >&2
  diff <(printf '%s\n' "$configured") <(printf '%s\n' "$expected") >&2 || true
  exit 1
fi

rm -rf dist
for step in "${CHAIN[@]}"; do
  echo "ci-chain: $step"
  bash -c "$step"
done
test -f dist/package.json
echo "ci-chain: ok"
