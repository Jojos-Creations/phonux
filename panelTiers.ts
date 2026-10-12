/**
 * Panel tiers: each form factor's own size, and the one rule for how wide a panel is in the row. Pure, and
 * free of live device state, so the row's state functions stay pure too.
 */
import { DEFAULT_PHONE_SIZE, type FormFactor, type PanelSize } from './hostApi.js';
import type { PanelRowEntry } from './panelRowEntry.js';
import { ROW_GAP, fitSlots, slotWidth } from './rowConstants.js';

/**
 * The size every panel starts at: the phone tier at the built-in phone size.
 * @public
 */
export const DEFAULT_PANEL_SIZE: PanelSize = Object.freeze({ formFactor: 'phone', width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height });

/**
 * Each tier's own size. The 'phone' entry is only a placeholder: a phone panel renders at the live phone size.
 * 'fill' is the row's own height. Frozen because every panel starts out referencing these same objects.
 * @public
 */
export const TIER_SIZES: Readonly<Record<FormFactor, PanelSize>> = Object.freeze({
  phone: DEFAULT_PANEL_SIZE,
  tablet: Object.freeze({ formFactor: 'tablet', width: 768, height: 'fill' }),
  desktop: Object.freeze({ formFactor: 'desktop', width: 1200, height: 'fill' }),
});

/**
 * The slots a panel is drawn at: its `slots` (at most its `maxSlots`) capped at what fits in `maxLiveWidth`; undefined for a
 * hand-built entry that carries no slots, which keeps drawing at its tier's width.
 * @internal
 */
export function drawnSlotsOf(p: Pick<PanelRowEntry, 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap: number = ROW_GAP): number | undefined {
  if (p.slots === undefined) return undefined;
  return Math.max(1, Math.min(p.slots, p.settings?.maxSlots ?? p.slots, fitSlots(maxLiveWidth, phoneWidth, gap)));
}

/**
 * A panel's own width in the row. A panel with slots is that many phone widths with the row gap between them, no more
 * than fit in `maxLiveWidth`. A hand-built entry without slots keeps the older rule: a phone panel takes the live
 * `phoneWidth`, a tablet or desktop panel its stored width capped at `maxLiveWidth`.
 * @public
 */
export function panelWidthOf(p: Pick<PanelRowEntry, 'formFactor' | 'size' | 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap: number = ROW_GAP): number {
  const drawn = drawnSlotsOf(p, phoneWidth, maxLiveWidth, gap);
  if (drawn !== undefined) return slotWidth(drawn, phoneWidth, gap);
  return (p.formFactor ?? 'phone') === 'phone' ? phoneWidth : Math.min(p.size?.width ?? phoneWidth, maxLiveWidth);
}
