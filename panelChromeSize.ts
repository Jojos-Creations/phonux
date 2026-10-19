/**
 * The heights the chrome around a frame takes, from the one place that prices them: the header and the footer are the
 * same height, and the row reserves exactly the footer's offset plus that height under the frame.
 */
import { HEADER_GAP_PX } from './rowConstants.js';

/** Px tall a panel's header and footer bars are, in every theme. @internal */
export const BAR_HEIGHT_PX = 36;

/** Px from the frame's bottom edge to the footer's bottom edge: the offset below the frame plus the footer's height. @internal */
export const FOOTER_ROOM_PX = HEADER_GAP_PX + BAR_HEIGHT_PX;

/** Px the row leaves under its frames: the row gap, or the footer's room when that is more. Layout and phone-fit height both read it. @internal */
export const rowBottomReservePx = (gap: number): number => Math.max(gap, FOOTER_ROOM_PX);
