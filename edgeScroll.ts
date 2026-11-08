/**
 * The two pure numbers behind edge scrolling: how fast the row scrolls for a pointer position, and how far one
 * frame moves it. No React and no DOM, so the frame loop in DragToClose is the only impure part.
 */

// A tab that was in the background returns with one huge frame; capped, it moves the row one ordinary step.
const MAX_FRAME_MS = 50;

/**
 * Signed px/s for a pointer at `pointerX` against a container spanning `left` to `right`: negative toward the left
 * edge, 0 outside both bands. The band is `zonePx` wide, but never more than half the container, so the two bands
 * of a narrow container cannot overlap. The speed ramps linearly from 0 at the band's inner edge to `maxPxPerSec`
 * at the container edge, and holds there beyond it.
 * @internal
 */
export function edgeScrollSpeed(i: { pointerX: number; left: number; right: number; zonePx: number; maxPxPerSec: number }): number {
  const zone = Math.min(i.zonePx, (i.right - i.left) / 2);
  if (!(zone > 0)) return 0;
  if (i.pointerX < i.left + zone) return (-i.maxPxPerSec * Math.min(zone, i.left + zone - i.pointerX)) / zone;
  if (i.pointerX > i.right - zone) return (i.maxPxPerSec * Math.min(zone, i.pointerX - (i.right - zone))) / zone;
  return 0;
}

/**
 * The delta one frame applies to `scrollLeft`: `speed` over `dtMs` (at most 50 ms), kept inside `[0, maxScroll]`.
 * `maxScroll` comes from the row numbers, never from `scrollWidth`, which a transformed descendant can inflate.
 * @internal
 */
export function edgeScrollStep(i: { speed: number; dtMs: number; scrollLeft: number; maxScroll: number }): number {
  const delta = (i.speed * Math.min(i.dtMs, MAX_FRAME_MS)) / 1000;
  const target = i.scrollLeft + delta;
  if (target >= 0 && target <= i.maxScroll) return delta + 0;
  return Math.min(i.maxScroll, Math.max(0, target)) - i.scrollLeft;
}

/**
 * Signed px/s for a pointer `depthPx` past an end, by the same ramp as `edgeScrollSpeed`: 0 at the end, `maxPxPerSec` once the
 * pointer is `zonePx` past it, held beyond. Negative depth is past the start. dnd-kit's AutoScroller and the browser's own
 * autoscroll work this way: speed by distance, applied on every frame for as long as the pointer stays there.
 * @internal
 */
export function depthSpeed(depthPx: number, zonePx: number, maxPxPerSec: number): number {
  if (!(zonePx > 0) || depthPx === 0 || !Number.isFinite(depthPx)) return 0;
  return Math.sign(depthPx) * maxPxPerSec * Math.min(1, Math.abs(depthPx) / zonePx);
}

/**
 * Time-driven travel in whole units, for a row that moves only by steps: `carried` px plus `speed` over `dtMs` (at most 50 ms), and
 * how many whole `unitPx` that makes, each a step toward the speed's sign. The rest is carried to the next frame, so a held pointer
 * steps at a steady rate and a deeper one faster; speed 0 drops what was carried.
 * @internal
 */
export function edgeSteps(i: { carried: number; speed: number; dtMs: number; unitPx: number }): { steps: number; carried: number } {
  if (i.speed === 0 || !(i.unitPx > 0)) return { steps: 0, carried: 0 };
  const carried = (Math.sign(i.carried) === Math.sign(i.speed) ? i.carried : 0) + (i.speed * Math.min(Math.max(i.dtMs, 0), MAX_FRAME_MS)) / 1000;
  const steps = Math.trunc(carried / i.unitPx);
  return { steps, carried: carried - steps * i.unitPx };
}
