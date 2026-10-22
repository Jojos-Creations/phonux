/**
 * The release candidate's publish text and its recorded base. publishCommand is pure, so the table below runs it
 * directly; the control feeds the same table a copy with the tag rule removed and demands that it fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type PublishCommand = (version: string, distDir: string) => string;

const PUBLISH_FILE = fileURLToPath(new URL('../tools/phonux-publish-command.mjs', import.meta.url));
const DESIGN = readFileSync(fileURLToPath(new URL('../DESIGN.md', import.meta.url)), 'utf8');

const ROWS: ReadonlyArray<readonly [version: string, tagged: boolean]> = [
  ['0.2.0-rc.1', true],
  ['0.2.0-rc.2', true],
  ['0.2.0-rc.3', true],
  ['0.2.0-rc.4', true],
  ['1.0.0-beta.2', true],
  ['0.2.0', false],
  ['0.1.1', false],
];

async function load(file: string): Promise<PublishCommand> {
  const mod = (await import(`${new URL(`file://${file}`).href}?load=${Math.random()}`)) as { publishCommand: PublishCommand };
  return mod.publishCommand;
}

/** The rows whose printed text disagrees with the tag rule; empty when `publishCommand` follows it. */
function tableProblems(publishCommand: PublishCommand): string[] {
  return ROWS.flatMap(([version, tagged]) => {
    const text = publishCommand(version, 'dist');
    const problems: string[] = [];
    if (text.includes('--tag next') !== tagged) problems.push(`${version}: ${tagged ? 'missing' : 'unexpected'} --tag next in '${text}'`);
    if (!text.includes('npm publish')) problems.push(`${version}: no npm publish in '${text}'`);
    return problems;
  });
}

for (const [version, tagged] of ROWS) {
  test(`publishCommand: ${version} ${tagged ? 'carries' : 'does not carry'} --tag next`, async () => {
    const text = (await load(PUBLISH_FILE))(version, 'dist');
    assert.equal(text.includes('--tag next'), tagged, text);
    assert.match(text, /^cd dist && npm publish/);
  });
}

test('publishCommand: a scratch copy with --tag next removed fails the table', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-publish-'));
  try {
    const source = readFileSync(PUBLISH_FILE, 'utf8');
    const edited = source.replace(" --tag next", '');
    assert.notEqual(edited, source, 'the planted edit must change the text');
    const copy = join(scratch, 'phonux-publish-command.mjs');
    writeFileSync(copy, edited);
    assert.deepEqual(tableProblems(await load(PUBLISH_FILE)), []);
    assert.notDeepEqual(tableProblems(await load(copy)), []);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('publishCommand: the file starts no process', () => {
  assert.doesNotMatch(readFileSync(PUBLISH_FILE, 'utf8'), /child_process|spawn|execFile|exec\(/);
});

test('DESIGN.md records the release candidate base: one 40-character commit line, and that no real browser measured the tree', () => {
  const at = DESIGN.indexOf('### Release candidate base');
  assert.ok(at >= 0, 'DESIGN.md has the Release candidate base heading');
  const section = DESIGN.slice(at, DESIGN.indexOf('\n#', at + 1) === -1 ? undefined : DESIGN.indexOf('\n#', at + 1));
  assert.equal(section.match(/^base: [0-9a-f]{40}$/gm)?.length, 1, 'exactly one base line');
  assert.match(section, /no real browser/i);
});

test('release:check prints the command through publishCommand, with no second copy of the text', () => {
  const check = readFileSync(fileURLToPath(new URL('../tools/phonux-release-check.mjs', import.meta.url)), 'utf8');
  assert.match(check, /publishCommand\(version, distDir\)/);
  assert.equal(check.split('npm publish').length - 1, 0);
});

const LOCK_FILE = fileURLToPath(new URL('../tools/phonux-lockfile-version.mjs', import.meta.url));

type LockfileVersionProblem = (packageDir: string) => string | null;

/** Both files in a scratch directory, with `lock` as the lockfile's root `version` and `packages[""].version`. */
function withPackage(manifest: string, lock: { root?: string; entry?: string } | null, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-lock-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'phonux', version: manifest }));
    if (lock) {
      const packages = lock.entry === undefined ? {} : { '': { name: 'phonux', version: lock.entry } };
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ name: 'phonux', version: lock.root, lockfileVersion: 3, packages }));
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadLock(file: string): Promise<LockfileVersionProblem> {
  const mod = (await import(`${new URL(`file://${file}`).href}?load=${Math.random()}`)) as { lockfileVersionProblem: LockfileVersionProblem };
  return mod.lockfileVersionProblem;
}

test('lockfileVersionProblem: no problem when package.json and both lockfile versions agree', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.3', { root: '0.2.0-rc.3', entry: '0.2.0-rc.3' }, (dir) => assert.equal(check(dir), null));
});

test('lockfileVersionProblem: names both versions when the lockfile root entry is behind', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.3', { root: '0.2.0-rc.3', entry: '0.2.0-rc.2' }, (dir) => {
    const text = check(dir) ?? '';
    assert.match(text, /0\.2\.0-rc\.3/);
    assert.match(text, /packages\[""\]\.version is 0\.2\.0-rc\.2/);
  });
});

