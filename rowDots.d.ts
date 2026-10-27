/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centring scroll sit. Internal; `usePanelDots` is the one public door.
 */
/** A dot's place in the bar's track, in px, and whether it is the hollow one. */
export interface DotPlace {
    readonly id: string;
    readonly left: number;
    readonly width: number;
    readonly hollow: boolean;
}
/** Every dot plus the oval for the visible window, all in track px. */
export interface DotLayout {
    readonly dots: readonly DotPlace[];
    readonly oval: {
        readonly left: number;
        readonly width: number;
    };
}
/** The width of a one-phone panel's dot, in px. */
export declare const DOT_PHONE_PX = 22;
/** The space between two dots, in px. */
export declare const DOT_GAP_PX = 8;
/**
 * Where each dot sits in the track, and the strip span each panel covers. A scroll position maps onto the track
 * piecewise: a panel's span (the panel and the gap after it) maps onto its dot and the dot gap after it, so the map has
 * no jump at a boundary and the oval tracks the scroll smoothly.
 */
export interface DotMap {
    readonly lefts: readonly number[];
    readonly widths: readonly number[];
    readonly strips: readonly number[];
    readonly spans: readonly number[];
    readonly width: number;
    /** One phone slot (a phone and a row gap) in strip px, and the phone width, which size the oval to the window. */
    readonly pitch: number;
    readonly phone: number;
}
/** The dot bar's map for the row's panels. Dot widths come from the panel's size, not from the track. */
export declare function dotMap(i: {
    widths: readonly number[];
    leftOffsets: readonly number[];
}): DotMap;
/** The track px for strip scroll `at`, piecewise over the panels. */
export declare function toTrack(map: DotMap, at: number): number;
/** The strip scroll for track px `at`: the inverse of `toTrack`, clamped to the bar. */
export declare function toScroll(map: DotMap, at: number): number;
/** Dots at their sizes, plus the oval for the visible window, in track px from the bar's left edge. */
export declare function dotLayout(i: {
    ids: readonly string[];
    hollow: readonly boolean[];
    map: DotMap;
    windowWidth: number;
    scrollLeft: number;
}): DotLayout;
/**
 * The scroll that centres panel `index` in the window, clamped to the row's legal range. Null when the row cannot
 * scroll or the window is not measured: a click on a dot then does nothing.
 */
export declare function centreScroll(i: {
    index: number;
    leftOffsets: readonly number[];
    widths: readonly number[];
    windowWidth: number;
    maxScroll: number;
}): number | null;
/** The scroll after the oval has been dragged `dx` track px from where the drag began, clamped to the row's range. */
export declare function dragScroll(i: {
    startScroll: number;
    dx: number;
    map: DotMap;
    maxScroll: number;
}): number;
/** A parked panel's dot: `before` is how many drawn panels come ahead of it in the row's order. */
export interface ParkedDot {
    readonly id: string;
    readonly before: number;
    readonly slots: number;
    readonly hollow: boolean;
}
/** The whole bar: the drawn panels' layout with each parked panel's dot set at its place in the row's order. */
export interface FullDotLayout extends DotLayout {
    /** The bar's width in px. */
    readonly width: number;
    /** The ids of the parked dots, which a click brings in by stepping the row. */
    readonly parked: ReadonlySet<string>;
}
/**
 * Sets the parked dots beside the drawn ones, which stay together under the oval: an always-shown panel such as the Workspace
 * never moves, so its dot stays in the oval's end slot and the panels parked between it and the rest wait outside the oval.
 */
export declare function withParked(layout: DotLayout, map: DotMap, parked: readonly ParkedDot[]): FullDotLayout;
