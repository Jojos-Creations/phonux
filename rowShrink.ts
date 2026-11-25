/**
 * A panel leaving a scrolling row shrinks into a point halfway up the next place beyond the edge, and an arriving one grows out
 * of it. That point is the panel's own center once it is a whole slot out, so a panel changes size where it stands and slides on.
 * The size runs on its own, slightly slower clock: in a fast scroll panels have not grown back by the time they move on, so they
 * look smaller.
 */

/** The time constant the drawn size trails the position by, ms. @internal */
export const SHRINK_LAG_MS = 90;
/** A panel under this share of its size is not drawn. */
const SHRINK_GONE = 0.02;
/** A size this close to its goal is at it. */
const SHRINK_SETTLED = 0.002;

/**
 * The size, 0 to 1, a one-slot panel's place asks for: its layout box starts at `left` and is `width` wide, in a window from
 * `viewLeft` to `viewRight` with a slot every `pitch` px. A whole pitch past an edge is gone.
 * @internal
 */
export function shrinkGoal(i: { left: number; width: number; viewLeft: number; viewRight: number; pitch: number }): number {
  const past = Math.max(i.viewLeft - i.left, i.left + i.width - i.viewRight);
  return past <= 0.5 || !(i.pitch > 0) ? 1 : 1 - Math.min(1, past / i.pitch);
}

/** The size drawn `dtMs` after it was `was`, trailing `goal`. A long gap between frames counts as two frames, so the trail is not lost. @internal */
export function trailSize(was: number, goal: number, dtMs: number): number {
  const next = was + (goal - was) * (1 - Math.exp(-Math.min(Math.max(dtMs, 0), 34) / SHRINK_LAG_MS));
  return Math.abs(next - goal) < SHRINK_SETTLED ? goal : next;
}

/** The styles that draw size `size`; empty at full size. A trailing size is never drawn larger than the place allows. @internal */
export function shrinkStyle(size: number, goal: number): { scale: string; opacity: string } {
  const s = Math.min(size, goal);
  if (s > 0.999) return { scale: '', opacity: '' };
  if (s < SHRINK_GONE) return { scale: String(SHRINK_GONE), opacity: '0' };
  return { scale: String(Math.round(s * 10000) / 10000), opacity: s >= 0.625 ? '' : String(Math.round(s * 1600) / 1000) };
}

const sizes = new WeakMap<Element, { size: number; at: number }>();

/**
 * Advances the drawn size of `box` toward `goal` at time `now` and writes it. `snap` (Reduce Motion) takes the goal at once. Answers true while the size still trails, so the caller draws another frame.
 * @internal
 */
export function drawShrink(box: HTMLElement, goal: number, now: number, snap: boolean): boolean {
  const was = sizes.get(box);
  const size = snap || was === undefined ? goal : trailSize(was.size, goal, now - was.at);
  sizes.set(box, { size, at: now });
  const style = shrinkStyle(size, goal);
  for (const name of ['scale', 'opacity'] as const) {
    if ((box.style[name] ?? '') !== style[name]) box.style[name] = style[name];
  }
  return size !== goal;
}
