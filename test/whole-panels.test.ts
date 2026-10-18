/**
 * The one-phone grid stops of a stepping row, on literal rows (phone 390, gap 16, container 1000: window 968). A strip that
 * overflows starts flush left and steps one phone width at a time; one that fits keeps its centring (two phones: 796, margin 86).
 * Pure cases first, then a mounted row.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
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
const root = (): PanelWindow => applyTemplate({ ...createHistoryPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
const numbers = (entries: PanelWindow[], containerWidth = 1000, wholePanels = true) => computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: 16, wholePanels });
const six = () => [root(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id))];

test('six phone panels: the stops are the one-phone grid from a flush-left start, the last stop the end of the strip', () => {
  const n = numbers(six());
  assert.equal(n.rowMarginLeft, 0, 'an overflowing strip starts flush left');
  assert.deepEqual(n.stops, [0, 406, 812, 1218, 1452], 'the last stop is the end of the strip: 2420 - 968');
  assert.deepEqual(n.stopSpans, [{ first: 0, end: 3 }, { first: 1, end: 4 }, { first: 2, end: 5 }, { first: 3, end: 6 }, { first: 3, end: 6 }]);
  assert.equal(n.endPad, 0);
  assert.equal(maxScrollOf(n), 1452, '2420 - 968, the last stop');
});

test('a two-slot panel between two phones: the grid stops are 0, 406 and the end at 640', () => {
  const n = numbers([root(), made('t', { slots: 2 }), made('b')]);
  assert.deepEqual(n.widths, [390, 796, 390]);
  assert.equal(n.rowMarginLeft, 0);
  assert.deepEqual(n.stops, [0, 406, 640], 'every stop is on the one-phone grid, and the last is the end of the strip: 1608 - 968');
  assert.deepEqual(n.stopSpans, [{ first: 0, end: 2 }, { first: 1, end: 3 }, { first: 1, end: 3 }]);
  assert.equal(n.endPad, 0);
  assert.equal(maxScrollOf(n), 640);
});

test('a panel as wide as two slots overflows by 234, so the one step is to the row end', () => {
  const n = numbers([root(), made('d', { slots: 64 })]);
  assert.deepEqual(n.widths, [390, 796]);
  assert.deepEqual(n.stops, [0, 234], 'the grid step of 406 is past the row end at 234, so the end is the next stop');
  assert.equal(n.endPad, 0);
  assert.equal(maxScrollOf(n), 234);
});

test('a strip that fits the window keeps its centring and has no stops', () => {
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
  assert.equal(snapToStop(n, 3, 100), 406, 'panel 3 is shown at the grid stop 406');
  assert.equal(snapToStop(n, 0, 900), 0, 'panel 0 is off the window by the grid stop 406, so only stop 0 shows it');
  assert.equal(snapToStop(n, 5, 0), 1218, 'panel 5 is first shown at the grid stop 1218');
  assert.equal(nearestStop(n, 700), 812);
  assert.equal(nearestStop(n, 100), 0);
  const none = numbers([root(), made('a')]);
  assert.equal(snapToStop(none, 1, 33), 33);
  assert.equal(nearestStop(none, 33), 33);
});

test('mounted in free mode: the one-phone grid stops, a spacer of the row gap alone and the margin is 0 once the strip overflows', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  assert.deepEqual(m.latest().rowNumbers.stops, [0, 406, 812, 1218, 1452], 'a free row rests on the grid too, so a scroll that ends settles on a stop');
  assert.equal(m.latest().rowNumbers.rowMarginLeft, 0);
  assert.equal(m.container.querySelector<HTMLElement>('[data-row-end-pad]')!.style.flex, '0 0 16px', 'the right edge space is the element, with no endPad to add');
});

test('mounted in step mode the trailing room is one spacer element, the row gap wide, outside the strip', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  const spacer = m.container.querySelector<HTMLElement>('[data-row-end-pad]');
  assert.ok(spacer, 'a spacer is drawn');
  assert.equal(spacer.style.flex, '0 0 16px', 'endPad is 0, so the spacer is the row gap alone');
  assert.equal(spacer.parentElement, m.container, 'a child of the scroll container, not of the strip');
});


test('a window exactly two panels wide fits two, not one', () => {
  const n = numbers(six(), 828);
  assert.equal(n.windowWidth, 796);
  assert.deepEqual(n.stopSpans[0], { first: 0, end: 2 });
  assert.equal(n.rowMarginLeft, 0);
});

test('a resize that changes how many fit brings a row resting past the new last stop back to a stop', async () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  m.scroller.glideTo(1452, { durationSec: 0, instant: true, ease: 'cubic-out' });
  assert.equal(m.container.scrollLeft, 1452, 'the last stop at two fit');
  m.rerender(1500);
  await advanceFrames(600);
  assert.deepEqual(m.latest().rowNumbers.stops, [0, 406, 812, 952], 'three fit at 1500, so the last stop is the new end, 952, which shows the last four panels');
  assert.equal(m.container.scrollLeft, 952);
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
