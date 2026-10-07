/**
 * The library is free of its host: no bridge, no web storage, nothing imported from outside its own root, and never itself by
 * package name. Each test plants a violating temp file as a live control, so a scan that read nothing cannot pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHONE_BOUNDARY_RULES, formatViolations, scanBoundary, type TextRule } from './support/boundary-scan.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every .ts/.tsx directly in the library root or in panels/: the published source. Not recursive, so dist/, test/ and tools/ are never read. */
const rootSources = (): string[] => readdirSync(ROOT).filter((f) => /[.]tsx?$/.test(f)).sort().map((f) => join(ROOT, f));
const panelSources = (): string[] => readdirSync(join(ROOT, 'panels')).filter((f) => /[.]tsx?$/.test(f)).sort().map((f) => join(ROOT, 'panels', f));

/** A floor under the scan (50 files): a wrong root or a moved folder scans fewer files and must fail, not pass. */
const MIN_LIBRARY_FILES = 49;
/** Files the scan must include by name, so a scan of the wrong directory cannot clear the floor. */
const CORE = ['PhoneDetectPrompt.tsx', 'PanelFrame.tsx', 'Panel.tsx', 'fakeHost.ts', 'phoneModels.ts', 'hostApi.tsx'];

/** Runs `fn` with a temp dir directly under the OS temp dir, removed even when an assertion throws. */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'phonux-boundary-'));
  try {
    assert.equal(dirname(dir), tmpdir());
    assert.ok(basename(dir).startsWith('phonux-boundary-'));
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const plant = (dir: string, name: string, lines: readonly string[]): string => {
  const file = join(dir, name);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
};

test('boundary: no library source touches the bridge, window.simplebrowser or web storage', () => {
  const files = [...rootSources(), ...panelSources()];
  for (const core of CORE) assert.ok(files.includes(join(ROOT, core)), `the scan never reached ${core}: it moved, or the directory is wrong`);
  assert.deepEqual(formatViolations(scanBoundary({ files, rules: PHONE_BOUNDARY_RULES, minFiles: MIN_LIBRARY_FILES }).violations, ROOT), []);
  withTempDir((dir) => {
    const planted = plant(dir, 'Planted.ts', ['const b = bridge().phone;', 'window.simplebrowser?.x;', "localStorage.getItem('k');"]);
    const hits = scanBoundary({ files: [planted], rules: PHONE_BOUNDARY_RULES, minFiles: 1 }).violations;
    assert.deepEqual(hits.map((v) => v.line), [1, 2, 3], formatViolations(hits, dir).join('\n'));
  });
});

// A root-level file climbs out with one `../`, a panels/ file with two; nothing may name the app's folders.
const ROOT_ESCAPE: TextRule = { name: 'imports outside the library root', pattern: /(['"`])[.]{2}\// };
const PANELS_ESCAPE: TextRule = { name: 'imports outside the library root', pattern: /(['"`])[.]{2}\/[.]{2}\// };
const APP_FOLDER: TextRule = { name: 'names an app folder', pattern: /(['"`])[^'"`\n]*\b(?:client\/src|electron)\// };

test('boundary: no library source imports outside the library root or names the app', () => {
  const rootFiles = rootSources();
  const panelFiles = panelSources();
  assert.ok(rootFiles.length + panelFiles.length >= MIN_LIBRARY_FILES, 'the scan read too few files to prove anything');
  const scan = (files: string[], rules: TextRule[]) => scanBoundary({ files, rules, minFiles: 1 }).violations;
  const found = [...scan(rootFiles, [ROOT_ESCAPE, APP_FOLDER]), ...scan(panelFiles, [PANELS_ESCAPE, APP_FOLDER])];
  assert.deepEqual(formatViolations(found, ROOT), []);
  withTempDir((dir) => {
    const planted = plant(dir, 'Planted.ts', ["import a from '../x.js';", "import b from '../client/src/x.js';", "import c from './ok.js';"]);
    const hits = scan([planted], [ROOT_ESCAPE, APP_FOLDER]);
    assert.deepEqual(hits.map((v) => v.line), [1, 2, 2], formatViolations(hits, dir).join('\n'));
    const deep = plant(dir, 'Deep.ts', ["import a from '../../x.js';", "import b from '../sibling.js';"]);
    assert.deepEqual(scan([deep], [PANELS_ESCAPE]).map((v) => v.line), [1], 'a panels/ file may import its parent, but not climb past it');
  });
});

const SELF_IMPORT: TextRule = { name: "imports 'phonux' by its own name", pattern: /(['"`])phonux(?:\/[^'"`]*)?\1/ };

test("boundary: no library source imports 'phonux' by its own name", () => {
  const files = [...rootSources(), ...panelSources()];
  assert.deepEqual(formatViolations(scanBoundary({ files, rules: [SELF_IMPORT], minFiles: MIN_LIBRARY_FILES }).violations, ROOT), []);
  withTempDir((dir) => {
    const planted = plant(dir, 'Planted.ts', ["import a from 'phonux';", 'import { b } from "phonux/testing";', "export { c } from 'phonux/some/subpath';", "const d = await import('phonux');", 'const e = require(`phonux`);', "type F = import('phonux').PanelsAPI;"]);
    const clean = plant(dir, 'Clean.ts', ["import g from './phonux.js';", "import h from 'phonuxx';", "import j from 'notphonux';", "// import k from 'phonux';", '/* import l from "phonux/testing" */', 'const m = "phonux is the name";']);
    assert.deepEqual(scanBoundary({ files: [planted], rules: [SELF_IMPORT], minFiles: 1 }).violations.map((v) => v.line), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(scanBoundary({ files: [clean], rules: [SELF_IMPORT], minFiles: 1 }).violations, []);
  });
});
