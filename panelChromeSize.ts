/**
 * The heights the chrome around a frame takes, from the one place that prices them: the header and the footer are the
 * same height, and the row reserves exactly the footer's offset plus that height under the frame.
 */
import type { Theme } from '@mui/material/styles';
import { panelCornerRadiusPx } from './PanelFrame.js';
import { HEADER_GAP_PX } from './rowConstants.js';

/** The height of a header and of a footer in px: twice the phone's corner radius, so their ends are exact semicircles. @internal */
export const panelHeaderHeightPx = (theme: Theme): number => 2 * panelCornerRadiusPx(theme);

/** Px from the frame's bottom edge to the footer's bottom edge: the offset below the frame plus the footer's height. @internal */
export const footerRoomPx = (theme: Theme): number => HEADER_GAP_PX + panelHeaderHeightPx(theme);

/** Px the row leaves under its frames: the row gap, or the footer's room when that is more. Layout and phone-fit height both read it. @internal */
export const rowBottomReservePx = (theme: Theme, gap: number): number => Math.max(gap, footerRoomPx(theme));
