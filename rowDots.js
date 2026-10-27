/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centring scroll sit. Internal; `usePanelDots` is the one public door.
 */
/** The width of a one-phone panel's dot, in px. */
export const DOT_PHONE_PX = 22;
/** The space between two dots, in px. */
export const DOT_GAP_PX = 8;
/** A panel `slots` phones wide draws one dot as wide as that many phone dots and the gaps between them. */
const dotWidthOf = (slots) => slots * DOT_PHONE_PX + (slots - 1) * DOT_GAP_PX;
/** The dot bar's map for the row's panels. Dot widths come from the panel's size, not from the track. */
export function dotMap(i) {
    const positive = i.widths.filter((w) => w > 0);
    const unit = positive.length === 0 ? 1 : Math.min(...positive);
    const lefts = [];
    const widths = [];
    const strips = [];
    const spans = [];
    let at = 0;
    i.widths.forEach((w, k) => {
        const slots = Math.max(1, Math.round(w / unit));
        const dot = dotWidthOf(slots);
        const start = i.leftOffsets[k] ?? 0;
        const next = i.leftOffsets[k + 1];
        lefts.push(at);
        widths.push(dot);
        strips.push(start);
        spans.push(next === undefined ? w : next - start);
        at += dot + DOT_GAP_PX;
    });
    // A span between two panels is `slots` phones and as many gaps, so the narrowest per-slot span is one phone and one gap.
    const pitches = spans.slice(0, -1).map((span, k) => span / Math.max(1, Math.round(i.widths[k] / unit)));
    const pitch = pitches.length === 0 ? unit : Math.min(...pitches);
    return { lefts, widths, strips, spans, width: Math.max(0, at - DOT_GAP_PX), pitch, phone: unit };
}
/** The index of the last entry of `starts` that is at or before `at`, 0 when none is. */
function segmentOf(starts, at) {
    let k = 0;
    for (let j = 0; j < starts.length; j++)
        if (starts[j] <= at)
            k = j;
    return k;
}
/** The track width segment `k` covers: its dot, and the dot gap after it unless it is the last. */
const trackSpan = (map, k) => map.widths[k] + (k < map.lefts.length - 1 ? DOT_GAP_PX : 0);
/** The track px for strip scroll `at`, piecewise over the panels. */
export function toTrack(map, at) {
    if (map.lefts.length === 0)
        return 0;
    const k = segmentOf(map.strips, at);
    const span = map.spans[k];
    const t = span > 0 ? Math.min(Math.max((at - map.strips[k]) / span, 0), 1) : 0;
    return map.lefts[k] + t * trackSpan(map, k);
}
/** The strip scroll for track px `at`: the inverse of `toTrack`, clamped to the bar. */
export function toScroll(map, at) {
    if (map.lefts.length === 0)
        return 0;
    const k = segmentOf(map.lefts, at);
    const track = trackSpan(map, k);
    const t = track > 0 ? Math.min(Math.max((at - map.lefts[k]) / track, 0), 1) : 0;
    return map.strips[k] + t * map.spans[k];
}
/** Dots at their sizes, plus the oval for the visible window, in track px from the bar's left edge. */
export function dotLayout(i) {
    const dots = i.ids.map((id, k) => ({
        id,
        left: i.map.lefts[k] ?? 0,
        width: i.map.widths[k] ?? 0,
        hollow: i.hollow[k] === true,
    }));
    // The window is a fixed width, so the oval is too: as many phone dots and dot gaps as the window holds slots. Only its left moves.
    const gap = i.map.pitch - i.map.phone;
    const slots = Number.isFinite(i.windowWidth) && i.map.pitch > 0 ? (i.windowWidth + gap) / i.map.pitch : Infinity;
    const width = Math.min(i.map.width, Math.max(0, slots * (DOT_PHONE_PX + DOT_GAP_PX) - DOT_GAP_PX));
    const left = Math.min(Math.max(toTrack(i.map, i.scrollLeft), 0), i.map.width - width);
    return { dots, oval: { left, width } };
}
/**
 * The scroll that centres panel `index` in the window, clamped to the row's legal range. Null when the row cannot
 * scroll or the window is not measured: a click on a dot then does nothing.
 */
export function centreScroll(i) {
    if (!(i.maxScroll > 0) || !Number.isFinite(i.windowWidth))
        return null;
    const centre = (i.leftOffsets[i.index] ?? 0) + (i.widths[i.index] ?? 0) / 2;
    return Math.min(Math.max(centre - i.windowWidth / 2, 0), i.maxScroll);
}
/** The scroll after the oval has been dragged `dx` track px from where the drag began, clamped to the row's range. */
export function dragScroll(i) {
    const at = toScroll(i.map, toTrack(i.map, i.startScroll) + i.dx);
    return Math.min(Math.max(at, 0), i.maxScroll);
}
/**
 * Sets the parked dots among the drawn ones. Every drawn dot, and the oval over them, moves right by the parked dots ahead of it,
 * so the oval still marks what is on screen and the parked dots show where the rest of the row lies.
 */
export function withParked(layout, map, parked) {
    const dots = [];
    const shifts = [];
    let at = 0;
    const park = (k) => {
        for (const p of parked) {
            if (Math.min(p.before, map.lefts.length) !== k)
                continue;
            const width = dotWidthOf(Math.max(1, Math.round(p.slots)));
            dots.push({ id: p.id, left: at, width, hollow: p.hollow });
            at += width + DOT_GAP_PX;
        }
    };
    layout.dots.forEach((dot, k) => {
        park(k);
        shifts.push(at - dot.left);
        dots.push({ ...dot, left: at });
        at += dot.width + DOT_GAP_PX;
    });
    park(layout.dots.length);
    if (layout.dots.length === 0)
        return { dots, oval: { left: 0, width: 0 }, width: Math.max(0, at - DOT_GAP_PX), parked: new Set(parked.map((p) => p.id)) };
    const right = layout.oval.left + layout.oval.width;
    const last = segmentOf(map.lefts, Math.max(layout.oval.left, right - 1e-6));
    let first = segmentOf(map.lefts, layout.oval.left);
    // Parked dots between two drawn ones on screen (an always-shown column, then the panels a scroll brought in past the parked ones)
    // must not fall inside the oval: it starts at the run of drawn dots that ends where it ends.
    let start = layout.oval.left + shifts[first];
    for (let k = last; k > first; k--) {
        if (shifts[k] !== shifts[k - 1]) {
            first = k;
            start = dots.find((d) => d.id === layout.dots[k].id).left;
            break;
        }
    }
    const oval = { left: start, width: right + shifts[last] - start };
    return { dots, oval, width: Math.max(0, at - DOT_GAP_PX), parked: new Set(parked.map((p) => p.id)) };
}
