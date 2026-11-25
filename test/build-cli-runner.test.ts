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
