import { type PanelRowEntry } from './panelRowEntry.js';
import type { RowRest } from './rowRest.js';
/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
    /** True when any drawn entry carries settings whose `overflow` is 'scroll': the row scrolls instead of parking for room. */
    rowScroll: boolean;
    /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
    windowWidth: number;
    /** The width of every drawn entry plus one gap between each two. */
    stripWidth: number;
    /** The row's left margin: centering for a strip that fits, the centering space before the strip on a stepping row that overflows, else 0. */
    rowMarginLeft: number;
    /** The ids of the drawn entries in the strip, in row order. Panels held at an edge are not here; `held` lists them. */
    ids: readonly string[];
    /** The width of each drawn entry, in the order of `ids`. */
    widths: readonly number[];
    /** Each drawn entry's resting x inside the strip: the widths before it plus one gap each. */
    leftOffsets: readonly number[];
    /** The panels held at an edge, left group first. Each is drawn in its edge's group, which the row keeps in view while the strip scrolls. */
    held: readonly {
        /** The panel's id. */
        id: string;
        /** The edge the panel holds at. */
        side: 'left' | 'right';
        /** The panel's width in px. */
        width: number;
        /** Where the panel sits inside its edge's group, in px from the group's left. */
        offset: number;
    }[];
    /**
     * The edgeHold 'both' panels that stick, in row order: each is drawn in the strip at its own place and holds at whichever edge
     * the scroll takes it past. `left` and `right` are the insets from the scrollport's edges that it keeps clear of the fixed
     * groups and of the 'both' panels stacked on its edge. Empty when the row does not scroll.
     */
    stuck: readonly {
        /** The panel's id. */
        id: string;
        /** The inset from the scrollport's left edge the panel's left edge keeps. */
        left: number;
        /** The inset from the scrollport's right edge the panel's right edge keeps. */
        right: number;
    }[];
    /** The width the left group takes before the strip, its trailing gap included; 0 with no left group. */
    leftInset: number;
    /** The width the right group takes after the strip, its leading gap included; 0 with no right group. */
    rightInset: number;
    /** The scrollLeft at which the strip's first slot rests: the left group and the row's margin. */
    stripStart: number;
    /** The width the strip is seen through: the window less both groups. `windowWidth` when no panel is held. */
    stripWindow: number;
    /** The widest one panel can be in this row; `Infinity` before the row is measured. */
    maxLiveWidth: number;
    /** The widths of the drawn entries the row never parks for room, the held and sticky panels included. */
    reservedWidths: readonly number[];
    /** The widths of the drawn entries the row may park for room. */
    parkLiveWidths: readonly number[];
    /**
     * The `scrollLeft` values a stepping row rests on, ascending; the first is 0 and the last is the row's end (`maxScrollOf`).
     * No two are more than one phone width apart. Empty when the row does not scroll, or its strip fits the window and keeps its centering.
     */
    stops: readonly number[];
    /** The same values as `stops`, under the step's name. Empty when `stops` is. */
    stepStops: readonly number[];
    /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
    stopSpans: readonly {
        first: number;
        end: number;
    }[];
    /** The blank a rest leaves before the parking panels, in px; `leftOffsets` already hold it. Absent reads as none. */
    leadPx?: number;
    /** The space after the strip: on a stepping row that overflows, the same centering space as before it, so the last rest centers too; else 0. */
    endPad: number;
    /** Set for the commit a hold starts or lets go, or a step swaps panels: how far the strip's kept panels moved in strip px. The row takes it into its offset so nothing on screen moves. */
    anchor?: number;
}
/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centers only a strip that fits.
 * @public
 * @deprecated The provider computes the row's numbers from its tuning; read them as `useProvidePanels(...).rowNumbers`.
 */
export declare function computeRowNumbers(i: {
    /** The row's whole list; the entries `isPresent` drops (parked ones, the marker) are not drawn and are ignored. */
    entries: readonly PanelRowEntry[];
    /** The phone frame's width in px: what a phone panel and a fixed column are drawn at. */
    phoneWidth: number;
    /** The row container's measured width; 0 before the first measurement. */
    containerWidth: number;
    /** The row's gap in px. */
    gap: number;
    /** How many fixed columns a hand-built row prices its capacity from. Default: the drawn entries that are not collapsible. */
    fixedItemCount?: number;
    /** True for a row whose gesture is 'step': the row then rests on the one-phone grid, `stops`. Default false. */
    wholePanels?: boolean;
    /** The blanks a parking row rests with: a strip that fits draws them, one that overflows ignores them. Default none. */
    rest?: RowRest | null;
}): RowNumbers;
/** Where `computeRowNumbers` asks first. A test swaps `model` to see that the answer really comes through it. @internal */
export declare const rowNumberSources: {
    model: (i: Parameters<typeof computeRowNumbers>[0]) => RowNumbers | null;
};
/**
 * The row's numbers by the arithmetic that predates the position model, kept as the reference the model's adapter is compared with.
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centers only a strip that fits.
 * @internal
 */
