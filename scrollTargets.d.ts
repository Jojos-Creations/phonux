/**
 * Where the row scrolls to: pure functions of the row's numbers and the container's measured width, so the same
 * target comes out of the executor, the gesture and the tests. Nothing here reads the DOM.
 */
import type { ScrollAlign } from './panelSettings.js';
/**
 * The `scrollLeft` that shows a panel. `left` is the panel's left edge in scroll coordinates (gap + the row's left
 * margin of the same commit + its offset). The window is `scrollLeft + gap` to `scrollLeft + clientWidth - gap`;
 * 'into-view' moves the least distance that puts the whole panel inside it (the left edge wins for a panel wider than
 * the window). The result is clamped to `[0, maxScroll]`, the strip's bound from the row numbers.
 */
export declare function scrollTargetFor(i: {
    left: number;
    width: number;
    scrollLeft: number;
    clientWidth: number;
    maxScroll: number;
    gap: number;
    align: ScrollAlign;
}): number;
/**
 * The stop one step from `base` toward `direction`: the next panel start past it, held to `[0, maxScroll]`. Null at the
 * strip's end. `panelStarts` are the panels' left edges less the gap, ascending.
 */
export declare function stepTarget(direction: 'left' | 'right', base: number, panelStarts: readonly number[], maxScroll: number): number | null;
/** A hidden panel the gesture may bring back. */
interface HiddenCandidate {
    id: string;
    /** How many live panels precede it in the row. */
    liveBefore: number;
    /** True when a person hid it and it stays hidden until shown. */
    held: boolean;
    /** Its `revealOnScroll`. */
    policy: 'edges' | 'any' | 'never';
}
/**
 * What one step does. The nearest hidden panel in the direction (past the window's edge) is shown when its policy
 * allows and no live panel lies between the window's edge and its slot, so a held panel is never reached by skipping
 * live ones; an engine-parked one under 'edges' also needs no live panel beyond the window on that side. Otherwise
 * the row scrolls one panel start, and with neither there is nothing to do.
 */
export declare function gestureTarget(i: {
    direction: 'left' | 'right';
    base: number;
    clientWidth: number;
    maxScroll: number;
    liveStarts: readonly number[];
    liveWidths: readonly number[];
    /** Where whole panels are shown, ascending; the step lands on these. Absent or empty: the panel starts. */
    stops?: readonly number[];
    gap: number;
    hidden: readonly HiddenCandidate[];
}): {
    kind: 'show';
    id: string;
} | {
    kind: 'scroll';
    to: number;
} | {
    kind: 'none';
};
export {};
