// A start within this of the base is the base itself: a glide ends on a fractional value.
const SAME_STOP_PX = 0.5;
const clamp = (value, max) => Math.min(max, Math.max(0, value));
/**
 * The `scrollLeft` that shows a panel. `left` is the panel's left edge in scroll coordinates (gap + the row's left
 * margin of the same commit + its offset). The window is `scrollLeft + gap` to `scrollLeft + clientWidth - gap`;
 * 'into-view' moves the least distance that puts the whole panel inside it (the left edge wins for a panel wider than
 * the window). The result is clamped to `[0, maxScroll]`, the strip's bound from the row numbers.
 */
export function scrollTargetFor(i) {
    let target;
    if (i.align === 'start')
        target = i.left - i.gap;
    else if (i.align === 'center')
        target = i.left + i.width / 2 - i.clientWidth / 2;
    else if (i.left < i.scrollLeft + i.gap)
        target = i.left - i.gap;
    else if (i.left + i.width > i.scrollLeft + i.clientWidth - i.gap)
        target = Math.min(i.left + i.width - i.clientWidth + i.gap, i.left - i.gap);
    else
        target = i.scrollLeft;
    return clamp(target, i.maxScroll);
}
/**
 * The stop one step from `base` toward `direction`: the next panel start past it, held to `[0, maxScroll]`. Null at the
 * strip's end. `panelStarts` are the panels' left edges less the gap, ascending.
 */
export function stepTarget(direction, base, panelStarts, maxScroll) {
    if (direction === 'right') {
        const next = panelStarts.find((start) => start > base + SAME_STOP_PX);
        const target = clamp(next ?? maxScroll, maxScroll);
        return target > base + SAME_STOP_PX ? target : null;
    }
    const before = panelStarts.filter((start) => start < base - SAME_STOP_PX);
    const target = clamp(before.length === 0 ? 0 : before[before.length - 1], maxScroll);
    return target < base - SAME_STOP_PX ? target : null;
}
/**
 * What one step does. The nearest hidden panel in the direction (past the window's edge) is shown when its policy
 * allows and no live panel lies between the window's edge and its slot, so a held panel is never reached by skipping
 * live ones; an engine-parked one under 'edges' also needs no live panel beyond the window on that side. Otherwise
 * the row scrolls one panel start, and with neither there is nothing to do.
 */
export function gestureTarget(i) {
    const windowLeft = i.base + i.gap;
    const windowRight = i.base + i.clientWidth - i.gap;
    const lefts = i.liveStarts.map((start) => start + i.gap);
    const overlaps = lefts.map((left, k) => left < windowRight && left + i.liveWidths[k] > windowLeft);
    const firstInView = overlaps.indexOf(true);
    const lastInView = overlaps.lastIndexOf(true);
    const count = i.liveStarts.length;
    // With nothing in view every hidden panel is on both sides; the nearest one wins.
    const sideRight = (h) => h.liveBefore > lastInView;
    const sideLeft = (h) => h.liveBefore <= (firstInView < 0 ? count : firstInView);
    const candidates = i.hidden.filter((h) => h.policy !== 'never' && (i.direction === 'right' ? sideRight(h) : sideLeft(h)));
    if (candidates.length > 0) {
        const nearest = candidates.reduce((best, h) => (i.direction === 'right' ? (h.liveBefore < best.liveBefore ? h : best) : h.liveBefore >= best.liveBefore ? h : best));
        const between = i.direction === 'right' ? nearest.liveBefore - 1 - lastInView : (firstInView < 0 ? count : firstInView) - nearest.liveBefore;
        const beyondWindow = i.direction === 'right' ? count - 1 - lastInView : firstInView;
        const reachable = nearest.held || nearest.policy === 'any' ? between <= 0 : between <= 0 && beyondWindow <= 0;
        if (reachable)
            return { kind: 'show', id: nearest.id };
    }
    const to = stepTarget(i.direction, i.base, i.stops !== undefined && i.stops.length > 0 ? i.stops : i.liveStarts, i.maxScroll);
    return to === null ? { kind: 'none' } : { kind: 'scroll', to };
}