test('lockfileVersionProblem: names both versions when the lockfile top-level version is behind', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.3', { root: '0.2.0-rc.2', entry: '0.2.0-rc.3' }, (dir) => {
    const text = check(dir) ?? '';
    assert.match(text, /package\.json says version 0\.2\.0-rc\.3/);
    assert.match(text, /"version" is 0\.2\.0-rc\.2/);
  });
});

test('lockfileVersionProblem: a package.json ahead of the lockfile is the same failure', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.3.0', { root: '0.2.0', entry: '0.2.0' }, (dir) => assert.match(check(dir) ?? '', /0\.3\.0.*0\.2\.0/));
});

test('lockfileVersionProblem: a missing root entry or a missing lockfile fails rather than passing', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('1.0.0', { root: '1.0.0' }, (dir) => assert.match(check(dir) ?? '', /packages\[""\]\.version is absent/));
  withPackage('1.0.0', null, (dir) => assert.match(check(dir) ?? '', /package-lock\.json is missing/));
});

test('lockfileVersionProblem: a lockfile version that only starts with the manifest version is still a disagreement', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.1', { root: '0.2.0-rc.10', entry: '0.2.0-rc.10' }, (dir) => assert.match(check(dir) ?? '', /0\.2\.0-rc\.1\b.*0\.2\.0-rc\.10/));
});

test('lockfileVersionProblem: both lockfile entries wrong are joined with "and", one wrong names only that one', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.3', { root: '0.2.0-rc.2', entry: '0.2.0-rc.1' }, (dir) => {
    const text = check(dir) ?? '';
    assert.match(text, /"version" is 0\.2\.0-rc\.2 and package-lock\.json packages\[""\]\.version is 0\.2\.0-rc\.1/);
  });
  withPackage('0.2.0-rc.3', { root: '0.2.0-rc.3', entry: '0.2.0-rc.2' }, (dir) => {
    const text = check(dir) ?? '';
    assert.doesNotMatch(text, / and package-lock/);
    assert.doesNotMatch(text, /"version" is/);
  });
});

test('lockfileVersionProblem: a missing lockfile message names the manifest version', async () => {
  const check = await loadLock(LOCK_FILE);
  withPackage('0.2.0-rc.3', null, (dir) => assert.match(check(dir) ?? '', /package-lock\.json is missing next to package\.json \(version 0\.2\.0-rc\.3\)/));
});

test('lockfileVersionProblem: a scratch copy that always returns null fails the disagreement case', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-lock-copy-'));
  try {
    const source = readFileSync(LOCK_FILE, 'utf8');
    const edited = source.replace('if (wrong.length === 0) return null;', 'return null;');
    assert.notEqual(edited, source, 'the planted edit must change the text');
    const copy = join(scratch, 'phonux-lockfile-version.mjs');
    writeFileSync(copy, edited);
    const real = await loadLock(LOCK_FILE);
    const mutant = await loadLock(copy);
    withPackage('0.2.0-rc.3', { root: '0.2.0-rc.2', entry: '0.2.0-rc.2' }, (dir) => {
      assert.notEqual(real(dir), null);
      assert.equal(mutant(dir), null);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('lockfileVersionProblem: the file starts no process', () => {
  assert.doesNotMatch(readFileSync(LOCK_FILE, 'utf8'), /child_process|spawn|execFile|exec\(/);
});

test('release:check runs the lockfile check before it asks the registry', () => {
  const check = readFileSync(fileURLToPath(new URL('../tools/phonux-release-check.mjs', import.meta.url)), 'utf8');
  const lockAt = check.indexOf('lockfileVersionProblem(PHONE_DIR)');
  assert.ok(lockAt >= 0, 'release-check calls lockfileVersionProblem');
  assert.ok(lockAt < check.indexOf("'view'"), 'before npm view');
  assert.match(check, /if \(lockProblem\) fail\(lockProblem\)/);
});
