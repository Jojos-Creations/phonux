/**
 * The column component: every workspace of a `WorkspaceColumnHandle` in a cell of its own, one above the other, with the current
 * one in view. The person moves by the buttons at the top and bottom center, which name the neighbor or offer to create one, and
 * by whatever key the app binds to `step`; the column itself never scrolls under a wheel or a trackpad. DESIGN.md, "The workspace column".
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { slideToTransition } from './directionalTransition.js';
import { resolveLabels } from './labels.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { columnCoreOf, type WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspaceHandle } from './workspaceCore.js';
import { Band, columnBandRoom, DEFAULT_COLUMN_BANDS, WORKSPACE_NAME_CONTROL_HEIGHT } from './columnBands.js';
import { ColumnDivider } from './ColumnDivider.js';
import { DEFAULT_PHONE_SIZE } from './hostApi.js';
import { WORKSPACE_ACTIVE_ATTRIBUTE } from './rowDom.js';
import { RowFloorContext } from './rowFloor.js';
import { steerColumnEntry, steerColumnTab } from './columnTabOrder.js';
import { useTabPress } from './panelRowTabOrder.js';

/** The room above a workspace's row that the default bands keep, in px, below the column's `topInset`. With bands of its own, `columnBandRoom(bands).above`. @public */
export const COLUMN_TOP_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).above;
/** The room below a workspace's row that the default bands keep, in px. With bands of its own, `columnBandRoom(bands).below`. @public */
export const COLUMN_BOTTOM_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).below;
const TARGET = WORKSPACE_NAME_CONTROL_HEIGHT;

const DefaultCell = React.lazy(() => import('./autoMount.js').then((m) => ({ default: m.AutoRoot })));

// The column's own controls sit inside the device's safe areas, as the row does; env() is 0 unless the page sets viewport-fit=cover.
const belowSafeTop = (px: number): string => `calc(${px}px + env(safe-area-inset-top, 0px))`;

/** The props of `WorkspaceColumn`. @public */
export interface WorkspaceColumnProps {
  /** The column to draw. */
  column: WorkspaceColumnHandle;
  /**
   * What fills a workspace's cell: the app's own hand-wired row for that workspace. Omitted: the row the library mounts itself, as
   * `createWorkspace` does. A returned row puts the column's `topInset` plus its bands' room above (`columnBandRoom`) plus its row gap above its panels.
   */
  children?: (workspace: WorkspaceHandle) => React.ReactNode | undefined;
}

/** The cell's own row, or undefined when the function is absent or returns undefined: the library's row is drawn then. */
const drawn = (children: WorkspaceColumnProps['children'], ws: WorkspaceHandle): React.ReactNode | undefined => (children === undefined ? undefined : children(ws));

/**
 * Draws a column: one cell per workspace, the current one in view, the others inert and hidden from assistive technology but
 * still mounted, so their panels keep their state. Moving to another workspace moves focus into its cell when focus was in the one left.
 * A column made with `sideBySide` and a window of several slots draws the cells `column.shown` lists next to one another, each as wide
 * as its slots, with a divider between each two; a press or focus in a cell makes it the current workspace.
 * @public
 */
