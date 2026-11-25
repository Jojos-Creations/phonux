/**
 * A panel leaving a scrolling row shrinks into a point halfway up the place it leaves by, and an arriving one grows out of it,
 * so no one-slot panel is drawn cut off. The size runs on its own, slightly slower clock: in a fast scroll panels have not grown
 * back by the time they move on, so they look smaller.
 */

/** The time constant the drawn size trails the position by, ms. @internal */
export const SHRINK_LAG_MS = 90;
/** A panel under this share of its size is not drawn. */
const SHRINK_GONE = 0.02;
/** A size this close to its goal is at it. */
const SHRINK_SETTLED = 0.002;

/** Where a panel is drawn relative to its layout box, and how large. `goal` is the size its place asks for, 0 to 1. @internal */
export interface ShrinkPose {
  goal: number;
  /** Sideways offset from the layout box's center to the drawn center, px. */
  dx: number;
}

/**
 * The pose of a one-slot panel whose layout box starts at `left` and is `width` wide, in a window from `viewLeft` to
 * `viewRight`, with a slot every `pitch` px. By how far it has passed an edge (a whole pitch is all the way), it shrinks, and its
 * center moves from the edge slot's to the vanishing point: the window's edge, or half a `gap` toward a sticky panel beside it, so
 * a leaving panel stays flush with the edge and never runs under the sticky one.
 * @internal
 */
export function shrinkPose(i: { left: number; width: number; viewLeft: number; viewRight: number; pitch: number; gap: number; stickyStart: boolean; stickyEnd: boolean }): ShrinkPose {
  const before = i.viewLeft - i.left;
  const after = i.left + i.width - i.viewRight;
  const side = before > 0.5 && before >= after ? -1 : after > 0.5 ? 1 : 0;
  if (side === 0 || !(i.pitch > 0)) return { goal: 1, dx: 0 };
  const t = Math.min(1, (side < 0 ? before : after) / i.pitch);
  const home = side < 0 ? i.viewLeft + i.width / 2 : i.viewRight - i.width / 2;
  const point = side < 0 ? i.viewLeft - (i.stickyStart ? i.gap / 2 : 0) : i.viewRight + (i.stickyEnd ? i.gap / 2 : 0);
  const center = home + (point - home) * t;
  return { goal: 1 - t, dx: center - (i.left + i.width / 2) };
}

/** The size drawn `dtMs` after it was `was`, trailing `goal`. A long gap between frames counts as two frames, so the trail is not lost. @internal */
export function trailSize(was: number, goal: number, dtMs: number): number {
  const next = was + (goal - was) * (1 - Math.exp(-Math.min(Math.max(dtMs, 0), 34) / SHRINK_LAG_MS));
  return Math.abs(next - goal) < SHRINK_SETTLED ? goal : next;
}

/** The styles that draw size `size` offset `dx`; all empty for a panel at full size in its place. A trailing size is never drawn larger than the place allows. @internal */
export function shrinkStyle(size: number, goal: number, dx: number): { translate: string; scale: string; opacity: string } {
  const s = Math.min(size, goal);
  const place = Math.abs(dx) < 0.05 ? '' : `${Math.round(dx * 100) / 100}px 0px`;
  if (s > 0.999) return { translate: place, scale: '', opacity: '' };
  if (s < SHRINK_GONE) return { translate: place, scale: String(SHRINK_GONE), opacity: '0' };
  return { translate: place, scale: String(Math.round(s * 10000) / 10000), opacity: s >= 0.625 ? '' : String(Math.round(s * 1600) / 1000) };
}

const sizes = new WeakMap<Element, { size: number; at: number }>();

/**
 * Advances the drawn size of `box` toward `goal` at time `now` and writes its pose. `snap` (Reduce Motion, or a row that does not
 * shrink) takes the goal at once. Answers true while the size still trails, so the caller draws another frame.
 * @internal
 */
export function drawShrink(box: HTMLElement, goal: number, dx: number, now: number, snap: boolean): boolean {
  const was = sizes.get(box);
  const size = snap || was === undefined ? goal : trailSize(was.size, goal, now - was.at);
  sizes.set(box, { size, at: now });
  const style = shrinkStyle(size, goal, dx);
  for (const name of ['translate', 'scale', 'opacity'] as const) {
    if ((box.style[name] ?? '') !== style[name]) box.style[name] = style[name];
  }
  return size !== goal;
}
