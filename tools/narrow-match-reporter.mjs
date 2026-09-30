#!/usr/bin/env node
/**
 * Reporter for tools/run-tests-narrow.mjs when a name pattern is active, in place of (never beside)
 * file-presence-reporter.mjs. MATCH lines exist because Node reports a pattern that selected no
 * test as `pass 1`, exit 0.
 */

import { isFileLevel, lineFor } from './test-stream.mjs';

export default async function* narrowMatchReporter(source) {
  for await (const event of source) {
    const line = lineFor(event);
    if (line !== null) yield `${line}\n`;
    if (event.type !== 'test:complete' || typeof event.data?.file !== 'string' || isFileLevel(event.data)) continue;
    // Suites and skipped tests are not MATCHes: neither is a test that ran.
    const { file, skip, details } = event.data;
    if (!skip && details?.type !== 'suite') yield `MATCH:${file}\n`;
  }
}
