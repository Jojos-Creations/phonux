/**
 * Pure row-layout arithmetic: the row's centring margin, how many live panels fit, and how wide one may be.
 * Zero DOM imports, so test/panel-layout.test.ts runs it under plain node.
 */
/**
 * The row's centering math. `fixedItemCount` must come from the same array the row renders, never a
 * hand-mirrored copy of its conditions, or a drifted count silently mis-centers the row by half an item.
 * `maxLiveThatFit` is the one "how many fit" answer, so a wider panel lowers the count instead of overflowing.
 * @public
 * @deprecated The row computes its own layout from its tuning; read it as `useProvidePanels(...).rowNumbers`.
 */
export function computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount, liveWidths, reservedWidths }) {
    const { availableForRow, fixedWidth, usedBudget } = rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount, reservedWidths });
    // Stopping at the first width that does not fit answers "how many of THESE fit", which the host's overflow
    // enforcement reads. Only when all fit are phoneWidth slots added: without them an empty `liveWidths` would
    // report 0 rather than how many phone panels fit.
    let runningWidth = 0;
    let fittingCount = 0;
    for (const width of liveWidths) {
        const itemSpan = width + gap;
        if (runningWidth + itemSpan > usedBudget)
            break;
        runningWidth += itemSpan;
        fittingCount++;
    }
    const extraSlots = fittingCount === liveWidths.length ? Math.max(0, Math.floor((usedBudget - runningWidth) / (phoneWidth + gap))) : 0;
    const maxLiveThatFit = Math.max(0, fittingCount + extraSlots);
    const effectiveLiveCount = Math.min(liveWidths.length, maxLiveThatFit);
    let effectiveLiveWidth = 0;
    for (let i = 0; i < effectiveLiveCount; i++)
        effectiveLiveWidth += liveWidths[i] + gap;
    const rowTotalWidth = fixedWidth + effectiveLiveWidth;
    const computedRowMarginLeft = Math.max(0, (availableForRow - rowTotalWidth) / 2);
    return { maxLiveThatFit, effectiveLiveCount, rowTotalWidth, computedRowMarginLeft };
}
/** The row's width, the fixed items' share of it, and what is left for live panels (each counted with its own gap). */
function rowBudget({ containerWidth, phoneWidth, gap, fixedItemCount, reservedWidths }) {
    const availableForRow = Math.max(0, containerWidth - 2 * gap);
    const fixedWidth = reservedWidths === undefined
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
export function computeMaxLiveWidth(input) {
    if (input.containerWidth === 0)
        return Number.POSITIVE_INFINITY;
    return Math.max(input.phoneWidth, rowBudget(input).usedBudget - input.gap);
}
