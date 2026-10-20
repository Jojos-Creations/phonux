/**
 * The row side of a drag that starts outside the row: the geometry that parts the row for it (shared with the header
 * drag), the controller PanelRow provides, and the state it drives. The hook a view calls is in usePanelRowDrop.ts.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import type { PanelResult } from './panelManager.js';
import { accepted, refused } from './panelManager.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import type { ChromeStore } from './panelChrome.js';
import { panelKey } from './panelSettings.js';
import type { AddPlacement } from './panelSettings.js';
import type { DragScroll } from './panelSlotContext.js';
import { openEdgeHold, endEdgeHold, stepEdgeHold, type EdgeHold } from './panelRowDropScroll.js';
import { closestRowScroller } from './rowScroller.js';
import { landPanelIn, type WorkspaceHandle } from './workspaceCore.js';

/** A panel a drag would cross, with the width the row draws it at. */
export interface Neighbor {
  readonly id: string;
  readonly width: number;
}

/** The panels a drag can cross, nearest first on each side. */
export interface Walk {
  readonly left: readonly Neighbor[];
  readonly right: readonly Neighbor[];
}

/** The neighbours `steps` hops would cross. */
export const crossedBy = (walk: Walk, steps: number): readonly Neighbor[] => (steps > 0 ? walk.right : walk.left).slice(0, Math.abs(steps));

/** How far a panel moves when it hops over `crossed`: each neighbour's width plus the gap. */
export const travelOver = (crossed: readonly Neighbor[], gap: number): number => crossed.reduce((sum, n) => sum + n.width + gap, 0);

/** Every panel the drag would cross moves by the dragged panel's own `span`, away from the side it is dragged toward. */
export function partShifts(walk: Walk, steps: number, span: number): Map<string, number> {
  const shifts = new Map<string, number>();
  if (steps === 0) return shifts;
  for (const crossed of crossedBy(walk, steps)) shifts.set(crossed.id, steps > 0 ? -span : span);
  return shifts;
}

/** What a row-drop preview asks the row to draw. */
export interface DropPreview {
  /** The engine id of the panel being dropped. */
  readonly id: string;
  /** The hops the pointer has asked for; negative to the left. */
  readonly steps: number;
  /** True for a panel that is not in view: the row shows a gap for it instead of moving it. */
  readonly hidden: boolean;
}

/** The row's drawn parts for a preview: each panel's extra offset and, for a hidden source, the gap. */
export interface DropParts {
  readonly shifts: ReadonlyMap<string, number>;
  /** The gap a hidden source holds open, in the row's own px; null for a panel in view. */
  readonly gap: { readonly left: number; readonly width: number } | null;
}

/** What `dropParts` reads of the row. */
export interface DropRow {
  readonly entries: readonly PanelRowEntry[];
  readonly rowGap: number;
  readonly widthById: ReadonlyMap<string, number>;
  readonly leftById: ReadonlyMap<string, number>;
  /** The width the dropped panel is drawn at. */
  readonly width: number;
  readonly walk: Walk;
}

/**
 * How the row parts for `preview`. A panel in view moves to the slot its hops end in while the neighbours it crossed
 * slide aside by its span. A hidden one leaves a gap its own width at the slot its hops end in: every present panel
 * after its place in the array moves right by the span, and the ones it crossed take that back.
 */
export function dropParts(preview: DropPreview, row: DropRow): DropParts {
  const span = row.width + row.rowGap;
  const shifts = partShifts(row.walk, preview.steps, span);
  const crossed = crossedBy(row.walk, preview.steps);
  const travel = travelOver(crossed, row.rowGap) * Math.sign(preview.steps);
  if (!preview.hidden) {
    if (preview.steps !== 0) shifts.set(preview.id, travel);
    return { shifts, gap: null };
  }
  const at = row.entries.findIndex((p) => p.id === preview.id);
  const after = row.entries.slice(at + 1).filter(isPresent);
  const before = row.entries.slice(0, at).filter(isPresent);
  for (const p of after) shifts.set(p.id, (shifts.get(p.id) ?? 0) + span);
  const next = after[0];
  const last = before[before.length - 1];
  const rest = next !== undefined ? (row.leftById.get(next.id) ?? 0) : last !== undefined ? (row.leftById.get(last.id) ?? 0) + (row.widthById.get(last.id) ?? 0) + row.rowGap : 0;
  return { shifts, gap: { left: rest + travel, width: row.width } };
}

/** Where a hidden panel lands after `steps` hops, as the placement the engine takes; 'in-place' for none. */
export function dropPlacement(walk: Walk, steps: number, keyOf: (id: string) => string): AddPlacement | 'in-place' {
  const crossed = crossedBy(walk, steps);
  const last = crossed[crossed.length - 1];
  if (last === undefined) return 'in-place';
  return steps > 0 ? { after: keyOf(last.id) } : { before: keyOf(last.id) };
}

/**
 * What a view calls to drag a panel into the row: the controller PanelRow provides to its views.
 * @internal
 */
export interface RowDropController {
  begin(key: string, source: 'code' | 'person'): boolean;
  update(clientX: number): void;
  end(): PanelResult;
  cancel(): void;
}

/** Provided by PanelRow to the views it renders; absent outside a row. */
export const RowDropContext = React.createContext<RowDropController | undefined>(undefined);

