#!/usr/bin/env node
/**
 * Builds the phonux package to dist/ and generates dist/package.json from the source manifest.
 * In-repo dev and test never run this: the source manifest's exports point at .ts.
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
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhoneDir } from './phonux-paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_DIR = resolvePhoneDir(REPO_ROOT);
const DIST_DIR = join(PHONE_DIR, 'dist');
const TSCONFIG = join(PHONE_DIR, 'tsconfig.build.json');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

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
  const withoutExt = sourcePath.replace(/\.tsx?$/, '');
  return { js: `${withoutExt}.js`, dts: `${withoutExt}.d.ts` };
}

const exports = {};
for (const [key, sourcePath] of Object.entries(srcPkg.exports)) {
  const { js, dts } = distExportPaths(sourcePath);
  // 'types' must be listed first in each condition or a resolver can miss the .d.ts entirely.
  exports[key] = { types: dts, import: js };
  for (const [label, relPath] of [['types', dts], ['import', js]]) {
    const abs = join(DIST_DIR, relPath);
    if (!existsSync(abs)) fail(`generated exports['${key}'].${label} points at ${relPath}, which tsc did not emit`);
  }
}

const bin = {};
for (const [name, sourcePath] of Object.entries(srcPkg.bin ?? {})) {
  bin[name] = distExportPaths(sourcePath).js;
  if (!existsSync(join(DIST_DIR, bin[name]))) fail(`generated bin['${name}'] points at ${bin[name]}, which tsc did not emit`);
  // npm links a bin without a shebang, and the shell then runs it as a shell script.
  if (!readFileSync(join(DIST_DIR, bin[name]), 'utf8').startsWith('#!/usr/bin/env node')) fail(`${bin[name]} lost its #!/usr/bin/env node line`);
}

// Gates consumer tree-shaking; a silent undefined default could drop a real side effect.
if (!('sideEffects' in srcPkg)) fail("source package.json is missing 'sideEffects'");

// Registry-page fields come from the source manifest, never from a literal here. The source keeps `private: true`
// so the .ts-pointing folder cannot be published by accident; only dist/package.json is publishable.
const REQUIRED_METADATA = ['description', 'license'];
const OPTIONAL_METADATA = ['repository', 'homepage', 'bugs', 'keywords', 'author'];
for (const field of REQUIRED_METADATA) {
  if (!srcPkg[field]) fail(`source package.json is missing '${field}', which a published manifest needs`);
}
const metadata = Object.fromEntries([...REQUIRED_METADATA, ...OPTIONAL_METADATA].filter((f) => f in srcPkg).map((f) => [f, srcPkg[f]]));

const distPkg = {
  name: srcPkg.name,
  version: srcPkg.version,
  ...metadata,
  type: srcPkg.type,
  sideEffects: srcPkg.sideEffects,
  // A scoped name would otherwise publish as restricted; stating it keeps "public" true whichever name is chosen.
  publishConfig: { access: 'public' },
  dependencies: srcPkg.dependencies,
  peerDependencies: srcPkg.peerDependencies,
  ...(srcPkg.peerDependenciesMeta === undefined ? {} : { peerDependenciesMeta: srcPkg.peerDependenciesMeta }),
  ...(Object.keys(bin).length === 0 ? {} : { bin }),
  exports,
};

writeFileSync(join(DIST_DIR, 'package.json'), `${JSON.stringify(distPkg, null, 2)}\n`);

// README is the registry page; DESIGN.md travels with it so the README can point at a file the consumer has, and the notices file
// because the package carries third-party data.
for (const name of ['README.md', 'DESIGN.md', 'THIRD_PARTY_NOTICES.md']) {
  const from = join(PHONE_DIR, name);
  if (!existsSync(from)) fail(`${relative(REPO_ROOT, from)} is missing; dist/ needs a copy for npm pack`);
  copyFileSync(from, join(DIST_DIR, name));
}
// An SPDX id with no LICENSE text grants nothing on a public package; UNLICENSED and SEE LICENSE IN need no file.
const licenseSrc = join(PHONE_DIR, 'LICENSE');
const hasLicenseFile = existsSync(licenseSrc);
if (hasLicenseFile) copyFileSync(licenseSrc, join(DIST_DIR, 'LICENSE'));

console.log(`build:phonux OK -- wrote ${relative(REPO_ROOT, DIST_DIR)}/{package.json,README.md,DESIGN.md,THIRD_PARTY_NOTICES.md${hasLicenseFile ? ',LICENSE' : ''}} and ${Object.keys(exports).length} export target(s)`);
