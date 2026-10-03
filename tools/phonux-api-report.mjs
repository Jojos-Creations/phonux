#!/usr/bin/env node
/**
 * Regenerates (--local) or checks the committed API reports, one per key of the phonux exports map.
 * The check fails on any warning, or on a report that differs from what the source generates.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePhoneDir } from './phonux-paths.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_DIR = resolvePhoneDir(REPO_ROOT);
// A workspace member's declarations sit beside the host's source, out of its typecheck;
// where the package is the repo root they stay in its own api-extractor-temp/.
const TEMP_DIR = join(REPO_ROOT, PHONE_DIR === REPO_ROOT ? 'api-extractor-temp' : 'client/api-extractor-temp');
const DTS_DIR = join(TEMP_DIR, 'dts');
const REPORT_DIR = join(PHONE_DIR, 'etc');
const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');
const API_EXTRACTOR_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'api-extractor');
const CONFIG_FOR_EXPORT = {
  '.': 'api-extractor.json',
  './testing': 'api-extractor.testing.json',
  './internal/directionalTransition': 'api-extractor.internal.json',
  './internal/panelModel': 'api-extractor.panelModel.json',
};

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
  const reportTempFolder = json.apiReport?.reportTempFolder?.replace('<projectFolder>', PHONE_DIR);
  if (!entry || !reportName || !reportTempFolder) {
    fail(`${config} must state mainEntryPointFilePath, apiReport.reportFileName, and apiReport.reportTempFolder`);
  }
  return { config, entry, report: `${reportName}.api.md`, reportTempFolder };
}

// An exports-map key with no config would never get a report, and the gate would stay green.
const exportsMap = readJson(join(PHONE_DIR, 'package.json')).exports;
const unconfigured = Object.keys(exportsMap).filter((key) => !Object.hasOwn(CONFIG_FOR_EXPORT, key));
if (unconfigured.length > 0) fail(`package.json exports ${unconfigured.join(', ')} with no API Extractor config`);
const unexported = Object.keys(CONFIG_FOR_EXPORT).filter((key) => !Object.hasOwn(exportsMap, key));
if (unexported.length > 0) fail(`a config is mapped to ${unexported.join(', ')}, which package.json no longer exports`);

// Per key, not as a set: two configs with transposed entry points cover the same set of files,
// yet each report would then describe the other entry point's API.
const entries = Object.entries(CONFIG_FOR_EXPORT).map(([key, config]) => {
  const described = describeConfig(config);
  const source = exportsMap[key];
  if (typeof source !== 'string') fail(`package.json exports["${key}"] must be a plain path, got ${JSON.stringify(source)}`);
  const expected = join(DTS_DIR, source.replace(/\.tsx?$/, '.d.ts'));
  const actual = resolve(described.entry);
  if (actual !== expected) {
    fail(
      `exports["${key}"] is ${source}, so ${config} must read ${relative(REPO_ROOT, expected)}, ` +
        `but its mainEntryPointFilePath reads ${relative(REPO_ROOT, actual)}`,
    );
  }
  // Additive to the mainEntryPointFilePath check above: a stale reportTempFolder climb would
  // otherwise only surface late, via the missing-report-file check after tsc and api-extractor ran.
  const expectedReportTempFolder = join(TEMP_DIR, 'report');
  const actualReportTempFolder = resolve(described.reportTempFolder);
  if (actualReportTempFolder !== expectedReportTempFolder) {
    fail(
      `${config}'s apiReport.reportTempFolder must resolve to ${relative(REPO_ROOT, expectedReportTempFolder)}, ` +
        `but it resolves to ${relative(REPO_ROOT, actualReportTempFolder)}`,
    );
  }
  return described;
});

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
  // Some messages (ae-forgotten-export) go into the report, not stdout, and a report carrying one matches its
  // own regeneration, so API Extractor passes it. Footer lines carry the message id but no "Warning:".
  const embedded = readFileSync(committed, 'utf8').match(/^.*(?:Warning:|Warnings were encountered|\((?:ae|tsdoc)-[a-z-]+\)).*$/gm) ?? [];
  for (const line of embedded) problems.push(`${report} embeds ${line.trim()}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`${LABEL}: ${problem}`);
  fail(`${problems.length} problem(s)`);
}

console.log(`${LABEL} OK -- ${entries.length} report(s) processed, zero embedded warnings`);
