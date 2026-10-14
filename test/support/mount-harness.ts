/**
 * Mounts React elements into the jsdom document and steps the virtual frame clock. jsdom-globals comes first so
 * react and motion load after the clock exists. Assert on booleans and strings read from the container: handing a
 * DOM node or a React element to assert.equal makes a failure walk React's fiber graph.
 */
import { FRAME_MS, frameClock } from './jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HostProvider, type Host } from '../../hostApi.js';
import { createFakeHost } from '../../fakeHost.js';
import type { JsonValue, PanelSettings, PanelsInput, WorkspaceHandle } from '../../index.js';
import { seededWorkspace, type SeedOptions } from './seed-workspace.js';
import { bindingOf } from '../../workspaceCore.js';
import { usePanelManager, type UsePanelManagerResult } from '../../panels/usePanelManager.js';
import type { PanelWindow } from '../../panelWindow.js';

export { StaticRow, plainTemplate, seededWorkspace, type SeedOptions } from './seed-workspace.js';

export interface Mounted {
  /** The element the tree is rendered into; it is a child of document.body until cleanup(). */
  readonly container: HTMLElement;
  rerender(ui: React.ReactNode): void;
  unmount(): void;
}

const mounted = new Set<{ root: Root; container: HTMLElement }>();

function renderInto(root: Root, ui: React.ReactNode): void {
  assertNotAdvancing('render called');
  act(() => root.render(ui));
}

export function mount(ui: React.ReactNode): Mounted {
  assertNotAdvancing('mount called');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const record = { root, container };
  mounted.add(record);
  renderInto(root, ui);
  return {
    container,
    rerender: (next) => renderInto(root, next),
    unmount: () => {
      if (!mounted.delete(record)) return;
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** `ui` under a HostProvider; `host` defaults to a recording fake with a 390 x 700 phone. */
export function withHost(ui: React.ReactNode, host: Host = createFakeHost()): React.ReactElement {
  return React.createElement(HostProvider, { host, children: ui });
}

/** Unmounts everything mounted so far; call it from an afterEach. */
export function cleanup(): void {
  assertNotAdvancing('cleanup called');
  for (const record of [...mounted]) {
    mounted.delete(record);
    act(() => record.root.unmount());
    record.container.remove();
  }
}

let advancing = false;

function assertNotAdvancing(what: string): void {
  if (advancing) throw new Error(`${what} while advanceFrames is still running: await every advanceFrames call`);
}

/**
 * Steps the virtual frame clock by whole frames covering `ms`, one async act() per frame: React renders and
 * promise continuations (motion finishes an exit through one) run between frames as they do in a browser. Never
 * waits on real time. Await it: a call left running makes the next harness call throw.
 */
export async function advanceFrames(ms: number): Promise<void> {
  assertNotAdvancing('advanceFrames called');
  advancing = true;
  try {
    const frames = Math.ceil(ms / FRAME_MS);
    for (let frame = 0; frame < frames; frame += 1) {
      await act(async () => {
        frameClock.step(1);
      });
    }
  } finally {
    advancing = false;
  }
}

/** The input a test gives useProvidePanels; `over` replaces any default. The row's rules come from `workspace`. */
export function panelsInput(over: Partial<PanelsInput> & { workspace: WorkspaceHandle }): PanelsInput {
  return {
    phoneWidth: 390,
    containerWidth: 0,
    overflowContainerRef: { current: null },
    ...over,
  };
}

/** What a probe over hand-built entries is given: the hook's own inputs and the workspace's. */
export type SeededOver = Partial<Omit<PanelsInput, 'workspace'>> & SeedOptions & { initialEntries: readonly PanelWindow[]; declared?: readonly Declared[] };

type Declared = { id: string; templateId: string; settings?: PanelSettings; params?: JsonValue; url?: string };

/**
 * `panelsInput` for a row that starts from `initialEntries`, called in the probe's render: the workspace is made once
 * for the probe's life and the seed options go to `createWorkspace`.
 */
export function useSeededInput(over: SeededOver): PanelsInput {
  const { initialEntries, declared, rootId, tuning, workspaceDefaults, templates, storage, ...hook } = over;
  const [workspace] = React.useState(() => {
    const ws = seededWorkspace(initialEntries, { ...(rootId !== undefined ? { rootId } : {}), ...(tuning !== undefined ? { tuning } : {}), ...(workspaceDefaults !== undefined ? { workspaceDefaults } : {}), ...(templates !== undefined ? { templates } : {}), ...(storage !== undefined ? { storage } : {}) });
    for (const d of declared ?? []) ws.addPanel(d.templateId, { ...(d.id === d.templateId && !bindingOf(ws).template(d.templateId)?.settings?.multiple ? {} : { id: d.id }), ...(d.settings !== undefined ? { settings: d.settings } : {}), ...(d.params !== undefined ? { params: d.params } : {}), ...(d.url !== undefined ? { url: d.url } : {}) });
    return ws;
  });
  // The workspace is made once, so a tuning the probe changes between renders reaches it as a session change, before the next paint.
  const applied = React.useRef(tuning);
  React.useLayoutEffect(() => {
    if (tuning === undefined || applied.current === tuning) return;
    applied.current = tuning;
    workspace.panels.configureTuning(tuning);
  });
  return panelsInput({ workspace, ...hook });
}

/** usePanelManager with the arguments a test cares about. */
export function usePanelManagerWith(a: {
  panels: PanelWindow[];
  setPanels: React.Dispatch<React.SetStateAction<PanelWindow[]>>;
  phoneWidth: number;
  containerWidth: number;
  fixedColumnCount: number;
  rootId: string;
}): UsePanelManagerResult {
  return usePanelManager(a.panels, a.setPanels, a.phoneWidth, a.containerWidth, a.fixedColumnCount, a.rootId);
}
