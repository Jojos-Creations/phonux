/**
 * The dot bar: the row's one ruler drawn small. Every panel the bar counts lies on the ruler in row order, and the window's span on
 * that ruler comes from the scroll alone, so a dot and the oval are one number scaled and cannot disagree with the row. Pure.
 */
import { waitsLeft } from './panelWindow.js';
import { layoutOf, scaledRuler } from './rowModel.js';
import { gridEdgesOf, slotSpanAt } from './rowNumbers.js';
/** The width of a one-phone panel's dot, in px. */
export const DOT_PHONE_PX = 22;
/** The space between two dots, in px. */
export const DOT_GAP_PX = 8;
/** Drops the float noise of scaling, so a dot on a whole slot compares equal to that slot. */
const tidy = (px) => Math.round(px * 1e6) / 1e6;
/**
 * The panels in ruler order. A parked panel lying inside the drawn run waits on the side a step reaches it from, as the window on a
 * ruler is one span. Past an always-shown panel that the rest have moved away from, it keeps its place: that panel rides over it. That
 * panel rides only while the window at `scroll` shows it: scrolled out it is in `gone`, and its dot keeps its own place outside the oval.
 */
function rulerOf(n, entries, slotsOf, scroll) {
    const heldRight = n.held.filter((h) => h.side === 'right');
    const widthOf = new Map([...n.ids.map((id, k) => [id, n.widths[k]]), ...n.held.map((h) => [h.id, h.width])]);
    const hollowOf = (id) => entries.find((e) => e.id === id)?.settings?.hollowDot === true;
    const item = (id, slots, drawn) => ({ id, slots, hollow: hollowOf(id), drawn, shown: drawn && entries.find((e) => e.id === id)?.collapsible === false });
    const items = [];
    for (const e of entries) {
        const w = widthOf.get(e.id);
        if (heldRight.some((h) => h.id === e.id))
            continue;
        if (w !== undefined)
            items.push(item(e.id, slotsOf(w), true));
        else if (e.live === false && e.marker !== true && e.settings?.revealOnScroll !== 'never')
            items.push(item(e.id, Math.max(1, Math.round(e.slots ?? 1)), false));
    }
    for (const id of widthOf.keys())
        if (!items.some((p) => p.id === id) && !heldRight.some((h) => h.id === id))
            items.push(item(id, slotsOf(widthOf.get(id)), true));
    for (const h of heldRight)
        items.push(item(h.id, slotsOf(h.width), true));
    const at = items.flatMap((p, k) => (p.drawn ? [k] : []));
    const first = at[0];
    const last = at[at.length - 1];
    const left = n.held.filter((h) => h.side === 'left').map((h) => h.id);
    const right = heldRight.map((h) => h.id);
    const gone = [];
    if (first === undefined || last === undefined)
        return { items, left, right, gone };
    for (const s of n.stuck) {
        if (items[first].id === s.id)
            left.push(s.id);
        else if (items[last].id === s.id)
            right.push(s.id);
    }
    const rides = (k) => items[k].shown && !left.includes(items[k].id) && !right.includes(items[k].id);
    const grid = gridEdgesOf(n);
    const outOfWindow = (id) => {
        const k = n.ids.indexOf(id);
        if (k < 0)
            return false;
        const span = slotSpanAt(n, k, scroll);
        return span.right <= grid.lo || span.left >= grid.hi;
    };
    if (at.length > 1 && rides(first) && at[1] !== first + 1)
        (outOfWindow(items[first].id) ? gone : left).push(items[first].id);
    if (at.length > 1 && rides(last) && at[at.length - 2] !== last - 1 && !outOfWindow(items[last].id))
        right.push(items[last].id);
    else if (at.length > 1 && rides(last) && at[at.length - 2] !== last - 1)
        gone.push(items[last].id);
    const runAt = at.filter((k) => !left.includes(items[k].id) && !right.includes(items[k].id) && !gone.includes(items[k].id));
    const start = runAt[0];
    const end = runAt[runAt.length - 1];
    if (start === undefined || end === undefined || end === start)
        return { items, left, right, gone };
    const strip = new Set(n.ids);
    const before = (k) => items.slice(0, k).filter((p) => strip.has(p.id)).length;
    const inside = items.slice(start, end + 1).map((p, k) => ({ p, k: k + start }));
    const waiting = inside.filter(({ p }) => !p.drawn);
    const leftWait = waiting.filter(({ k }) => waitsLeft(before(k), n.ids.length)).map(({ p }) => p);
    const rightWait = waiting.filter(({ k }) => !waitsLeft(before(k), n.ids.length)).map(({ p }) => p);
    return { items: [...items.slice(0, start), ...leftWait, ...inside.filter(({ p }) => p.drawn).map(({ p }) => p), ...rightWait, ...items.slice(end + 1)], left, right, gone };
}
/** The bar for a row at `scroll`. `entries` is every panel in row order; one the numbers do not draw counts only while it is parked and can come back. */
export function barOf(n, entries, scroll) {
    const positive = [...n.widths, ...(n.widths.length === 0 ? n.held.map((h) => h.width) : [])].filter((w) => w > 0);
    const phonePx = positive.length === 0 ? 1 : Math.min(...positive);
    const slotsOf = (w) => Math.max(1, Math.round(w / phonePx));
    // A span between two panels is `slots` phones and as many gaps, so the narrowest per-slot span is one phone and one gap.
    const pitches = n.widths.slice(0, -1).map((w, k) => (n.leftOffsets[k + 1] - n.leftOffsets[k]) / slotsOf(w));
    const pitchPx = pitches.length === 0 ? phonePx : Math.min(...pitches);
    const { items, left, right, gone } = rulerOf(n, entries, slotsOf, scroll);
    const l = layoutOf({ panels: items.map((p) => ({ id: p.id, slots: p.slots })), heldLeft: null, phonePx, gapPx: pitchPx - phonePx, windowPx: 0, view: 0 });
    const { gapPx } = l;
    const scale = (DOT_PHONE_PX + DOT_GAP_PX) / pitchPx;
    const placed = new Map(l.drawn.map((p) => [p.id, p]));
    const run = l.drawn.filter((p) => items[p.index].drawn && !left.includes(p.id) && !right.includes(p.id) && !gone.includes(p.id));
    // What the strip holds before the run: the scroll counts it, and a panel the window has left is on the strip as a rider is.
    const before = gone.filter((id) => (run[0] === undefined ? false : placed.get(id).x < run[0].x));
    const room = [...left, ...before].reduce((sum, id) => sum + placed.get(id).w + gapPx, 0);
    const spanOf = items.reduce((sum, p, k) => sum + (p.drawn ? l.drawn[k].w + gapPx : 0), -gapPx);
    // The grid is what a rest shows: the window less its centering. A row that does not fill it shows only its panels.
    const gridPx = Math.max(0, Math.min(spanOf, n.windowWidth - n.rowMarginLeft - n.endPad));
    const from = (run[0]?.x ?? l.drawn.find((p) => items[p.index].drawn)?.x ?? 0) - (run.length === 0 ? 0 : room) + scroll;
    const grid = { left: Math.min(Math.max(from, 0), Math.max(0, l.stripPx - gridPx)), width: gridPx };
    const riders = new Map();
    let edge = grid.left;
    for (const id of left) {
        const p = placed.get(id);
        const x = Math.max(p.x, edge);
        riders.set(id, x);
        edge = x + p.w + gapPx;
    }
    edge = grid.left + grid.width;
    for (const id of [...right].reverse()) {
        const p = placed.get(id);
        const x = Math.min(p.x, edge - p.w);
        riders.set(id, x);
        edge = x - gapPx;
    }
    const { dots, oval } = scaledRuler(l, scale, DOT_GAP_PX, grid, riders);
    const places = dots.map((d, k) => ({ id: d.id, left: tidy(d.left), width: tidy(d.width), hollow: items[k].hollow, riding: riders.has(d.id) }));
    const lastRun = run[run.length - 1];
    return {
        dots: places.sort((a, b) => a.left - b.left),
        oval: items.some((p) => p.drawn) ? { left: tidy(oval.left), width: tidy(oval.width) } : { left: 0, width: 0 },
        width: items.length === 0 ? 0 : tidy(scale * (l.stripPx + gapPx) - DOT_GAP_PX),
        parked: new Set(items.filter((p) => !p.drawn).map((p) => p.id)),
        run: { left: tidy(scale * (run[0]?.x ?? 0)), right: lastRun === undefined ? 0 : tidy(scale * (lastRun.x + lastRun.w + gapPx)) },
        scale,
    };
}
/**
 * The scroll that centers panel `index` in the window, clamped to the row's legal range. Null when the row cannot
 * scroll or the window is not measured: a click on a dot then does nothing.
 */
export function centreScroll(i) {
    if (!(i.maxScroll > 0) || !Number.isFinite(i.windowWidth))
        return null;
    const centre = (i.leftOffsets[i.index] ?? 0) + (i.widths[i.index] ?? 0) / 2;
    return Math.min(Math.max(centre - i.windowWidth / 2, 0), i.maxScroll);
}
