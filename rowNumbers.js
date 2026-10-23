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
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
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
    const allWidths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
    const admitted = rowScroll && measured ? admitHolds(present, allWidths, i.gap, i.phoneWidth, windowWidth) : [];
    const admittedKs = new Set(admitted.map((a) => a.k));
    // Only the left and right holds take a group in flow; a 'both' panel stays in the strip and sticks where it is drawn.
    const edges = admitted.flatMap((a) => (a.hold === 'both' ? [] : [{ k: a.k, side: a.hold }]));
    const { leftInset, rightInset, held } = edgeGroups(edges, present, allWidths, i.gap);
    const heldAt = new Set(edges.map((e) => e.k));
    const strip = present.flatMap((p, k) => (heldAt.has(k) ? [] : [{ p, k }]));
    const ids = strip.map((x) => x.p.id);
    const widths = strip.map((x) => allWidths[x.k]);
    const stripWidth = contentLength(widths, i.gap);
    const stripWindow = windowWidth - leftInset - rightInset;
    const leftOffsets = [];
    let running = 0;
    for (const width of widths) {
        leftOffsets.push(running);
        running += width + i.gap;
    }
    const overflows = rowScroll && measured && stripWidth > stripWindow;
    // A strip that overflows starts flush at the window's left: a centring margin would show as blank room at scroll 0 and
    // push every grid stop off the panel starts.
    let rowMarginLeft;
    if (!rowScroll) {
        rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [allWidths[k]] : [])) }).computedRowMarginLeft;
    }
    else {
        rowMarginLeft = !measured || overflows ? 0 : (windowWidth - stripWidth) / 2;
    }
    // A 'both' panel keeps clear of the fixed groups and of the 'both' panels that stack on its edge. Scroll pins an earlier one
    // whenever it pins a later one, so the stack on the left runs in row order from the left group, and on the right it runs in
    // row order from the right group: the outermost panel of each stack sits nearest the window edge.
    const bothKs = admitted.filter((a) => a.hold === 'both').map((a) => a.k);
    const stacked = (ks) => ks.reduce((sum, k) => sum + allWidths[k] + i.gap, 0);
    const stuck = bothKs.map((k, j) => ({
        id: present[k].id,
        left: leftInset + stacked(bothKs.slice(0, j)),
        right: rightInset + i.gap + stacked(bothKs.slice(j + 1)),
    }));
    const stepStops = i.wholePanels === true && overflows ? stepGrid(stripWidth - stripWindow, i.phoneWidth + i.gap) : [];
    const stops = stepStops;
    const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, stripWindow));
    // A panel the row admits is never parked for room, whether it is held or sticks in the strip.
    const reservedWidths = [...present.flatMap((p, k) => (admittedKs.has(k) || parksForRoom(p) ? [] : [allWidths[k]])), ...admitted.map((a) => allWidths[a.k])];
    const parkLiveWidths = present.flatMap((p, k) => (admittedKs.has(k) || !parksForRoom(p) ? [] : [allWidths[k]]));
    return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids, widths, leftOffsets, held, stuck, leftInset, rightInset, stripStart: leftInset + rowMarginLeft, stripWindow, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops, stopSpans, endPad: 0 };
}
/** The length of `widths` laid end to end with one gap between each two: 0 for none. */
function contentLength(widths, gap) {
    return widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * gap;
}
/**
 * The panels admitted to an edge, in row order, or none. A candidate joins while the window keeps at least one phone's width of
 * strip beside every admitted panel; one that cannot fit lets go and scrolls with the strip. The admissions stand only while the
 * strip without them still overflows the window that remains, so a row that would not scroll releases them all.
 */
function admitHolds(present, allWidths, gap, phoneWidth, windowWidth) {
    const picked = [];
    for (const [k, p] of present.entries()) {
        const hold = p.settings?.edgeHold;
        if (hold !== 'left' && hold !== 'right' && hold !== 'both')
            continue;
        const side = hold === 'right' ? 'right' : 'left';
        const { leftInset, rightInset } = insetsOf([...picked, { k, side }], allWidths, gap);
        if (windowWidth - leftInset - rightInset >= phoneWidth)
            picked.push({ k, hold, side });
    }
    if (picked.length === 0)
        return [];
    const { leftInset, rightInset } = insetsOf(picked, allWidths, gap);
    const heldK = new Set(picked.map((e) => e.k));
    const restWidths = allWidths.filter((_, k) => !heldK.has(k));
    return contentLength(restWidths, gap) > windowWidth - leftInset - rightInset ? picked : [];
}
/** The widths the two edge groups take in flow for `picks`: the left group with its trailing gap, the right with its leading one. */
function insetsOf(picks, allWidths, gap) {
    const left = picks.filter((e) => e.side === 'left').map((e) => allWidths[e.k]);
    const right = picks.filter((e) => e.side === 'right').map((e) => allWidths[e.k]);
    return { leftInset: left.length === 0 ? 0 : contentLength(left, gap) + gap, rightInset: right.length === 0 ? 0 : gap + contentLength(right, gap) };
}
/** The group sizes and each held panel's x inside its group, left group first in row order, then the right. */
function edgeGroups(edges, present, allWidths, gap) {
    const { leftInset, rightInset } = insetsOf(edges, allWidths, gap);
    const held = [];
    let x = 0;
    for (const e of edges) {
        if (e.side !== 'left')
            continue;
        held.push({ id: present[e.k].id, side: 'left', width: allWidths[e.k], offset: x });
        x += allWidths[e.k] + gap;
    }
    x = gap;
    for (const e of edges) {
        if (e.side !== 'right')
            continue;
        held.push({ id: present[e.k].id, side: 'right', width: allWidths[e.k], offset: x });
        x += allWidths[e.k] + gap;
    }
    return { leftInset, rightInset, held };
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
    const left = n.stripStart + n.leftOffsets[k];
    return (pin === 'end' ? left + n.widths[k] : left) - edge;
}
/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n) {
    return Number.isFinite(n.windowWidth) ? Math.max(0, n.stripStart + n.stripWidth + n.rightInset + n.endPad - n.windowWidth) : 0;
}
