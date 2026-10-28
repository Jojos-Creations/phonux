/**
 * Panel sizes: the size a panel starts at, and the one rule for how wide a panel is in the row. Pure, and free of live
 * device state, so the row's state functions stay pure too.
 */
import { DEFAULT_PHONE_SIZE } from './hostApi.js';
import { ROW_GAP, fitSlots, slotWidth } from './rowConstants.js';
/**
 * The size every panel starts at: one slot at the built-in phone size.
 * @public
 */
export const DEFAULT_PANEL_SIZE = Object.freeze({ width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height });
/**
 * The slots a panel is drawn at: its `slots` (at most its `maxSlots`) capped at what fits in `maxLiveWidth`; undefined for a
 * hand-built entry that carries no slots, which keeps drawing at the phone width.
 * @internal
 */
export function drawnSlotsOf(p, phoneWidth, maxLiveWidth, gap = ROW_GAP) {
    if (p.slots === undefined)
        return undefined;
    return Math.max(1, Math.min(p.slots, p.settings?.maxSlots ?? p.slots, fitSlots(maxLiveWidth, phoneWidth, gap)));
}
/**
 * A panel's own width in the row: its slots, that many phone widths with the row gap between them, no more than fit in
 * `maxLiveWidth`. A hand-built entry without slots takes the live `phoneWidth`.
 * @public
 * @deprecated Inside a row, `Panel`, `PanelFrame` and `PanelSizeBox` take the slot's drawn size when `size` is left out, and `PanelSummary.size.width` is that width.
 */
export function panelWidthOf(p, phoneWidth, maxLiveWidth, gap = ROW_GAP) {
    const drawn = drawnSlotsOf(p, phoneWidth, maxLiveWidth, gap);
    return drawn === undefined ? phoneWidth : slotWidth(drawn, phoneWidth, gap);
}
