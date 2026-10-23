import { type PanelRowEntry } from './panelRowEntry.js';
/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
    /** True when any drawn entry carries settings whose `overflow` is 'scroll': the row scrolls instead of parking for room. */
    rowScroll: boolean;
    /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
    windowWidth: number;
    /** The width of every drawn entry plus one gap between each two. */
    stripWidth: number;
    /** The row's left margin: centring for a strip that fits, 0 for one that does not. */
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
     * The edgeHold 'both' panels that stick: each is drawn in the strip at its own place and holds at whichever edge the scroll
     * takes it past. `left` and `right` are the insets from the scrollport's edges that it keeps clear of the fixed groups and of
     * the sticky panels beside it. Empty when the row does not scroll.
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
     * The `scrollLeft` values a stepping row rests on, ascending; the first is 0. They are one phone width apart, and the last
     * is the row's end (`maxScrollOf`). Empty when the row does not scroll, or its strip fits the window and keeps its centring.
     */
    stops: readonly number[];
    /** The same values as `stops`, under the step's name. Empty when `stops` is. */
    stepStops: readonly number[];
    /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
    stopSpans: readonly {
        first: number;
        end: number;
    }[];
    /** Always 0: the space after the strip is one row gap wide, and the last stop leaves the last panel one gap from the window edge. */
    endPad: number;
}
/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centres only a strip that fits.
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
}): RowNumbers;
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
/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export declare function maxScrollOf(n: RowNumbers): number;
