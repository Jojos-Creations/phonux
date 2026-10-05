/**
 * Panel tiers: each form factor's own size, and the one rule for how wide a panel is in the row. Pure, and
 * free of live device state, so the row's state functions stay pure too.
 */
import { DEFAULT_PHONE_SIZE } from './hostApi.js';
/**
 * The size every panel starts at: the phone tier at the built-in phone size.
 * @public
 */
export const DEFAULT_PANEL_SIZE = Object.freeze({ formFactor: 'phone', width: DEFAULT_PHONE_SIZE.width, height: DEFAULT_PHONE_SIZE.height });
/**
 * Each tier's own size. The 'phone' entry is only a placeholder: a phone panel renders at the live phone size.
 * 'fill' is the row's own height. Frozen because every panel starts out referencing these same objects.
 * @public
 */
export const TIER_SIZES = Object.freeze({
    phone: DEFAULT_PANEL_SIZE,
    tablet: Object.freeze({ formFactor: 'tablet', width: 768, height: 'fill' }),
    desktop: Object.freeze({ formFactor: 'desktop', width: 1200, height: 'fill' }),
});
/**
 * A panel's own width in the row. A phone panel always takes the live `phoneWidth`, never its stored size, which
 * is only a placeholder. A tablet or desktop panel takes its stored width, capped at `maxLiveWidth` so it always
 * fits beside the row's fixed columns.
 * @public
 */
export function panelWidthOf(p, phoneWidth, maxLiveWidth) {
    return (p.formFactor ?? 'phone') === 'phone' ? phoneWidth : Math.min(p.size?.width ?? phoneWidth, maxLiveWidth);
}
