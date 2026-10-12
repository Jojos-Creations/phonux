/**
 * Whether package.json and package-lock.json name the same version. It only reads two files: nothing in this file
 * starts a process.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// npm ci and the packed tarball read different files, so a release whose two files disagree passes one and not the other.
export function lockfileVersionProblem(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const lockPath = join(packageDir, 'package-lock.json');
  if (!existsSync(lockPath)) return `package-lock.json is missing next to package.json (version ${manifest.version})`;
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const entries = [
    ['package-lock.json "version"', lock.version],
    ['package-lock.json packages[""].version', lock.packages?.['']?.version],
  ];
  const wrong = entries.filter(([, found]) => found !== manifest.version);
  if (wrong.length === 0) return null;
  const said = wrong.map(([where, found]) => `${where} is ${found === undefined ? 'absent' : found}`).join(' and ');
  return `package.json says version ${manifest.version} but ${said}; run npm install --package-lock-only so they agree`;
}
