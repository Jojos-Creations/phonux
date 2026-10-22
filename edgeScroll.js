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
export function edgeScrollSpeed(i) {
    const zone = Math.min(i.zonePx, (i.right - i.left) / 2);
    if (!(zone > 0))
        return 0;
    if (i.pointerX < i.left + zone)
        return (-i.maxPxPerSec * Math.min(zone, i.left + zone - i.pointerX)) / zone;
    if (i.pointerX > i.right - zone)
        return (i.maxPxPerSec * Math.min(zone, i.pointerX - (i.right - zone))) / zone;
    return 0;
}
/**
 * The delta one frame applies to `scrollLeft`: `speed` over `dtMs` (at most 50 ms), kept inside `[0, maxScroll]`.
 * `maxScroll` comes from the row numbers, never from `scrollWidth`, which a transformed descendant can inflate.
 * @internal
 */
export function edgeScrollStep(i) {
    const delta = (i.speed * Math.min(i.dtMs, MAX_FRAME_MS)) / 1000;
    const target = i.scrollLeft + delta;
    if (target >= 0 && target <= i.maxScroll)
        return delta + 0;
    return Math.min(i.maxScroll, Math.max(0, target)) - i.scrollLeft;
}