/** What the controller reads of the row, fresh on every render. */
export interface RowDropInput {
  readonly workspace: WorkspaceHandle;
  readonly rootId: string;
  readonly entries: readonly PanelRowEntry[];
  readonly chrome: ChromeStore;
  readonly boxRef: React.RefObject<HTMLElement | null>;
  /** The x of the centre a drag of the entry counts its pointer offset from, in the row's own px: its slot when it is in view, else the gap it would hold open. */
  readonly centreOf: (entry: PanelRowEntry, hidden: boolean) => number;
  readonly walkOf: (entry: PanelRowEntry) => Walk;
  /** The hop rule shared with the header drag. */
  readonly stepsFor: (entry: PanelRowEntry, offset: number) => number;
  readonly dragScroll: DragScroll | undefined;
}

interface Active {
  readonly engineId: string;
  readonly key: string;
  readonly source: 'code' | 'person';
  readonly live: boolean;
  hold: EdgeHold | null;
  x: number | null;
  steps: number;
}

/**
 * The state and controller behind a row drop: the preview PanelRow draws, and the begin/update/end/cancel the hook
 * calls. The controller keeps one identity; it reads the row through a ref, so a call always sees the latest render.
 */
export function useRowDrop(input: RowDropInput): { preview: DropPreview | null; controller: RowDropController } {
  const [preview, setPreview] = React.useState<DropPreview | null>(null);
  const latest = React.useRef(input);
  latest.current = input;
  const reduced = (useReducedMotionConfig() === true) || (useReducedMotion() === true);
  const reducedRef = React.useRef(reduced);
  reducedRef.current = reduced;
  const active = React.useRef<Active | null>(null);

  const controller = React.useMemo<RowDropController>(() => {
    const entryOf = (a: Active): PanelRowEntry | undefined => latest.current.entries.find((p) => p.id === a.engineId);
    const releaseHold = (a: Active): void => {
      if (a.hold !== null) endEdgeHold(a.hold, latest.current.dragScroll, reducedRef.current);
      a.hold = null;
    };
    const finish = (a: Active): void => {
      releaseHold(a);
      if (a.live) latest.current.chrome.setDragging(a.engineId, false);
      active.current = null;
      setPreview(null);
    };
    /** The hops the pointer asks for now. */
    const recompute = (a: Active): void => {
      const row = latest.current;
      const entry = entryOf(a);
      if (entry === undefined || a.x === null) return;
      const rect = row.boxRef.current?.getBoundingClientRect();
      const centre = (rect?.left ?? 0) + row.centreOf(entry, !a.live);
      a.steps = row.stepsFor(entry, a.x - centre);
      setPreview((now) => (now?.id === a.engineId && now.steps === a.steps ? now : { id: a.engineId, steps: a.steps, hidden: !a.live }));
    };
    const tick = (a: Active) => (nowMs: number): void => {
      const h = a.hold;
      const slot = latest.current.dragScroll;
      if (h === null || active.current !== a) return;
      h.frame = null;
      if (slot === undefined) return;
      stepEdgeHold(h, nowMs, a.x ?? Number.NaN, slot, reducedRef.current);
      recompute(a);
      h.frame = requestAnimationFrame(tick(a));
    };
    return {
      begin(key, source) {
        if (active.current !== null) return false;
        const row = latest.current;
        const state = row.workspace.panels.getSnapshot().panels.find((p) => p.id === key);
        if (state === undefined || (state.status !== 'live' && state.status !== 'parked') || state.engineId === null) return false;
        if (state.engineId === row.rootId) return false;
        if (source === 'person' && !state.settings.movable) return false;
        const entry = row.entries.find((p) => p.id === state.engineId);
        if (entry === undefined || entry.marker === true) return false;
        const a: Active = { engineId: entry.id, key, source, live: state.status === 'live', hold: null, x: null, steps: 0 };
        active.current = a;
        if (a.live) row.chrome.setDragging(a.engineId, true);
        const scrollerEl = row.boxRef.current === null ? null : closestRowScroller(row.boxRef.current);
        const slot = row.dragScroll;
        if (scrollerEl !== null && slot !== undefined && slot.mode === 'edge') {
          a.hold = openEdgeHold(scrollerEl, scrollerEl.scrollLeft, slot);
          if (a.hold !== null) a.hold.frame = requestAnimationFrame(tick(a));
        }
        setPreview({ id: a.engineId, steps: 0, hidden: !a.live });
        return true;
      },
      update(clientX) {
        const a = active.current;
        if (a === null) return;
        a.x = clientX;
        recompute(a);
      },
      end() {
        const a = active.current;
        if (a === null) return refused('unknown-panel', 'no row drop is in progress');
        const row = latest.current;
        const entry = entryOf(a);
        const steps = a.steps;
        const walk = entry === undefined ? undefined : row.walkOf(entry);
        const nowLive = entry !== undefined && isPresent(entry);
        finish(a);
        if (entry === undefined || walk === undefined) return refused('is-closed', `panel '${a.key}' left the row during the drag`);
        if (nowLive !== a.live) return refused('busy', `panel '${a.key}' changed under the drag`);
        if (a.live) {
          if (steps === 0) return accepted(false);
          const handle = row.workspace.panels.get(a.key);
          return handle === undefined ? refused('unknown-panel', `no panel '${a.key}' in this workspace`) : handle.move(steps, a.source);
        }
        const keyOf = (id: string): string => {
          const found = row.entries.find((p) => p.id === id);
          return found === undefined ? id : panelKey(found);
        };
        return landPanelIn(row.workspace, a.key, dropPlacement(walk, steps, keyOf), a.source);
      },
      cancel() {
        const a = active.current;
        if (a !== null) finish(a);
      },
    };
  }, []);

  // A drag whose panel left the row by other means has nothing left to preview or hold.
  const gone = preview !== null && !input.entries.some((p) => p.id === preview.id);
  React.useEffect(() => {
    if (gone) controller.cancel();
  }, [gone, controller]);
  React.useEffect(() => () => controller.cancel(), [controller]);
  return { preview, controller };
}
