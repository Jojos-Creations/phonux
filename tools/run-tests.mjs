#!/usr/bin/env node
/**
 * Wraps `tsx --test` so a run that silently drops a requested file (Node's
 * own --test CLI re-resolves its file argv at start and tolerates a partial
 * miss as long as one match remains) exits non-zero and names the file,
 * instead of a clean-looking summary and exit 0 for fewer files than were
 * asked for.
 *
 * Usage: node tools/run-tests.mjs <file-or-flag ...>   (or: npm test)
 * Every argv token is forwarded to the real tsx/node --test child unchanged;
 * this script only adds its own machine-readable reporter alongside it.
 *
 * package.json's `scripts.test` key must keep the exact substring "test" --
 * the full-suite lease hook (.claude/coordinator-config.yaml) matches the
 * raw shell command text ("npm test"/"npm run test"), never this script's
 * internals, so renaming the key would silently escape that cap.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TSX_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const REPORTER_PATH = join(REPO_ROOT, 'tools', 'file-presence-reporter.mjs');

/**
 * An argv token counts as "requested" only if it resolves (relative to cwd,
 * matching how the shell/npm handed it to us) to a real file on disk right
 * now -- flag names and pattern values never do. Resolved to an ABSOLUTE
 * path because the reporter's own `data.file` is always absolute regardless
 * of how the file was named on argv; pinned by the "resolveRequestedFiles
 * resolves relative tokens..." test in test/run-tests-guard.test.ts.
 */
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

/** Pure set difference: requested files with no matching observed completion. */
export function missingFiles(requestedAbs, observedAbs) {
  const observed = new Set(observedAbs);
  return requestedAbs.filter((f) => !observed.has(f));
}

export function formatSummary({ repoRoot, requestedCount, observedCount, missing }) {
  const lines = [
    `run-tests: requested ${requestedCount} file(s), observed ${observedCount} file(s) complete.`,
  ];
  if (missing.length > 0) {
    lines.push(`run-tests: ${missing.length} requested file(s) never completed:`);
    for (const abs of missing) {
      lines.push(`  ${relative(repoRoot, abs)}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const forwardArgv = process.argv.slice(2);
  const cwd = process.cwd();
  const requestedAbs = resolveRequestedFiles(forwardArgv, cwd);

  const scratchDir = mkdtempSync(join(tmpdir(), 'phonux-run-tests-'));
  const observedDestination = join(scratchDir, 'observed-files.log');

  const childArgv = [
    '--test',
    '--test-timeout=900000',
    // --test-force-exit stays: unrelated to the file-drop bug above; removing
    // it hangs indefinitely on any file with imperfect teardown (Electron tests especially).
    '--test-force-exit',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    `--test-reporter=${REPORTER_PATH}`,
    `--test-reporter-destination=${observedDestination}`,
    ...forwardArgv,
  ];

  // process.exit() must stay outside the try: calling it from inside skips
  // the finally below, so the scratch dir would never get cleaned up.
  let exitCode;
  try {
    // 'close' (not 'exit'): fires once stdio has flushed, whether the child
    // exited cleanly, threw, or was signal-killed (code is then null) --
    // 'exit' alone can race the reporter file's own last write.
    const code = await new Promise((resolvePromise, reject) => {
      const child = spawn(TSX_BIN, childArgv, { cwd: REPO_ROOT, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => resolvePromise(code));
    });

    const observedAbs = existsSync(observedDestination)
      ? readFileSync(observedDestination, 'utf8').split('\n').filter((line) => line.length > 0)
      : [];
    const observedUnique = [...new Set(observedAbs)];
    const missing = missingFiles(requestedAbs, observedUnique);

    console.log(
      formatSummary({
        repoRoot: REPO_ROOT,
        requestedCount: requestedAbs.length,
        observedCount: observedUnique.length,
        missing,
      }),
    );

    exitCode = missing.length > 0 ? 1 : code === 0 ? 0 : code === null ? 1 : code;
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

// Only run the CLI when this file IS the entry point: importing it for its
// pure exports must not also spawn a child --test run and race its
// process.exit() against the importer's own assertions.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
