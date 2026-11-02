/**
 * The release check refuses a checkout that lacks work merged into its rc branch. Each case builds a scratch origin
 * with an `rc9` branch and a clone of it, so the git calls run for real and touch no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type RcBranchProblem = (options: { version: string; cwd: string; remote?: string }) => string | null;
type Module = { rcBranchFor: (version: string) => string | null; pullRequestNumbers: (subjects: string[]) => number[]; rcBranchProblem: RcBranchProblem };

const RC_FILE = fileURLToPath(new URL('../tools/phonux-rc-branch.mjs', import.meta.url));

async function load(file: string): Promise<Module> {
  return (await import(`${new URL(`file://${file}`).href}?load=${Math.random()}`)) as Module;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** An origin whose rc9 has the clone's head plus "Merge pull request #12", and a clone checked out one merge behind. */
function scratchRepos(run: (repos: { origin: string; clone: string }) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'phonux-rc-'));
  try {
    const origin = join(root, 'origin');
    git(root, 'init', '-q', '-b', 'rc9', origin);
    writeFileSync(join(origin, 'a.txt'), 'a\n');
    git(origin, 'add', 'a.txt');
    git(origin, 'commit', '-q', '-m', 'Start rc9');
    const clone = join(root, 'clone');
    git(root, 'clone', '-q', origin, clone);
    git(origin, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(origin, 'b.txt'), 'b\n');
    git(origin, 'add', 'b.txt');
    git(origin, 'commit', '-q', '-m', 'Add b');
    git(origin, 'checkout', '-q', 'rc9');
    git(origin, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #12 from owner/feature', 'feature');
    run({ origin, clone });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('rcBranchFor: an rc version names its branch, anything else names none', async () => {
  const { rcBranchFor } = await load(RC_FILE);
  assert.equal(rcBranchFor('0.2.0-rc.6'), 'rc6');
  assert.equal(rcBranchFor('0.2.0-rc.12'), 'rc12');
  assert.equal(rcBranchFor('0.2.0'), null);
  assert.equal(rcBranchFor('1.0.0-beta.2'), null);
  assert.equal(rcBranchFor('0.2.0-rc.6.1'), null);
});

test('pullRequestNumbers: reads both merge subject forms once each and skips plain commits', async () => {
  const { pullRequestNumbers } = await load(RC_FILE);
  assert.deepEqual(
    pullRequestNumbers(['Merge pull request #533 from Jojos-Creations/x', 'Merge #530: Name the timeline', 'Fix a thing #44', 'Merge pull request #533 from y']),
    [533, 530],
  );
});

test('rcBranchProblem: a checkout behind its rc branch fails and names the missing pull request', async () => {
  const { rcBranchProblem } = await load(RC_FILE);
  scratchRepos(({ clone }) => {
    const problem = rcBranchProblem({ version: '0.2.0-rc.9', cwd: clone }) ?? '';
    assert.match(problem, /origin\/rc9 .* has pull request #12 that this checkout \(HEAD\) lacks/);
    assert.match(problem, /Merge pull request #12 from owner\/feature/);
  });
});

test('rcBranchProblem: the same checkout passes once it holds the rc branch head', async () => {
  const { rcBranchProblem } = await load(RC_FILE);
  scratchRepos(({ clone }) => {
    git(clone, 'pull', '-q', '--ff-only', 'origin', 'rc9');
    assert.equal(rcBranchProblem({ version: '0.2.0-rc.9', cwd: clone }), null);
  });
});

test('rcBranchProblem: a checkout ahead of its rc branch passes', async () => {
  const { rcBranchProblem } = await load(RC_FILE);
  scratchRepos(({ clone }) => {
    git(clone, 'pull', '-q', '--ff-only', 'origin', 'rc9');
    writeFileSync(join(clone, 'c.txt'), 'c\n');
    git(clone, 'add', 'c.txt');
    git(clone, 'commit', '-q', '-m', 'Local change');
    assert.equal(rcBranchProblem({ version: '0.2.0-rc.9', cwd: clone }), null);
  });
});

test('rcBranchProblem: a missing rc branch is a failure that proved nothing, never a pass', async () => {
  const { rcBranchProblem } = await load(RC_FILE);
  scratchRepos(({ clone }) => {
    assert.match(rcBranchProblem({ version: '0.2.0-rc.8', cwd: clone }) ?? '', /could not fetch origin rc8 .*this proved nothing/);
  });
});

test('rcBranchProblem: a version with no rc branch is not compared', async () => {
  const { rcBranchProblem } = await load(RC_FILE);
  scratchRepos(({ clone }) => assert.equal(rcBranchProblem({ version: '0.2.0', cwd: clone }), null));
});

test('rcBranchProblem: a scratch copy that never reports missing commits passes the behind checkout, so the case can fail', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'phonux-rc-copy-'));
  try {
    const source = readFileSync(RC_FILE, 'utf8');
    const edited = source.replace("if (missing.out === '') return null;", 'return null;');
    assert.notEqual(edited, source, 'the planted edit must change the text');
    const copy = join(scratch, 'phonux-rc-branch.mjs');
    writeFileSync(copy, edited);
    const real = (await load(RC_FILE)).rcBranchProblem;
    const mutant = (await load(copy)).rcBranchProblem;
    scratchRepos(({ clone }) => {
      assert.notEqual(real({ version: '0.2.0-rc.9', cwd: clone }), null);
      assert.equal(mutant({ version: '0.2.0-rc.9', cwd: clone }), null);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('release:check runs the rc branch check before it asks the registry, and the printed command runs it again', () => {
  const check = readFileSync(fileURLToPath(new URL('../tools/phonux-release-check.mjs', import.meta.url)), 'utf8');
  const at = check.indexOf('rcBranchProblem({ version, cwd: REPO_ROOT })');
  assert.ok(at >= 0, 'release-check calls rcBranchProblem');
  assert.ok(at < check.indexOf("'view'"), 'before npm view');
  assert.match(check, /if \(rcProblem\) fail\(rcProblem\)/);
  assert.match(check, /node \$\{rcCheck\} && \$\{publishCommand\(version, distDir\)\}/);
});
