#!/usr/bin/env node
/**
 * Custom --test-reporter used by tools/run-tests-narrow.mjs when a
 * name-pattern is active, IN PLACE OF tools/file-presence-reporter.mjs
 * (never alongside it: a third --test-reporter trips Node's
 * MaxListenersExceededWarning on the shared TestsStream).
 *
 * Emits `FILE:<abs path>` once per test file that finished and
 * `MATCH:<abs path>` once per real test that ran, so the wrapper can tell a
 * file that completed from a file where the pattern selected no test at all
 * -- Node reports that case as `pass 1`, exit 0.
 *
 * File-level discriminator is the same as file-presence-reporter.mjs:
 * `line === 1 && column === 1` (every test file opens with an import).
 * Suites and skipped tests are not MATCHes: neither is a test that ran.
 * Validated against Node v24.18.0; Node's docs call this event shape
 * unversioned, so an upgrade that changes it fails loud (files report
 * missing or zero-match), never silently green.
 */

export default async function* narrowMatchReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:complete') continue;
    const { line, column, file, skip, details } = event.data ?? {};
    if (typeof file !== 'string') continue;
    if (line === 1 && column === 1) {
      yield `FILE:${file}\n`;
    } else if (!skip && details?.type !== 'suite') {
      yield `MATCH:${file}\n`;
    }
  }
}
