#!/usr/bin/env node
/**
 * Builds the phonux package (client/src/shared/phone) to dist/ for packing.
 * In-repo dev/test never runs this: package.json's own exports still point at
 * .ts source, so this script exists only for `npm pack`/`npm run smoke:phonux`.
 *
 * Usage: node tools/phonux-build.mjs   (or: npm run build:phonux)
 *
 * Compiles with tsc -p <phone>/tsconfig.build.json (declaration:true, excludes
 * *.typecheck.ts), then GENERATES dist/package.json from the source
 * package.json -- exports rewritten relative to dist/ with 'types' first in
 * each condition, every INTERNAL_ONLY_EXPORT_KEYS subpath ('./internal/directionalTransition',
 * './internal/panelModel') dropped (they stay in-repo-only, resolved via the unbuilt
 * package.json instead), and copies README.md alongside it.
 */

import { execFileSync } from 'node:child_process';
import {
  rmSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// Discovered from the workspace, not a hardcoded literal, so this script keeps
// working if phone/ moves to a different nesting depth (e.g. a repo split).
const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const PHONE_DIR = resolve(REPO_ROOT, rootPkg.workspaces[0]);
const DIST_DIR = join(PHONE_DIR, 'dist');
const TSCONFIG = join(PHONE_DIR, 'tsconfig.build.json');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

// Subpaths only this repo's own app resolves; an outside consumer has no use for them, so they never
// appear in the shipped exports map.
const INTERNAL_ONLY_EXPORT_KEYS = new Set(['./internal/directionalTransition', './internal/panelModel']);

function fail(message) {
  console.error(`build:phonux FAILED: ${message}`);
  process.exit(1);
}

// Deleted first: a stale dist/ passing this script's own file-existence checks
// would look identical to a build that actually ran.
rmSync(DIST_DIR, { recursive: true, force: true });

execFileSync(TSC_BIN, ['-p', TSCONFIG], { cwd: REPO_ROOT, stdio: 'inherit' });

if (!existsSync(DIST_DIR)) fail(`tsc reported success but ${relative(REPO_ROOT, DIST_DIR)} was never created`);

// Defense in depth: the tsconfig's own exclude should already keep these out;
// a leaked fixture in dist/ would ship test-only code to every consumer.
function findLeaked(dir) {
  const leaked = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      leaked.push(...findLeaked(full));
    } else if (/\.typecheck\.|fixture/i.test(entry.name)) {
      leaked.push(relative(DIST_DIR, full));
    }
  }
  return leaked;
}
const leaked = findLeaked(DIST_DIR);
if (leaked.length > 0) fail(`typecheck/fixture files leaked into dist: ${leaked.join(', ')}`);

const srcPkg = JSON.parse(readFileSync(join(PHONE_DIR, 'package.json'), 'utf8'));

function distExportPaths(sourcePath) {
  // sourcePath is e.g. './index.ts' -- same basename, extension swapped, now under dist/.
  const withoutExt = sourcePath.replace(/\.tsx?$/, '');
  return { js: `${withoutExt}.js`, dts: `${withoutExt}.d.ts` };
}

const exports = {};
for (const [key, sourcePath] of Object.entries(srcPkg.exports)) {
  if (INTERNAL_ONLY_EXPORT_KEYS.has(key)) continue;
  const { js, dts } = distExportPaths(sourcePath);
  // 'types' must be listed first in each condition or a resolver can miss the .d.ts entirely.
  exports[key] = { types: dts, import: js };
  for (const [label, relPath] of [['types', dts], ['import', js]]) {
    const abs = join(DIST_DIR, relPath);
    if (!existsSync(abs)) fail(`generated exports['${key}'].${label} points at ${relPath}, which tsc did not emit`);
  }
}

// Gates consumer tree-shaking; a silent undefined default could drop a real side effect.
if (!('sideEffects' in srcPkg)) fail("source package.json is missing 'sideEffects'");

const distPkg = {
  name: srcPkg.name,
  version: srcPkg.version,
  private: true,
  type: srcPkg.type,
  sideEffects: srcPkg.sideEffects,
  peerDependencies: srcPkg.peerDependencies,
  exports,
};

writeFileSync(join(DIST_DIR, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);

const readmeSrc = join(PHONE_DIR, 'README.md');
if (!existsSync(readmeSrc)) fail(`${relative(REPO_ROOT, readmeSrc)} is missing; dist/ needs a copy for npm pack`);
copyFileSync(readmeSrc, join(DIST_DIR, 'README.md'));

console.log(`build:phonux OK -- wrote ${relative(REPO_ROOT, DIST_DIR)}/{package.json,README.md} and ${Object.keys(exports).length} export target(s)`);
