/**
 * The release gate's source check for the settings catalog: every name has a differential call in exactly one test file,
 * that file is one the owning entries wrote, and every name has a `matrix:NAME` probe. The search is over the text of
 * test/*.test.ts, so a differential renamed or deleted in a test file turns this red.
 *
 * The search string is concatenated from its parts: neither this file nor the matrix file contains a literal
 * differential call for a catalog name, so neither can satisfy the check for a name by itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_SETTINGS_CATALOG } from '../index.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const NAMES: readonly string[] = PANEL_SETTINGS_CATALOG.map((d) => d.name);

const OWNING_BASENAMES = [
  'settings-enforcement-permissions',
  'settings-enforcement-visibility',
  'settings-enforcement-motion',
  'panel-placement',
  'settings-enforcement-tuning',
  'keep-mounted',
  'settings-enforcement-overflow',
  'settings-enforcement-scroll',
  'settings-enforcement-edge-scroll',
  'settings-enforcement-memory',
  'workspace-attach',
  'panel-manager-operations',
  'panel-pin',
  'header-buttons',
  'max-live-panels-count',
] as const;
const OWNING_FILES: readonly string[] = OWNING_BASENAMES.map((b) => `${b}.test.ts`);

const TEST_FILES: readonly string[] = readdirSync(TEST_DIR).filter((n) => n.endsWith('.test.ts')).sort();
const TEXT = new Map<string, string>(TEST_FILES.map((n) => [n, readFileSync(join(TEST_DIR, n), 'utf8')]));

const callOf = (name: string): string => ["differential('", name, "'"].join('');
const probeOf = (name: string): string => ["test('matrix:", name, "'"].join('');

function holders(texts: ReadonlyMap<string, string>, name: string): string[] {
  const found: string[] = [];
  for (const [file, text] of texts) {
    const needle = callOf(name);
    for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) found.push(file);
  }
  return found;
}

test('S7 sources: the search runs over every test file and the catalog has 64 names', () => {
  assert.equal(NAMES.length, 64);
  assert.equal(new Set(NAMES).size, 64);
  assert.equal(TEST_FILES.length > 50, true, `found ${TEST_FILES.length} test files`);
  assert.deepEqual(
    OWNING_FILES.filter((f) => !TEXT.has(f)),
    [],
    'every owning differential file exists',
  );
});

test('S7 sources: the search finds a call, ignores a renamed one and counts repeats', () => {
  const planted = new Map([
    ['one.test.ts', `${callOf('closable')}, () => {});\n`],
    ['two.test.ts', `${callOf('closable_')}, () => {});\n${callOf('listed')}, () => {});\n${callOf('listed')}, () => {});\n`],
  ]);
  assert.deepEqual(holders(planted, 'closable'), ['one.test.ts'], 'a renamed call is not a call for the name');
  assert.deepEqual(holders(planted, 'listed'), ['two.test.ts', 'two.test.ts'], 'a repeated call is counted twice');
  assert.deepEqual(holders(planted, 'title'), []);
});

test('S7 sources: every catalog name has a differential call in exactly one test file', () => {
  const offenders = NAMES.flatMap((name) => {
    const found = holders(TEXT, name);
    return found.length === 1 ? [] : [`${name}: ${found.length === 0 ? 'no call' : `${found.length} calls in ${[...new Set(found)].join(', ')}`}`];
  });
  assert.deepEqual(offenders, [], 'names without exactly one differential call');
});

test("S7 sources: the file holding each name's differential is one of the owning entries' differential files", () => {
  const offenders = NAMES.flatMap((name) => {
    const found = holders(TEXT, name);
    const outside = [...new Set(found)].filter((file) => !OWNING_FILES.includes(file));
    return outside.length === 0 ? [] : [`${name}: found in ${outside.join(', ')}`];
  });
  assert.deepEqual(offenders, [], 'differentials in a file no owning entry names');
});

test('S7 sources: every catalog name has a matrix:NAME probe, once, in the matrix test', () => {
  const matrix = TEXT.get('panel-configure-matrix.test.ts');
  assert.notEqual(matrix, undefined, 'the matrix test exists');
  const offenders = NAMES.flatMap((name) => {
    const count = matrix!.split(probeOf(name)).length - 1;
    return count === 1 ? [] : [`${name}: ${count} probes`];
  });
  assert.deepEqual(offenders, [], 'names without exactly one probe');
});

test('S7 sources: neither coverage test file holds a literal differential call, so neither can cover a name itself', () => {
  for (const file of ['settings-coverage-sources.test.ts', 'panel-configure-matrix.test.ts']) {
    const text = TEXT.get(file)!;
    const hits = NAMES.filter((name) => text.includes(callOf(name)));
    assert.deepEqual(hits, [], `${file} holds a literal call`);
  }
});
