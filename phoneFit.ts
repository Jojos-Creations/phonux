/**
 * The phone size the default mount draws at: the host's preferred size scaled so whole slots fill the window. `fitPhone`
 * is the pure rule; the context and `usePhoneSize` carry its result to every reader of the phone size.
 */
import * as React from 'react';
import { flushSync } from 'react-dom';
import { useHost, useOptionalHost } from './hostApi.js';
import { ALL_SLOTS } from './rowConstants.js';

/** A count change needs the new count's scale this far (a fraction of the band edge) inside the band. */
export const PHONE_FIT_MARGIN = 0.02;

/** What `fitPhone` reads. @internal */
export interface PhoneFitInput {
  /** The scroll container's width; 0 or less is unmeasured. */
  windowWidth: number;
  /** The height the row has, container less its padding; 0 is unmeasured and applies no height cap. */
  heightBudget: number;
  /** How many rows share the height; each gets an equal share. */
  rowCount: number;
  preferred: { width: number; height: number };
  gap: number;
  /** Space left at each window edge. */
  edge: number;
  min: number;
  max: number;
  /** The count in force before this call; with it, a change of count needs `PHONE_FIT_MARGIN` of room inside the band. */
  previousCount?: number;
}

/** What `fitPhone` returns. @internal */
export interface PhoneFit {
  /** Whole slots that fit; 0 while unmeasured. */
  count: number;
  /** Whole pixels. */
  width: number;
  /** Whole pixels. */
  height: number;
  /** The height cap sits below the band's top, so the height, not the width, limited the phone. */
  heightCapped: boolean;
}

/**
 * Picks how many phone slots fit and the phone size that makes them fill the window. The widths are whole pixels, `floor((W + g) / N) - g`,
 * with W the window less its edge space. The smallest count whose phone is inside the band and under the height cap wins; with none, the
 * most slots inside the band at the cap, the leftover centered; with none of those, the minimum phone, as many as fit, the row scrolling
 * sideways. The height is never more than the row's share, so a row too short for the minimum phone draws it shorter than its shape.
 * @internal
 */
export function fitPhone(i: PhoneFitInput): PhoneFit {
  const { preferred, gap, min, max } = i;
  if (!(i.windowWidth > 0)) return { count: 0, width: preferred.width, height: preferred.height, heightCapped: false };
  const room = i.windowWidth - 2 * i.edge;
  const rows = Math.max(1, Math.floor(i.rowCount));
  const share = i.heightBudget > 0 ? (i.heightBudget - (rows - 1) * gap) / rows : Number.POSITIVE_INFINITY;
  const heightScale = share / preferred.height;
  const cap = Math.min(max, heightScale);
  const widthOf = (n: number): number => Math.floor((room + gap) / n) - gap;
  const scaleOf = (n: number): number => widthOf(n) / preferred.width;
  const minWidth = Math.ceil(min * preferred.width);
  // The row never scrolls vertically, so a phone held at the minimum width in a row too short for it is cut to the row's height.
  const make = (count: number, width: number): PhoneFit => ({ count, width, height: Math.min(Math.round((width / preferred.width) * preferred.height), Math.max(1, Math.floor(share))), heightCapped: heightScale < max });

  let inBand = 0;
  while (inBand < ALL_SLOTS && scaleOf(inBand + 1) >= min) inBand += 1;
  let first = 1;
  while (first <= inBand && scaleOf(first) > cap) first += 1;

  const minimum = (): PhoneFit => make(Math.max(1, Math.min(ALL_SLOTS, Math.floor((room + gap) / (minWidth + gap)))), minWidth);
  let choice: PhoneFit;
  if (cap < min || inBand === 0) choice = minimum();
  else if (first <= inBand) choice = make(first, widthOf(first));
  else choice = make(inBand, Math.max(minWidth, Math.floor(cap * preferred.width)));

  const prev = i.previousCount;
  if (prev !== undefined && prev >= 1 && prev <= inBand && prev !== choice.count && cap >= min) {
    const next = choice.count > prev ? scaleOf(choice.count) >= min * (1 + PHONE_FIT_MARGIN) : choice.width / preferred.width <= cap * (1 - PHONE_FIT_MARGIN);
    if (!next) return make(prev, Math.min(widthOf(prev), Math.max(minWidth, Math.floor(cap * preferred.width))));
  }
  return choice;
}

/** The size the default mount fits to the window; unset where nothing fits, so a reader falls back to the host's own. */
export const PhoneSizeContext = React.createContext<{ readonly width: number; readonly height: number } | undefined>(undefined);

