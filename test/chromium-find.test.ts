/**
 * The rendered tests' browser search (test/support/chromium.ts) finds a cached headless shell under either name Playwright has
 * shipped it as, so a machine holding only the older `headless_shell` download does not report "no Chromium" and skip.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedChromium } from './support/chromium.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A Playwright download folder holding `files` (paths under it), each an empty file. */
function cache(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pw-cache-'));
  made.push(root);
  for (const f of files) {
    mkdirSync(join(root, f, '..'), { recursive: true });
    writeFileSync(join(root, f), '');
  }
  return root;
}

test('an older headless shell download named headless_shell is found', () => {
  const root = cache(['chromium_headless_shell-1194/chrome-mac/headless_shell']);
  assert.equal(cachedChromium([root]), join(root, 'chromium_headless_shell-1194/chrome-mac/headless_shell'));
});

test('a newer chrome-headless-shell download is found, and the newest revision wins over an older headless_shell', () => {
  const root = cache(['chromium_headless_shell-1194/chrome-mac/headless_shell', 'chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell']);
  assert.equal(cachedChromium([root]), join(root, 'chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell'));
});

test('a folder with no browser binary, and a root that does not exist, find nothing', () => {
  const root = cache(['chromium_headless_shell-1194/chrome-mac/README']);
  assert.equal(cachedChromium([root, join(root, 'missing'), undefined]), undefined);
});
