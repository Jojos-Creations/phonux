/**
 * computeRowNumbers for panels held at an edge, on literal rows (phone 390, gap 16), written from their sums. A window of 968
 * is a container of 1000. A held panel is 390 wide, so its group takes 406 px in flow (the panel and its trailing gap).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, snapToStop, type RowNumbers } from '../rowNumbers.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const GAP = 16;

registerTestView('edge-view', ({ panel }) => createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'edge-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}
const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'edge-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');

const numbers = (entries: PanelWindow[], containerWidth = 1000, wholePanels = false): RowNumbers => computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: GAP, wholePanels });

test('edgeHold off is the default: a row with no edgeHold, and one with off, have the same numbers and hold nothing', () => {
  const plain = numbers([scrollRoot(), made('a'), made('b'), made('c')]);
  const off = numbers([scrollRoot(), made('a', { edgeHold: 'off' }), made('b'), made('c')]);
  assert.deepEqual(plain.held, []);
  assert.deepEqual(off, plain);
  assert.deepEqual([plain.leftInset, plain.rightInset, plain.stripStart], [0, 0, 0]);
  assert.equal(plain.stripWindow, plain.windowWidth);
});

test('sticky-left: a left-held panel leaves the strip for the left group, and the strip starts after that group', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')]);
  assert.deepEqual(n.held, [{ id: 'a', side: 'left', width: 390, offset: 0 }]);
  assert.equal(n.leftInset, 406, 'the panel and its trailing gap');
  assert.equal(n.rightInset, 0);
  assert.deepEqual(n.ids, ['root', 'b', 'c', 'd'], 'the held panel is not in the strip');
  assert.deepEqual(n.leftOffsets, [0, 406, 812, 1218]);
  assert.equal(n.stripStart, 406);
  assert.equal(n.stripWindow, 968 - 406, 'the strip is seen through the window less the group');
  assert.equal(maxScrollOf(n), 406 + 4 * 390 + 3 * GAP - 968, 'the range is the strip plus the group, less the window');
});

test('sticky-right: a right-held panel is drawn after the strip, with its leading gap inside its group', () => {
  const n = numbers([scrollRoot(), made('a'), made('b'), made('c'), made('d', { edgeHold: 'right' })]);
  assert.deepEqual(n.held, [{ id: 'd', side: 'right', width: 390, offset: GAP }]);
  assert.equal(n.leftInset, 0);
  assert.equal(n.rightInset, 406, 'the leading gap and the panel');
  assert.deepEqual(n.ids, ['root', 'a', 'b', 'c']);
  assert.equal(n.stripStart, 0);
  assert.equal(n.stripWindow, 968 - 406);
  assert.equal(maxScrollOf(n), 4 * 390 + 3 * GAP + 406 - 968, 'the right group adds its width to the range, so the last stop rests it at the window edge');
});

test('sticky-both: the both panel is in the strip at every scroll, with its sticky insets; the fixed holds of the row are unchanged', () => {
  const entries = [scrollRoot(), made('a', { edgeHold: 'both' }), made('b'), made('c'), made('d')];
  const n = numbers(entries);
  assert.deepEqual(n.held, [], 'a both panel is a strip panel: it sticks, it is not in a group');
  assert.deepEqual(n.stuck, [{ id: 'a', left: 0, right: GAP }]);
});

test('no room: a held panel that leaves less than one phone of strip beside it lets go and scrolls with the strip', () => {
  const narrow = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')], 600);
  assert.deepEqual(narrow.held, [], 'a 568 window less a 406 group leaves 162, under one phone');
  assert.deepEqual(narrow.ids, ['root', 'a', 'b', 'c', 'd'], 'the released panel is a strip panel again');
  assert.equal(narrow.leftInset, 0);
  assert.equal(narrow.stops.length, 0, 'the released row asks for no whole-panel grid');
  const wide = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')], 1000);
  assert.equal(wide.held.length, 1, 'the same row at 1000 holds it: the boundary is the phone of room');
});

test('no room: a held panel wider than the window lets go, even when the row alone would scroll', () => {
  const n = numbers([scrollRoot(), made('wide', { edgeHold: 'left', slots: 3, maxSlots: 3 }), made('b')], 1000);
  assert.deepEqual(n.held, [], 'three phones do not fit a 968 window beside a phone of strip');
  assert.deepEqual(n.ids, ['root', 'wide', 'b']);
});

test('a row that does not overflow with the holds released lets them go: its strip fits beside the window', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b')], 1300);
  assert.deepEqual(n.held, [], 'root, a and b fit in 1268 with no group, so there is nothing to hold against');
  assert.equal(n.rowScroll, true, 'a scroll-overflow row still reads as scrolling; the holds alone do not make it overflow');
});

test('a left and a right hold together take both groups, and the range counts both', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d', { edgeHold: 'right' })], 1400);
  assert.deepEqual(n.held.map((h) => [h.id, h.side, h.offset]), [['a', 'left', 0], ['d', 'right', GAP]]);
  assert.deepEqual([n.leftInset, n.rightInset], [406, 406]);
  assert.equal(maxScrollOf(n), 16 + 406 + 3 * 390 + 2 * GAP + 406 + 16 - 1400, 'the content is gap, left group, strip, right group and the end gap');
});

test('two left holds stack in row order inside the left group, when the window keeps a phone of strip beside both', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b', { edgeHold: 'left' }), made('c'), made('d')], 1600);
  assert.deepEqual(n.held.map((h) => [h.id, h.offset]), [['a', 0], ['b', 406]]);
  assert.equal(n.leftInset, 2 * 390 + GAP + GAP, 'both panels, the gap between them and the trailing gap');
});

test('a held panel reserves its width in reservedWidths, so the capacity is priced beside it', () => {
  // Every panel here scrolls (overflow scroll), so each one is reserved; the held one is counted beside the four strip panels.
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')]);
  assert.equal(n.ids.length, 4);
  assert.equal(n.reservedWidths.length, 5, 'four strip panels and the held one');
});

test('the whole-panel grid of a held row ends on the range, so the last stop rests the strip at the window edge', () => {
  const n = numbers([scrollRoot(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')], 1000, true);
  assert.deepEqual(n.stops, [0, 406, 812, maxScrollOf(n)]);
  assert.equal(n.stops.at(-1), 1046);
  assert.equal(snapToStop(n, 2, 500), 406, 'of the stops whose span draws strip panel c, the one nearest the target');
});
