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

/** How far the row's room moves in one step, in px, for that step to be a jump: past any hand drag of a window edge. */
const WINDOW_JUMP_PX = 120;

/**
 * True from a jump of the row's room (a window maximized, restored or snapped) until `width` and `height` have held still for
 * `holdMs`. A jump has no in-between sizes to follow, so the row lands it in that commit, at the new phone size and panel count, with
 * no motion: the window's own animation is the transition. A hand drag steps a few px at a time and is never a jump.
 * @internal
 */
export function useWindowJump(width: number, height: number, holdMs: number): boolean {
  const last = React.useRef({ width, height });
  const until = React.useRef(0);
  const [, wake] = React.useReducer((n: number) => n + 1, 0);
  const dw = Math.abs(width - last.current.width);
  const dh = Math.abs(height - last.current.height);
  const measured = last.current.width > 0 && last.current.height > 0;
  const now = performance.now();
  // The steps a jump arrives in stay part of it.
  if (measured && (dw >= WINDOW_JUMP_PX || dh >= WINDOW_JUMP_PX || ((dw > 0 || dh > 0) && now < until.current))) until.current = now + holdMs;
  last.current = { width, height };
  const jumping = now < until.current;
  React.useEffect(() => {
    if (!jumping) return undefined;
    // Counted on animation frames, as the settle is, so a virtual frame clock runs this wait too.
    let frame = requestAnimationFrame(function wait(): void {
      if (performance.now() >= until.current) wake();
      else frame = requestAnimationFrame(wait);
    });
    return () => cancelAnimationFrame(frame);
  }, [jumping, width, height]);
  return jumping;
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
