/**
 * The release gate over every catalog descriptor: each name has one differential call in test/*.test.ts, a matrix probe,
 * a DESIGN.md row whose class word is the descriptor's, and one of the 17 owning entries. Names are joined from parts so
 * this file holds no literal call for any name and cannot cover one itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_SETTINGS_CATALOG } from '../index.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const DESIGN = readFileSync(join(TEST_DIR, '..', 'DESIGN.md'), 'utf8');
const MATRIX = readFileSync(join(TEST_DIR, 'panel-configure-matrix.test.ts'), 'utf8');
const TEXTS: ReadonlyMap<string, string> = new Map(
  readdirSync(TEST_DIR)
    .filter((n) => n.endsWith('.test.ts'))
    .sort()
    .map((n) => [n, readFileSync(join(TEST_DIR, n), 'utf8')] as const),
);

const OWNER_IDS: readonly string[] = [
  'phonux-engine-permission-settings',
  'phonux-engine-visibility-settings',
  'phonux-engine-placement-and-motion-settings',
  'phonux-engine-tuning-look-settings',
  'phonux-keep-mounted-render-path',
  'phonux-row-numbers-and-overflow',
  'phonux-row-scroll-gesture-and-requests',
  'phonux-edge-scroll-while-dragging',
  'phonux-saved-overrides-and-template-paths',
  'phonux-workspace-attach-and-snapshot',
  'phonux-panel-handle-operations',
  'phonux-pin-and-reset',
  'phonux-header-buttons',
  'phonux-max-live-panels',
  'phonux-slot-sizing-resizable-root-v3',
  'phonux-shrink-whole-panels-v1',
  'phonux-default-frame-v3',
];

const callOf = (name: string): string => ["differential('", name, "'"].join('');
const probeOf = (name: string): string => ["test('matrix:", name, "'"].join('');
const count = (text: string, needle: string): number => text.split(needle).length - 1;

/** Class word per name from the DESIGN.md table: the capitals that open the on_configure cell. */
function docClassWords(doc: string): Map<string, string> {
  const start = doc.indexOf('<!-- catalog:start -->');
  const end = doc.indexOf('<!-- catalog:end -->');
  const rows = new Map<string, string>();
  if (start < 0 || end <= start) return rows;
  for (const line of doc.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.slice(1, line.lastIndexOf('|')).split('|').map((c) => c.trim());
    const name = (cells[0] ?? '').replace(/^`|`$/g, '');
    if (cells.length === 4 && /^[A-Za-z]/.test(name) && name !== 'Setting') rows.set(name, /^[A-Z]+/.exec(cells[3] ?? '')?.[0] ?? '');
  }
  return rows;
}

test('release gate: the catalog has 71 descriptors and the DESIGN.md table has 71 rows', () => {
  assert.equal(PANEL_SETTINGS_CATALOG.length, 71);
  assert.equal(docClassWords(DESIGN).size, 71);
});

for (const d of PANEL_SETTINGS_CATALOG) {
  test(`release gate ${d.name}: one differential call, a matrix probe, the DESIGN.md class word and a listed owner`, () => {
    const holders = [...TEXTS].flatMap(([file, text]) => Array.from({ length: count(text, callOf(d.name)) }, () => file));
    assert.equal(holders.length, 1, `${d.name} has ${holders.length} differential calls (${holders.join(', ')})`);
    assert.equal(count(MATRIX, probeOf(d.name)), 1, `${d.name} needs one matrix probe`);
    assert.equal(docClassWords(DESIGN).get(d.name), d.configure.cls, `${d.name} class word in DESIGN.md`);
    assert.ok(OWNER_IDS.includes(d.ownerEntry), `${d.name} owner ${d.ownerEntry} is not one of the 17 entries`);
  });
}

test('release gate: the owners are exactly the 17 listed ids', () => {
  assert.equal(OWNER_IDS.length, 17);
  assert.deepEqual([...new Set(PANEL_SETTINGS_CATALOG.map((d) => d.ownerEntry))].sort(), [...OWNER_IDS].sort());
});

test('release gate: a scratch copy of DESIGN.md with one class word edited disagrees with the catalog', () => {
  const crossable = PANEL_SETTINGS_CATALOG.find((d) => d.name === 'crossable');
  assert.ok(crossable);
  const edited = DESIGN.replace(/(\| `crossable` \|[^\n]*\| )[A-Z]+\./, `$1${crossable.configure.cls === 'NEXT' ? 'NOW' : 'NEXT'}.`);
  assert.notEqual(edited, DESIGN, 'the planted edit must change the text');
  assert.notEqual(docClassWords(edited).get('crossable'), crossable.configure.cls);
});
