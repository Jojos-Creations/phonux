/**
 * Runs each shared tool's own --self-test. A tool that checks nothing must read as a failure here, never a pass, so
 * each case demands a summary line with a non-zero total as well as a zero exit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEN_MINUTES_MS = 10 * 60 * 1000;

/** The runner marks its test processes with NODE_TEST_CONTEXT; a nested `node --test` that inherits it reports to the parent instead of printing. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

/** Runs `command` with --self-test and returns the passed and total counts from its last line, `self-test: P/T`. */
function runSelfTest(command: string, args: string[]): { passed: number; total: number } {
  const run = spawnSync(command, [...args, '--self-test'], { cwd: ROOT, env: cleanEnv(), encoding: 'utf8', timeout: TEN_MINUTES_MS, maxBuffer: 64 * 1024 * 1024 });
  const output = `${run.stdout}${run.stderr}`;
  assert.equal(run.error, undefined, `${command} could not run: ${String(run.error)}`);
  assert.equal(run.status, 0, `${args[0]} --self-test exited ${String(run.status)}:\n${output}`);
  const summary = /^self-test: (\d+)\/(\d+)$/m.exec(run.stdout);
  assert.ok(summary, `${args[0]} --self-test printed no 'self-test: P/T' line, so it proved nothing:\n${output}`);
  const passed = Number(summary[1]);
  const total = Number(summary[2]);
  assert.ok(total > 0, `${args[0]} --self-test ran zero cases`);
  assert.equal(passed, total, `${args[0]} --self-test passed ${passed} of ${total}:\n${output}`);
  assert.doesNotMatch(run.stdout, /^FAIL /m, `${args[0]} --self-test printed a FAIL line:\n${output}`);
  return { passed, total };
}

test('tools/testcount.sh --self-test: an empty log fails, one summary line prints its count, two print the last', () => {
  assert.ok(runSelfTest('bash', ['tools/testcount.sh']).total >= 3);
});

test('tools/comment-rule.sh --self-test: planted owner and Q-number comments fail, a clean one passes, fixtures are skipped, a bad base fails', () => {
  assert.ok(runSelfTest('bash', ['tools/comment-rule.sh']).total >= 5);
});

test('tools/ref-count.mjs --self-test: the fixture prints 2 references, a too-high --min-files fails', () => {
  assert.ok(runSelfTest(process.execPath, ['tools/ref-count.mjs']).total >= 2);
});

test('tools/mutate-check.mjs --self-test: a mutant that turns a planted test red counts, a repeated or commented find does not, a red base fails', () => {
  assert.ok(runSelfTest(process.execPath, ['tools/mutate-check.mjs']).total >= 4);
});
