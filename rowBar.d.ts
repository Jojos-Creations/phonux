import { type RowNumbers } from './rowNumbers.js';
import type { WorkspaceRowEntry } from './workspaceRow.js';
/** The width of a one-phone panel's dot, in px. */
export declare const DOT_PHONE_PX = 22;
/** The space between two dots, in px. */
export declare const DOT_GAP_PX = 8;
/** A dot's place in the bar's track, in px. */
export interface DotPlace {
    readonly id: string;
    readonly left: number;
    readonly width: number;
    readonly hollow: boolean;
    /** The panel stays on screen as the row moves, so its dot keeps to the oval's end and lies over the dots beneath it. */
    readonly riding: boolean;
}
/** The whole bar, in track px from its left edge. */
export interface RowBar {
    readonly dots: readonly DotPlace[];
    readonly oval: {
        readonly left: number;
        readonly width: number;
    };
    /** The bar's width: its dots and the gaps between them. */
    readonly width: number;
    /** The ids of the parked dots, which a click brings in by stepping the row. */
    readonly parked: ReadonlySet<string>;
    /** Where the panels the row moves start and end: a parked dot left of `left` waits left, one at or past `right` waits right. */
    readonly run: {
        readonly left: number;
        readonly right: number;
    };
    /** Track px to one px of scroll. */
    readonly scale: number;
}
/** The bar for a row at `scroll`. `entries` is every panel in row order; one the numbers do not draw counts only while it is parked and can come back. */
export declare function barOf(n: RowNumbers, entries: readonly WorkspaceRowEntry[], scroll: number): RowBar;
/**
 * The scroll that centers panel `index` in the window, clamped to the row's legal range. Null when the row cannot
 * scroll or the window is not measured: a click on a dot then does nothing.
 */
export declare function centreScroll(i: {
    index: number;
    leftOffsets: readonly number[];
    widths: readonly number[];
    windowWidth: number;
    maxScroll: number;
}): number | null;
