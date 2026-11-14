/**
 * The row's position model: one ordered list of every panel on one continuous ruler, and one number, `view`, for where the
 * window sits on it. Everything else (where a panel is on screen, which panels are shown, parked or held, where the dots are)
 * is derived from those two and never stored. Pure: no DOM, no React, no animation state.
 */
/** Positions within this many px are the same position; the arithmetic is exact for integers and this absorbs a centering half-pixel. */
export const EPS_PX = 0.5;
/** How little of a panel may be missing from the grid and still count as shown: the tolerance plus a margin over the float noise of scaling it to a dot. */
export const SHOWN_TOLERANCE_PX = EPS_PX + 1e-6;
const widthOf = (slots, phonePx, gapPx) => slots * phonePx + (slots - 1) * gapPx;
export function layoutOf(m) {
    const pitchPx = m.phonePx + m.gapPx;
    const drawn = [];
    let x = 0;
    let totalSlots = 0;
    m.panels.forEach((p, index) => {
        if (p.hidden === true)
            return;
        const w = widthOf(p.slots, m.phonePx, m.gapPx);
        drawn.push({ id: p.id, index, slots: p.slots, x, w });
        x += w + m.gapPx;
        totalSlots += p.slots;
    });
    const stripPx = drawn.length === 0 ? 0 : x - m.gapPx;
    const first = drawn[0];
    // A hold that leaves less than a phone of room is a plain first panel, so a narrowing window never needs a second code path.
    const held = first !== undefined && first.id === m.heldLeft && first.w + pitchPx <= m.windowPx ? first : null;
    // The right hold is the mirror: the last drawn panel, with a phone's room left beside it and beside any left-held panel.
    const last = drawn[drawn.length - 1];
    const leftEdge = held === null ? 0 : held.w + m.gapPx;
    const heldRight = last !== undefined && last.id === m.heldRight && last !== held && last.w + pitchPx + leftEdge <= m.windowPx ? last : null;
    const fits = stripPx <= m.windowPx;
    const wholeSlots = Math.max(1, Math.floor((m.windowPx + m.gapPx) / pitchPx));
    // The centering depends on the window and the strip alone, never on the hold, so a hold flip cannot change where a rest is.
    const centerPx = fits ? (m.windowPx - stripPx) / 2 : Math.max(0, (m.windowPx + m.gapPx - wholeSlots * pitchPx) / 2);
    const lastStop = fits ? 0 : Math.max(0, totalSlots - wholeSlots);
    const stops = [];
    for (let n = 0; n <= lastStop; n += 1)
        stops.push(n * pitchPx - centerPx);
    const rightEdge = heldRight === null ? 0 : heldRight.w + m.gapPx;
    return { drawn, pitchPx, gapPx: m.gapPx, stripPx, held, heldRight, windowPx: m.windowPx, centerPx, lo: centerPx + leftEdge, hi: m.windowPx - centerPx - rightEdge, stops };
}
const clampTo = (v, low, high) => Math.min(high, Math.max(low, v));
function clampView(l, v) {
    const low = l.stops[0];
    const high = l.stops[l.stops.length - 1];
    return low === undefined || high === undefined ? v : clampTo(v, low, high);
}
/** Where `p` is in the window; a held panel never leaves its edge. */
function screenAt(l, view, p) {
    const s = p.x - view;
    if (l.held !== null && p.id === l.held.id)
        return Math.max(s, 0);
    return l.heldRight !== null && p.id === l.heldRight.id ? Math.min(s, l.windowPx - p.w) : s;
}
const isHeld = (l, p) => p.id === l.held?.id || p.id === l.heldRight?.id;
export function screenOf(m, id) {
    const l = layoutOf(m);
    const p = l.drawn.find((d) => d.id === id);
    return p === undefined ? undefined : screenAt(l, m.view, p);
}
/**
 * The one on-screen predicate. A panel is shown when all of it lies in the grid less the held panel; one wider than that is shown
 * while it fills it, since no rest can show it whole.
 */
