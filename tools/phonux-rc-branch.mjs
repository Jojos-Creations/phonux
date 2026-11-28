/**
 * Whether the commit being published holds everything merged into its release candidate branch. A version
 * 0.2.0-rc.N is cut from branch `rcN`; work merged there after the candidate was checked must not be left out.
 * A candidate cut straight from main has no rc branch: then the commit must be on main, the only branch the
 * publish workflow publishes from. A final version is published from main too. The tree must be clean for all of them.
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

/** The fetched head of `ref` on `remote`, or the reason it could not be read. */
function fetchHead(cwd, remote, ref) {
  const fetch = git(cwd, ['fetch', '--quiet', remote, `refs/heads/${ref}`]);
  if (!fetch.ok) return { problem: `could not fetch ${remote} ${ref} (${fetch.out.split('\n')[0] || 'no output'}); this proved nothing` };
  const tip = git(cwd, ['rev-parse', 'FETCH_HEAD']);
  if (!tip.ok) return { problem: `could not read the fetched ${ref} head (${tip.out}); this proved nothing` };
  return { tip: tip.out };
}

/** Why the working tree is not the committed code, or null when `git status --porcelain` prints nothing. */
function dirtyTreeProblem(cwd) {
  const status = git(cwd, ['status', '--porcelain']);
  if (!status.ok) return `could not read the git status (${status.out}); this proved nothing`;
  if (status.out === '') return null;
  const lines = status.out.split('\n');
  const shown = lines.slice(0, 5).map((line) => `  ${line}`);
  const more = lines.length > shown.length ? [`  ... and ${lines.length - shown.length} more`] : [];
  return ['the working tree has uncommitted or untracked files, so what is built may not be what is committed:', ...shown, ...more, 'Commit or remove them, and run release:check again.'].join('\n');
}

/** `{ problem, summary }` for a HEAD that must be on `remote`'s `main`; `lacks` says why, for a version cut from no rc branch. */
function headOnMain({ cwd, remote, main, lacks }) {
  const onMain = fetchHead(cwd, remote, main);
  if (onMain.problem !== undefined) return { problem: onMain.problem, summary: '' };
  const head = git(cwd, ['rev-parse', 'HEAD']);
  if (!head.ok) return { problem: `could not read HEAD (${head.out}); this proved nothing`, summary: '' };
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', head.out, onMain.tip], { cwd, encoding: 'utf8' });
  if (ancestor.status === 0) return { problem: null, summary: `${lacks.summary}HEAD (${head.out.slice(0, 7)}) is on ${remote}/${main} (${onMain.tip.slice(0, 7)}).` };
  if (ancestor.status !== 1) return { problem: `could not compare HEAD with ${remote}/${main} (${(ancestor.error?.message ?? ancestor.stderr).trim()}); this proved nothing`, summary: '' };
  return { problem: `${lacks.problem}HEAD (${head.out.slice(0, 7)}) is not on ${remote}/${main} (${onMain.tip.slice(0, 7)}): ${lacks.advice}`, summary: '' };
}

/**
 * What the rc branch check found, as `{ problem, summary }`: `problem` is null when HEAD in `cwd` may be published as
 * `version`, else the reason to stop; `summary` says which case passed. The working tree must be clean for every version.
 * A version with no rc branch (a final) has nothing to compare with but `remote`'s `main`, so HEAD must be on it.
 * When `remote` has the version's rc branch, HEAD must hold its head, and the problem names each pull request merged
 * there that HEAD lacks. When `remote` has no such branch, HEAD must be on `remote`'s `main`. A failed listing or fetch
 * is a problem too: it proves nothing about what the branches hold.
 */
export function rcBranchStatus({ version, cwd, remote = 'origin', main = 'main' }) {
  const dirty = dirtyTreeProblem(cwd);
  if (dirty !== null) return { problem: dirty, summary: '' };
  const branch = rcBranchFor(version);
  if (branch === null) {
    return headOnMain({
      cwd,
      remote,
      main,
      lacks: {
        summary: `${version} is not a release candidate, so there is no rc branch to compare; the working tree is clean and `,
        problem: `${version} is not a release candidate, so it is published from ${main}, and `,
        advice: `publish a commit that is on ${main}, and run release:check again.`,
      },
    });
  }
  // ls-remote exits 2 for a ref the remote does not have, and otherwise non-zero only when it could not ask.
  const listed = spawnSync('git', ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`], { cwd, encoding: 'utf8' });
  if (listed.error || (listed.status !== 0 && listed.status !== 2)) {
    return { problem: `could not list ${remote}'s branches (${(listed.error?.message ?? listed.stderr).trim().split('\n')[0] || 'no output'}); this proved nothing`, summary: '' };
  }
  if (listed.status === 2) {
    return headOnMain({
      cwd,
      remote,
      main,
      lacks: {
        summary: `${remote} has no ${branch}, and `,
        problem: `${remote} has no branch ${branch}, and `,
        advice: `publish a commit that is on ${main}, or push ${branch} at the commit to publish, and run release:check again.`,
      },
    });
  }
  const rc = fetchHead(cwd, remote, branch);
  if (rc.problem !== undefined) return { problem: rc.problem, summary: '' };
  const missing = git(cwd, ['log', '--first-parent', '--format=%h %s', `HEAD..${rc.tip}`]);
  if (!missing.ok) return { problem: `could not compare HEAD with ${branch} (${missing.out}); this proved nothing`, summary: '' };
  if (missing.out === '') return { problem: null, summary: `HEAD holds all of ${remote}/${branch}.` };
  const lines = missing.out.split('\n');
  const prs = pullRequestNumbers(lines.map((line) => line.slice(line.indexOf(' ') + 1)));
  const named = prs.length > 0 ? `pull request${prs.length === 1 ? '' : 's'} ${prs.map((n) => `#${n}`).join(', ')}` : 'commits';
  return {
    problem: [
      `${remote}/${branch} (${rc.tip.slice(0, 7)}) has ${named} that this checkout (HEAD) lacks:`,
      ...lines.map((line) => `  ${line}`),
      `Check out ${remote}/${branch}, or merge it, and run release:check again.`,
    ].join('\n'),
    summary: '',
  };
}

/** Null when HEAD may be published as `version` (see `rcBranchStatus`), else the reason to stop. */
export function rcBranchProblem(options) {
  return rcBranchStatus(options).problem;
}