export declare function legacyRowNumbers(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers;
/**
 * Whether the root leaves the row's drawn panels so the panels beside it arrive whole: a row that swaps, whose one parking panel, chosen wider than a phone, does not fit
 * the window beside the root and does fit it without. Derived from the list and the window, so it follows both in the commit that changes
 * them and nothing is stored or saved: the root's entry stays live on the list, and only the entries the row draws read it as parked. A
 * row with a panel that scrolls keeps its edge rule, and a hand-built root's row needs no step: it caps its panels beside the fixed columns.
 * @internal
 */
export declare function rootStepsAside(i: {
    entries: readonly PanelRowEntry[];
    rootId: string;
    phoneWidth: number;
    containerWidth: number;
    gap: number;
}): boolean;
/**
 * The row's numbers read off the position model, or null for a row the model does not express: an unmeasured window, a scrolling row
 * whose window is narrower than a phone, a hold that is not on the first panel, and a scrolling row that fits and rests with blanks. A right hold on the first panel is read as
 * the panel docked in the last slot, so the model is given it last. A row that never scrolls is read as one with no hold. `computeRowNumbers` then answers with the older arithmetic. @internal
 */
export declare function rowNumbersViaModel(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers | null;
/** The two edges of a row's slot grid, in the window's coordinates (0 is the window's left edge): nothing of a panel draws outside them. @internal */
export declare function gridEdgesOf(n: RowNumbers): {
    lo: number;
    hi: number;
};
/**
 * The window a strip panel may show in at scroll `at`, in the window's coordinates: the grid less the held groups, and less a
 * 'both' panel the scroll has stuck at an edge there with its gap. Nothing of the strip draws under or beside a held or stuck panel. @internal
 */
export declare function stripWindowAt(n: RowNumbers, at: number, gap: number): {
    lo: number;
    hi: number;
};
/** Where the drawn entry `k` of `n` rests at scroll `at`, in the window's coordinates. @internal */
export declare function slotSpanAt(n: RowNumbers, k: number, at: number): {
    left: number;
    right: number;
};
/**
 * How much of the drawn entry `k` of `n` lies outside its strip window at scroll `at`, in px off each side, and whether it lies
 * wholly outside (`away`): the cut a slot is drawn with, and the reach it keeps. A whole panel at rest cuts 0 and 0. @internal
 */
export declare function slotCutAt(n: RowNumbers, k: number, at: number, gap: number): {
    left: number;
    right: number;
    away: boolean;
};
/**
 * How entry `k` of `n` is drawn in a row whose only hold is a left one, at scroll `at`, in px of its own box: `fade` is where the
 * fade across the held panel's gap starts (it ends one gap further, and null is no fade), and `left` and `right` are the cuts. The
 * left cut is the held panel's edge. The right cut lets a panel past the grid run on toward the window's edge by as much as it has
 * inside the grid, so one wholly past stays hidden and one coming in grows out of the grid's edge with no jump. @internal
 */
export declare function slotEdgesAt(n: RowNumbers, k: number, at: number, gap: number): {
    fade: number | null;
    left: number;
    right: number;
};
/** Whether the drawn entry `index` of `n` lies wholly inside its strip window at scroll `at`, within a pixel. @internal */
export declare function drawsWhole(n: RowNumbers, index: number, at: number): boolean;
/**
 * The index in `n.stops` of the stop to rest at to show panel `index` whole: of the stops whose panels include it, drawn at its
 * full width, the one nearest `target`. Of stops that share a position, the earliest. -1 when the row has no such stop. @internal
 */
export declare function snapToStopIndex(n: RowNumbers, index: number, target: number): number;
/**
 * The stop to rest at to show panel `index` whole: where `snapToStopIndex` points, `target` itself when the row has none. @internal
 */
export declare function snapToStop(n: RowNumbers, index: number, target: number): number;
/** The stop of `n` nearest `at`; `at` itself when the row has none. @internal */
export declare function nearestStop(n: RowNumbers, at: number): number;
/**
 * The `scrollLeft` that puts the pinned edge of entry `k` back at `edge` px from the window's left, with `n`'s margin, offset and
 * width: its right edge when the width was pinned at its end (a left grabber), its left edge when pinned at its start. `at` itself
 * when the entry is not in `n`. @internal
 */
export declare function scrollHoldingEdge(n: RowNumbers, k: number, pin: 'start' | 'end', edge: number, at: number): number;
/**
 * The offset change that keeps every panel `prev` and `now` share where it stands, or undefined when there is none to keep: the
 * row's panels and holds did not change, the change is not one that should hold still, or the offset would leave the row's range. @internal
 */
export declare function rowAnchor(prev: RowNumbers | undefined, now: RowNumbers, base: number, stepped: boolean): number | undefined;
/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export declare function maxScrollOf(n: RowNumbers): number;