export function WorkspaceColumn({ column, children }: WorkspaceColumnProps): React.ReactElement {
  const core = columnCoreOf(column);
  const snap = React.useSyncExternalStore(core.subscribe, core.snapshot, core.snapshot);
  // The system preference too, because an app's MotionConfig may not carry it.
  const systemReduced = useReducedMotion() === true;
  const reduced = useReducedMotionConfig() === true || systemReduced;
  const move = React.useMemo(() => slideToTransition(resolveWorkspaceTuning(snap.tuning).slide), [snap.tuning]);
  const labels = React.useMemo(() => resolveLabels(snap.labels), [snap.labels]);
  const bands = core.bands ?? DEFAULT_COLUMN_BANDS;
  const room = React.useMemo(() => columnBandRoom(bands), [bands]);
  const cells = React.useRef(new Map<string, HTMLElement>());
  const rootRef = React.useRef<HTMLDivElement>(null);
  const phone = snap.phoneWidth ?? DEFAULT_PHONE_SIZE.width;
  // The window's slots are counted from the column's drawn width at the phone size, which is the one place the column learns it.
  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const read = (): void => core.setWindowWidth(el.clientWidth, phone);
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [core, phone]);
  // Several spaces share the window: each cell is as wide as its slots and the group stands centered, as one row does in the window.
  // Neighbouring cells overlap by one gap, the padding each row keeps at its ends, so panels of two spaces stand one gap apart.
  const pitch = phone + snap.rowGap;
  const shownIds = new Set(snap.shown.map((c) => c.id));
  const split = snap.sideBySide && snap.shown.length > 1;
  const slotsAll = snap.shown.reduce((sum, c) => sum + c.slots, 0);
  const geometry = new Map<string, React.CSSProperties>();
  let before = 0;
  for (const c of snap.shown) {
    geometry.set(c.id, { left: `calc(50% + ${before * pitch - (slotsAll * pitch + snap.rowGap) / 2}px)`, right: 'auto', width: c.slots * pitch + snap.rowGap });
    before += c.slots;
  }
  // A cell that leaves the window keeps the place it had while it slides away.
  const lastGeometry = React.useRef(new Map<string, React.CSSProperties>());
  if (split) for (const [id, g] of geometry) lastGeometry.current.set(id, g);
  const left = React.useRef<number>(snap.current);
  // The saved workspace is selected only once the column has read it, so the move onto it is a placement, not a slide: the slide
  // comes on with the first move away from where the column was when it became ready.
  const placedAt = React.useRef<number | null>(null);
  const moved = React.useRef(false);
  if (snap.status === 'ready' && placedAt.current === null) placedAt.current = snap.current;
  if (placedAt.current !== null && snap.current !== placedAt.current) moved.current = true;
  const placed = moved.current;
  // Only the workspace left and the one arrived at slide, so a move past several is one step and the ones between never show.
  // A workspace added or removed above the current one changes neither, so nothing moves.
  const currentId = snap.workspaces[snap.current]?.id;
  const [seenId, setSeenId] = React.useState(currentId);
  const [fromId, setFromId] = React.useState<string | undefined>(undefined);
  if (seenId !== currentId) {
    setSeenId(currentId);
    setFromId(seenId);
  }
  const slide = reduced || !placed ? 'none' : `transform ${move.duration}s cubic-bezier(${move.ease.join(',')})`;

  // An inert cell drops the focus inside it; the arrow keys keep working only if focus lands somewhere in the column again.
  React.useLayoutEffect(() => {
    const was = snap.workspaces[left.current];
    left.current = snap.current;
    const now = snap.workspaces[snap.current];
    if (was === undefined || now === undefined || was === now) return;
    const from = cells.current.get(was.id);
    const to = cells.current.get(now.id);
    if (from !== undefined && to !== undefined && from.contains(document.activeElement)) to.focus({ preventScroll: true });
  }, [snap.current, snap.workspaces]);

  // A cell the window stops showing is inert, which drops the focus inside it; focus goes to the current space's cell instead of the page.
  React.useLayoutEffect(() => {
    const held = document.activeElement;
    const now = snap.workspaces[snap.current];
    const to = now === undefined ? undefined : cells.current.get(now.id);
    if (to === undefined || held === null || to.contains(held)) return;
    for (const [id, el] of cells.current) if (!shownIds.has(id) && el.contains(held)) return void to.focus({ preventScroll: true });
  });

  const create = (index: number): void => {
    column.scrollTo(column.addWorkspace({ index }));
  };

  const tabPress = useTabPress();
  // The stops Tab walks side by side, in screen order: each shown cell, the divider after it, and so on.
  const screenStops = (): HTMLElement[] => {
    const root = rootRef.current;
    if (root === null) return [];
    return snap.shown.flatMap((c, k) => {
      const cell = cells.current.get(c.id);
      const divider = k < snap.shown.length - 1 ? root.querySelector<HTMLElement>(`[data-column-divider="${k}"]`) : null;
      return [cell, divider].filter((el): el is HTMLElement => el !== null && el !== undefined);
    });
  };
  const base = React.useId();
  const cellIdOf = (id: string): string => `${base}-cell-${snap.workspaces.findIndex((w) => w.id === id)}`;
  const cellOf = (ws: WorkspaceHandle, i: number): React.ReactNode => {
      const active = i === snap.current;
      const shown = shownIds.has(ws.id);
      const cell = snap.shown.find((c) => c.id === ws.id);
      const above = snap.workspaces[i - 1];
      const below = snap.workspaces[i + 1];
      const own = drawn(children, ws);
      const slotProps = { workspace: ws, column, index: i, above, below, active, labels };
      return (
        <Box
          key={ws.id}
          ref={(el: HTMLElement | null) => {
            if (el === null) cells.current.delete(ws.id);
            else cells.current.set(ws.id, el);
          }}
          id={cellIdOf(ws.id)}
        data-workspace-cell=""
          data-workspace-id={ws.id}
          {...{ [WORKSPACE_ACTIVE_ATTRIBUTE]: active ? '' : undefined }}
          data-workspace-shown={shown ? '' : undefined}
          tabIndex={-1}
          aria-hidden={shown ? undefined : true}
          inert={!shown}
          onTransitionEnd={(event: React.TransitionEvent<HTMLElement>) => {
            if (active && event.target === event.currentTarget && event.propertyName === 'transform') setFromId(undefined);
          }}
          // A press or focus in a cell side by side makes it the current workspace, so the keys that step go to the side the person is in.
          onPointerDownCapture={split && shown && !active ? () => column.scrollTo(ws) : undefined}
          onFocusCapture={split && shown && !active ? () => column.scrollTo(ws) : undefined}
          style={{ transform: `translateY(${shown ? 0 : i < snap.current ? -100 : 100}%)`, transition: shown || ws.id === fromId ? slide : 'none', ...(split ? (shown ? geometry.get(ws.id) : lastGeometry.current.get(ws.id)) : undefined) }}
          sx={{ position: 'absolute', inset: 0, outline: 'none' }}
        >
          <RowFloorContext.Provider value={split ? cell?.rowSlots : undefined}>
            <Band side="above" band={bands.above} inset={snap.topInset} props={slotProps} />
            {own === undefined ? (
              <React.Suspense fallback={null}>
                <DefaultCell workspace={ws} columnTop={room.above} columnBottom={room.below - COLUMN_BOTTOM_BAND} themed={false} />
              </React.Suspense>
            ) : (
              own
            )}
            <Band side="below" band={bands.below} inset={snap.topInset} props={slotProps} />
          </RowFloorContext.Provider>
        </Box>
      );
    };
  const dividerAt = (k: number): React.ReactNode => {
    const left = snap.shown[k]!;
    const right = snap.shown[k + 1]!;
    const through = snap.shown.slice(0, k + 1).reduce((sum, c) => sum + c.slots, 0);
    const nameOf = (id: string): string => snap.workspaces.find((w) => w.id === id)?.name ?? '';
    return (
      <ColumnDivider
        key={`${left.id}|${right.id}`}
        column={column}
        evenSplit={() => void core.evenSplit()}
        rows={snap.shown.map((c) => c.rowSlots)}
        at={k}
        controls={cellIdOf(left.id)}
        names={[nameOf(left.id), nameOf(right.id)]}
        least={snap.leastRows}
        pitch={pitch}
        center={`calc(50% + ${(through - slotsAll / 2) * pitch}px)`}
        labels={labels}
      />
    );
  };
  return (
    <Box
      ref={rootRef}
      data-workspace-column=""
      onKeyDown={split ? (e: React.KeyboardEvent<HTMLElement>) => steerColumnTab(e, rootRef.current!, screenStops()) : undefined}
      onFocus={
        split
          ? (e: React.FocusEvent<HTMLElement>) => {
              steerColumnEntry(e, rootRef.current!, screenStops(), tabPress.current);
              // Focus a Tab steered into another cell makes that cell the current one, as focus there by any other way does.
              const held = document.activeElement;
              const ws = snap.workspaces.find((w) => cells.current.get(w.id)?.contains(held) === true);
              if (ws !== undefined && shownIds.has(ws.id)) column.scrollTo(ws);
            }
          : undefined
      }
      sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ position: 'relative', height: '100%' }}>
        {snap.workspaces.map((ws, i) => cellOf(ws, i))}
        {split ? snap.shown.slice(0, -1).map((_, k) => dividerAt(k)) : null}
      </div>
      {snap.workspaces.length === 0 ? (
        <Button data-workspace-neighbour="empty" size="small" onClick={() => create(0)} sx={{ position: 'absolute', top: belowSafeTop(snap.topInset), left: '50%', transform: 'translateX(-50%)', height: TARGET, minHeight: 0, textTransform: 'none' }}>
          {labels.newWorkspace}
        </Button>
      ) : null}
    </Box>
  );
}
