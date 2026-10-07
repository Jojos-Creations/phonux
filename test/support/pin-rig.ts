/**
 * A workspace of marker templates mounted in a measured row, for the tests that pin, unpin and reset panels. With a root
 * the row reads [root a b c ...]; panels are added in id order and read by their names, not their engine ids.
 */
import { createWorkspace } from '../../index.js';
import type { PanelHandle, PanelsInput, PanelSettings, PanelState, PanelTemplate, PanelWindow, ProvidedPanels, WorkspaceHandle, WorkspaceOptions } from '../../index.js';
import { panelKey } from '../../panelSettings.js';
import { advanceFrames } from './mount-harness.js';
import { flush, markerTemplate, mountWorkspace, type MountedWorkspace } from './workspace-row.js';
import { act } from 'react';

export interface PinRigOptions {
  /** Ids added in order; default a, b, c. */
  ids?: readonly string[];
  /** Settings layer per template id. */
  settings?: Record<string, PanelSettings>;
  /** A workspace root panel named 'root', so the row has a visible root. Default true. */
  root?: boolean;
  width?: number;
  /** Extra workspace options (storage, defaults, tuning). */
  workspace?: Partial<WorkspaceOptions>;
  /** Provider input overrides, e.g. a short saveQuietMs. */
  over?: Partial<PanelsInput>;
  /** Extra templates beside the marker ones. */
  extra?: readonly PanelTemplate[];
}

export interface PinRig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
  h: Record<string, PanelHandle>;
  /** Runs `fn` in one act, so every call in it shares a turn. */
  turn: <T>(fn: () => T) => T;
  /** The row in array order, the root named 'root' and a marker left out. */
  order: () => string[];
  /** The ids of the present (live) entries in array order. */
  live: () => string[];
  entry: (id: string) => PanelWindow;
  state: (id: string) => PanelState;
  /** The permission and listing facts a pin changes, as literals. */
  facts: (id: string) => { parkable: boolean; listed: boolean; placeable: boolean; draggable: boolean; clearable: boolean; pinned: boolean };
  provided: () => ProvidedPanels;
  settle: () => Promise<void>;
}

export async function pinRig(o: PinRigOptions = {}): Promise<PinRig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const ws = createWorkspace({
    ...(o.root === false ? {} : { root: markerTemplate('root', { settings: { title: 'History' } }) }),
    templates: [...ids.map((id) => markerTemplate(id, o.settings?.[id] === undefined ? {} : { settings: o.settings[id] })), ...(o.extra ?? [])],
    ...(o.workspace ?? {}),
  });
  const h: Record<string, PanelHandle> = {};
  for (const id of ids) h[id] = ws.addPanel(id);
  const m = mountWorkspace(ws, { width: o.width ?? 4000, ...(o.over === undefined ? {} : { over: o.over }) });
  await flush();
  const entries = (): readonly PanelWindow[] => m.latest().entries.filter((p) => p.marker !== true);
  const entry = (id: string): PanelWindow => {
    const found = entries().find((p) => panelKey(p) === id);
    if (found === undefined) throw new Error(`no entry '${id}' in the row: ${entries().map(panelKey).join(' ')}`);
    return found;
  };
  return {
    ws,
    m,
    h,
    turn: <T,>(fn: () => T): T => {
      let out!: T;
      act(() => {
        out = fn();
      });
      return out;
    },
    order: () => entries().map(panelKey),
    live: () => entries().filter((p) => p.live).map(panelKey),
    entry,
    state: (id) => ws.panels.get(id)!.getState(),
    facts: (id) => {
      const s = ws.panels.get(id)!.getState();
      return { parkable: s.settings.parkable, listed: s.listed, placeable: s.settings.placeable, draggable: s.settings.draggable, clearable: s.settings.clearable, pinned: s.pinned };
    },
    provided: () => m.latest(),
    settle: () => advanceFrames(900),
  };
}
