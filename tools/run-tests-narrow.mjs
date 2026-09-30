#!/usr/bin/env node
// `npm test -- <file>` still runs every file (npm appends it after the glob): hence this wrapper.
// The package.json key must never be "test" plus a separator (test-file, test:file, test.file): the
// full-suite lease hook matches `npm run test\b` in the raw command text. `file-test` does not match.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHILD_BASE_FLAGS, missingFiles, resolveRequestedFiles } from './run-tests.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
export const FILE_PRESENCE_REPORTER = join(REPO_ROOT, 'tools', 'file-presence-reporter.mjs');
export const NARROW_MATCH_REPORTER = join(REPO_ROOT, 'tools', 'narrow-match-reporter.mjs');

const PATTERN_FLAG = '--test-name-pattern';
// `-t` and `--grep` exist only in this wrapper (Node has neither); both become --test-name-pattern.
const PATTERN_SPELLINGS = new Set(['-t', '--grep', PATTERN_FLAG]);
const USAGE =
  'usage: npm run file-test -- <file...> [-t <pattern> | --grep <pattern> | --test-name-pattern=<pattern>]';

export function parseNarrowArgs(argvTokens) {
  const flags = [];
  const fileTokens = [];
  const patterns = [];
  for (let i = 0; i < argvTokens.length; i += 1) {
    const token = argvTokens[i];
    if (token === '--') continue;
    const eq = token.indexOf('=');
    const name = eq > 0 ? token.slice(0, eq) : token;
    if (PATTERN_SPELLINGS.has(name)) {
      const value = eq > 0 ? token.slice(eq + 1) : argvTokens[++i];
      if (value === undefined || value === '') {
        return { error: `${name} needs a non-empty pattern` };
      }
      patterns.push(value);
    } else if (name.startsWith('--test-reporter')) {
      // A third --test-reporter trips MaxListenersExceededWarning on Node's
      // shared TestsStream; this wrapper always runs exactly two.
      return { error: `${name} is set by this wrapper and cannot be passed` };
    } else if (token.startsWith('-')) {
      // A Node flag that takes a value must be `--flag=value`, or the value is read as a file token.
      flags.push(token);
    } else {
      fileTokens.push(token);
    }
  }
  return { flags, fileTokens, patterns };
}

export function resolveNarrowFiles(fileTokens, cwd) {
  const notFiles = fileTokens.filter((token) => resolveRequestedFiles([token], cwd).length === 0);
  // Real paths: a test's data.file is the loader's real path while the file-level event echoes argv
  // (/var vs /private/var on macOS), so an unresolved path would read as a zero-match.
  const requestedAbs = [...new Set(resolveRequestedFiles(fileTokens, cwd).map((abs) => realpathSync(abs)))];
  return { requestedAbs, notFiles };
}

export function selectReporter(patterns) {
  return patterns.length > 0 ? NARROW_MATCH_REPORTER : FILE_PRESENCE_REPORTER;
}

export function buildChildArgv({ flags, patterns, files, reporterPath, reporterDestination }) {
  return [
    '--test',
    ...CHILD_BASE_FLAGS,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${reporterPath}`,
    `--test-reporter-destination=${reporterDestination}`,
    // Flags go before the files: Node 24 silently ignores --test-name-pattern after a file positional.
    ...flags,
    ...patterns.map((pattern) => `${PATTERN_FLAG}=${pattern}`),
    ...files,
  ];
}

export function parseReporterOutput(text, patternActive) {
  const lines = text.split('\n').filter((line) => line.length > 0);
  if (!patternActive) {
    return { observedAbs: [...new Set(lines)], matchedAbs: [] };
  }
  const observed = new Set();
  const matched = new Set();
  for (const line of lines) {
    if (line.startsWith('FILE:')) observed.add(line.slice('FILE:'.length));
    else if (line.startsWith('MATCH:')) matched.add(line.slice('MATCH:'.length));
  }
  return { observedAbs: [...observed], matchedAbs: [...matched] };
}

export function zeroMatchFiles(requestedAbs, observedAbs, matchedAbs) {
  const observed = new Set(observedAbs);
  const matched = new Set(matchedAbs);
  return requestedAbs.filter((f) => observed.has(f) && !matched.has(f));
}

export function formatNarrowSummary({ repoRoot, requestedCount, observedCount, missing, patterns, zeroMatch }) {
  const lines = [
    `run-tests-narrow: requested ${requestedCount} file(s), observed ${observedCount} file(s) complete.`,
  ];
  if (missing.length > 0) {
    lines.push(`run-tests-narrow: ${missing.length} requested file(s) never completed:`);
    for (const abs of missing) lines.push(`  ${relative(repoRoot, abs)}`);
  }
  if (zeroMatch.length > 0) {
    const shown = patterns.map((pattern) => `${PATTERN_FLAG}=${JSON.stringify(pattern)}`).join(' ');
    const files = zeroMatch.map((abs) => relative(repoRoot, abs)).join(', ');
    lines.push(`run-tests-narrow: ${shown} matched ZERO tests in ${zeroMatch.length} file(s): ${files}`);
  }
  return lines.join('\n');
}

export function narrowExitCode({ childCode, missing, zeroMatch }) {
  if (missing.length > 0 || zeroMatch.length > 0) return 1;
  if (childCode === null) return 1;
  return childCode;
}

async function main() {
  const parsed = parseNarrowArgs(process.argv.slice(2));
  if (parsed.error) {
    console.error(`run-tests-narrow: ${parsed.error}\n${USAGE}`);
    process.exit(1);
  }
  const { flags, fileTokens, patterns } = parsed;
  if (fileTokens.length === 0) {
    console.error(
      `run-tests-narrow: no test file given; name at least one file (this never falls back to the full suite).\n${USAGE}`,
    );
    process.exit(1);
  }
  const { requestedAbs, notFiles } = resolveNarrowFiles(fileTokens, process.cwd());
  if (notFiles.length > 0) {
    console.error(`run-tests-narrow: not a file: ${notFiles.join(', ')}\n${USAGE}`);
    process.exit(1);
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'phonux-run-tests-narrow-'));
  const reporterDestination = join(scratchDir, 'observed-files.log');
  const childArgv = buildChildArgv({
    flags,
    patterns,
    files: requestedAbs,
    reporterPath: selectReporter(patterns),
    reporterDestination,
  });

  let exitCode;
  try {
    const childCode = await new Promise((resolvePromise, reject) => {
      const child = spawn(TSX_BIN, childArgv, { cwd: REPO_ROOT, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => resolvePromise(code));
    });

    const text = existsSync(reporterDestination) ? readFileSync(reporterDestination, 'utf8') : '';
    const { observedAbs, matchedAbs } = parseReporterOutput(text, patterns.length > 0);
    const missing = missingFiles(requestedAbs, observedAbs);
    const zeroMatch = patterns.length > 0 ? zeroMatchFiles(requestedAbs, observedAbs, matchedAbs) : [];

    console.log(
      formatNarrowSummary({
        repoRoot: REPO_ROOT,
        requestedCount: requestedAbs.length,
        observedCount: observedAbs.length,
        missing,
        patterns,
        zeroMatch,
      }),
    );
    exitCode = narrowExitCode({ childCode, missing, zeroMatch });
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