/** What `useWindowSettle` reports: the size the window settled at, and whether it is still changing. @internal */
export interface WindowSettle {
  /** `width` and `height` as of the last settle; the live pair while `instant`, and a side not yet measured (0) takes its first value at once. */
  readonly settled: { readonly width: number; readonly height: number };
  /** True from the first change of a resize until it settles: every step in between lands at once. */
  readonly changing: boolean;
}

/**
 * Whether the window's `width` and `height` have settled after a resize, and the size they settled at. A resize is every change from
 * the first one on, and it settles once both sides have held still for `quietMs` and at least `floorMs` have passed since its first
 * change, both counted on animation frames so a virtual frame clock runs the wait. The floor keeps one window action one resize:
 * a zoom hands the page an 8 px nudge and then its final size ~340 ms later, and entering full screen its width at once and then
 * two height-only changes ~585 and ~625 ms after its first (Chrome on macOS, measured 2026-11-25). `endKey` changing ends a resize
 * at once: the commit that lands the settled size is not a step of it. `instant` (Reduce Motion, a settle of 0) settles every change
 * as it comes.
 * @internal
 */
export function useWindowSettle(width: number, height: number, quietMs: number, floorMs: number, instant: boolean, endKey?: string): WindowSettle {
  const [settled, setSettled] = React.useState({ width, height });
  const burst = React.useRef<{ first: number; last: number } | null>(null);
  const seen = React.useRef({ width, height, endKey });
  const [, wake] = React.useReducer((n: number) => n + 1, 0);
  const now = performance.now();
  // A height of 0 is a host that measures none; only the first width is the first measurement.
  const measured = seen.current.width > 0;
  if (seen.current.width !== width || seen.current.height !== height) {
    if (measured && !instant) burst.current = { first: burst.current?.first ?? now, last: now };
  } else if (seen.current.endKey !== endKey) burst.current = null;
  seen.current = { width, height, endKey };
  if (instant) burst.current = null;
  const dueAt = burst.current === null ? 0 : Math.max(burst.current.last + quietMs, burst.current.first + floorMs);
  if (burst.current !== null && now >= dueAt) burst.current = null;
  const changing = burst.current !== null;
  // Settled, or never measured: the live size; mid-resize: the size the last settle drew.
  const w = !changing || settled.width === 0 ? width : settled.width;
  const h = !changing || settled.height === 0 ? height : settled.height;
  React.useEffect(() => {
    if (!changing) {
      if (settled.width !== width || settled.height !== height) setSettled({ width, height });
      return undefined;
    }
    let frame = requestAnimationFrame(function wait(): void {
      if (performance.now() >= dueAt) wake();
      else frame = requestAnimationFrame(wait);
    });
    return () => cancelAnimationFrame(frame);
  }, [changing, dueAt, width, height, settled]);
  const pair = React.useMemo(() => ({ width: w, height: h }), [w, h]);
  return { settled: pair, changing };
}

/**
 * True in the commit that first measures the row's container, and in every commit before it. The fitted size lands in that
 * commit, so the slots moved to it snap there: a slide from the preferred size would be a move nobody asked for.
 * @internal
 */
export const LandingContext = React.createContext(false);

/**
 * The phone size a panel is drawn at: the width and height of one slot. With the workspace's `phoneFit` on it is the host's
 * preferred size scaled to the window; otherwise it is `useHost().device.size`, which stays the person's preference. Read this,
 * not `device.size`, for any layout that must agree with the panel's width.
 * @public
 */
export function usePhoneSize(): { readonly width: number; readonly height: number } {
  const fitted = React.useContext(PhoneSizeContext);
  const { device } = useHost();
  return fitted ?? device.size;
}

/** `usePhoneSize` outside a `HostProvider`: undefined there, where `usePhoneSize` throws. @internal */
export function useOptionalPhoneSize(): { readonly width: number; readonly height: number } | undefined {
  const fitted = React.useContext(PhoneSizeContext);
  const host = useOptionalHost();
  return fitted ?? host?.device.size;
}

/** The height in px `container` leaves for the row once `topPad` above and `bottomPad` below are taken out; 0 until measured and wherever nothing lays out. @internal */
export function useRowHeightBudget(ref: React.RefObject<HTMLDivElement | null>, topPad: number, bottomPad: number, enabled = true): number {
  const [budget, setBudget] = React.useState(0);
  React.useLayoutEffect(() => {
    const container = ref.current;
    if (!enabled || container === null) return undefined;
    const measure = (): void => setBudget(Math.max(0, Math.round(container.clientHeight - topPad - bottomPad)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // Committed before the paint, as the width is: a resized window never draws the row at the old height.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(container);
    return () => observer.disconnect();
  }, [ref, topPad, bottomPad, enabled]);
  return budget;
}
