/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent } from './panelRowEntry.js';
import { panelWidthOf } from './panelTiers.js';
import { parksForRoom } from './panelWindow.js';
/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the 0.1.0 numbers
 * (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centres only a strip that fits.
 * @public
 * @deprecated The provider computes the row's numbers from its tuning; read them as `useProvidePanels(...).rowNumbers`.
 */
export function computeRowNumbers(i) {
    const present = i.entries.filter(isPresent);
    // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
    // and would turn every hand-built row into a scrolling one.
    const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
    const measured = i.containerWidth !== 0;
    const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
    const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
    const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount });
    const widths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
    const parks = present.map((p) => parksForRoom(p));
    const parkLiveWidths = widths.filter((_, k) => parks[k]);
    const reservedWidths = widths.filter((_, k) => !parks[k]);
    const stripWidth = widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * i.gap;
    const leftOffsets = [];
    let running = 0;
    for (const width of widths) {
        leftOffsets.push(running);
        running += width + i.gap;
    }
    const overflows = rowScroll && measured && stripWidth > windowWidth;
    // A strip that overflows starts flush at the window's left: a centring margin would show as blank room at scroll 0 and
    // push every grid stop off the panel starts.
    let rowMarginLeft;
    if (!rowScroll) {
        rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]] : [])) }).computedRowMarginLeft;
    }
    else {
        rowMarginLeft = !measured || overflows ? 0 : (windowWidth - stripWidth) / 2;
    }
    const stepStops = i.wholePanels === true && overflows ? stepGrid(stripWidth - windowWidth, i.phoneWidth + i.gap) : [];
    const stops = stepStops;
    const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, windowWidth));
    return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops, stopSpans, endPad: 0 };
}
/** The drawn entries a window at scroll `at` shows: the first one its right edge passes and one past the last one its left edge reaches. */
function spanAt(at, widths, offsets, rowMarginLeft, windowWidth) {
    let first = 0;
    while (first < widths.length - 1 && rowMarginLeft + offsets[first] + widths[first] <= at)
        first++;
    let end = first + 1;
    while (end < widths.length && rowMarginLeft + offsets[end] < at + windowWidth)
        end++;
    return { first, end };
}
/**
 * Every phone width from scroll 0 up to `maxScroll`, then `maxScroll` itself: a step moves one phone width, and the last one
 * moves the rest. Empty when the row does not scroll.
 */
function stepGrid(maxScroll, step) {
    if (maxScroll <= 0)
        return [];
    const grid = [];
    for (let at = 0; at < maxScroll; at += step)
        grid.push(at);
    grid.push(maxScroll);
    return grid;
}
/**
 * The index in `n.stops` of the stop to rest at to show panel `index` whole: of the stops whose panels include it, drawn at its
 * full width, the one nearest `target`. Of stops that share a position, the earliest. -1 when the row has no such stop. @internal
 */
export function snapToStopIndex(n, index, target) {
    let best = -1;
    for (const [k, span] of n.stopSpans.entries()) {
        if (index < span.first || index >= span.end)
            continue;
        if (best < 0 || Math.abs(n.stops[k] - target) < Math.abs(n.stops[best] - target))
            best = k;
    }
    return best;
}
/**
 * The stop to rest at to show panel `index` whole: where `snapToStopIndex` points, `target` itself when the row has none. @internal
 */
export function snapToStop(n, index, target) {
    const k = snapToStopIndex(n, index, target);
    return k < 0 ? target : n.stops[k];
}
/** The stop of `n` nearest `at`; `at` itself when the row has none. @internal */
export function nearestStop(n, at) {
    let best = at;
    for (const [k, stop] of n.stops.entries())
        if (k === 0 || Math.abs(stop - at) < Math.abs(best - at))
            best = stop;
    return best;
}
/**
 * The `scrollLeft` that puts the pinned edge of entry `k` back at `edge` px from the window's left, with `n`'s margin, offset and
 * width: its right edge when the width was pinned at its end (a left grabber), its left edge when pinned at its start. `at` itself
 * when the entry is not in `n`. @internal
 */
export function scrollHoldingEdge(n, k, pin, edge, at) {
    if (k < 0 || k >= n.ids.length)
        return at;
    const left = n.rowMarginLeft + n.leftOffsets[k];
    return (pin === 'end' ? left + n.widths[k] : left) - edge;
}
/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n) {
    return Number.isFinite(n.windowWidth) ? Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth) : 0;
}
