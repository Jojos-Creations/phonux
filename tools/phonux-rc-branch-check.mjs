#!/usr/bin/env node
/**
 * Re-checks, at the moment of publishing, that HEAD holds everything merged into the release candidate branch.
 * release:check prints this ahead of the publish command, because the branch can take a merge between the two.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhoneDir } from './phonux-paths.mjs';
import { rcBranchFor, rcBranchProblem } from './phonux-rc-branch.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(resolvePhoneDir(REPO_ROOT), 'package.json'), 'utf8'));

const problem = rcBranchProblem({ version, cwd: REPO_ROOT });
if (problem) {
  console.error(`rc branch check FAILED: ${problem}`);
  process.exit(1);
}
const branch = rcBranchFor(version);
console.log(branch ? `rc branch check OK -- HEAD holds all of origin/${branch}.` : `rc branch check: ${version} is not a release candidate, so there is no rc branch to compare.`);
