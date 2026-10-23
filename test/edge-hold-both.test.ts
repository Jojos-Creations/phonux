/**
 * An edgeHold 'both' panel on literal rows (phone 390, gap 16). It stays in the strip at its own place, so the layout does not
 * change with the scroll; the numbers give it the insets it sticks at, and the row's host holds it at whichever edge the scroll
 * takes it past. Several 'both' panels stack on each edge in row order; one with no room lets go, as the other holds do.
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
  assert.deepEqual(b.stops, [0, 406, 812, 1218, 1624, 2030, 2436], 'the one-phone grid, and the last stop the centered end of the range: 86 + 3232 + 86 - 968');
});

test('two both panels in one row both stick, each clear of the other on the edge they stack at, in row order', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d', { edgeHold: 'both' }), made('e')], 1400);
  assert.deepEqual(n.held, []);
  // On the left, a is outermost and d sits one panel and one gap in. On the right the order reverses: d is nearest the window's
  // right edge, a one panel and one gap in from it.
  assert.deepEqual(n.stuck, [
    { id: 'a', left: 0, right: GAP + 390 + GAP },
    { id: 'd', left: 390 + GAP, right: GAP },
  ]);
  assert.deepEqual(n.ids, ['root', 'a', 'b', 'c', 'd', 'e'], 'both are drawn in the strip, at their own places');
});

test('stacked both panels keep their gap on each edge: the inner one starts a gap past the outer one, on either side', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c', { edgeHold: 'both' }), made('d')], 1400);
  const [outer, inner] = n.stuck;
  assert.ok(outer && inner);
  assert.equal(inner.left - outer.left, 390 + GAP, 'pinned left, the inner panel is one panel and one gap in from the outer');
  assert.equal(outer.right - inner.right, 390 + GAP, 'pinned right, the outer panel is one panel and one gap in from the inner');
});

test('a third both panel with no room beside the two lets go and is a plain strip panel', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c', { edgeHold: 'both' }), made('d'), made('e', { edgeHold: 'both' }), made('f')], 1400);
  assert.deepEqual(n.stuck.map((s) => s.id), ['a', 'c'], 'two stand: a 1368 window keeps a phone of strip beside them, a third would not');
  assert.ok(n.ids.includes('e'), 'the third is drawn in the strip, unpinned, and scrolls with it');
  const fits = numbers([scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c', { edgeHold: 'both' }), made('d'), made('e', { edgeHold: 'both' }), made('f')], 1800);
  assert.deepEqual(fits.stuck.map((s) => s.id), ['a', 'c', 'e'], 'a wider window keeps all three');
});

test('stacked both panels under a fixed left hold stack after the group: the group is in front of both', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c', { edgeHold: 'both' }), made('d', { edgeHold: 'both' }), made('e')], 1800);
  assert.deepEqual(n.held.map((h) => h.id), ['a']);
  assert.equal(n.stuck[0]!.left, n.leftInset, 'the first both panel clears the left group');
  assert.equal(n.stuck[1]!.left, n.leftInset + 390 + GAP, 'the second clears the first');
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
