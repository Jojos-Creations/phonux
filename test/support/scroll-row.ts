/**
 * A mounted provider, Workspace and PanelRow sharing one scroll container, for the tests that watch the row scroll.
 * Rows are built the way a creation path builds them (appendPanel's skeleton, then applyTemplate over a resolved layer).
 */
import assert from 'node:assert/strict';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, Workspace, useProvidePanels } from '../../index.js';
import type { PanelSettings, PanelWindow, PanelsInput, ProvidedPanels, SettingNote, WorkspaceHandle } from '../../index.js';
import { createFakeHost } from '../../fakeHost.js';
import { applyTemplate, resolvePanelSettings } from '../../panelSettings.js';
import { deriveAnchorsFromOrder } from '../../panelRowOrder.js';
import { appendPanel, createHistoryPanel } from '../../panelWindow.js';
import { rowScrollerFor } from '../../rowScroller.js';
import { mount, panelsInput, seededWorkspace, withHost, type SeedOptions } from './mount-harness.js';

export const ROOT = 'root';

/** An entry as a creation path builds it. */
export const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'scroll-row-view' }, id, ROOT)[0]!;
  return { ...applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create'), instance: layer };
};
export const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'scroll-row-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
/** The row in array order with every anchor read from it. */
export const row = (...entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
/** The row [root s1 ... s(count)]: panel k starts at 16 + 406k. */
export const panelsOf = (count: number, layer: PanelSettings = {}): PanelWindow[] => row(rootEntry(), ...Array.from({ length: count }, (_, k) => made(`s${k + 1}`, layer)));

const NONE: ReadonlySet<string> = new Set();

export interface MountedRow {
  /** The workspace the row was mounted with. */
  workspace: WorkspaceHandle;
  latest: () => ProvidedPanels;
  container: HTMLDivElement;
  notes: SettingNote[];
  scroller: ReturnType<typeof rowScrollerFor>;
  live: () => string[];
  rerender: (width: number) => void;
  wheel: (init: WheelEventInit) => WheelEvent;
  key: (name: string, init?: KeyboardEventInit, target?: EventTarget) => void;
}

/**
 * `entries` mounted at a measured container `width`; `over` replaces any provider input; `wrap` puts the mounted row inside a
 * parent, such as StrictMode or a MotionConfig.
 */
export function mountRow(entries: PanelWindow[], width: number, over: Partial<Omit<PanelsInput, 'workspace'>> & SeedOptions & { wireClosing?: boolean } = {}, wrap: (row: React.ReactElement) => React.ReactElement = (row) => row): MountedRow {
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const notes: SettingNote[] = [];
  let latest: ProvidedPanels | undefined;
  const { rootId: _root, tuning, workspaceDefaults, templates, storage, wireClosing = false, ...hook } = over;
  const workspace = seededWorkspace(entries, { rootId: ROOT, ...(tuning !== undefined ? { tuning } : {}), ...(workspaceDefaults !== undefined ? { workspaceDefaults } : {}), ...(templates !== undefined ? { templates } : {}), ...(storage !== undefined ? { storage } : {}) });
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    latest = useProvidePanels(panelsInput({ workspace, containerWidth, overflowContainerRef: ref, onNote: (n) => void notes.push(n), ...hook }));
    const provided = latest;
    return withHost(
      React.createElement(
        Workspace,
        { overflowContainerRef: ref, rowRef, containerWidth, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace } as never,
        React.createElement(PanelRow, { entries: provided.entries, rootId: ROOT, closingIds: wireClosing ? provided.closingIds : NONE, enteringViaAnchorIds: NONE, rowNumbers: provided.rowNumbers, workspace }),
      ),
      createFakeHost({ panels: provided }),
    );
  }
  const mounted = mount(wrap(React.createElement(Probe, { containerWidth: width })));
  const container = ref.current;
  assert.ok(container, 'the Workspace never attached its scroll container');
  return {
    workspace,
    latest: () => latest!,
    container,
    notes,
    scroller: rowScrollerFor(container),
    live: () => latest!.entries.filter((p) => p.collapsible && p.live).map((p) => p.id),
    rerender: (next) => mounted.rerender(wrap(React.createElement(Probe, { containerWidth: next }))),
    wheel: (init) => {
      const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
      act(() => void container.dispatchEvent(event));
      return event;
    },
    key: (name, init = {}, target = window) => void act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }))),
  };
}
