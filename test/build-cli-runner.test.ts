/** `phonux build`'s runner: how a step's command line reaches the operating system. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Job } from '../cli/plan.js';
import { logPath, runJob } from '../cli/runner.js';

test('an argument with shell characters reaches the command as one argument, on every platform', async () => {
  const root = mkdtempSync(join(tmpdir(), 'phonux-runner-'));
  const arg = 'pa ss;echo INJECTED&echo INJECTED|x';
  const job: Job = {
    id: 'probe', label: 'probe', deps: [], memoryGb: 0, env: {},
    steps: [{ kind: 'run', command: process.execPath, args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', arg], cwd: root }],
  };
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  // Claiming Windows here runs the Windows spawn path on any machine, where shell quoting is what splits an argument.
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  let ok: boolean;
  try {
    ok = await runJob(root, job);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
  const log = readFileSync(logPath(root, job), 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.equal(ok, true, log);
  assert.ok(log.includes(JSON.stringify([arg])), log);
  assert.ok(!/^INJECTED$/m.test(log), log);
});

const PASSWORDS = { PHONUX_KEYSTORE_PASSWORD: 'store-pw-8431', PHONUX_KEY_PASSWORD: 'key-pw-2907' };

async function withPasswords<T>(run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(PASSWORDS).map((name) => [name, process.env[name]]));
  Object.assign(process.env, PASSWORDS);
  try {
    return await run();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** A step that prints which of the two password variables it can see, and whether they hold the test values. */
const seen = (root: string, signs: boolean): Job['steps'][number] => ({
  kind: 'run', command: process.execPath, cwd: root, ...(signs ? { signs: true as const } : {}),
  args: ['-e', `const e = process.env; console.log('seen', JSON.stringify([e.PHONUX_KEYSTORE_PASSWORD === '${PASSWORDS.PHONUX_KEYSTORE_PASSWORD}', e.PHONUX_KEY_PASSWORD === '${PASSWORDS.PHONUX_KEY_PASSWORD}', 'PHONUX_KEYSTORE_PASSWORD' in e, 'PHONUX_KEY_PASSWORD' in e]))`],
});

test('a step that does not sign starts without the keystore passwords, and the step that signs gets both', async () => {
  const root = mkdtempSync(join(tmpdir(), 'phonux-runner-'));
  const job: Job = { id: 'probe', label: 'probe', deps: [], memoryGb: 0, env: {}, steps: [seen(root, false), seen(root, true), seen(root, false)] };
  const ok = await withPasswords(() => runJob(root, job));
  const log = readFileSync(logPath(root, job), 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.equal(ok, true, log);
  const lines = log.split('\n').filter((line) => line.startsWith('seen '));
  assert.deepEqual(lines, ['seen [false,false,false,false]', 'seen [true,true,true,true]', 'seen [false,false,false,false]']);
});

test('a password a step prints is hidden in the log, even when it arrives in two pieces', async () => {
  const root = mkdtempSync(join(tmpdir(), 'phonux-runner-'));
  const secret = PASSWORDS.PHONUX_KEYSTORE_PASSWORD;
  const script = `const s = process.env.PHONUX_KEYSTORE_PASSWORD; console.log('whole ' + s); process.stdout.write('split ' + s.slice(0, 5)); setTimeout(() => process.stdout.write(s.slice(5) + '\\n'), 50); console.error('err ' + process.env.PHONUX_KEY_PASSWORD);`;
  const job: Job = { id: 'probe', label: 'probe', deps: [], memoryGb: 0, env: {}, steps: [{ kind: 'run', command: process.execPath, args: ['-e', script], cwd: root, signs: true }] };
  const ok = await withPasswords(() => runJob(root, job));
  const log = readFileSync(logPath(root, job), 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.equal(ok, true, log);
  for (const value of Object.values(PASSWORDS)) assert.ok(!log.includes(value), log);
  assert.ok(log.includes('whole [hidden]') && log.includes('split [hidden]') && log.includes('err [hidden]'), log);
});

test('output with no newline at its end, and output of an unrelated step, still reach the log in order', async () => {
  const root = mkdtempSync(join(tmpdir(), 'phonux-runner-'));
  const step = (text: string): Job['steps'][number] => ({ kind: 'run', command: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(text)})`], cwd: root });
  const job: Job = { id: 'probe', label: 'probe', deps: [], memoryGb: 0, env: {}, steps: [step('first one'), step('second one\nthird é')] };
  const ok = await runJob(root, job);
  const log = readFileSync(logPath(root, job), 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.equal(ok, true, log);
  assert.ok(log.indexOf('first one') < log.indexOf('second one') && log.indexOf('second one\nthird é') > 0, log);
});
