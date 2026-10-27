/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { centreScroll, dotLayout, dotMap, dragScroll } from './rowDots.js';
import { maxScrollOf, snapToStop, type RowNumbers } from './rowNumbers.js';
import { rowScrollerFor, type ScrollClaim } from './rowScroller.js';
import { stepRowIn } from './rowStep.js';

/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
  /** Each drawn panel's dot in track px, in row order. `hollow` is the panel setting `hollowDot`. */
  readonly dots: readonly { readonly id: string; readonly left: number; readonly width: number; readonly hollow: boolean }[];
  /** The window oval in track px. */
  readonly oval: { readonly left: number; readonly width: number };
  /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
  readonly width: number;
  /** Centres the panel `id` in the window. Does nothing when the row cannot scroll, or while a drag holds the row. */
  selectDot(id: string): void;
  /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
  startOvalDrag(): { drag(dx: number): void; end(): void } | null;
  /** The cursor the bar shows where the pointer rests now: `grabbing` while the oval is dragged, `grab` over the oval, `pointer` over a dot, else `default`. */
  readonly cursor: string;
  /**
   * Spread on the element that holds the dots and the oval. A press that moves past a few px drags the oval; one that does not
   * selects the dot it began on. The pointer is captured, so the drag follows it off the bar. A drag carried past the row's end, or
   * on a row that cannot scroll, steps the row one stop per dot it travels, bringing in hidden panels as a scroll at the row's edge
   * does; a wheel over the bar, either axis, steps the row the same way. The dots and the oval follow each step.
   */
  readonly barProps: {
    readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onPointerCancel: () => void;
    readonly onWheel: (e: React.WheelEvent<HTMLElement>) => void;
    readonly style: { readonly touchAction: 'none'; readonly cursor: string };
  };
  /** Spread on the oval: a focusable slider whose value is how far along the row the window is, 0 to 100. Give it an `aria-label`. */
  readonly ovalProps: {
    readonly role: 'slider';
    readonly tabIndex: 0;
    readonly 'aria-valuemin': 0;
    readonly 'aria-valuemax': 100;
    readonly 'aria-valuenow': number;
  };
  /** Spread on the dot of panel `id` (a button): it marks the dot for the bar and selects it on a keyboard activation. */
  dotProps(id: string): { readonly 'data-dot': string; readonly onClick: (e: React.MouseEvent<HTMLElement>) => void };
}

/** A press that moves this far across the bar drags the oval; a shorter one is a click. */
const DRAG_THRESHOLD_PX = 4;

/** Track px a drag travels past the row's end for one step: about one phone dot and its gap. */
const OVERSHOOT_STEP_PX = 30;

/** Wheel travel over the bar for one step, and the quiet that ends a wheel gesture. */
const WHEEL_STEP_PX = 100;
const WHEEL_QUIET_MS = 200;

/** The bar's cursor for a pointer at `x` across the bar (null when off it), the oval as drawn now, and `side`, how far the oval reaches past its dots. */
function ovalCursor(x: number | null, oval: { left: number; width: number }, side: number, dragging: boolean, overDot: boolean): string {
  if (dragging) return 'grabbing';
  if (x === null) return 'default';
  // The dots lie over the oval, so a cursor set per dot would leave the part of a dot that straddles the oval's edge as a pointer.
  return x >= oval.left && x <= oval.left + oval.width + 2 * side ? 'grab' : overDot ? 'pointer' : 'default';
}

