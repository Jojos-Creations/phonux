/**
 * An edgeHold 'both' panel on literal rows (phone 390, gap 16). It stays in the strip at its own place, so the layout does not
 * change with the scroll; the numbers give it the insets it sticks at, and the row's host holds it at whichever edge the scroll
 * takes it past. Two 'both' panels stack in row order, and a release lets them go as it does for the other holds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, type RowNumbers } from '../rowNumbers.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const GAP = 16;
const PHONE = 390;

registerTestView('both-view', ({ panel }) => createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'both-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}
const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'both-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');

const numbers = (entries: PanelWindow[], containerWidth = 1000, wholePanels = false): RowNumbers => computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth, gap: GAP, wholePanels });

test("sticky-both: a both panel is a strip panel, not held, and sticks at both edges with a gap from each", () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d')]);
  assert.deepEqual(n.held, [], 'nothing is in a group: the panel is drawn in the strip');
  assert.ok(n.ids.includes('a'), 'it keeps its place in the strip');
  assert.deepEqual(n.stuck, [{ id: 'a', left: 0, right: GAP }], 'it sticks clear of the window edges by nothing on the left and one gap on the right');
  assert.equal(n.leftInset, 0);
  assert.equal(n.rightInset, 0);
});

test("sticky-both: a both panel's layout is the same as a row where it is a plain strip panel: the stops and the range do not change", () => {
  const plain = [scrollRoot(), made('a'), made('b'), made('c'), made('d'), made('e'), made('f'), made('g')];
  const both = [scrollRoot(), made('a'), made('b'), made('c'), made('d'), made('e', { edgeHold: 'both' }), made('f'), made('g')];
  const p = numbers(plain, 1000, true);
  const b = numbers(both, 1000, true);
  assert.deepEqual([b.ids, b.widths, b.leftOffsets, b.stops, b.stopSpans, b.stripStart], [p.ids, p.widths, p.leftOffsets, p.stops, p.stopSpans, p.stripStart]);
  assert.equal(maxScrollOf(b), maxScrollOf(p));
  assert.deepEqual(b.stops, [0, 406, 812, 1218, 1624, 2030, 2264], 'the one-phone grid, the last stop the end of the range');
});

test('sticky-both stacks: two both panels in one row keep clear of each other, each with the other\'s width and a gap', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d', { edgeHold: 'both' }), made('e')], 1400);
  assert.deepEqual(n.held, []);
  assert.deepEqual(n.stuck, [
    { id: 'a', left: 0, right: GAP + PHONE + GAP },
    { id: 'd', left: PHONE + GAP, right: GAP },
  ], 'a sticks left of d when both are pinned: d starts a phone and a gap in, and a ends a phone and a gap before the right edge');
});

test('sticky-both with a fixed left hold: the fixed group is in front of the sticky panel, so the sticky panel keeps clear of it', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c', { edgeHold: 'both' }), made('d')], 1400);
  assert.deepEqual(n.held.map((h) => [h.id, h.side]), [['a', 'left']]);
  assert.deepEqual(n.stuck, [{ id: 'c', left: n.leftInset, right: GAP }]);
  assert.equal(n.leftInset, PHONE + GAP, 'the fixed group and its trailing gap');
});

test('release: a both panel with less than a phone of strip beside it lets go, and is a plain strip panel', () => {
  const narrow = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d')], 600);
  assert.deepEqual(narrow.stuck, [], 'a 568 window less a 406 gap leaves 162, under one phone');
  assert.deepEqual(narrow.held, []);
  assert.ok(narrow.ids.includes('a'));
});

test('release: a row that fits the window with the panel out holds nothing, whatever the scroll', () => {
  const fits = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b')], 1300);
  assert.deepEqual(fits.stuck, [], 'three panels fit a 1268 window: nothing to hold against');
  assert.equal(maxScrollOf(fits), 0);
});

test('a both panel reserves its width, so the capacity is priced beside it', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d')]);
  assert.equal(n.reservedWidths.length, 5, 'every panel scrolls, so each is reserved: History and the four, the sticky one included');
});
