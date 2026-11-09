/**
 * What the row's wheel and arrow gesture does before the row scrolls to panels: it swaps a parked panel in from
 * the live range's edge, once per burst. Each pin is a behavior a later change may flip; a flipped pin is renamed,
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
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { rowScrollerFor } from '../rowScroller.js';
import type { UsePanelManagerResult } from '../panels/usePanelManager.js';
import { cleanup, mount, usePanelManagerWith, useSeededInput } from './support/mount-harness.js';

afterEach(() => cleanup());

const ROOT = 'root';
/** The container width whose capacity beside the root column is `n` phone panels. */
const W = (n: number): number => 422 + 406 * n;

const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { view: 'web', url: `https://${id}.example`, title: id.toUpperCase() }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create');
};
const park = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => made(id, { overflow: 'park' }, over);
const rootEntry = (): PanelWindow =>
  applyTemplate(createRootPanel(ROOT), resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');
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

