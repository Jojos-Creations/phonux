/**
 * A workspace for the tests of `tuning.maxLivePanels`: a scrolling History root and web panels w1, w2, ... that park for
 * room, mounted in a measured row. Panels are added in id order, so the row reads [root w1 w2 ...]; a pinned one sits left
 * of the root. `row()` writes the row in array order and marks a parked panel with `*`.
 */
import * as React from 'react';
import { act } from 'react';
import { DragToClose, createWorkspace, definePanel, usePanelReorderSteps } from '../../index.js';
import type { PanelHandle, PanelSettings, PanelWindow, ProvidedPanels, WorkspaceHandle, WorkspaceOptions, WorkspaceTuning } from '../../index.js';
import { panelKey } from '../../panelSettings.js';
import { advanceFrames } from './mount-harness.js';
import { flush, markerTemplate, mountWorkspace, type ResizableWorkspace } from './workspace-row.js';

const ROOT = 'root';

export interface CapRigOptions {
  /** How many web panels w1..wK have a template; default 7. */
  count?: number;
  /** How many of them are added before the row is mounted, in id order (the pinned ones always are); default all. Others open later through `add`. */
  initial?: number;
  /** `tuning.maxLivePanels`; left out, the key is unset. */
  cap?: number | null;
  /** Panels added at the row start, so they sit pinned left of the root in the order given and are live before the cap is first read. */
  pinned?: readonly string[];
  /** The measured container width; default 1280, 0 is unmeasured. */
  width?: number;
  /** Every web panel's `capacityReturn`; default 'manual'. */
  returns?: 'auto' | 'manual';
  /** Every web panel's `revealOnScroll`; default 'never'. */
  reveal?: 'edges' | 'any' | 'never';
  /** `tuning.rowGesture`; default 'step', so wheel and arrow keys act. */
  gesture?: 'step' | 'free' | 'off';
  /** Draws a drag handle in every web panel, whose horizontal drop moves the panel one hop per step. */
  grab?: boolean;
  /** Settings every web panel adds over the three above. */
  settings?: PanelSettings;
  /** Settings one panel adds over those, by name. */
  own?: Record<string, PanelSettings>;
  /** Other tuning leaves. */
  tuning?: WorkspaceTuning;
  /** Other workspace options (storage, defaults). */
  workspace?: Partial<WorkspaceOptions>;
  /** Records the row of every committed render in `commits`. */
  record?: boolean;
  /** Mounts under React.StrictMode, as the apps run. */
  strict?: boolean;
}

export interface CapRig {
  ws: WorkspaceHandle;
  m: ResizableWorkspace;
  h: Record<string, PanelHandle>;
  /** Runs `fn` inside one act, so every call in it shares a turn. */
  turn: <T>(fn: () => T) => T;
  /** Adds the panel `name`, as opening it does. */
  add: (name: string) => PanelHandle;
  /** The row in array order: names, `root` for History, `*` after a parked panel. */
  row: () => string;
  /** The live panels right of the root, in row order. */
  unpinnedLive: () => string[];
  /** The panels left of the root that are live, in row order. */
  pinnedLive: () => string[];
  /** The parked panels, in row order. */
  parked: () => string[];
  /** The row of every committed render, when `record` is set. */
  commits: string[];
  entry: (name: string) => PanelWindow;
  provided: () => ProvidedPanels;
  /** Lets the slide and fade finish. */
  settle: () => Promise<void>;
}

/** How many panels right of the root are live in a row written as `row()` writes it. */
export const liveRightOfRoot = (row: string): number => {
  const names = row.split(' ');
  return names.slice(names.indexOf(ROOT) + 1).filter((name) => !name.endsWith('*')).length;
};

/** The row as `row()` writes it. */
export const rowOf = (entries: readonly PanelWindow[]): string =>
  entries
    .filter((p) => p.marker !== true)
    .map((p) => (p.live ? panelKey(p) : `${panelKey(p)}*`))
    .join(' ');

/** A web template whose view is a drag handle: a drop `offset` px away asks the panel to hop that many places. */
function grabbable(id: string, settings: PanelSettings) {
  return definePanel({
    id,
    settings,
    view: function Grab({ panel, handle }) {
      const stepsFor = usePanelReorderSteps();
      return React.createElement(DragToClose, {
        reorder: {
          onDragEnd: (offset: number) => {
            const steps = stepsFor(offset);
            for (let k = 0; k < Math.abs(steps); k += 1) handle.move(steps > 0 ? 'right' : 'left', 'person');
          },
        },
        children: (grip) => React.createElement('div', { 'data-grab': id, 'data-slot': panel.id, onPointerDown: grip.onPointerDown }, id),
      });
    },
  });
}

export async function capRig(o: CapRigOptions = {}): Promise<CapRig> {
  const ids = Array.from({ length: o.count ?? 7 }, (_, k) => `w${k + 1}`);
  const pinned = new Set(o.pinned ?? []);
  const settings: PanelSettings = { overflow: 'park', capacityReturn: o.returns ?? 'manual', revealOnScroll: o.reveal ?? 'never', ...o.settings };
  const template = (id: string) => {
    const own: PanelSettings = { ...settings, ...(pinned.has(id) ? { placeOnAdd: 'row-start' as const } : {}), ...o.own?.[id] };
    return o.grab === true ? grabbable(id, own) : markerTemplate(id, { settings: own });
  };
  const ws = createWorkspace({
    root: markerTemplate(ROOT, { settings: { title: 'History' } }),
    templates: ids.map(template),
    tuning: { rowGesture: o.gesture ?? 'step', ...(o.cap === undefined ? {} : { maxLivePanels: o.cap }), ...o.tuning },
    ...(o.workspace ?? {}),
  });
  const h: Record<string, PanelHandle> = {};
  // Each panel at the row start lands before the last one, so the pinned are added last to first.
  for (const id of [...(o.pinned ?? [])].reverse()) h[id] = ws.addPanel(id);
  for (const id of ids.slice(0, o.initial ?? ids.length)) if (!pinned.has(id)) h[id] = ws.addPanel(id);
  const commits: string[] = [];
  const m = mountWorkspace(ws, { width: o.width ?? 1280, ...(o.strict === true ? { strict: true } : {}), ...(o.record === true ? { onCommit: (provided: ProvidedPanels) => void commits.push(rowOf(provided.entries)) } : {}) });
  await flush();
  const entries = (): readonly PanelWindow[] => m.latest().entries.filter((p) => p.marker !== true);
  const rootAt = (): number => entries().findIndex((p) => panelKey(p) === ROOT);
  const rig: CapRig = {
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
    add: (name) => {
      let added!: PanelHandle;
      act(() => {
        added = ws.addPanel(name);
      });
      h[name] = added;
      return added;
    },
    row: () => rowOf(m.latest().entries),
    unpinnedLive: () => entries().filter((p, k) => k > rootAt() && p.live).map(panelKey),
    pinnedLive: () => entries().filter((p, k) => k < rootAt() && p.live).map(panelKey),
    parked: () => entries().filter((p) => !p.live).map(panelKey),
    commits,
    entry: (name) => {
      const found = entries().find((p) => panelKey(p) === name);
      if (found === undefined) throw new Error(`no entry '${name}' in the row: ${rowOf(entries())}`);
      return found;
    },
    provided: () => m.latest(),
    settle: () => advanceFrames(900),
  };
  return rig;
}