function shownAt(l, view, p) {
    if (isHeld(l, p))
        return true;
    const s = p.x - view;
    const seen = Math.min(s + p.w, l.hi) - Math.max(s, l.lo);
    return seen >= Math.min(p.w, l.hi - l.lo) - SHOWN_TOLERANCE_PX;
}
export function onScreenIds(m) {
    const l = layoutOf(m);
    return l.drawn.filter((p) => shownAt(l, m.view, p)).map((p) => p.id);
}
/** Panels the row need not keep mounted: wholly outside the window by more than the overscan. The held panel is never one. */
export function parkedIds(m) {
    const l = layoutOf(m);
    const overscan = m.overscanPx ?? 0;
    return l.drawn
        .filter((p) => {
        if (isHeld(l, p))
            return false;
        const s = p.x - m.view;
        return s + p.w <= -overscan || s >= m.windowPx + overscan;
    })
        .map((p) => p.id);
}
/**
 * The ruler drawn small: `k` track px to a ruler px, and a dot gap of `dotGapPx`, so a dot's left is its panel's left scaled and its
 * right stops one dot gap short of the next slot. `grid` is the span of the ruler the oval draws, and `riders` the ruler x of each
 * panel that does not sit at its own place, as a held one rides its edge of the window.
 */
export function scaledRuler(l, k, dotGapPx, grid, riders) {
    const oval = { left: k * grid.left, width: k * (grid.width + l.gapPx) - dotGapPx };
    const eps = SHOWN_TOLERANCE_PX * k;
    const dots = l.drawn.map((p) => {
        const left = k * (riders.get(p.id) ?? p.x);
        const width = k * (p.w + l.gapPx) - dotGapPx;
        const seen = Math.min(left + width, oval.left + oval.width) - Math.max(left, oval.left);
        return { id: p.id, left, width, lit: riders.has(p.id) || seen >= Math.min(width, oval.width) - eps };
    });
    return { dots, oval };
}
/** The ruler shrunk to `trackPx`. A dot is lit by the same rule as `onScreenIds`, applied to the scaled numbers. */
export function dotsOf(m, trackPx) {
    const l = layoutOf(m);
    const k = l.stripPx > 0 ? trackPx / l.stripPx : 0;
    const riders = new Map();
    if (l.held !== null)
        riders.set(l.held.id, Math.max(l.held.x, m.view));
    if (l.heldRight !== null)
        riders.set(l.heldRight.id, Math.min(l.heldRight.x, m.view + l.windowPx - l.heldRight.w));
    return scaledRuler(l, k, k * m.gapPx, { left: m.view + l.lo, width: l.hi - l.lo }, riders);
}
export function viewRange(m) {
    const { stops } = layoutOf(m);
    return { min: stops[0], max: stops[stops.length - 1] };
}
/**
 * Takes a list change into the model: `view` moves by what the leftmost kept panel in the grid moved, so what is on screen
 * stays put. `subject` is the panel the caller is moving on purpose and so cannot be the anchor.
 */
