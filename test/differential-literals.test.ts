/**
 * The release gate finds a setting's differential by grepping the text of test/*.test.ts for the literal call that
 * carries the setting's name, and wants exactly one per catalog name, in a file an owning entry names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PANEL_SETTINGS_CATALOG } from '../index.js';

// The directory of this file, not a fixed checkout: the scratch copy that tools/mutate-check.mjs mutates must be the text read.
const TEST_DIR = new URL('.', import.meta.url);

const OWNING_FILES = [
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
  'slot-sizing',
  'phone-fit',
  'default-frame',
].map((base) => `${base}.test.ts`);

type Texts = ReadonlyMap<string, string>;

// Joined from parts: a search string written out whole in this file would be a second call for its name.
const searchFor = (name: string): string => ["differential('", name, "'"].join('');

function occurrences(text: string, search: string): number {
  return text.split(search).length - 1;
}

function callsOf(texts: Texts, name: string): Array<[file: string, count: number]> {
  const search = searchFor(name);
  const found: Array<[string, number]> = [];
  for (const [file, text] of texts) {
    const count = occurrences(text, search);
    if (count > 0) found.push([file, count]);
  }
  return found;
}

function readTestFiles(): Texts {
  const files = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith('.test.ts'))
    .sort();
  return new Map(files.map((f) => [f, readFileSync(new URL(f, TEST_DIR), 'utf8')]));
}

test('every catalog name has exactly one literal differential call across the test files', () => {
  const names = PANEL_SETTINGS_CATALOG.map((d) => d.name);
  const texts = readTestFiles();
  assert.equal(names.length, 53, 'positive control: the whole catalog was read');
  assert.ok(texts.size > 50, `positive control: the scan read the test files, it read ${texts.size}`);
  const offenders: string[] = [];
  for (const name of names) {
    const found = callsOf(texts, name);
    const total = found.reduce((sum, [, count]) => sum + count, 0);
    if (total === 0) offenders.push(`${name}: no call`);
    else if (total > 1) offenders.push(`${name}: ${total} calls in ${found.map(([file]) => file).join(', ')}`);
  }
  assert.deepEqual(offenders, []);
});

test("the file holding each name's literal differential call is one an owning entry names", () => {
  const texts = readTestFiles();
  assert.deepEqual(
    OWNING_FILES.filter((file) => !texts.has(file)),
    [],
    'positive control: every owning file exists',
  );
  const offenders: string[] = [];
  for (const { name } of PANEL_SETTINGS_CATALOG) {
    for (const [file] of callsOf(texts, name)) {
      if (!OWNING_FILES.includes(file)) offenders.push(`${name}: found in ${file}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the search finds a literal call, ignores a renamed one and counts a repeat', () => {
  const texts: Texts = new Map([
    ['literal.test.ts', `${searchFor('afterClose')}, (run) => {});`],
    ['renamed.test.ts', `${searchFor('afterClose_')}, (run) => {});`],
    ['repeat.test.ts', `${searchFor('showWhenClosed')}, (run) => {});\n${searchFor('showWhenClosed')}, (run) => {});`],
    ['variable.test.ts', "const name = 'toggleWhenClosed';\ndifferential(name as never, (run) => {});"],
  ]);
  assert.deepEqual(callsOf(texts, 'afterClose'), [['literal.test.ts', 1]], 'the literal call is found and the renamed one is not');
  assert.deepEqual(callsOf(texts, 'afterClose_'), [['renamed.test.ts', 1]], 'positive control: the renamed call is a call of its own name');
  assert.deepEqual(callsOf(texts, 'showWhenClosed'), [['repeat.test.ts', 2]], 'two calls in one file count twice');
  assert.deepEqual(callsOf(texts, 'toggleWhenClosed'), [], 'a call through a variable is not a call');
});
