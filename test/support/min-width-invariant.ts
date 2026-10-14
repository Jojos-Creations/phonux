/**
 * The guarantee `PanelsAPI.minWorkspaceWidth` makes, checked against the phone the row actually draws at that width. Any
 * code that changes how wide a phone is drawn (a phone fitted to the window included) runs its drawn phone through this
 * at the reported minimum, because the minimum is only true for the phone it is drawn with.
 */
import { computeMaxLiveWidth, computeRowLayout } from '../../panelRowLayout.js';
import { TIER_SIZES } from '../../panelTiers.js';

export interface MinWidthCase {
  /** The row container width under test: the reported minimum. */
  containerWidth: number;
  /** The phone width the row draws at `containerWidth`, not the width the minimum was priced from. */
  drawnPhoneWidth: number;
  fixedColumnCount: number;
  gap: number;
  /** Default 2. */
  phoneSlots?: number;
  /** Default the tier table's 768; 0 checks the phones alone. */
  tabletWidth?: number;
}

export interface MinWidthVerdict {
  /** How many phone slots fit beside the fixed columns. */
  phonesThatFit: number;
  /** The widest one panel may be drawn beside the fixed columns. */
  maxLiveWidth: number;
  phonesFit: boolean;
  tabletFits: boolean;
  /** Both: the guarantee holds at this width. */
  holds: boolean;
}

export function checkMinWidth(c: MinWidthCase): MinWidthVerdict {
  const phoneSlots = c.phoneSlots ?? 2;
  const tabletWidth = c.tabletWidth ?? TIER_SIZES.tablet.width;
  const row = { containerWidth: c.containerWidth, phoneWidth: c.drawnPhoneWidth, gap: c.gap, fixedItemCount: c.fixedColumnCount };
  const phonesThatFit = computeRowLayout({ ...row, liveWidths: [] }).maxLiveThatFit;
  const maxLiveWidth = computeMaxLiveWidth(row);
  const phonesFit = phonesThatFit >= phoneSlots;
  const tabletFits = tabletWidth === 0 || maxLiveWidth >= tabletWidth;
  return { phonesThatFit, maxLiveWidth, phonesFit, tabletFits, holds: phonesFit && tabletFits };
}
