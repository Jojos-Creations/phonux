/**
 * What the row's wheel and arrow gesture does before the row scrolls to panels: it swaps a parked panel in from
 * the live range's edge, once per burst. Each pin is a behaviour a later change may flip; a flipped pin is renamed,
 * never deleted.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { frameClock } from './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow, ProvidedPanels } from '../index.js';
import { applyTemplate } from '../panelSettings.js';
import { deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { rowScrollerFor } from '../rowScroller.js';
import type { UsePanelManagerResult } from '../panels/usePanelManager.js';
import { cleanup, mount, usePanelManagerWith, useSeededInput } from './support/mount-harness.js';

afterEach(() => cleanup());

const ROOT = 'root';
/** The container width whose capacity beside the root column is `n` phone panels. */
const W = (n: number): number => 422 + 406 * n;

const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id.toUpperCase() }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create');
};
const park = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => made(id, { overflow: 'park' }, over);
const rootEntry = (): PanelWindow =>
  applyTemplate(createHistoryPanel(ROOT), resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');
const row = (...entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
const liveIds = (panels: readonly PanelWindow[]): string[] => panels.filter((p) => p.collapsible && p.live).map((p) => p.id);

/** A provider over `entries` at `width`, with a container carrying the gesture's listeners. */
function provide(entries: PanelWindow[], width: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const ref = { current: container };
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: entries, containerWidth: width, overflowContainerRef: ref, tuning: { rowGesture: 'step' } }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const wheel = (deltaX: number): void => void act(() => void container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
  const key = (name: 'ArrowLeft' | 'ArrowRight'): void => void act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })));
  return { container, live: () => liveIds(latest!.entries), wheel, key };
}

test('PIN with [A, B parked, C] and A, C live, scrollRow in both directions reveals nothing and sets no state', () => {
  let manager: UsePanelManagerResult | undefined;
  let panelsNow: PanelWindow[] = [];
  function Probe(): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(() => row(rootEntry(), park('a'), park('b', { live: false }), park('c')));
    manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth: 0, fixedColumnCount: 1, rootId: ROOT });
    panelsNow = panels;
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const before = panelsNow;
  act(() => manager!.scrollRow('right'));
  act(() => manager!.scrollRow('left'));
  assert.equal(panelsNow, before, 'the same array: nothing was set');
  assert.deepEqual(liveIds(panelsNow), ['a', 'c']);
});

test('PIN a swipe on a row whose parked panel lies beyond the live range swaps: A parks, the next parked returns, and a same-direction step waits 30 ms after the last', () => {
  const p = provide(row(rootEntry(), park('a'), park('b'), park('c', { live: false }), park('d', { live: false })), W(2));
  mock.timers.enable({ apis: ['setTimeout'] });
  const tick = (ms: number): void =>
    void act(() => {
      mock.timers.tick(ms);
      frameClock.skip(ms);
    });
  try {
    p.wheel(100);
    assert.deepEqual(p.live(), ['b', 'c']);
    tick(10);
    p.wheel(500);
    assert.deepEqual(p.live(), ['b', 'c'], 'a phone width of travel inside the lock does nothing');
    tick(19);
    p.wheel(1);
    assert.deepEqual(p.live(), ['b', 'c'], 'one ms short of the lock');
    tick(1);
    p.wheel(1);
    assert.deepEqual(p.live(), ['c', 'd'], 'after the lock the travel steps again');
    p.wheel(-100);
    assert.deepEqual(p.live(), ['b', 'c'], 'a reversal is a fresh gesture: the lock does not hold it');
  } finally {
    mock.timers.reset();
  }
});

test('PIN arrow keys swap with no lock: ArrowRight then ArrowLeft at once undo each other', () => {
  const p = provide(row(rootEntry(), park('a'), park('b'), park('c', { live: false })), W(2));
  p.key('ArrowRight');
  assert.deepEqual(p.live(), ['b', 'c']);
  p.key('ArrowLeft');
  assert.deepEqual(p.live(), ['a', 'b']);
});

test('PIN activate of a live panel is a same-array no-op', () => {
  let manager: UsePanelManagerResult | undefined;
  let panelsNow: PanelWindow[] = [];
  function Probe(): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(() => row(rootEntry(), park('a'), park('b')));
    manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth: 0, fixedColumnCount: 1, rootId: ROOT });
    panelsNow = panels;
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const before = panelsNow;
  act(() => manager!.handleActivatePanel('a'));
  assert.equal(panelsNow, before);
});

test('PIN the container ends with one wheel listener and the window one keydown listener, counted as adds less removes', () => {
  const container = document.createElement('div');
  const counts = { wheel: 0, keydown: 0 };
  const onContainer = container.addEventListener.bind(container);
  container.addEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'wheel') counts.wheel += 1;
    return (onContainer as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof container.addEventListener;
  const offContainer = container.removeEventListener.bind(container);
  container.removeEventListener = ((type: string, ...rest: unknown[]) => {
    if (type === 'wheel') counts.wheel -= 1;
    return (offContainer as (...a: unknown[]) => void)(type, ...rest);
  }) as typeof container.removeEventListener;
  const onWindow = window.addEventListener.bind(window);
  const spy = mock.method(window, 'addEventListener', (type: string, ...rest: unknown[]) => {
    if (type === 'keydown') counts.keydown += 1;
    return (onWindow as (...a: unknown[]) => void)(type, ...rest);
  });
  const offWindow = window.removeEventListener.bind(window);
  const offSpy = mock.method(window, 'removeEventListener', (type: string, ...rest: unknown[]) => {
    if (type === 'keydown') counts.keydown -= 1;
    return (offWindow as (...a: unknown[]) => void)(type, ...rest);
  });
  try {
    function Probe(): React.ReactElement {
      useProvidePanels(useSeededInput({ initialEntries: row(rootEntry(), park('a')), containerWidth: W(2), overflowContainerRef: { current: container }, tuning: { rowGesture: 'step' } }));
      return React.createElement('output');
    }
    mount(React.createElement(Probe));
    assert.deepEqual(counts, { wheel: 1, keydown: 1 });
  } finally {
    spy.mock.restore();
    offSpy.mock.restore();
  }
});

test('a swipe on a row whose live panels run beyond the window scrolls one panel instead of revealing the parked panel', () => {
  const p = provide(row(rootEntry(), made('s1'), made('s2'), made('s3'), park('p', { live: false })), 1000);
  // The parked panel is not drawn, so the stops come from the four live panels.
  const stops = computeRowNumbers({ entries: row(rootEntry(), made('s1'), made('s2'), made('s3')), phoneWidth: 390, containerWidth: 1000, gap: 16, wholePanels: true }).stops;
  assert.deepEqual(p.live(), ['s1', 's2', 's3']);
  p.wheel(100);
  assert.deepEqual(p.live(), ['s1', 's2', 's3'], 'the parked panel stays parked');
  assert.equal(rowScrollerFor(p.container).glideTarget(), stops[1], 'the row glides to the next stop');
});
