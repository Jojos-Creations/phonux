/**
 * Pure row-layout arithmetic: the row's centring margin, how many live panels fit, and how wide one may be.
 * Zero DOM imports, so test/panel-layout.test.ts runs it under plain node.
 */

/** One row's measurements: what computeRowLayout reads. @public */
export interface RowLayoutInput {
  /** The row container's measured width. The caller measures it, so this function touches no DOM. */
  containerWidth: number;
  /** The default/live phone width -- every FIXED row item is exactly this wide (a permanent column never
   * changes form factor), and it is also the width assumed for a hypothetical slot beyond `liveWidths` --
   * see `maxLiveThatFit`'s own doc comment. */
  phoneWidth: number;
  /** The row's own gap between adjacent items (the exported `GAP`). */
  gap: number;
  /** How many always-rendered (non-collapsible) slots the row holds: a plain count, so this function stays
   * free of the caller's panel state. */
  fixedItemCount: number;
  /**
   * Each LIVE collapsible panel's own width, in row order -- a 'tablet'/'desktop' panel contributes its own
   * (wider) width instead of `phoneWidth`, so it alone lowers how many more panels fit. An empty array (no
   * live panel known yet) still yields the full `phoneWidth`-based ceiling -- see `maxLiveThatFit`.
   */
  liveWidths: readonly number[];
  /**
   * The widths of everything in the row that never parks for room, in row order. When given, they stand in for
   * `fixedItemCount` copies of `phoneWidth`, so a scroll panel beside the parkable ones takes its own width out of
   * the budget. Absent: `fixedItemCount` phone-width items, every 0.1.0 number.
   */
  reservedWidths?: readonly number[];
}

/** How many live panels fit in one row, and where that row starts so it is centered. @public */
export interface RowLayoutResult {
  /**
   * How many live panels the row can show at most: those of `liveWidths` that fit in row order, plus, when all
   * of them fit, however many more `phoneWidth` slots fit in the budget left. With every entry exactly
   * `phoneWidth` this does not depend on `liveWidths.length`, so `[]` (nothing live yet) gives the same ceiling.
   * How many panels whose `overflow` is 'park' may be live at once derives from this; a scrolling row never parks for room.
   */
  maxLiveThatFit: number;
  /** `liveWidths.length`, capped at `maxLiveThatFit`: the centering math's view of what renders. Which
   * entries render is decided by `live`, not here. */
  effectiveLiveCount: number;
  /** The fixed items' width plus the first `effectiveLiveCount` entries' own widths (each plus one gap). */
  rowTotalWidth: number;
  /** The `marginLeft` that centers `rowTotalWidth` in the row's available width, floored at 0 when the fixed
   * items alone are wider. */
  computedRowMarginLeft: number;
}

/**
 * The row's centering math. `fixedItemCount` must come from the same array the row renders, never a
 * hand-mirrored copy of its conditions, or a drifted count silently mis-centers the row by half an item.
 * `maxLiveThatFit` is the one "how many fit" answer, so a wider panel lowers the count instead of overflowing.
 * @public
 */
export function computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveWidths, reservedWidths }: RowLayoutInput): RowLayoutResult {
  const { availableForRow, fixedWidth, usedBudget } = rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount, reservedWidths });

  // Stopping at the first width that does not fit answers "how many of THESE fit", which the host's overflow
  // enforcement reads. Only when all fit are phoneWidth slots added: without them an empty `liveWidths` would
  // report 0 rather than how many phone panels fit.
  let runningWidth = 0;
  let fittingCount = 0;
  for (const width of liveWidths) {
    const itemSpan = width + gap;
    if (runningWidth + itemSpan > usedBudget) break;
    runningWidth += itemSpan;
    fittingCount++;
  }
  const extraSlots = fittingCount === liveWidths.length ? Math.max(0, Math.floor((usedBudget - runningWidth) / (phoneWidth + gap))) : 0;
  const maxLiveThatFit = Math.max(0, fittingCount + extraSlots);

  const effectiveLiveCount = Math.min(liveWidths.length, maxLiveThatFit);
  let effectiveLiveWidth = 0;
  for (let i = 0; i < effectiveLiveCount; i++) effectiveLiveWidth += liveWidths[i]! + gap;
  const rowTotalWidth = fixedWidth + effectiveLiveWidth;
  const computedRowMarginLeft = Math.max(0, (availableForRow - rowTotalWidth) / 2);
  return { maxLiveThatFit, effectiveLiveCount, rowTotalWidth, computedRowMarginLeft };
}

/** The row's width, the fixed items' share of it, and what is left for live panels (each counted with its own gap). */
function rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount, reservedWidths }: Omit<RowLayoutInput, 'liveWidths'>) {
  const availableForRow = Math.max(0, containerWidth - 2 * gap);
  const fixedWidth =
    reservedWidths === undefined
      ? fixedItemCount * phoneWidth + (fixedItemCount - 1) * gap
      : reservedWidths.reduce((sum, width) => sum + width, 0) + (reservedWidths.length - 1) * gap;
  return { availableForRow, fixedWidth, usedBudget: availableForRow - fixedWidth };
}

/**
 * The widest ONE live panel can be beside the fixed items and still fit: `computeRowLayout`'s live budget less
 * that panel's gap. `panelWidthOf` caps a tablet/desktop panel at this, so its tier width is a maximum and a
 * wide panel never overflows a narrow window. Never below `phoneWidth`: when not even a phone fits, a narrower
 * "tablet" would not fit either. Infinity while unmeasured (`containerWidth` 0), as every reader treats 0.
 * @internal
 */
export function computeMaxLiveWidth(input: Omit<RowLayoutInput, 'liveWidths'>): number {
  if (input.containerWidth === 0) return Number.POSITIVE_INFINITY;
  return Math.max(input.phoneWidth, rowBudget(input).usedBudget - input.gap);
}
