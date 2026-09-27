#!/usr/bin/env node
/**
 * Regenerates or checks the committed API reports of the phonux package
 * (client/src/shared/phone/etc/*.api.md), one per entry in its package.json exports map.
 *
 * Usage: npm run api-report:update   (node tools/phonux-api-report.mjs --local: rewrites the reports)
 *        npm run check:api-report    (node tools/phonux-api-report.mjs: fails on any warning, or on
 *                                     a report that no longer matches the source)
 *
 * tsc emits declarations into client/api-extractor-temp/, a sibling of client/src, so typecheck:app,
 * the file-size ratchet and the phone-boundary scan never see them; API Extractor reads them from there.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_DIR = join(REPO_ROOT, 'client/src/shared/phone');
const TEMP_DIR = join(REPO_ROOT, 'client/api-extractor-temp');
const REPORT_DIR = join(PHONE_DIR, 'etc');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
const API_EXTRACTOR_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'api-extractor');
const CONFIGS = ['api-extractor.json', 'api-extractor.testing.json', 'api-extractor.internal.json'];

const LOCAL = process.argv.includes('--local');
const LABEL = LOCAL ? 'api-report:update' : 'check:api-report';

function fail(message) {
  console.error(`${LABEL} FAILED: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Each extended config restates its own entry point and apiReport, so reading one file is enough.
function describeConfig(config) {
  const json = readJson(join(PHONE_DIR, config));
  const entry = json.mainEntryPointFilePath?.replace('<projectFolder>', PHONE_DIR);
  const reportName = json.apiReport?.reportFileName;
  if (!entry || !reportName) fail(`${config} must state mainEntryPointFilePath and apiReport.reportFileName`);
  return { config, entry, report: `${reportName}.api.md` };
}

const entries = CONFIGS.map(describeConfig);

// An exports-map entry with no config would never get a report, and the gate would stay green.
const exportTargets = Object.values(readJson(join(PHONE_DIR, 'package.json')).exports)
  .map((source) => basename(source).replace(/\.tsx?$/, '.d.ts'))
  .sort();
const configTargets = entries.map((e) => basename(e.entry)).sort();
if (JSON.stringify(exportTargets) !== JSON.stringify(configTargets)) {
  fail(`package.json exports map to [${exportTargets.join(', ')}] but the configs read [${configTargets.join(', ')}]`);
}

// Deleted first: a stale declaration or temp report would look identical to one this run produced.
rmSync(TEMP_DIR, { recursive: true, force: true });

execFileSync(TSC_BIN, ['-p', join(PHONE_DIR, 'tsconfig.api-extractor.json')], { cwd: REPO_ROOT, stdio: 'inherit' });

for (const { entry } of entries) {
  if (!existsSync(entry)) fail(`tsc reported success but ${relative(REPO_ROOT, entry)} was never emitted`);
}

const failedConfigs = [];
for (const { config } of entries) {
  const args = ['run', ...(LOCAL ? ['--local'] : []), '--config', join(PHONE_DIR, config)];
  try {
    execFileSync(API_EXTRACTOR_BIN, args, { cwd: REPO_ROOT, stdio: 'inherit' });
  } catch {
    failedConfigs.push(config);
  }
}

const problems = failedConfigs.map((config) => `api-extractor exited non-zero for ${config}`);

for (const { config, report } of entries) {
  // The temp folder was emptied above, so this file exists only if API Extractor really ran.
  if (!existsSync(join(TEMP_DIR, 'report', report))) {
    problems.push(`${config} produced no report in ${relative(REPO_ROOT, TEMP_DIR)}/report`);
  }
  const committed = join(REPORT_DIR, report);
  if (!existsSync(committed)) {
    problems.push(`${relative(REPO_ROOT, committed)} is missing`);
    continue;
  }
  // Messages such as ae-forgotten-export go into the report file instead of stdout, and a report that
  // already carries one matches its own regeneration, so API Extractor alone would pass it.
  const embedded = readFileSync(committed, 'utf8').match(/^.*Warning:.*$/gm) ?? [];
  for (const line of embedded) problems.push(`${report} embeds ${line.trim()}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`${LABEL}: ${problem}`);
  fail(`${problems.length} problem(s)`);
}

console.log(`${LABEL} OK -- ${entries.length} report(s) processed, zero embedded warnings`);
