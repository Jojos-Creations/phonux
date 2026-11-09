/**
 * The one-phone grid stops of a stepping row, on literal rows (phone 390, gap 16, container 1000: window 968). A strip that
 * overflows has half the window's leftover past its whole slots, ((968 + 16) mod 406) / 2 = 86, before it and after it, so every
 * rest on the grid centers what it shows, the ends included; one that fits keeps its centering (two phones: 796, margin 86). Pure cases first, then a
 * mounted row.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowOffsetOf } from './support/strip.js';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, nearestStop, snapToStop } from '../rowNumbers.js';
import { workspaceShellStyle } from '../Workspace.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const ROOT = 'root';
const made = (id: string, layer: PanelSettings = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};
const root = (): PanelWindow => applyTemplate({ ...createRootPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
const numbers = (entries: PanelWindow[], containerWidth = 1000, wholePanels = true) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: 16, wholePanels });
const six = () => [root(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))];

test('six phone panels: the stops are the one-phone grid, with 86 of centering before and after the strip', () => {
  const n = numbers(six());
  assert.equal(n.rowMarginLeft, 86, 'an overflowing row starts after the centering space');
  assert.deepEqual(n.stops, [0, 406, 812, 1218, 1624], 'the grid, and the end of the strip: 86 + 2420 + 86 - 968');
  assert.deepEqual(n.stopSpans, [{ first: 0, end: 3 }, { first: 0, end: 4 }, { first: 1, end: 5 }, { first: 2, end: 6 }, { first: 3, end: 6 }]);
  assert.equal(n.endPad, 86, 'an overflowing row ends with the same centering space');
  assert.equal(maxScrollOf(n), 1624, '86 + 2420 + 86 - 968, the last stop');
});

test('a two-slot panel between two phones: centered ends, the stops run to 812 and the inner rest shows the two-slot panel whole', () => {
  const n = numbers([root(), made('t', { slots: 2 }), made('b')]);
  assert.deepEqual(n.widths, [390, 796, 390]);
  assert.equal(n.rowMarginLeft, 86, 'an overflowing row starts after the centering space');
  assert.deepEqual(n.stops, [0, 406, 812], 'the grid 406, which shows the two-slot panel (492 to 1288) whole, and the end: 86 + 1608 + 86 - 968');
  assert.deepEqual(n.stopSpans, [{ first: 0, end: 2 }, { first: 0, end: 3 }, { first: 1, end: 3 }]);
  assert.equal(n.endPad, 86, 'an overflowing row ends with the same centering space');
  assert.equal(maxScrollOf(n), 812);
});

test('a panel as wide as two slots overflows: with the centering space at both ends, the stops are 0 and 406', () => {
  const n = numbers([root(), made('d', { slots: 64 })]);
  assert.deepEqual(n.widths, [390, 796]);
  assert.equal(n.rowMarginLeft, 86, 'an overflowing row starts after the centering space');
  assert.deepEqual(n.stops, [0, 406], 'the end, 86 + 1202 + 86 - 968, is one grid step');
  assert.equal(n.endPad, 86, 'an overflowing row ends with the same centering space');
  assert.equal(maxScrollOf(n), 406);
});

test('a strip that fits the window keeps its centering and has no stops', () => {
  const n = numbers([root(), made('a')]);
  assert.equal(n.rowMarginLeft, 86);
  assert.deepEqual(n.stops, []);
  assert.equal(n.endPad, 0);
  assert.equal(maxScrollOf(n), 0);
});

test('unmeasured, and wholePanels false, give no stops: the 0.2.0 numbers', () => {
  const entries = [root(), made('a'), made('b')];
  assert.deepEqual(numbers(entries, 0).stops, []);
  const off = numbers(entries, 1000, false);
  assert.deepEqual(off.stops, []);
  assert.equal(off.rowMarginLeft, 0);
  assert.equal(off.endPad, 0);
  assert.equal(maxScrollOf(off), 234, '1202 - 968');
});

test('snapToStop picks the nearest stop that shows the panel; nearestStop the nearest stop; both leave a row with no stops alone', () => {
  const n = numbers(six());
  assert.equal(snapToStop(n, 3, 100), 812, 'panel 3 is first drawn whole at the stop 812; at 406 the window edge cuts it');
  assert.equal(snapToStop(n, 0, 900), 0, 'only stop 0 draws panel 0 whole: at 406 its left edge is 320 past the window');
  assert.equal(snapToStop(n, 5, 0), 1624, 'panel 5 is first drawn whole at the stop 1624');
  assert.equal(nearestStop(n, 700), 812);
  assert.equal(nearestStop(n, 100), 0);
  const none = numbers([root(), made('a')]);
  assert.equal(snapToStop(none, 1, 33), 33);
  assert.equal(nearestStop(none, 33), 33);
});

test('mounted in free mode: the one-phone grid stops, and the row centers once the strip overflows', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  assert.deepEqual(m.latest().rowNumbers.stops, [0, 406, 812, 1218, 1624], 'a free row rests on the grid too, so a scroll that ends settles on a stop');
  assert.equal(m.latest().rowNumbers.rowMarginLeft, 86);
});

test('a window exactly two panels wide fits two, not one', () => {
  const n = numbers(six(), 828);
  assert.equal(n.windowWidth, 796);
  assert.deepEqual(n.stopSpans[0], { first: 0, end: 2 });
  assert.equal(n.rowMarginLeft, 0);
});

test('the strip margin snaps while stops exist and glides otherwise', () => {
  const style = (entries: PanelWindow[]) => workspaceShellStyle({ containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowNumbers: numbers(entries) });
  assert.deepEqual(style(six()).transition, { duration: 0 });
  assert.notDeepEqual(style([root(), made('a')]).transition, { duration: 0 }, 'a strip that fits has no stops and keeps the glide');
});

test('a panel as wide as the window steps one phone width, which brings History in on its right', () => {
  // Five slots fit (window 2014): the 5-slot panel fills it, and the first step moves 406 so History shows on its right.
  const n = computeRowNumbers({ entries: [made('wide', { slots: 5 }), root(), made('next', { slots: 5 })], phoneWidth: 390, containerWidth: 2046, gap: 16, wholePanels: true });
  assert.deepEqual(n.widths, [2014, 390, 2014]);
  assert.deepEqual(n.stops.slice(0, 2), [0, 406]);
  assert.deepEqual(n.stopSpans.slice(0, 3), [{ first: 0, end: 1 }, { first: 0, end: 2 }, { first: 0, end: 3 }]);
  assert.equal(n.stops[1]! + 2014, n.rowMarginLeft + n.leftOffsets[1]! + 390, 'the window ends at the History edge');
});

test('a panel as wide as the window steps one phone width even when the next panel is as wide', () => {
  // The next panel is as wide as the window, so the first step moves a phone plus the gap and the first panel keeps four fifths of the window.
  const n = computeRowNumbers({ entries: [made('wide', { slots: 5 }), made('next', { slots: 5 })], phoneWidth: 390, containerWidth: 2046, gap: 16, wholePanels: true });
  assert.deepEqual(n.widths, [2014, 2014]);
  assert.deepEqual(n.stops.slice(0, 2), [0, 406]);
  assert.deepEqual(n.stopSpans.slice(0, 2), [{ first: 0, end: 1 }, { first: 0, end: 2 }]);
  assert.equal(n.rowMarginLeft + 2014 - n.stops[1]!, 1608, 'the wide panel keeps 1608 of the window');
});

test('an image, a second window-wide panel, History and a next panel: the first step keeps the image beside the second panel', () => {
  const n = computeRowNumbers({ entries: [made('image', { slots: 5 }), made('mid', { slots: 5 }), root(), made('next', { slots: 5 })], phoneWidth: 390, containerWidth: 2046, gap: 16, wholePanels: true });
  assert.deepEqual(n.widths, [2014, 2014, 390, 2014]);
  assert.deepEqual(n.stops.slice(0, 3), [0, 406, 812], 'every step is one phone width: 0, 406, 812');
  assert.deepEqual(n.stopSpans[1], { first: 0, end: 2 }, 'at step 1 the second window-wide panel shows on the right');
  assert.equal(n.rowMarginLeft + 2014 - n.stops[1]!, 1608, 'the image keeps 1608 of the window');
});
