/** Px tall a panel's header and footer bars are, in every theme. @internal */
export declare const BAR_HEIGHT_PX = 36;
/** Px from the frame's bottom edge to the footer's bottom edge: the offset below the frame plus the footer's height. @internal */
export declare const FOOTER_ROOM_PX: number;
/** Px the row leaves under its frames: `asked`, else the row gap, or the footer's room when that is more. Layout and phone-fit height both read it. @internal */
export declare const rowBottomReservePx: (gap: number, asked?: number) => number;
/** Px the row leaves above its frames. A dev's `tuning.rowTop` is taken as given; without it, never less than the header's room, so a header drawn above a frame that fills the height stays on screen. @internal */
export declare const rowTopReservePx: (asked: number | undefined, rowTop: number | null, gap: number) => number;
