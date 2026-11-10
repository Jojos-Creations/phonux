/**
 * Whether the commit being published holds everything merged into its release candidate branch. A version
 * 0.2.0-rc.N is cut from branch `rcN`; work merged there after the candidate was checked must not be left out.
 */

import { spawnSync } from 'node:child_process';

const RC_VERSION = /^\d+\.\d+\.\d+-rc\.(\d+)$/;

/** `rcN` for a 0.x.y-rc.N version, or null for a version that is not cut from an rc branch. */
export function rcBranchFor(version) {
  const match = RC_VERSION.exec(version);
  return match ? `rc${match[1]}` : null;
}

/** The pull request numbers named by GitHub merge subjects ("Merge pull request #533 from ...") or "Merge #530: ...". */
export function pullRequestNumbers(subjects) {
  const numbers = subjects.flatMap((subject) => {
    const match = /^Merge (?:pull request )?#(\d+)\b/.exec(subject);
    return match ? [Number(match[1])] : [];
  });
  return [...new Set(numbers)];
}

function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (run.error) return { ok: false, out: run.error.message };
  return { ok: run.status === 0, out: `${run.stdout}${run.status === 0 ? '' : run.stderr}`.trim() };
}

/**
 * Null when HEAD in `cwd` holds the head of `remote`'s rc branch for `version`, or when the version has no rc branch.
 * Otherwise the reason to stop, naming each pull request merged there that HEAD lacks. A failed fetch is a problem
 * too: it proves nothing about what the branch holds.
 */
export function rcBranchProblem({ version, cwd, remote = 'origin' }) {
  const branch = rcBranchFor(version);
  if (branch === null) return null;
  const fetch = git(cwd, ['fetch', '--quiet', remote, `refs/heads/${branch}`]);
  if (!fetch.ok) return `could not fetch ${remote} ${branch} (${fetch.out.split('\n')[0] || 'no output'}); this proved nothing`;
  const tip = git(cwd, ['rev-parse', 'FETCH_HEAD']);
  if (!tip.ok) return `could not read the fetched ${branch} head (${tip.out}); this proved nothing`;
  const missing = git(cwd, ['log', '--first-parent', '--format=%h %s', `HEAD..${tip.out}`]);
  if (!missing.ok) return `could not compare HEAD with ${branch} (${missing.out}); this proved nothing`;
  if (missing.out === '') return null;
  const lines = missing.out.split('\n');
  const prs = pullRequestNumbers(lines.map((line) => line.slice(line.indexOf(' ') + 1)));
  const named = prs.length > 0 ? `pull request${prs.length === 1 ? '' : 's'} ${prs.map((n) => `#${n}`).join(', ')}` : 'commits';
  return [
    `${remote}/${branch} (${tip.out.slice(0, 7)}) has ${named} that this checkout (HEAD) lacks:`,
    ...lines.map((line) => `  ${line}`),
    `Check out ${remote}/${branch}, or merge it, and run release:check again.`,
  ].join('\n');
}
