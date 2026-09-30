import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// tools/ is outside every tsconfig and ships no types, so the helper runs in a child node instead of being imported.
const PATHS_URL = new URL('../tools/phonux-paths.mjs', import.meta.url).href;

function resolvePhoneDirIn(root: string) {
  const script = `import { resolvePhoneDir } from ${JSON.stringify(PATHS_URL)}; process.stdout.write(resolvePhoneDir(${JSON.stringify(root)}));`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
}

// The tree is removed even when an assertion throws.
function withTree<T>(files: Record<string, unknown>, body: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'phonux-paths-'));
  try {
    assert.equal(dirname(root), tmpdir(), 'the scratch tree must sit directly under the OS temp dir');
    for (const [rel, json] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), JSON.stringify(json));
    }
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the real repo root resolves to the phonux workspace member', () => {
  const run = resolvePhoneDirIn(REPO_ROOT);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, join(REPO_ROOT, 'client/src/shared/phone'));
});

test('a root with no workspaces key and the name phonux resolves to itself', () => {
  withTree({ 'package.json': { name: 'phonux' } }, (root) => {
    const run = resolvePhoneDirIn(root);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, root);
  });
});

test('with a non-phonux package first in workspaces, the phonux member is still the one picked', () => {
  withTree(
    {
      'package.json': { workspaces: ['a', 'client/src/shared/phone'] },
      'a/package.json': { name: 'other' },
      'client/src/shared/phone/package.json': { name: 'phonux' },
    },
    (root) => {
      const run = resolvePhoneDirIn(root);
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout, join(root, 'client/src/shared/phone'));
    },
  );
});

test('zero packages named phonux and two packages named phonux are both refused, with the count', () => {
  const refusal = (files: Record<string, unknown>, count: number) =>
    withTree(files, (root) => {
      const run = resolvePhoneDirIn(root);
      assert.notEqual(run.status, 0, 'the lookup must not succeed');
      assert.equal(run.stdout, '', 'nothing may be printed as a resolved path');
      assert.match(run.stderr, /expected exactly one package named/);
      assert.match(run.stderr, new RegExp(`found ${count}\\b`));
    });
  refusal({ 'package.json': { workspaces: ['a'] }, 'a/package.json': { name: 'other' } }, 0);
  refusal(
    {
      'package.json': { workspaces: ['a', 'b'] },
      'a/package.json': { name: 'phonux' },
      'b/package.json': { name: 'phonux' },
    },
    2,
  );
});

test('the smoke refuses any argument but --from <value> before it packs or installs anything', () => {
  const smoke = fileURLToPath(new URL('../tools/phonux-pack-smoke.mjs', import.meta.url));
  const cases: Array<[string[], RegExp]> = [
    [['--from=phonux@0.0.0'], /unexpected argument "--from=phonux@0.0.0"/],
    [['phonux@0.0.0'], /unexpected argument "phonux@0.0.0"/],
    [['--bogus'], /unexpected argument "--bogus"/],
    [['--from'], /--from needs a tarball path/],
    [['--from', '--bogus'], /--from needs a tarball path/],
  ];
  for (const [args, reason] of cases) {
    const run = spawnSync(process.execPath, [smoke, ...args], { encoding: 'utf8' });
    const label = args.join(' ');
    assert.equal(run.status, 1, `${label}: ${run.stdout}${run.stderr}`);
    // The reason is asserted too: without a dist/ the smoke would also exit 1 for a missing package.json.
    assert.match(run.stderr, reason, label);
    assert.match(run.stderr, /smoke:phonux FAILED before all checks could run/, label);
    assert.ok(!run.stdout.includes('smoke:phonux OK'), `${label}: must not print an OK line`);
    assert.ok(!run.stdout.includes('working in'), `${label}: must fail before a scratch app is created`);
  }
});
