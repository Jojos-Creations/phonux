/**
 * The two pure numbers behind edge scrolling: how fast the row scrolls for a pointer position, and how far one
 * frame moves it. No React and no DOM, so the frame loop in DragToClose is the only impure part.
 */
/**
 * Signed px/s for a pointer at `pointerX` against a container spanning `left` to `right`: negative toward the left
 * edge, 0 outside both bands. The band is `zonePx` wide, but never more than half the container, so the two bands
 * of a narrow container cannot overlap. The speed ramps linearly from 0 at the band's inner edge to `maxPxPerSec`
 * at the container edge, and holds there beyond it.
 * @internal
 */
export declare function edgeScrollSpeed(i: {
    pointerX: number;
    left: number;
    right: number;
    zonePx: number;
    maxPxPerSec: number;
}): number;
/**
 * The delta one frame applies to `scrollLeft`: `speed` over `dtMs` (at most 50 ms), kept inside `[0, maxScroll]`.
 * `maxScroll` comes from the row numbers, never from `scrollWidth`, which a transformed descendant can inflate.
 * @internal
 */
export declare function edgeScrollStep(i: {
    speed: number;
    dtMs: number;
    scrollLeft: number;
    maxScroll: number;
}): number;
