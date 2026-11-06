/**
 * The heights the chrome around a frame takes, from the one place that prices them: the header and the footer are the
 * same height, and the row reserves exactly the footer's offset plus that height under the frame.
 */
import { HEADER_GAP_PX } from './rowConstants.js';

/** Px tall a panel's header and footer bars are, in every theme. @internal */
export const BAR_HEIGHT_PX = 36;

/** Px from the frame's bottom edge to the footer's bottom edge: the offset below the frame plus the footer's height. @internal */
export const FOOTER_ROOM_PX = HEADER_GAP_PX + BAR_HEIGHT_PX;

/** Px the row leaves under its frames: `asked`, else the row gap, or the footer's room when that is more. Layout and phone-fit height both read it. @internal */
export const rowBottomReservePx = (gap: number, asked?: number): number => Math.max(asked ?? gap, FOOTER_ROOM_PX);

/** Px the row leaves above its frames. A dev's `tuning.rowTop` is taken as given; without it, never less than the header's room, so a header drawn above a frame that fills the height stays on screen. @internal */
export const rowTopReservePx = (asked: number | undefined, rowTop: number | null, gap: number): number =>
  rowTop !== null ? (asked ?? rowTop) : Math.max(asked ?? gap, FOOTER_ROOM_PX);

/**
 * Px tall a panel's header and footer bars are, in every theme. A host lays out around the row with it rather than a copy.
 * @public
 */
export const PANEL_BAR_HEIGHT_PX: number = BAR_HEIGHT_PX;

/**
 * Px from a frame's bottom edge to its footer's bottom edge: the room the footer takes under a frame.
 * @public
 */
export const PANEL_FOOTER_ROOM_PX: number = FOOTER_ROOM_PX;

/**
 * Px the row leaves under its frames for row gap `gap`: the gap, or the footer's room when that is more. The phone fit's height
 * budget counts it, so a host centering the row in its page counts it the same way.
 * @public
 */
export const rowFootReserve = (gap: number): number => rowBottomReservePx(gap);
