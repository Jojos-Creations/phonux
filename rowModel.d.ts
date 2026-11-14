/**
 * The row's position model: one ordered list of every panel on one continuous ruler, and one number, `view`, for where the
 * window sits on it. Everything else (where a panel is on screen, which panels are shown, parked or held, where the dots are)
 * is derived from those two and never stored. Pure: no DOM, no React, no animation state.
 */
/** A panel is a whole number of slots wide, so every width plus its gap is a multiple of the pitch; the stops rely on it. */
export interface RowPanel {
    readonly id: string;
    readonly slots: number;
    /** Not drawn and given no dot and no length on the ruler, as a panel that never reveals on scroll. */
    readonly hidden?: boolean;
}
export interface RowModel {
    /** Every panel in order. Nothing leaves this list for being parked or held. */
    readonly panels: readonly RowPanel[];
    /** The id of the panel held at the left edge, or null. Held only while it is the first drawn panel and the window leaves it a phone's room. */
    readonly heldLeft: string | null;
    readonly phonePx: number;
    readonly gapPx: number;
    /** The id of the panel held at the right edge, or null: the mirror of `heldLeft`, held only while it is the last drawn panel. The same id in both is one panel held at whichever edge of the list it is at (see `holdBoth`). */
    readonly heldRight?: string | null;
    /** The measured container less its padding. A finite number: an unmeasured row has no model. */
    readonly windowPx: number;
    /** The window's left edge along the ruler, in px. The one scalar a driver animates. */
    readonly view: number;
    /** How far outside the window a panel stays mounted. Default 0. */
    readonly overscanPx?: number;
}
/** Positions within this many px are the same position; the arithmetic is exact for integers and this absorbs a centering half-pixel. */
export declare const EPS_PX = 0.5;
/** How little of a panel may be missing from the grid and still count as shown: the tolerance plus a margin over the float noise of scaling it to a dot. */
export declare const SHOWN_TOLERANCE_PX: number;
export interface DrawnPanel {
    readonly id: string;
    /** Index in `RowModel.panels`. */
    readonly index: number;
    readonly slots: number;
    /** Left edge on the ruler: the running sum of the drawn widths and gaps before it, parked panels included. */
    readonly x: number;
    readonly w: number;
}
export interface RowLayout {
    readonly drawn: readonly DrawnPanel[];
    readonly pitchPx: number;
    readonly gapPx: number;
    readonly stripPx: number;
    /** The panel held at the left edge when the hold is in effect, else null. */
    readonly held: DrawnPanel | null;
    /** The panel held at the right edge when the hold is in effect, else null. */
    readonly heldRight: DrawnPanel | null;
    readonly windowPx: number;
    /** Space left of the first whole slot and right of the last, so the slots a rest shows are centered. */
    readonly centerPx: number;
    /** The span of the window, in window px, that unheld panels count as shown inside: the grid less the held panel. */
    readonly lo: number;
    readonly hi: number;
    /** Every `view` the row rests on, ascending. */
    readonly stops: readonly number[];
}
export declare function layoutOf(m: RowModel): RowLayout;
export declare function screenOf(m: RowModel, id: string): number | undefined;
export declare function onScreenIds(m: RowModel): string[];
/** Panels the row need not keep mounted: wholly outside the window by more than the overscan. The held panel is never one. */
export declare function parkedIds(m: RowModel): string[];
export interface RowDots {
    readonly dots: readonly {
        id: string;
        left: number;
        width: number;
        lit: boolean;
    }[];
    /** The grid the window shows, less the held panel: the same span as `lo` to `hi`, scaled. */
    readonly oval: {
        left: number;
        width: number;
    };
}
/**
 * The ruler drawn small: `k` track px to a ruler px, and a dot gap of `dotGapPx`, so a dot's left is its panel's left scaled and its
 * right stops one dot gap short of the next slot. `grid` is the span of the ruler the oval draws, and `riders` the ruler x of each
 * panel that does not sit at its own place, as a held one rides its edge of the window.
 */
export declare function scaledRuler(l: RowLayout, k: number, dotGapPx: number, grid: {
    left: number;
    width: number;
}, riders: ReadonlyMap<string, number>): RowDots;
/** The ruler shrunk to `trackPx`. A dot is lit by the same rule as `onScreenIds`, applied to the scaled numbers. */
export declare function dotsOf(m: RowModel, trackPx: number): RowDots;
export declare function viewRange(m: RowModel): {
    min: number;
    max: number;
};
export declare function open(m: RowModel, panel: RowPanel, index?: number): RowModel;
export declare function close(m: RowModel, id: string): RowModel;
/** Moves `id` so it ends at `to` in the new list. A held panel does not move, and nothing moves in front of the left-held one or after the right-held one. */
export declare function reorder(m: RowModel, id: string, to: number): RowModel;
export declare function resize(m: RowModel, id: string, slots: number): RowModel;
/** Holds `id` at the left edge, or lets go with null. Only the first drawn panel can be held. */
export declare function hold(m: RowModel, id: string | null): RowModel;
/** Holds `id` at the right edge, or lets go with null. Only the last drawn panel can be held there. */
export declare function holdRight(m: RowModel, id: string | null): RowModel;
/**
 * Holds `id` at whichever edge of the list it is at, or lets go with null: one state, so a list change cannot drop one edge of it.
 * Only the first or the last drawn panel can be held this way; any other is left as it was.
 */
export declare function holdBoth(m: RowModel, id: string | null): RowModel;
/** A window change keeps every panel where it is; the grid moves under it, so call `settle` to land on a rest. */
export declare function setWindow(m: RowModel, windowPx: number): RowModel;
/** One slot toward `dir`: the next rest in that direction, and no move when there is none. */
export declare function step(m: RowModel, dir: -1 | 1): RowModel;
/** A drag by `dx` screen px: the content follows the pointer, held inside the range of rests. */
export declare function dragBy(m: RowModel, dx: number): RowModel;
/** The nearest rest: what a release or a window change lands on. The earlier rest wins a tie. */
export declare function settle(m: RowModel): RowModel;
export declare function atRest(m: RowModel): boolean;
