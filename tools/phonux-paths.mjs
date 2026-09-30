/**
 * Where the phonux package lives, for the phonux tools. In this repo it is a workspace member; in its own
 * repo the package IS the repo root and there is no `workspaces` key, so the lookup must not require one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const PHONUX_PACKAGE_NAME = 'phonux';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function resolvePhoneDir(repoRoot) {
  const members = readJson(join(repoRoot, 'package.json')).workspaces;
  const candidates = Array.isArray(members) && members.length > 0 ? members.map((m) => resolve(repoRoot, m)) : [repoRoot];
  // By name, not workspaces[0]: another member listed first would otherwise be built and reported green as phonux.
  const found = candidates.filter((dir) => existsSync(join(dir, 'package.json')) && readJson(join(dir, 'package.json')).name === PHONUX_PACKAGE_NAME);
  if (found.length !== 1) {
    const where = candidates.map((dir) => relative(repoRoot, dir) || '.').join(', ');
    throw new Error(`expected exactly one package named "${PHONUX_PACKAGE_NAME}" in [${where}], found ${found.length} (glob workspaces are not supported)`);
  }
  return found[0];
}
