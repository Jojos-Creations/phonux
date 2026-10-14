/**
 * Panel sizes: the size a panel starts at, and the one rule for how wide a panel is in the row. Pure, and free of live
 * device state, so the row's state functions stay pure too.
 */
import { DEFAULT_PHONE_SIZE, type PanelSize } from './hostApi.js';
import type { PanelRowEntry } from './panelRowEntry.js';
import { ROW_GAP, fitSlots, slotWidth } from './rowConstants.js';

/**
 * The size every panel starts at: one slot at the built-in phone size.
 * @public
 */
export const DEFAULT_PANEL_SIZE: PanelSize = Object.freeze({ width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height });

/**
 * The size recorded for a panel of `slots` slots: the phone size for one, else the slots' width at the built-in phone width
 * and the row's own height. A placeholder the row replaces with the width it draws.
 * @internal
 */
export const sizeOfSlots = (slots: number): PanelSize => (slots <= 1 ? DEFAULT_PANEL_SIZE : { width: slotWidth(slots, DEFAULT_PHONE_SIZE.width, ROW_GAP), height: 'fill' });

/**
 * The slots a panel is drawn at: its `slots` (at most its `maxSlots`) capped at what fits in `maxLiveWidth`; undefined for a
 * hand-built entry that carries no slots, which keeps drawing at the phone width.
 * @internal
 */
export function drawnSlotsOf(p: Pick<PanelRowEntry, 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap: number = ROW_GAP): number | undefined {
  if (p.slots === undefined) return undefined;
  return Math.max(1, Math.min(p.slots, p.settings?.maxSlots ?? p.slots, fitSlots(maxLiveWidth, phoneWidth, gap)));
}

/**
 * A panel's own width in the row: its slots, that many phone widths with the row gap between them, no more than fit in
 * `maxLiveWidth`. A hand-built entry without slots takes the live `phoneWidth`.
 * @public
 * @deprecated Inside a row, `Panel`, `PanelFrame` and `PanelSizeBox` take the slot's drawn size when `size` is left out, and `PanelSummary.size.width` is that width.
 */
export function panelWidthOf(p: Pick<PanelRowEntry, 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap: number = ROW_GAP): number {
  const drawn = drawnSlotsOf(p, phoneWidth, maxLiveWidth, gap);
  return drawn === undefined ? phoneWidth : slotWidth(drawn, phoneWidth, gap);
}
