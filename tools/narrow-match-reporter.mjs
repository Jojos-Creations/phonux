#!/usr/bin/env node
/**
 * Reporter for tools/run-tests-narrow.mjs when a name pattern is active, in place of (never beside)
 * file-presence-reporter.mjs. MATCH lines exist because Node reports a pattern that selected no
 * test as `pass 1`, exit 0.
 */

export default async function* narrowMatchReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:complete') continue;
    // Node's docs call this event shape unversioned, so an upgrade that changes it fails loud
    // (files report missing or zero-match), never silently green.
    const { line, column, file, skip, details } = event.data ?? {};
    if (typeof file !== 'string') continue;
    // File-level event: every test file opens with an import, so no real test sits at line 1, column 1.
    if (line === 1 && column === 1) {
      yield `FILE:${file}\n`;
    } else if (!skip && details?.type !== 'suite') {
      // Suites and skipped tests are not MATCHes: neither is a test that ran.
      yield `MATCH:${file}\n`;
    }
  }
}
