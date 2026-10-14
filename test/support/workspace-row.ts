/**
 * A mounted provider, Workspace and PanelRow fed by one createWorkspace handle, for the tests that watch panels attach,
 * restore and render. The container's width is the host's measurement; phone panels are 390 wide.
 */
import assert from 'node:assert/strict';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, Workspace, definePanel, useProvidePanels } from '../../index.js';
import type { PanelsInput, PanelTemplate, ProvidedPanels, SettingNote, WorkspaceHandle } from '../../index.js';
import { createFakeHost } from '../../fakeHost.js';
import { rowScrollerFor } from '../../rowScroller.js';
import type { PanelWindow } from '../../panelWindow.js';
import { mount, panelsInput, withHost } from './mount-harness.js';

const NONE: ReadonlySet<string> = new Set();

/** A template whose view renders `<i data-slot={panel.id} data-keys={Object.keys(handle)}>` so a test can read what a view receives. */
/** The entries the newest mounted row was given, so a view can name its panel by engine id. */
export const rowEntries: { current: readonly PanelWindow[] } = { current: [] };

export const markerTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({
    id,
    view: ({ panel, handle, manager }) =>
      React.createElement('i', {
        'data-slot': panel.id,
        'data-template': id,
        'data-handle-keys': Object.keys(handle).join(','),
        'data-manager-keys': Object.keys(manager).join(','),
        'data-handle-id': handle.id,
      }),
    ...over,
    settings: over.settings,
  });

export interface MountedWorkspace {
  latest: () => ProvidedPanels;
  container: HTMLDivElement;
  notes: SettingNote[];
  /** The `data-slot` ids of the mounted views, in document order. */
  slots: () => string[];
  /** Every render's `ProvidedPanels` count; a test reads it to know a commit happened. */
  renders: () => number;
  rerender: (next: React.ReactNode) => void;
  unmount: () => void;
}

/** A `MountedWorkspace` whose container can be measured again. */
export interface ResizableWorkspace extends MountedWorkspace {
  /** Measures the container again at `width`, as a window resize does. */
  setWidth: (width: number) => void;
}

/**
 * `ws` mounted at a measured container `width`; `over` replaces any provider input. `onCommit` sees the row of every
 * render that reached the document, from a layout effect, so a render React discarded is never recorded.
 */
export function mountWorkspace(ws: WorkspaceHandle, o: { width?: number; over?: Partial<PanelsInput>; strict?: boolean; onCommit?: (provided: ProvidedPanels) => void; wrap?: (tree: React.ReactElement) => React.ReactElement } = {}): ResizableWorkspace {
  const width = o.width ?? 1000;
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const notes: SettingNote[] = [];
  let latest: ProvidedPanels | undefined;
  let renders = 0;
  let measure: ((next: number) => void) | undefined;
  function Probe(): React.ReactElement {
    const [containerWidth, setContainerWidth] = React.useState(width);
    measure = setContainerWidth;
    latest = useProvidePanels(panelsInput({ workspace: ws, containerWidth, overflowContainerRef: ref, onNote: (n) => void notes.push(n), ...o.over }));
    rowEntries.current = latest.entries;
    renders += 1;
    const provided = latest;
    React.useLayoutEffect(() => o.onCommit?.(provided));
    return withHost(
      React.createElement(
        Workspace,
        { overflowContainerRef: ref, rowRef, containerWidth, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, tuning: provided.tuning } as never,
        React.createElement(PanelRow, { entries: provided.entries, rootId: ws.rootId, closingIds: NONE, enteringViaAnchorIds: NONE, rowNumbers: provided.rowNumbers, workspace: ws }),
      ),
      createFakeHost({ panels: provided }),
    );
  }
  const tree = o.strict === true ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe);
  const mounted = mount(o.wrap === undefined ? tree : o.wrap(tree));
  const container = ref.current;
  assert.ok(container, 'the Workspace never attached its scroll container');
  return {
    latest: () => latest!,
    container,
    notes,
    slots: () => [...container.querySelectorAll('[data-slot]')].map((n) => (n as HTMLElement).dataset.slot!),
    renders: () => renders,
    setWidth: (next) => void act(() => measure!(next)),
    rerender: (next) => mounted.rerender(next),
    unmount: () => mounted.unmount(),
  };
}

/** Lets pending promise continuations (a storage load) and their renders run. */
export const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

export { rowScrollerFor };
