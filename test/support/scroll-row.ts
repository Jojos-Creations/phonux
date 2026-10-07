/**
 * A mounted provider, Workspace and PanelRow sharing one scroll container, for the tests that watch the row scroll.
 * Rows are built the way a creation path builds them (appendPanel's skeleton, then applyTemplate over a resolved layer).
 */
import assert from 'node:assert/strict';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, Workspace, registerView, resolvePanelSettings, useProvidePanels } from '../../index.js';
import type { PanelSettings, PanelWindow, PanelsInput, ProvidedPanels, SettingNote } from '../../index.js';
import { createFakeHost } from '../../fakeHost.js';
import { applyTemplate } from '../../panelSettings.js';
import { deriveAnchorsFromOrder } from '../../panelRowOrder.js';
import { appendPanel, createHistoryPanel } from '../../panelWindow.js';
import { rowScrollerFor } from '../../rowScroller.js';
import { mount, panelsInput, withHost } from './mount-harness.js';

export const ROOT = 'root';
registerView('scroll-row-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it. */
export const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create');
};
export const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
/** The row in array order with every anchor read from it. */
export const row = (...entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
/** The row [root s1 ... s(count)]: panel k starts at 16 + 406k. */
export const panelsOf = (count: number, layer: PanelSettings = {}): PanelWindow[] => row(rootEntry(), ...Array.from({ length: count }, (_, k) => made(`s${k + 1}`, layer)));

const NONE: ReadonlySet<string> = new Set();

export interface MountedRow {
  latest: () => ProvidedPanels;
  container: HTMLDivElement;
  notes: SettingNote[];
  scroller: ReturnType<typeof rowScrollerFor>;
  live: () => string[];
  rerender: (width: number) => void;
  wheel: (init: WheelEventInit) => WheelEvent;
  key: (name: string, init?: KeyboardEventInit, target?: EventTarget) => void;
}

/** `entries` mounted at a measured container `width`; `over` replaces any provider input. */
export function mountRow(entries: PanelWindow[], width: number, over: Partial<PanelsInput> = {}): MountedRow {
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const notes: SettingNote[] = [];
  let latest: ProvidedPanels | undefined;
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: entries, containerWidth, overflowContainerRef: ref, onNote: (n) => void notes.push(n), ...over }));
    const provided = latest;
    return withHost(
      React.createElement(
        Workspace,
        { overflowContainerRef: ref, rowRef, containerWidth, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, tuning: provided.tuning } as never,
        React.createElement(PanelRow, { entries: provided.entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, rowNumbers: provided.rowNumbers, tuning: provided.tuning }),
      ),
      createFakeHost({ panels: provided }),
    );
  }
  const mounted = mount(React.createElement(Probe, { containerWidth: width }));
  const container = ref.current;
  assert.ok(container, 'the Workspace never attached its scroll container');
  return {
    latest: () => latest!,
    container,
    notes,
    scroller: rowScrollerFor(container),
    live: () => latest!.entries.filter((p) => p.collapsible && p.live).map((p) => p.id),
    rerender: (next) => mounted.rerender(React.createElement(Probe, { containerWidth: next })),
    wheel: (init) => {
      const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
      act(() => void container.dispatchEvent(event));
      return event;
    },
    key: (name, init = {}, target = window) => void act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))),
  };
}
