#!/usr/bin/env node
/**
 * Pre-publish check: name@version must still be free on the registry and the built package must pass the publish
 * gate, then it PRINTS the publish command for the owner to run by hand. It never publishes and never logs in.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhoneDir } from './phonux-paths.mjs';
import { lockfileVersionProblem } from './phonux-lockfile-version.mjs';
import { publishCommand } from './phonux-publish-command.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_DIR = resolvePhoneDir(REPO_ROOT);
const { name, version } = JSON.parse(readFileSync(join(PHONE_DIR, 'package.json'), 'utf8'));
const spec = `${name}@${version}`;

function fail(message) {
  console.error(`release:check FAILED: ${message}`);
  process.exit(1);
}

const lockProblem = lockfileVersionProblem(PHONE_DIR);
if (lockProblem) fail(lockProblem);

const levelCheck = spawnSync(join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [fileURLToPath(new URL('./phonux-api-level-version.ts', import.meta.url)), PHONE_DIR], { encoding: 'utf8' });
if (levelCheck.error) fail(`could not run the panel API level check (${levelCheck.error.message}); this proved nothing`);
if (levelCheck.status !== 0) fail(levelCheck.stderr.trim() || `the panel API level check exited ${levelCheck.status}`);

// Cheapest check first: a taken name@version makes the rest of the run pointless, and versions are never reusable.
const view = spawnSync('npm', ['view', spec, 'version'], { encoding: 'utf8' });
if (view.error) fail(`could not run npm view for ${spec} (${view.error.message}); this proved nothing`);
const viewOut = `${view.stdout}${view.stderr}`;
if (view.status === 0 && view.stdout.trim() !== '') {
  fail(`${spec} is already published (registry says ${view.stdout.trim()}); bump the version in ${relative(REPO_ROOT, join(PHONE_DIR, 'package.json'))}`);
}
// Offline, an auth wall and a registry outage also exit non-zero; none of them is proof the name is free.
if (!viewOut.includes('E404')) {
  fail(`could not tell whether ${spec} is free (npm view said: ${viewOut.split('\n')[0] || 'nothing'}); this proved nothing`);
}

const build = spawnSync(process.execPath, [fileURLToPath(new URL('./phonux-build.mjs', import.meta.url))], { stdio: 'inherit' });
if (build.status !== 0) fail(`node tools/phonux-build.mjs exited ${build.status}`);
const smoke = spawnSync(process.execPath, [fileURLToPath(new URL('./phonux-pack-smoke.mjs', import.meta.url))], { stdio: 'inherit' });
if (smoke.status !== 0) fail(`node tools/phonux-pack-smoke.mjs exited ${smoke.status}`);

const distDir = relative(process.cwd(), join(PHONE_DIR, 'dist')) || '.';
console.log(`release:check OK -- ${spec} is free on the registry and the built package passed the publish gate.`);
console.log('Publish it yourself (this script never does), with your npm account and 2FA code ready:');
console.log(`  ${publishCommand(version, distDir)}`);
