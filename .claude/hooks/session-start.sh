#!/bin/bash
set -euo pipefail

# Cloud sessions only: a local checkout has the owner's own toolchain.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# tools/queue imports PyYAML; without it the offline queue lint crashes at import.
python3 -c 'import yaml' 2>/dev/null || python3 -m pip install --quiet --disable-pip-version-check pyyaml

# npm ci, not npm install: install rewrites package-lock.json (it dropped
# entries in phonux-app), leaving a dirty tree before the first commit.
npm ci --no-audit --no-fund --loglevel=error

# The markdown-lint git hook runs markdownlint-cli2 through `npx --offline`,
# which skips on a cold cache.
npx --yes markdownlint-cli2 --version >/dev/null || echo "session-start: markdownlint-cli2 cache not warmed; the markdown lint gate will skip or fail" >&2
