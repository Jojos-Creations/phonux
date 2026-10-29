/** `phonux build`: the device list, the tool checks, the plan and the scheduler, against a fake machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { checkPlatform, type Probe } from '../cli/checks.js';
import type { AppInfo } from '../cli/config.js';
import { pickerStep } from '../cli/picker.js';
import { planBuild } from '../cli/plan.js';
import { describeStep } from '../cli/runner.js';
import { schedule } from '../cli/scheduler.js';
import { iosDeviceFamily, TARGETS, targetsById } from '../cli/targets.js';

const ROOT = '/app';
const SDK = '/home/dev/Library/Android/sdk';
const STUDIO_JDK = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';

function app(overrides: Partial<AppInfo['config']> = {}): AppInfo {
  return {
    root: ROOT,
    scripts: { 'build:web': 'vite build', 'build:desktop': 'electron-vite build' },
    config: { web: 'build:web', desktop: 'build:desktop', ...overrides },
  };
}

const INSTALLED = ['@capacitor/cli', '@capacitor/core', '@capacitor/android', '@capacitor/ios'].map((name) => join(ROOT, 'node_modules', name, 'package.json'));

function mac(files: string[] = [], env: Record<string, string> = {}, outputs: Record<string, string> = {}): Probe {
  const present = new Set([...INSTALLED, join(ROOT, 'capacitor.config.ts'), ...files]);
  return {
    platform: 'darwin',
    env,
    home: '/home/dev',
    exists: (path) => present.has(path),
    run: (command) => outputs[command.split('/').pop()!] ?? null,
  };
}

const fullMac = (files: string[] = [], env: Record<string, string> = {}): Probe =>
  mac([join(STUDIO_JDK, 'bin', 'java'), join(SDK, 'platform-tools'), ...files], env, {
    java: 'openjdk version "21.0.6" 2025-01-21',
    xcodebuild: 'Xcode 26.1\nBuild version 17B55',
  });

test('the list offers the four device types and desktop, all build-stage', () => {
  assert.deepEqual(TARGETS.map((t) => t.id), ['android-phone', 'android-tablet', 'iphone', 'ipad', 'desktop']);
  assert.ok(TARGETS.every((t) => t.stage === 'build'));
  assert.throws(() => targetsById(['watch']), /Unknown target "watch"/);
});

test('iPhone and iPad picks become one device family setting', () => {
  assert.equal(iosDeviceFamily(targetsById(['iphone'])), '1');
  assert.equal(iosDeviceFamily(targetsById(['ipad'])), '2');
  assert.equal(iosDeviceFamily(targetsById(['iphone', 'ipad'])), '1,2');
});

test('iOS on a machine that is not a Mac says so plainly', () => {
  const ready = checkPlatform('ios', app(), { ...fullMac(), platform: 'linux' });
  assert.equal(ready.ok, false);
  assert.deepEqual(ready.problems, ['iPhone and iPad builds need a Mac with Xcode. This machine is not a Mac.']);
});

test('iOS on a Mac with Xcode 26 is ready, and an older Xcode is named', () => {
  assert.equal(checkPlatform('ios', app(), fullMac()).ok, true);
  const old = mac([], {}, { xcodebuild: 'Xcode 16.4' });
  assert.match(checkPlatform('ios', app(), old).problems.join(' '), /this Mac has Xcode 16/);
});

test('Android finds the JDK inside Android Studio and the default SDK folder', () => {
  const ready = checkPlatform('android', app(), fullMac());
  assert.deepEqual(ready, { ok: true, problems: [], env: { JAVA_HOME: STUDIO_JDK, ANDROID_HOME: SDK } });
});

test('Android with no Java and no SDK lists both, and an old Java by version', () => {
  const bare = checkPlatform('android', app(), mac());
  assert.equal(bare.ok, false);
  assert.equal(bare.problems.length, 2);
  assert.match(bare.problems[0]!, /need Java 21 or newer, and none was found/);
  assert.match(bare.problems[1]!, /need the Android SDK/);
  const old = checkPlatform('android', app(), mac([join(SDK, 'platform-tools')], {}, { java: 'java version "1.8.0_402"' }));
  assert.match(old.problems.join(' '), /this machine has Java 8/);
});

test('a missing Capacitor package, config or web script is each named', () => {
  const probe: Probe = { ...fullMac(), exists: (path) => path.includes('platform-tools') || path.endsWith('/bin/java') };
  const ready = checkPlatform('android', { ...app(), scripts: {} }, probe);
  assert.deepEqual(
    ready.problems.map((p) => p.split(' ')[0]),
    ['@capacitor/cli', '@capacitor/core', '@capacitor/android', 'No', 'No'],
  );
});

test('phone and tablet picks share one build per platform, after one web build', () => {
  const probe = fullMac([join(ROOT, 'android'), join(ROOT, 'ios')]);
  const plan = planBuild(TARGETS, app(), probe, (p) => checkPlatform(p, app(), probe), { debug: false });
  assert.deepEqual(plan.jobs.map((j) => [j.id, j.deps]), [['web', []], ['android', ['web']], ['ios', ['web']], ['desktop', []]]);
  const xcode = plan.jobs.find((j) => j.id === 'ios')!.steps.at(-1)!;
  assert.ok(xcode.kind === 'run' && xcode.args.includes('TARGETED_DEVICE_FAMILY=1,2') && xcode.args.includes('iphonesimulator'));
});

test('desktop alone needs no web build, and a missing native project is added first', () => {
  const probe = fullMac();
  const desktop = planBuild(targetsById(['desktop']), app(), probe, (p) => checkPlatform(p, app(), probe), { debug: false });
  assert.deepEqual(desktop.jobs.map((j) => j.id), ['desktop']);
  const android = planBuild(targetsById(['android-tablet']), app(), probe, (p) => checkPlatform(p, app(), probe), { debug: false });
  const steps = android.jobs[1]!.steps.map((s) => (s.kind === 'run' ? `${s.command} ${s.args.join(' ')}` : s.kind));
  assert.deepEqual(steps, ['npx cap add android', 'npx cap sync android', './gradlew assembleDebug']);
});

test('a platform this machine cannot build is skipped and the rest still plan', () => {
  const probe = { ...fullMac(), platform: 'linux' as const };
  const plan = planBuild(targetsById(['iphone', 'desktop']), app(), probe, (p) => checkPlatform(p, app(), probe), { debug: false });
  assert.deepEqual(plan.jobs.map((j) => j.id), ['desktop']);
  assert.deepEqual(plan.skipped.map((s) => s.platform), ['ios']);
});

test('signing turns on release builds, --debug turns them off, and a missing password skips', () => {
  const signed = app({ android: { keystore: 'release.jks', alias: 'app' }, ios: { teamId: 'ABCDE12345' } });
  const probe = fullMac([join(ROOT, 'android'), join(ROOT, 'ios')], { PHONUX_KEYSTORE_PASSWORD: 'secret' });
  const check = (p: Parameters<typeof checkPlatform>[0]) => checkPlatform(p, signed, probe);
  const release = planBuild(targetsById(['android-phone', 'ipad']), signed, probe, check, { debug: false });
  assert.deepEqual(release.jobs.map((j) => j.label), ['Web build', 'Android release build', 'iOS release build']);
  const debug = planBuild(targetsById(['android-phone', 'ipad']), signed, probe, check, { debug: true });
  assert.deepEqual(debug.jobs.map((j) => j.label), ['Web build', 'Android test build', 'iOS simulator build']);
  const noPass = { ...probe, env: {} };
  const skipped = planBuild(targetsById(['android-phone']), signed, noPass, (p) => checkPlatform(p, signed, noPass), { debug: false });
  assert.match(skipped.skipped[0]!.problems[0]!, /PHONUX_KEYSTORE_PASSWORD is not set/);
});

test('printed commands hide keystore passwords', () => {
  const line = describeStep({ kind: 'run', command: 'npx', args: ['cap', 'build', '--keystorepass', 'secret', '--keystorealiaspass', 'secret2'], cwd: ROOT });
  assert.equal(line, 'npx cap build --keystorepass *** --keystorealiaspass ***');
});

function deferred(): { promise: Promise<boolean>; resolve: (ok: boolean) => void } {
  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test('the scheduler holds to the job limit and starts dependents only after their deps', async () => {
  const jobs = [
    { id: 'web', deps: [], memoryGb: 1 },
    { id: 'android', deps: ['web'], memoryGb: 3 },
    { id: 'ios', deps: ['web'], memoryGb: 4 },
    { id: 'desktop', deps: [], memoryGb: 2 },
  ];
  const gates = new Map(jobs.map((j) => [j.id, deferred()]));
  const started: string[] = [];
  const done = schedule(jobs, { maxJobs: 2, memoryGb: 100 }, (job) => {
    started.push(job.id);
    return gates.get(job.id)!.promise;
  });
  await Promise.resolve();
  assert.deepEqual(started, ['web', 'desktop']);
  gates.get('web')!.resolve(true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['web', 'desktop', 'android']);
  gates.get('desktop')!.resolve(true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['web', 'desktop', 'android', 'ios']);
  gates.get('android')!.resolve(true);
  gates.get('ios')!.resolve(true);
  assert.deepEqual([...(await done).values()], ['done', 'done', 'done', 'done']);
});

test('the scheduler runs one at a time when memory is short, and skips jobs whose dep failed', async () => {
  const jobs = [
    { id: 'web', deps: [], memoryGb: 1 },
    { id: 'desktop', deps: [], memoryGb: 2 },
    { id: 'android', deps: ['web'], memoryGb: 3 },
  ];
  let running = 0;
  let peak = 0;
  const outcomes = await schedule(jobs, { maxJobs: 3, memoryGb: 2 }, async (job) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setImmediate(r));
    running--;
    return job.id !== 'web';
  });
  assert.equal(peak, 1);
  assert.deepEqual(Object.fromEntries(outcomes), { web: 'failed', desktop: 'done', android: 'skipped' });
});

test('the picker moves, toggles and picks all', () => {
  let state = { cursor: 0, checked: new Set<string>() };
  state = pickerStep(state, 'up', TARGETS);
  assert.equal(state.cursor, TARGETS.length - 1);
  state = pickerStep(state, 'toggle', TARGETS);
  assert.deepEqual([...state.checked], ['desktop']);
  state = pickerStep(state, 'all', TARGETS);
  assert.equal(state.checked.size, TARGETS.length);
  state = pickerStep(state, 'all', TARGETS);
  assert.equal(state.checked.size, 0);
});
