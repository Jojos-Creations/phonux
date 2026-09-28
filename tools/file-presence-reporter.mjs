#!/usr/bin/env node
/**
 * Custom --test-reporter for Node's test runner: emits one line per test
 * FILE that finished (not per test), so tools/run-tests.mjs can diff
 * "files asked for" against "files that actually completed" and catch a
 * file Node silently dropped from its own re-resolved argv.
 *
 * Usage (paired positionally with a second --test-reporter for human output,
 * per Node's own multi-reporter contract):
 *   node --test --test-reporter=spec --test-reporter-destination=stdout \
 *        --test-reporter=tools/file-presence-reporter.mjs \
 *        --test-reporter-destination=<file> test/*.test.ts
 *
 * File-level discriminator: Node emits a `test:complete` event for the file
 * itself (name = the argv token, e.g. "test/foo.test.ts") in addition to one
 * per real test. `nesting` is 0 on BOTH in this repo's flat, describe-free
 * test style (proven live on Node v24.18.0), so it cannot tell them apart.
 * `line === 1 && column === 1` does: every test file opens with an import,
 * so no real test() call is ever declared at line 1, but the file-level
 * event always reports line 1, column 1.
 */

export default async function* filePresenceReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:complete') continue;
    const { line, column, file } = event.data ?? {};
    if (line === 1 && column === 1 && typeof file === 'string') {
      yield `${file}\n`;
    }
  }
}
