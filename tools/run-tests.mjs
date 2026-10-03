#!/usr/bin/env node
// Fails a run that Node's exit code would pass: a requested file that never completed, one whose results stopped early, or no test at all.
// It also refuses to start on a file that registers after an await: --test-force-exit drops that test and leaves no line in the stream.
// Node's --test CLI re-resolves its file argv at start and tolerates a partial miss while one match remains.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatLateScan, lateScanFailed, scanLateRegistrations } from './late-registration-scan.mjs';
import { formatStopped, parseStreamLines, realKey, stoppedEarly, streamTotals } from './test-stream.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const REPORTER_PATH = join(REPO_ROOT, 'tools', 'file-presence-reporter.mjs');

// Absolute paths, because the reporter's data.file is always absolute however argv spelled the file.
export function resolveRequestedFiles(argvTokens, cwd) {
  const seen = new Set();
  const requested = [];
  for (const token of argvTokens) {
    const abs = resolve(cwd, token);
    if (seen.has(abs)) continue;
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    seen.add(abs);
    requested.push(abs);
  }
  return requested;
}

export function missingFiles(requestedAbs, observedAbs) {
  const observed = new Set(observedAbs);
  return requestedAbs.filter((f) => !observed.has(f));
}

export function formatSummary({ repoRoot, requestedCount, observedCount, missing, stopped = [], ranNothing = false }) {
  const lines = [
    `run-tests: requested ${requestedCount} file(s), observed ${observedCount} file(s) complete.`,
  ];
  if (missing.length > 0) {
    lines.push(`run-tests: ${missing.length} requested file(s) never completed:`);
    for (const abs of missing) {
      lines.push(`  ${relative(repoRoot, abs)}`);
    }
  }
  lines.push(...formatStopped(stopped, (abs) => relative(repoRoot, abs), 'run-tests: '));
  if (ranNothing) lines.push('run-tests: no test was queued: this run proved nothing.');
  return lines.join('\n');
}

// argv[1] keeps a symlinked spelling (/var vs /private/var) while import.meta.url is the real path;
// compared raw, main() would silently never run and the process would exit 0.
export function isEntryPoint(metaUrl, argv1) {
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

export function runExitCode({ childCode, missing, stopped, ranNothing }) {
  if (missing.length > 0 || stopped.length > 0 || ranNothing) return 1;
  return childCode === 0 ? 0 : childCode === null ? 1 : childCode;
}

export const FLUSH_PRELOAD_PATH = join(REPO_ROOT, 'tools', 'flush-stdout-before-exit.mjs');
// --test-force-exit stays: a file with imperfect teardown hangs the run without it.
export const CHILD_BASE_FLAGS = ['--test-timeout=900000', '--test-force-exit', `--import=${FLUSH_PRELOAD_PATH}`];

export function buildRunTestsArgv({ reporterDestination, forwardArgv }) {
  return [
    '--test',
    ...CHILD_BASE_FLAGS,
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER_PATH}`,
    `--test-reporter-destination=${reporterDestination}`,
    ...forwardArgv,
  ];
}

async function main() {
  const forwardArgv = process.argv.slice(2);
  const cwd = process.cwd();
  const requestedAbs = resolveRequestedFiles(forwardArgv, cwd);

  const lateScan = { repoRoot: REPO_ROOT, ...scanLateRegistrations(requestedAbs) };
  if (lateScanFailed(lateScan)) {
    console.log(formatLateScan(lateScan).join('\n'));
    process.exit(1);
  }

  const scratchDir = mkdtempSync(join(tmpdir(), 'phonux-run-tests-'));
  const observedDestination = join(scratchDir, 'observed-files.log');

  const childArgv = buildRunTestsArgv({ reporterDestination: observedDestination, forwardArgv });

  // process.exit() must stay outside the try: calling it from inside skips
  // the finally below, so the scratch dir would never get cleaned up.
  let exitCode;
  try {
    // 'close', not 'exit': 'exit' alone can race the reporter file's own last write, while 'close' fires once stdio has flushed.
    const code = await new Promise((resolvePromise, reject) => {
      const child = spawn(TSX_BIN, childArgv, { cwd: REPO_ROOT, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => resolvePromise(code));
    });

    const parsed = parseStreamLines(
      existsSync(observedDestination) ? readFileSync(observedDestination, 'utf8') : '',
      realKey,
    );
    const requestedReal = [...new Set(requestedAbs.map(realKey))];
    const observedUnique = [...parsed.completed];
    const missing = missingFiles(requestedReal, observedUnique);
    const stopped = stoppedEarly(requestedReal, observedUnique, parsed);
    const ranNothing = requestedReal.length > 0 && streamTotals(parsed).queued === 0;

    console.log(
      `${formatSummary({
        repoRoot: REPO_ROOT,
        requestedCount: requestedReal.length,
        observedCount: observedUnique.length,
        missing,
        stopped,
        ranNothing,
      })}\n${formatLateScan(lateScan).join('\n')}`,
    );

    exitCode = runExitCode({ childCode: code, missing, stopped, ranNothing });
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

// Only run the CLI when this file is the entry point: importing it for its exports must not spawn a child --test run
// or call process.exit() under the importer's own assertions.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  main();
}