/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i: {
  rowNumbers: RowNumbers;
  entries: readonly { readonly id: string; readonly settings?: { readonly hollowDot: boolean } }[];
  scroller: React.RefObject<HTMLElement | null>;
  tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
  /** How far the drawn oval reaches past the dots it encloses on each side, in px, so the cursor reads the oval as drawn. Default 0. */
  ovalSide?: number;
}): PanelDots {
  const { rowNumbers: n, entries, scroller, tuning, ovalSide = 0 } = i;
  const systemReduced = useReducedMotion();
  const configReduced = useReducedMotionConfig();
  const reduced = systemReduced === true || configReduced === true;
  const [scrollLeft, setScrollLeft] = React.useState(0);

  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => setScrollLeft(el.scrollLeft);
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => el.removeEventListener('scroll', sync);
  }, [scroller]);

  const hollow = n.ids.map((id) => entries.find((e) => e.id === id)?.settings?.hollowDot === true);
  const map = dotMap({ widths: n.widths, leftOffsets: n.leftOffsets });
  const layout = dotLayout({
    ids: n.ids,
    hollow,
    map,
    windowWidth: n.stripWindow,
    // The track starts at the strip's first panel, not at scroll 0.
    scrollLeft: scrollLeft - n.stripStart,
  });
  const maxScroll = maxScrollOf(n);

  const selectDot = (id: string): void => {
    const el = scroller.current;
    const index = n.ids.indexOf(id);
    if (!el || index < 0) return;
    rowScrollerFor(el).noteInput();
    rowScrollerFor(el).noteMove();
    const target = centreScroll({ index, leftOffsets: n.leftOffsets, widths: n.widths, windowWidth: n.stripWindow, maxScroll });
    if (target === null) return;
    // A stepping row rests on its stops only, so the dot's rest is the stop that shows the panel, not the margin-shifted centre.
    // Numbers built by hand may omit the stops; such a row has none to snap to.
    const at = Math.min(maxScroll, target + n.stripStart);
    rowScrollerFor(el).glideTo(n.stops?.length ? snapToStop(n, index, at) : at, { durationSec: tuning.slide.durationSec, instant: reduced, ease: tuning.slide.glideEase });
  };

  const startOvalDrag = () => {
    const el = scroller.current;
    if (!el) return null;
    const scroll = rowScrollerFor(el);
    scroll.noteInput();
    scroll.noteMove();
    const claim: ScrollClaim | null = scroll.claim();
    if (claim === null) return null;
    claim.setMaxScroll(maxScroll);
    const startScroll = scroll.scrollLeft();
    let open = true;
    return {
      drag(dx: number) {
        if (open) claim.write(dragScroll({ startScroll, dx, map, maxScroll }));
      },
      end() {
        if (!open) return;
        open = false;
        claim.release();
      },
    };
  };

  // Worked out each render from the pointer's last place and the oval as drawn now, so a redraw that moves the oval under a still pointer reads true.
  const [pointer, setPointer] = React.useState<{ x: number; overDot: boolean } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef<ReturnType<typeof startOvalDrag>>(null);
  // `moved` latches once the press passes the threshold: that press drags and never selects. `edgeX` is where the pointer was when
  // the drag last met the row's end (or last stepped), so travel beyond it steps the row.
  const press = React.useRef<{ x: number; id: string | null; moved: boolean; edgeX: number | null } | null>(null);
  const wheel = React.useRef<{ travel: number; at: number }>({ travel: 0, at: 0 });
  const step = (direction: 'left' | 'right'): void => {
    const el = scroller.current;
    if (el) stepRowIn(el, direction);
  };
  const cursor = ovalCursor(pointer?.x ?? null, layout.oval, ovalSide, dragging, pointer?.overDot === true);
  const stop = (): void => {
    drag.current?.end();
    drag.current = null;
    setDragging(false);
  };
  // A bar that unmounts mid-drag (the row stops overflowing) gets no pointerup: its claim would hold the row against every later step.
  React.useEffect(() => () => drag.current?.end(), []);
  const dotOf = (target: EventTarget): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-dot]') : null);
  const barProps: PanelDots['barProps'] = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      press.current = { x: e.clientX, id: dotOf(e.target)?.dataset.dot ?? null, moved: false, edgeX: null };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      setPointer({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, overDot: dotOf(e.target) !== null });
      const p = press.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      if (!p.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        p.moved = true;
        drag.current = startOvalDrag();
        setDragging(true);
      }
      if (!p.moved) return;
      drag.current?.drag(dx);
      // Past the end, or on a row that cannot scroll at all, the drag steps the row instead.
      const el = scroller.current;
      const at = el?.scrollLeft ?? 0;
      const atEnd = drag.current === null || maxScroll <= 0 || (dx > 0 ? at >= maxScroll - 0.5 : at <= 0.5);
      if (!atEnd) {
        p.edgeX = null;
        return;
      }
      p.edgeX ??= e.clientX;
      const past = e.clientX - p.edgeX;
      if (Math.abs(past) < OVERSHOOT_STEP_PX) return;
      p.edgeX = e.clientX;
      // A step may hand the row to its glide; the drag picks up again from wherever that leaves it.
      drag.current?.end();
      drag.current = null;
      step(past > 0 ? 'right' : 'left');
    },
    onPointerUp: () => {
      const p = press.current;
      press.current = null;
      stop();
      if (p && !p.moved && p.id !== null) selectDot(p.id);
    },
    onPointerLeave: () => setPointer(null),
    onWheel: (e) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      const w = wheel.current;
      if (e.timeStamp - w.at > WHEEL_QUIET_MS || Math.sign(raw) !== Math.sign(w.travel)) w.travel = 0;
      // The first event of a gesture steps at once, so one notch moves the row.
      const first = w.travel === 0;
      w.travel += e.deltaMode === 1 ? raw * 16 : raw;
      w.at = e.timeStamp;
      if (!first && Math.abs(w.travel) < WHEEL_STEP_PX) return;
      if (!first) w.travel = Math.sign(w.travel) * 0.001;
      step(raw > 0 ? 'right' : 'left');
    },
    onPointerCancel: () => {
      press.current = null;
      stop();
    },
    style: { touchAction: 'none', cursor },
  };
  const ovalProps: PanelDots['ovalProps'] = {
    role: 'slider',
    tabIndex: 0,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round((layout.oval.left / Math.max(1, map.width - layout.oval.width)) * 100),
  };
  const dotProps = (id: string) => ({
    'data-dot': id,
    // A pointer press is handled on the bar; only a keyboard activation (detail 0) reaches this click.
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (e.detail === 0) selectDot(id);
    },
  });

  return { dots: layout.dots, oval: layout.oval, width: map.width, selectDot, startOvalDrag, cursor, barProps, ovalProps, dotProps };
}
