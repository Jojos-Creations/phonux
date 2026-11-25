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
import { COLUMN_SENTINEL, steerColumnSentinel, steerColumnTab } from './columnTabOrder.js';
import { byIndex, type ColumnMotion, type ColumnSlide, type ParkSide, parkedTransform, prunedMotion, settledMotion, shownTransform, STILL, switchMotion } from './columnSlide.js';

/** How long the fade that stands in for a slide under Reduce Motion lasts, in seconds: long enough to read as a change, too short to wait on. */
const REDUCED_FADE_SEC = 0.15;

/** The room above a workspace's row that the default bands keep, in px, below the column's `topInset`. With bands of its own, `columnBandRoom(bands).above`. @public */
export const COLUMN_TOP_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).above;
/** The room below a workspace's row that the default bands keep, in px. With bands of its own, `columnBandRoom(bands).below`. @public */
export const COLUMN_BOTTOM_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).below;
const TARGET = WORKSPACE_NAME_CONTROL_HEIGHT;

// A tab stop of no size: the browser's own step lands on it, and focus is parked on it so that a pending step carries on from there.
// No aria-hidden, which a focusable element must not carry. A tab stop on a non-interactive element is the point.
function ColumnSentinel({ at, stop }: { at: 'start' | 'end' | 'cell-start' | 'cell-end'; stop: boolean }): React.ReactElement {
  return <span {...{ tabIndex: stop ? 0 : -1, [COLUMN_SENTINEL]: at }} style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', outline: 'none' }} />;
}

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
 * as its slots, with a divider between each two; a press or focus in a cell makes it the current workspace. Tab and Shift+Tab then
 * walk the shown cells left to right as they are drawn, each divider between its two cells, whatever order the column lists them in.
 * Inside a cell the browser's own Tab order is untouched. For the steps between cells the column and each cell hold zero-size elements
 * of their own (`data-column-sentinel`). Where the cell drawn first (last) is not the first (last) shown one in the DOM, Tab into or out
 * of the column at that end rests on such an element for one press. The dividers take focus and are reached by Tab through the column.
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
  const placedAt = React.useRef<string | null | undefined>(undefined);
  const moved = React.useRef(false);
  const atId = snap.workspaces[snap.current]?.id ?? null;
  if (snap.status === 'ready' && placedAt.current === undefined) placedAt.current = atId;
  if (placedAt.current !== undefined && atId !== placedAt.current) moved.current = true;
  const placed = moved.current;
  // Only the workspace left and the one arrived at slide, so a move past several is one step and the ones between never show.
  // A workspace added or removed above the current one changes neither, so nothing moves.
  const currentId = snap.workspaces[snap.current]?.id;
  const sideways = core.slideFrom !== undefined;
  const fadeWhenReduced = core.reducedSwitch === 'fade';
  const [seen, setSeen] = React.useState<{ id: string | undefined; workspaces: readonly WorkspaceHandle[] }>({ id: currentId, workspaces: snap.workspaces });
  const [motion, setMotion] = React.useState<ColumnMotion>(STILL);
  let shownMotion = motion;
  if (seen.id !== currentId || seen.workspaces !== snap.workspaces) {
    setSeen({ id: currentId, workspaces: snap.workspaces });
    const ids = new Set(snap.workspaces.map((w) => w.id));
    shownMotion = prunedMotion(motion, ids);
    // A move to a side already on screen only moves the focus there: neither cell is thrown aside, whatever slideFrom would say.
    const onScreen = split && seen.id !== undefined && shownIds.has(seen.id);
    if (seen.id !== currentId && seen.id !== undefined && currentId !== undefined && !onScreen) {
      const fromWs = seen.workspaces.find((w) => w.id === seen.id);
      const toWs = snap.workspaces[snap.current]!;
      // A cell never moved rests above or below the workspace that was current, by index.
      const fromAt = snap.workspaces.findIndex((w) => w.id === seen.id);
      const restOf = (id: string): ParkSide =>
        fromAt >= 0 ? byIndex(fromAt, snap.workspaces.findIndex((w) => w.id === id)) : byIndex(seen.workspaces.findIndex((w) => w.id === seen.id), seen.workspaces.findIndex((w) => w.id === id));
      const asked = (): ColumnSlide | undefined => {
        try {
          return fromWs === undefined ? 'none' : core.slideFrom?.(fromWs, toWs, seen.workspaces);
        } catch (e) {
          core.reportError(e);
          return undefined;
        }
      };
      const wanted: ColumnSlide = !placed ? 'none' : reduced ? (fadeWhenReduced ? 'fade' : 'none') : asked() ?? restOf(currentId);
      shownMotion = switchMotion(shownMotion, seen.id, currentId, wanted, restOf);
    }
    if (shownMotion !== motion) setMotion(shownMotion);
  }
  const slide = `transform ${move.duration}s cubic-bezier(${move.ease.join(',')})`;
  const fade = `opacity ${reduced ? REDUCED_FADE_SEC : move.duration}s ease`;
  // The arriving cell is drawn once where it starts with no transition, so its glide starts there and not from where it rested.
  React.useLayoutEffect(() => {
    if (shownMotion.pre === null) return;
    void cells.current.get(shownMotion.pre.id)?.getBoundingClientRect();
    setMotion((m) => (m.pre === null ? m : { ...m, pre: null }));
  }, [shownMotion.pre]);
  const styleOf = (id: string, i: number, shown: boolean): React.CSSProperties => {
    const { pre } = shownMotion;
    if (pre?.id === id) return pre.slide === 'fade' ? { transform: shownTransform(sideways), transition: 'none', opacity: 0 } : { transform: parkedTransform(pre.slide as ParkSide, sideways), transition: 'none' };
    const kind = shownMotion.moving.get(id);
    // A cell fading out stays where it stood until it is clear, then rests out of view.
    if (kind === 'fade') return { transform: shownTransform(sideways), transition: fade, opacity: shown ? 1 : 0 };
    const rest = sideways ? (shownMotion.park.get(id) ?? byIndex(snap.current, i)) : i < snap.current ? 'above' : 'below';
    // Side by side, a side the window comes to show glides in though no move carried it; a cell passed over never moves through view.
    const glides = kind === 'slide' || (split && shown && placed && !reduced);
    return { transform: shown ? shownTransform(sideways) : parkedTransform(rest, sideways), transition: glides ? slide : 'none' };
  };

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

  // Where the space drawn first (last) is also the first (last) shown one in the DOM, the browser's own step into and out of the
  // column at that end is already the right one, and the sentinels there are no stops.
  const mounted = snap.workspaces.filter((w) => shownIds.has(w.id));
  const native = { start: mounted[0]?.id === snap.shown[0]?.id, end: mounted[mounted.length - 1]?.id === snap.shown[snap.shown.length - 1]?.id };
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
  // Focus the column held and the page then dropped, by a blur or a script: the browser's next Tab still starts there, but the key is
  // pressed on the body, where the column's own handler does not hear it.
  const lost = React.useRef<HTMLElement | null>(null);
  const stopsNow = React.useRef(screenStops);
  stopsNow.current = screenStops;
  React.useEffect(() => {
    if (!split) return;
    const forget = (): void => {
      lost.current = null;
    };
    const onKey = (event: KeyboardEvent): void => {
      const root = rootRef.current;
      if (root !== null && lost.current !== null && document.activeElement === document.body) steerColumnTab(event, root, stopsNow.current(), lost.current);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', forget, true);
    // A press sets the browser's starting point where it landed.
    document.addEventListener('pointerdown', forget, true);
    return () => {
      forget();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', forget, true);
      document.removeEventListener('pointerdown', forget, true);
    };
  }, [split]);
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
            if (event.target === event.currentTarget && (event.propertyName === 'transform' || event.propertyName === 'opacity')) setMotion((m) => settledMotion(m, ws.id));
          }}
          // A press or focus in a cell side by side makes it the current workspace, so the keys that step go to the side the person is in.
          onPointerDownCapture={split && shown && !active ? () => column.scrollTo(ws) : undefined}
          onFocusCapture={split && shown && !active ? () => column.scrollTo(ws) : undefined}
          style={{ ...styleOf(ws.id, i, shown), ...(split ? (shown ? geometry.get(ws.id) : lastGeometry.current.get(ws.id)) : undefined) }}
          sx={{ position: 'absolute', inset: 0, outline: 'none' }}
        >
          {split ? <ColumnSentinel at="cell-start" stop={!(native.start && ws.id === snap.shown[0]?.id)} /> : null}
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
          {split ? <ColumnSentinel at="cell-end" stop={!(native.end && ws.id === snap.shown[snap.shown.length - 1]?.id)} /> : null}
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
      onBlur={
        split
          ? (e: React.FocusEvent<HTMLElement>) => {
              if (e.relatedTarget === null) lost.current = e.target;
            }
          : undefined
      }
      onFocus={
        split
          ? (e: React.FocusEvent<HTMLElement>) => {
              steerColumnSentinel(e, rootRef.current!, screenStops());
              // Focus a Tab brings into another cell makes that cell the current one, as focus there by any other way does.
              const held = document.activeElement;
              const ws = snap.workspaces.find((w) => cells.current.get(w.id)?.contains(held) === true);
              if (ws !== undefined && shownIds.has(ws.id)) column.scrollTo(ws);
            }
          : undefined
      }
      sx={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {split ? <ColumnSentinel at="start" stop={!native.start} /> : null}
      <div style={{ position: 'relative', height: '100%' }}>
        {snap.workspaces.map((ws, i) => cellOf(ws, i))}
        {split ? snap.shown.slice(0, -1).map((_, k) => dividerAt(k)) : null}
      </div>
      {split ? <ColumnSentinel at="end" stop={!native.end} /> : null}
      {snap.workspaces.length === 0 ? (
        <Button data-workspace-neighbour="empty" size="small" onClick={() => create(0)} sx={{ position: 'absolute', top: belowSafeTop(snap.topInset), left: '50%', transform: 'translateX(-50%)', height: TARGET, minHeight: 0, textTransform: 'none' }}>
          {labels.newWorkspace}
        </Button>
      ) : null}
    </Box>
  );
}