function withPanels(m, panels, subject) {
    const before = layoutOf(m);
    const heldLeft = m.heldLeft !== null && panels.some((p) => p.id === m.heldLeft) ? m.heldLeft : null;
    const heldRight = m.heldRight != null && panels.some((p) => p.id === m.heldRight) ? m.heldRight : null;
    const next = { ...m, panels, heldLeft, heldRight };
    const after = layoutOf(next);
    const afterX = new Map(after.drawn.map((p) => [p.id, p.x]));
    const kept = before.drawn.filter((p) => afterX.has(p.id) && p.id !== subject && !isHeld(before, p) && !isHeld(after, p));
    const anchor = kept.find((p) => shownOverlap(before, m.view, p)) ?? kept[0];
    const shift = anchor === undefined ? 0 : afterX.get(anchor.id) - anchor.x;
    return { ...next, view: clampView(after, m.view + shift) };
}
const shownOverlap = (l, view, p) => Math.min(p.x - view + p.w, l.hi) - Math.max(p.x - view, l.lo) > EPS_PX;
// The same id in both fields is one state, a panel held at whichever edge of the list it is at. A panel that is first binds the
// floor and not the ceiling, so the right hold is read as none while it is first; one that is last binds the ceiling, which wins
// the clamp over the floor it also sets, so the left hold needs no such rule.
const rightHeldIn = (m, panels) => m.heldRight != null && !(m.heldRight === m.heldLeft && panels[0]?.id === m.heldRight) ? m.heldRight : null;
/** The lowest index a list change may use: nothing goes in front of the held panel. */
function floorIndex(m, panels) {
    const at = m.heldLeft === null ? -1 : panels.findIndex((p) => p.id === m.heldLeft);
    return at < 0 ? 0 : at + 1;
}
/** The highest index a list change may use: nothing goes after the right-held panel. */
function ceilingIndex(m, panels) {
    const held = rightHeldIn(m, panels);
    const at = held === null ? -1 : panels.findIndex((p) => p.id === held);
    return at < 0 ? panels.length : at;
}
export function open(m, panel, index = m.panels.length) {
    if (m.panels.some((p) => p.id === panel.id))
        return m;
    const at = clampTo(index, floorIndex(m, m.panels), ceilingIndex(m, m.panels));
    return withPanels(m, [...m.panels.slice(0, at), panel, ...m.panels.slice(at)], panel.id);
}
export function close(m, id) {
    return m.panels.some((p) => p.id === id) ? withPanels(m, m.panels.filter((p) => p.id !== id)) : m;
}
/** Moves `id` so it ends at `to` in the new list. A held panel does not move, and nothing moves in front of the left-held one or after the right-held one. */
export function reorder(m, id, to) {
    const from = m.panels.findIndex((p) => p.id === id);
    if (from < 0 || id === m.heldLeft || id === m.heldRight)
        return m;
    const rest = m.panels.filter((p) => p.id !== id);
    const at = clampTo(to, floorIndex(m, rest), ceilingIndex(m, rest));
    return withPanels(m, [...rest.slice(0, at), m.panels[from], ...rest.slice(at)], id);
}
export function resize(m, id, slots) {
    const s = Math.max(1, Math.round(slots));
    if (!m.panels.some((p) => p.id === id && p.slots !== s))
        return m;
    return withPanels(m, m.panels.map((p) => (p.id === id ? { ...p, slots: s } : p)));
}
/** Holds `id` at the left edge, or lets go with null. Only the first drawn panel can be held. */
export function hold(m, id) {
    if (id === null)
        return m.heldLeft === null ? m : { ...m, heldLeft: null };
    const first = layoutOf(m).drawn[0];
    return first !== undefined && first.id === id && m.heldLeft !== id ? { ...m, heldLeft: id } : m;
}
/** Holds `id` at the right edge, or lets go with null. Only the last drawn panel can be held there. */
export function holdRight(m, id) {
    if (id === null)
        return m.heldRight == null ? m : { ...m, heldRight: null };
    const drawn = layoutOf(m).drawn;
    const last = drawn[drawn.length - 1];
    return last !== undefined && last.id === id && m.heldRight !== id ? { ...m, heldRight: id } : m;
}
/**
 * Holds `id` at whichever edge of the list it is at, or lets go with null: one state, so a list change cannot drop one edge of it.
 * Only the first or the last drawn panel can be held this way; any other is left as it was.
 */
export function holdBoth(m, id) {
    if (id === null)
        return m.heldLeft === null && m.heldRight == null ? m : { ...m, heldLeft: null, heldRight: null };
    const drawn = layoutOf(m).drawn;
    const edge = drawn[0]?.id === id || drawn[drawn.length - 1]?.id === id;
    return edge ? { ...m, heldLeft: id, heldRight: id } : m;
}
/** A window change keeps every panel where it is; the grid moves under it, so call `settle` to land on a rest. */
export function setWindow(m, windowPx) {
    const next = { ...m, windowPx };
    return { ...next, view: clampView(layoutOf(next), m.view) };
}
/** One slot toward `dir`: the next rest in that direction, and no move when there is none. */
export function step(m, dir) {
    const { stops } = layoutOf(m);
    const to = dir === 1 ? stops.find((s) => s > m.view + EPS_PX) : [...stops].reverse().find((s) => s < m.view - EPS_PX);
    return to === undefined ? m : { ...m, view: to };
}
/** A drag by `dx` screen px: the content follows the pointer, held inside the range of rests. */
export function dragBy(m, dx) {
    return { ...m, view: clampView(layoutOf(m), m.view - dx) };
}
/** The nearest rest: what a release or a window change lands on. The earlier rest wins a tie. */
export function settle(m) {
    const { stops } = layoutOf(m);
    let best;
    for (const s of stops)
        if (best === undefined || Math.abs(s - m.view) < Math.abs(best - m.view))
            best = s;
    return best === undefined ? m : { ...m, view: best };
}
export function atRest(m) {
    return layoutOf(m).stops.some((s) => Math.abs(s - m.view) <= EPS_PX);
}
