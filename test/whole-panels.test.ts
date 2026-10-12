/**
 * The whole-panel stops of a stepping row, on literal rows (phone 390, gap 16, container 1000: window 968). Two panels
 * fit the window (796) and three do not (1202), so the even margin is 86. Pure cases first, then a mounted row.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { resolvePanelSettings } from '../index.js';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, fadeAt, maxScrollOf, nearestStop, snapToStop } from '../rowNumbers.js';
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

test('six phone panels: two whole panels fit, so five stops 406 apart, an 86 margin each side and 86 of room after the strip', () => {
  const n = numbers(six());
  assert.equal(n.rowMarginLeft, 86, '(968 - 796) / 2');
  assert.deepEqual(n.stops, [0, 406, 812, 1218, 1624]);
  assert.deepEqual(n.stopSpans, [{ first: 0, end: 2 }, { first: 1, end: 3 }, { first: 2, end: 4 }, { first: 3, end: 5 }, { first: 4, end: 6 }]);
  assert.equal(n.endPad, 86);
  assert.equal(maxScrollOf(n), 1624, '86 + 2420 + 86 - 968, the last stop');
});

test('a tablet between two phones shows alone at its stop: stops 0, 595 and 1190, margins 289, 100 and 289', () => {
  const n = numbers([root(), made('t', { formFactor: 'tablet' }), made('b')]);
  assert.deepEqual(n.widths, [390, 768, 390]);
  assert.equal(n.rowMarginLeft, 289);
  assert.deepEqual(n.stops, [0, 595, 1190], 'stop 1 is 289 + 406 - 100');
  assert.deepEqual(n.stopSpans.map((s) => s.end - s.first), [1, 1, 1]);
  assert.equal(n.endPad, 289);
  assert.equal(maxScrollOf(n), 1190);
});

test('a panel as wide as the window shows alone with no margin, and the stop before it keeps the phone centred', () => {
  const n = numbers([root(), made('d', { formFactor: 'desktop' })]);
  assert.deepEqual(n.widths, [390, 968]);
  assert.deepEqual(n.stops, [0, 695], '289 + 406 - 0');
  assert.equal(n.endPad, 0);
  assert.equal(maxScrollOf(n), 695);
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

test('fadeAt: a panel leaving fades out as the one arriving fades in, and a stop shows exactly its panels', () => {
  const n = numbers(six());
  assert.deepEqual(fadeAt(n, 0), [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(fadeAt(n, 406), [0, 1, 1, 0, 0, 0]);
  assert.deepEqual(fadeAt(n, 203), [0.5, 1, 0.5, 0, 0, 0], 'halfway: panel 0 leaves, panel 2 arrives, panel 1 stays');
  assert.deepEqual(fadeAt(n, -50), [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(fadeAt(n, 5000), [0, 0, 0, 0, 1, 1]);
  assert.deepEqual(fadeAt(numbers([root(), made('a')]), 0), [1, 1], 'no stops: nothing fades');
});

test('snapToStop picks the nearest stop that shows the panel; nearestStop the nearest stop; both leave a row with no stops alone', () => {
  const n = numbers(six());
  assert.equal(snapToStop(n, 3, 100), 812, 'panel 3 is shown at stops 812 and 1218');
  assert.equal(snapToStop(n, 0, 900), 0, 'panel 0 is shown at stop 0 only');
  assert.equal(snapToStop(n, 5, 0), 1624);
  assert.equal(nearestStop(n, 700), 812);
  assert.equal(nearestStop(n, 100), 0);
  const none = numbers([root(), made('a')]);
  assert.equal(snapToStop(none, 1, 33), 33);
  assert.equal(nearestStop(none, 33), 33);
});

const slotFilters = (container: HTMLElement): string[] => [...container.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => el.style.filter);

test('mounted at 1000: a wheel steps one stop, the shown panels are the stop\'s and the rest are faded out and inert', async () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  mock.timers.enable({ apis: ['setTimeout'] });
  const slots = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  assert.deepEqual(slotFilters(m.container), ['', '', 'opacity(0)', 'opacity(0)', 'opacity(0)', 'opacity(0)']);
  assert.deepEqual(slots().map((el) => el.hasAttribute('inert')), [false, false, true, true, true, true]);
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), 406);
  await advanceFrames(600);
  assert.equal(m.container.scrollLeft, 406);
  // jsdom writes scrollLeft without firing the scroll event a browser fires.
  act(() => void m.container.dispatchEvent(new Event('scroll')));
  assert.deepEqual(slotFilters(m.container), ['opacity(0)', '', '', 'opacity(0)', 'opacity(0)', 'opacity(0)']);
  assert.equal(slots()[0]!.style.pointerEvents, 'none');
  assert.equal(slots()[1]!.style.pointerEvents, '');
});

test('mounted in free mode: no stops, no spacer, nothing faded and the margin is 0 once the strip overflows', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'free' } });
  assert.equal(m.latest().rowNumbers.stops.length, 0);
  assert.equal(m.latest().rowNumbers.rowMarginLeft, 0);
  assert.equal(m.container.querySelectorAll('[data-row-end-pad]').length, 0);
  assert.ok(slotFilters(m.container).every((f) => f === ''));
});

test('mounted in step mode the trailing room is one spacer element of endPad px outside the strip', () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
  const spacer = m.container.querySelector<HTMLElement>('[data-row-end-pad]');
  assert.ok(spacer, 'a spacer is drawn');
  assert.equal(spacer.style.flex, '0 0 86px');
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
  m.scroller.glideTo(1624, { durationSec: 0, instant: true });
  assert.equal(m.container.scrollLeft, 1624, 'the last stop at two fit');
  m.rerender(1500);
  await advanceFrames(600);
  assert.deepEqual(m.latest().rowNumbers.stops, [0, 406, 812, 1218], 'three fit at 1500, so the last stop is panel 3');
  assert.equal(m.container.scrollLeft, 1218);
});
