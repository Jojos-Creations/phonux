/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { barOf, centreScroll, type RowBar } from './rowBar.js';
import { maxScrollOf, snapToStop, type RowNumbers } from './rowNumbers.js';
import { rowScrollerFor, type ScrollClaim } from './rowScroller.js';
import { halfStepIn, stepRowIn } from './rowStep.js';
import { applyRowIntent, holdRow } from './rowIntents.js';
import { FAST_SCROLL_FLOOR_SEC } from './rowFastScroll.js';
import { EDGE_SCROLL_MAX_PX_PER_SEC, EDGE_SCROLL_ZONE_PX, FAST_SCROLL } from './rowConstants.js';
import { depthSpeed, edgeSteps } from './edgeScroll.js';
import type { WorkspaceRowEntry } from './workspaceRow.js';

/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
  /** Each panel's dot in track px, at its place on the row's ruler: the drawn panels and the parked ones a scroll can bring in. `hollow` is the panel setting `hollowDot`. `riding` marks the dot of a panel that stays on screen as the row moves: it keeps to the oval's end and lies over the dots beneath it, so draw it on top. */
  readonly dots: readonly { readonly id: string; readonly left: number; readonly width: number; readonly hollow: boolean; readonly riding: boolean }[];
  /** The window oval in track px, over the dots of the panels on screen. */
  readonly oval: { readonly left: number; readonly width: number };
  /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
  readonly width: number;
  /** The ids of the panels on screen now, in px of the row and not of the bar: those held at an edge, and those the strip's window shows. */
  readonly shown: readonly string[];
  /** Centers the panel `id` in the window. A row that parks steps until the panel is as near the center as the panels beside it allow, bringing a parked one in on the way. Does nothing while a drag holds the row. */
  selectDot(id: string): void;
  /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
  startOvalDrag(): { drag(dx: number): void; end(): void } | null;
  /** The cursor the bar shows where the pointer rests now: `grabbing` while the oval is dragged, `grab` over the oval, `pointer` over a dot, else `default`. */
  readonly cursor: string;
  /**
   * Spread on the element that holds the dots and the oval. A press that begins on the oval and moves past a few px drags it; any
   * other press selects the dot it began on. The pointer is captured, so the drag follows it off the bar. On a row that cannot scroll, the oval
   * moves with the pointer and the row steps each time the oval passes half a dot, bringing in hidden panels; on release the oval
   * settles over the panels on screen. On a row that scrolls the oval stays at the place it was grabbed under the pointer, drawn in the event that moved it. A pointer past a scrolling row's end steps the row toward it every animation frame it stays there, faster the farther past it is, held still or not. A wheel over
   * the bar, either axis, steps the row too, and the oval follows each step.
   */
  readonly barProps: {
    readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    readonly onPointerLeave: () => void;
    readonly onPointerCancel: () => void;
    readonly onWheel: (e: React.WheelEvent<HTMLElement>) => void;
    readonly style: { readonly touchAction: 'none'; readonly cursor: string };
    readonly 'data-dot-bar': '';
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

/** Track px of time-driven travel past the row's end for one step: one phone dot and its gap. */
const OVERSHOOT_STEP_PX = 30;

/** How far a carried oval is from the row's window before the row steps toward it: half a phone dot and its gap, where the next window is nearer. */
const CARRY_STEP_PX = 15;

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

/** The step that brings the drawn panel `id` nearer the window's center in a row that parks, or null when none does: it is as near as a step gets, or nothing can take the slot it leaves. To the right, the row's own blank slots can. */
function centerStep(n: RowNumbers, id: string, maxScroll: number, bar: RowBar, entries: readonly WorkspaceRowEntry[]): 'left' | 'right' | null {
  const index = n.ids.indexOf(id);
  if (maxScroll > 0 || index < 0 || n.ids.length < 2) return null;
  const off = n.stripStart + n.leftOffsets[index]! + n.widths[index]! / 2 - n.windowWidth / 2;
  const slot = n.leftOffsets[1]! - n.leftOffsets[0]! - (n.leadPx ?? 0);
  if (Math.abs(off) <= slot / 2 + 1) return null;
  const direction = off > 0 ? 'right' : 'left';
  const waits = bar.dots.some((d) => bar.parked.has(d.id) && (direction === 'left' ? d.left < bar.run.left : d.left >= bar.run.right));
  if (waits) return direction;
  if (direction === 'left') return null;
  // The row opens a blank only by parking its leftmost panel, which must be able to come back, and never past the last panel's center.
  const last = n.ids.length - 1;
  const first = n.ids.map((x) => entries.find((e) => e.id === x)).find((e) => e !== undefined && e.collapsible !== false);
  const lastOff = n.stripStart + n.leftOffsets[last]! + n.widths[last]! / 2 - n.windowWidth / 2;
  return n.ids.length >= 3 && first?.settings?.revealOnScroll !== 'never' && lastOff - slot >= -1 ? 'right' : null;
}

/** A step left while the root sits a whole slot or more left of the window's center, so blanks open before it; null otherwise. */
function rootStep(n: RowNumbers, id: string, maxScroll: number): 'left' | null {
  const k = n.ids.indexOf(id);
  if (k < 0 || maxScroll > 0) return null;
  const off = n.stripStart + n.leftOffsets[k]! + n.widths[k]! / 2 - n.stripWindow / 2;
  return off <= -(n.widths[k]! * 0.75) ? 'left' : null;
}

/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` is every panel in row order, drawn or
 * parked (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i: {
  rowNumbers: RowNumbers;
  entries: readonly WorkspaceRowEntry[];
  scroller: React.RefObject<HTMLElement | null>;
  tuning: Pick<ResolvedWorkspaceTuning, 'slide'> & Partial<Pick<ResolvedWorkspaceTuning, 'fastScroll'>>;
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
    const row = rowScrollerFor(el);
    const sync = () => setScrollLeft(row.scrollLeft());
    sync();
    return row.subscribe(sync);
  }, [scroller]);

  // Where the strip's window starts, along the strip: a held group takes its room from the window, not from the scroll.
  const seen = scrollLeft - (n.stripStart - n.leftInset);
  const bar = barOf(n, entries, scrollLeft);
  const shown = [...n.held.map((h) => h.id), ...n.ids.filter((_, k) => Math.min(n.leftOffsets[k]! + n.widths[k]!, seen + n.stripWindow) - Math.max(n.leftOffsets[k]!, seen) > 1)];
  const maxScroll = maxScrollOf(n);
  const step = (direction: 'left' | 'right'): void => {
    const el = scroller.current;
    if (el) stepRowIn(el, direction);
  };

  // A click on a parked dot steps the row toward it, one step each time the parked set changes, until it is drawn. A step that
  // only scrolls a row toward its end changes no parked panel, so the wait for the next step also ends after one slide.
  // A row that parks then goes on stepping toward the center, for a drawn panel's dot too, while a panel waits on that side to take the slot it leaves.
  const [seek, setSeek] = React.useState<{ id: string; direction: 'left' | 'right'; steps: number } | null>(null);
  const parkedKey = [...bar.parked].join(' ');
  React.useEffect(() => {
    if (seek === null) return undefined;
    const direction = bar.parked.has(seek.id) ? seek.direction : entries.find((e) => e.id === seek.id)?.collapsible === false ? rootStep(n, seek.id, maxScroll) : centerStep(n, seek.id, maxScroll, bar, entries);
    if (direction === null || seek.steps <= 0) {
      setSeek(null);
      // Whole steps got it as near as they can: an even row has one half step left to center it.
      const el = scroller.current;
      if (direction === null && el && !bar.parked.has(seek.id)) halfStepIn(el, seek.id);
      return undefined;
    }
    step(direction);
    // The steps toward a far dot come at the fast-scroll floor, each retargeting the last, not one whole slide apiece.
    const next = window.setTimeout(() => setSeek((s) => (s === null ? s : { ...s, steps: s.steps - 1 })), Math.min(tuning.slide.durationSec, FAST_SCROLL_FLOOR_SEC) * 1000 + 50);
    return () => window.clearTimeout(next);
  }, [seek?.id, seek?.steps, parkedKey]);

  const selectDot = (id: string): void => {
    const el = scroller.current;
    if (bar.parked.has(id)) {
      const dot = bar.dots.find((d) => d.id === id);
      if (!el || dot === undefined || rowScrollerFor(el).claimHeld()) return;
      // One step per parked dot between the window and this one, and one more for a row that must first scroll to its end.
      const left = dot.left < bar.run.left;
      const between = bar.dots.filter((d) => bar.parked.has(d.id) && (left ? d.left >= dot.left && d.left < bar.run.left : d.left <= dot.left && d.left >= bar.run.right)).length;
      setSeek({ id, direction: left ? 'left' : 'right', steps: between + 1 + (maxScroll > 0 ? 0 : bar.parked.size + n.ids.length) });
      return;
    }
    const index = n.ids.indexOf(id);
    // A held panel is always on screen, so its dot takes the row back to the panels beside it.
    if (el && n.held.some((h) => h.id === id && h.side === 'left')) {
      applyRowIntent(rowScrollerFor(el), { kind: 'step', to: 0, mode: tuning.fastScroll ?? FAST_SCROLL, durationSec: tuning.slide.durationSec, ease: tuning.slide.glideEase, instant: reduced, windowWidth: n.stripWindow });
      return;
    }
    if (!el || index < 0) return;
    const target = centreScroll({ index, leftOffsets: n.leftOffsets, widths: n.widths, windowWidth: n.stripWindow, maxScroll });
    if (target === null) {
      if (!rowScrollerFor(el).claimHeld()) setSeek({ id, direction: 'right', steps: bar.parked.size + n.ids.length });
      return;
    }
    // A stepping row rests on its stops only, so the dot's rest is the stop that shows the panel, not the margin-shifted center.
    // Numbers built by hand may omit the stops; such a row has none to snap to.
    const at = Math.min(maxScroll, target + n.stripStart - n.leftInset);
    applyRowIntent(rowScrollerFor(el), { kind: 'step', to: n.stops?.length ? snapToStop(n, index, at) : at, mode: tuning.fastScroll ?? FAST_SCROLL, durationSec: tuning.slide.durationSec, ease: tuning.slide.glideEase, instant: reduced, windowWidth: n.stripWindow });
  };

  const startOvalDrag = () => {
    const el = scroller.current;
    if (!el) return null;
    const scroll = rowScrollerFor(el);
    const claim: ScrollClaim | null = holdRow(scroll);
    if (claim === null) return null;
    claim.setMaxScroll(maxScroll);
    const startScroll = scroll.scrollLeft();
    let open = true;
    return {
      drag(dx: number) {
        if (open) claim.write(startScroll + dx / bar.scale);
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
  /**
   * A press on the bar. Only one begun on the oval can drag; `moved` latches once it passes the threshold, and that press drags and
   * never selects. `clientX` is the pointer now, `bar` the element pressed and `grab` where along the oval it took hold, in track px.
   * A drag of a scrolling row writes the scroll that puts the oval at `grab` under the pointer: `base.scroll` plus the pointer's
   * travel since `base.x`, scaled; `from` is the scroll its claim counts from. `carried` and `lastMs` are the time-driven travel
   * past the row's end.
   */
  const press = React.useRef<{
    x: number;
    clientX: number;
    bar: HTMLElement;
    grab: number;
    id: string | null;
    onOval: boolean;
    moved: boolean;
    carries: boolean;
    base: { scroll: number; x: number } | null;
    from: number;
    carried: number;
    lastMs: number | null;
  } | null>(null);
  const wheel = React.useRef<{ travel: number; at: number }>({ travel: 0, at: 0 });

  // On a row that steps instead of scrolling, the oval is carried by the pointer 1:1 and the row steps each time it is half a dot
  // or more from where the row is; on release the oval settles on the window the row came to rest on.
  const [carry, setCarry] = React.useState<{ from: number; dx: number } | null>(null);
  const shownOval = carry === null ? bar.oval : { ...bar.oval, left: Math.min(Math.max(carry.from + carry.dx, 0), Math.max(0, bar.width - bar.oval.width)) };
  // The row's oval when the last carry step was asked for, and when. A step the row answers moves that oval, and the next step may
  // follow at once; one it has not answered is asked again only after the fast-scroll floor, so one pointer move never asks twice.
  const stepAsked = React.useRef<{ at: number; time: number } | null>(null);
  // The frame loop and the handlers read this render's numbers, not the ones of the render they began in.
  const latest = React.useRef({ bar, maxScroll, carry, step, startOvalDrag });
  latest.current = { bar, maxScroll, carry, step, startOvalDrag };
  const frame = React.useRef<number | null>(null);

  /** Steps a row that cannot scroll toward the carried oval while the oval is half a dot or more from the row's window. */
  const catchUp = (dx: number): void => {
    const l = latest.current;
    // The carry as this move sets it: the render that draws it may not have run yet.
    const from = l.carry?.from ?? l.bar.oval.left;
    const shown = Math.min(Math.max(from + dx, 0), Math.max(0, l.bar.width - l.bar.oval.width));
    const ask = stepAsked.current;
    if (ask !== null && ask.at === l.bar.oval.left && performance.now() - ask.time < FAST_SCROLL_FLOOR_SEC * 1000) return;
    stepAsked.current = null;
    const off = shown - l.bar.oval.left;
    if (Math.abs(off) < CARRY_STEP_PX) return;
    stepAsked.current = { at: l.bar.oval.left, time: performance.now() };
    l.step(off > 0 ? 'right' : 'left');
  };

  /** Takes the row for the drag, counting from the pointer now so the oval sits at its grab under it. False while the row is held elsewhere. */
  const take = (p: NonNullable<typeof press.current>): boolean => {
    const el = scroller.current;
    const l = latest.current;
    const d = el === null ? null : l.startOvalDrag();
    if (d === null || el === null) return false;
    drag.current = d;
    const scroll = rowScrollerFor(el).scrollLeft();
    const at = p.clientX - p.bar.getBoundingClientRect().left;
    p.from = scroll;
    p.base = { scroll: scroll + (at - p.grab - l.bar.oval.left) / l.bar.scale, x: p.clientX };
    return true;
  };

  /**
   * One frame of the drag (`nowMs`) or one pointer move (null). A scrolling row is written to the pointer 1:1. Past the row's end the
   * pointer's depth beyond it steps the row by time, as edge scrolling does, so a pointer held still there keeps bringing panels in.
   */
  const follow = (p: NonNullable<typeof press.current>, nowMs: number | null): void => {
    const el = scroller.current;
    const l = latest.current;
    if (el === null) return;
    const row = rowScrollerFor(el);
    // A wide panel parking mid-drag can leave the row with nothing to scroll: the drag goes on as a carry from where the pointer is.
    if (!p.carries && l.maxScroll <= 0) {
      drag.current?.end();
      drag.current = null;
      p.carries = true;
      p.base = null;
      p.x = p.clientX;
      setCarry({ from: l.bar.oval.left, dx: 0 });
      return;
    }
    if (p.carries) {
      const dx = p.clientX - p.x;
      setCarry((c) => (c === null || c.dx === dx ? c : { ...c, dx }));
      catchUp(dx);
      return;
    }
    // A step past the row's end gave the row to its glide: once that lands the drag takes it back, with the oval at its grab under the pointer.
    if (drag.current === null && (row.glideTarget() !== null || row.claimHeld() || !take(p))) {
      p.lastMs = null;
      return;
    }
    if (p.base === null) return;
    const want = p.base.scroll + (p.clientX - p.base.x) / l.bar.scale;
    drag.current?.drag((want - p.from) * l.bar.scale);
    const at = row.scrollLeft();
    const past = want > l.maxScroll + 0.5 && at >= l.maxScroll - 0.5 ? (want - l.maxScroll) * l.bar.scale : want < -0.5 && at <= 0.5 ? want * l.bar.scale : 0;
    const dt = nowMs === null || p.lastMs === null ? 0 : nowMs - p.lastMs;
    if (nowMs !== null) p.lastMs = nowMs;
    const next = edgeSteps({ carried: p.carried, speed: depthSpeed(past, EDGE_SCROLL_ZONE_PX, EDGE_SCROLL_MAX_PX_PER_SEC), dtMs: dt, unitPx: OVERSHOOT_STEP_PX / l.bar.scale });
    p.carried = next.carried;
    if (next.steps === 0) return;
    // A step needs the row, so the drag gives it back for the step and takes it again once the step has landed.
    p.carried = 0;
    p.lastMs = null;
    drag.current?.end();
    drag.current = null;
    l.step(next.steps > 0 ? 'right' : 'left');
  };

  // Every frame of a drag, so a pointer held still goes on moving what it asks for: the carry's steps, and the steps past the end.
  const tick = (nowMs: number): void => {
    frame.current = null;
    const p = press.current;
    if (p === null || !p.moved) return;
    flushSync(() => follow(p, nowMs));
    frame.current = requestAnimationFrame(tick);
  };

  const cursor = ovalCursor(pointer?.x ?? null, shownOval, ovalSide, dragging, pointer?.overDot === true);
  const stop = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current?.end();
    drag.current = null;
    stepAsked.current = null;
    setDragging(false);
    setCarry(null);
  };
  // A bar that unmounts mid-drag (the row stops overflowing) gets no pointerup: its claim would hold the row against every later step.
  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      drag.current?.end();
    },
    [],
  );
  const dotOf = (target: EventTarget): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('[data-dot]') : null);
  const barProps: PanelDots['barProps'] = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const at = e.clientX - e.currentTarget.getBoundingClientRect().left;
      const onOval = at >= shownOval.left && at <= shownOval.left + shownOval.width + 2 * ovalSide;
      press.current = { x: e.clientX, clientX: e.clientX, bar: e.currentTarget, grab: at - shownOval.left, id: dotOf(e.target)?.dataset.dot ?? null, onOval, moved: false, carries: maxScroll <= 0, base: null, from: 0, carried: 0, lastMs: null };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const next = { x: e.clientX - e.currentTarget.getBoundingClientRect().left, overDot: dotOf(e.target) !== null };
      const p = press.current;
      if (!p) {
        setPointer(next);
        return;
      }
      p.clientX = e.clientX;
      // A drag is drawn in the event that moved it, before the browser paints: the oval is never a frame behind the pointer.
      flushSync(() => {
        setPointer(next);
        if (!p.moved && p.onOval && Math.abs(e.clientX - p.x) > DRAG_THRESHOLD_PX) {
          p.moved = true;
          setDragging(true);
          p.carries = maxScroll <= 0;
          if (p.carries) setCarry({ from: bar.oval.left, dx: 0 });
          // Taking the row ends a glide in flight, as a press on the row does.
          else take(p);
          if (frame.current === null) frame.current = requestAnimationFrame(tick);
        }
        if (p.moved) follow(p, null);
      });
    },
    onPointerUp: () => {
      const p = press.current;
      press.current = null;
      stop();
      // The held dot lies inside the oval, where a drag begins: a press that does not travel there must not send the row to its start.
      if (p && !p.moved && p.id !== null && !n.held.some((h) => h.id === p.id)) selectDot(p.id);
    },
    onPointerLeave: () => setPointer(null),
    onWheel: (e) => {
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (raw === 0) return;
      const glider = scroller.current === null ? null : rowScrollerFor(scroller.current);
      if (glider?.glideTarget() != null) return;
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
    'data-dot-bar': '',
  };
  const ovalProps: PanelDots['ovalProps'] = {
    role: 'slider',
    tabIndex: 0,
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': Math.round((shownOval.left / Math.max(1, bar.width - bar.oval.width)) * 100),
  };
  const dotProps = (id: string) => ({
    'data-dot': id,
    // A pointer press is handled on the bar; only a keyboard activation (detail 0) reaches this click.
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (e.detail === 0) selectDot(id);
    },
  });

  return { dots: bar.dots, oval: shownOval, width: bar.width, shown, selectDot, startOvalDrag, cursor, barProps, ovalProps, dotProps };
}
