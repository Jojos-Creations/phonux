/**
 * Pure row-layout arithmetic, shared by the renderer's row shell (client/src/desktop/row/useRowShell.ts), its
 * panel manager (client/src/desktop/panels/usePanelManager.ts) and SettingsAPI's fit count
 * (client/src/desktop/settings/useProvideSettings.ts). Zero Electron/DOM imports, so this is directly
 * unit-testable under plain node (test/panel-layout.test.ts).
 */

export interface RowLayoutInput {
  /** The row container's measured width (useRowShell.ts's ResizeObserver);
   * the DOM wiring stays there so this function has none. */
  containerWidth: number;
  /** The default/live phone width -- every FIXED row item is exactly this wide (a permanent column never
   * changes form factor), and it is also the width assumed for a hypothetical slot beyond `liveWidths` --
   * see `maxLiveThatFit`'s own doc comment. */
  phoneWidth: number;
  /** The row's own gap between adjacent items (PanelRowSlot's `GAP`). */
  gap: number;
  /**
   * How many always-rendered (non-collapsible) slots the row holds before any
   * live panels -- History today. A plain count so this function stays free
   * of the caller's panel state.
   */
  fixedItemCount: number;
  /**
   * Each LIVE collapsible panel's own width, in row order -- a 'tablet'/'desktop' panel contributes its own
   * (wider) width instead of `phoneWidth`, so it alone lowers how many more panels fit. An empty array (no
   * live panel known yet) still yields the full `phoneWidth`-based ceiling -- see `maxLiveThatFit`.
   */
  liveWidths: readonly number[];
}

export interface RowLayoutResult {
  /**
   * How many live panels the row can show at most: every entry already in `liveWidths` is assumed to already
   * fit (it is already live), plus however many MORE default-`phoneWidth` slots still fit in whatever budget
   * is left over. When every entry is exactly `phoneWidth` this is independent of `liveWidths.length` --a
   * live panel then "spends" exactly what a hypothetical one would have -- so passing `[]` (nothing live yet)
   * recovers the same ceiling as passing any number of phoneWidth-only entries. usePanelManager.ts's
   * `capacity` and SettingsAPI's `fitCount` are both derived from this.
   */
  maxLiveThatFit: number;
  /** `liveWidths.length`, capped at `maxLiveThatFit` -- what the row actually
   * renders width-wise (rendering itself is still driven by which entries are
   * live elsewhere; this is only the centering math's own capped view of it). */
  effectiveLiveCount: number;
  /** The fixed items' width plus the first `effectiveLiveCount` entries' own widths (each plus one gap). */
  rowTotalWidth: number;
  /** The `marginLeft` that centers `rowTotalWidth` inside the row's
   * available width -- floored at 0 when the fixed items alone are wider
   * than that. */
  computedRowMarginLeft: number;
}

/**
 * The row's centering math. `fixedItemCount` must come from the same array the row's JSX renders,
 * never a hand-mirrored copy of its conditions, or a drifted count mis-centers the row by half an
 * item, silently. `maxLiveThatFit` is the one "how many fit" function both usePanelManager.ts's
 * `capacity` and SettingsAPI's `fitCount` derive from, so a wider panel lowers the count instead of
 * overflowing unnoticed.
 */
export function computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveWidths }: RowLayoutInput): RowLayoutResult {
  const { availableForRow, fixedWidth, usedBudget } = rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount });

  // Walk the given widths in row order, in the budget they already occupy (each already live, so each has
  // already "passed" this once) -- stopping at the first one that would not is how a caller asks "how many of
  // THESE actually fit" (usePanelManager's own overflow enforcement reads exactly that case). Only when the
  // WHOLE array fits is there budget left to extend with hypothetical phoneWidth-sized slots for whatever
  // isn't live yet -- without this extension, an empty `liveWidths` (nothing live yet) would report a ceiling
  // of 0 rather than "how many phoneWidth panels would fit here".
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
function rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount }: Omit<RowLayoutInput, 'liveWidths'>) {
  const availableForRow = Math.max(0, containerWidth - 2 * gap);
  const fixedWidth = fixedItemCount * phoneWidth + (fixedItemCount - 1) * gap;
  return { availableForRow, fixedWidth, usedBudget: availableForRow - fixedWidth };
}

/**
 * The widest ONE live panel can be beside the fixed items and still fit: `computeRowLayout`'s own live budget
 * less that panel's gap. A tablet/desktop panel is capped here (panelWindow.ts's `panelWidthOf`), so its tier
 * width is a maximum and a wide panel never overflows a narrow window. Never below `phoneWidth`: when not even
 * a phone fits, a narrower "tablet" would not fit either. Infinity while unmeasured (`containerWidth` 0), the
 * same reading usePanelManager and SettingsAPI give it: no cap before the first measurement.
 */
export function computeMaxLiveWidth(input: Omit<RowLayoutInput, 'liveWidths'>): number {
  if (input.containerWidth === 0) return Number.POSITIVE_INFINITY;
  return Math.max(input.phoneWidth, rowBudget(input).usedBudget - input.gap);
}
