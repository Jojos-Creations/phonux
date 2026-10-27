/** Px tall a panel's header and footer bars are, in every theme. @internal */
export declare const BAR_HEIGHT_PX = 36;
/** Px from the frame's bottom edge to the footer's bottom edge: the offset below the frame plus the footer's height. @internal */
export declare const FOOTER_ROOM_PX: number;
/** Px the row leaves under its frames: the row gap, or the footer's room when that is more. Layout and phone-fit height both read it. @internal */
export declare const rowBottomReservePx: (gap: number) => number;
/** Px the row leaves above its frames. A dev's `tuning.rowTop` is taken as given; without it, never less than the header's room, so a header drawn above a frame that fills the height stays on screen. @internal */
export declare const rowTopReservePx: (asked: number | undefined, rowTop: number | null, gap: number) => number;
/**
 * Px tall a panel's header and footer bars are, in every theme. A host lays out around the row with it rather than a copy.
 * @public
 */
export declare const PANEL_BAR_HEIGHT_PX: number;
/**
 * Px from a frame's bottom edge to its footer's bottom edge: the room the footer takes under a frame.
 * @public
 */
export declare const PANEL_FOOTER_ROOM_PX: number;
/**
 * Px the row leaves under its frames for row gap `gap`: the gap, or the footer's room when that is more. The phone fit's height
 * budget counts it, so a host centering the row in its page counts it the same way.
 * @public
 */
export declare const rowFootReserve: (gap: number) => number;
