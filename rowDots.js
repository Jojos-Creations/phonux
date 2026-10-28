/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centering scroll sit. Internal; `usePanelDots` is the one public door.
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
 * The scroll that centers panel `index` in the window, clamped to the row's legal range. Null when the row cannot
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
 * Whether a parked panel with `before` drawn panels ahead of it in the row waits on the bar's left, of `drawn` drawn panels: one
 * inside the drawn run waits on the side nearer its place, a tie on the left. The row's step follows the same rule, so a step
 * toward a dot always reaches it.
 */
export function waitsLeft(before, drawn) {
    return before <= 0 || (before < drawn && before <= drawn - before);
}
/**
 * Sets the parked dots beside the drawn ones, which stay together under the oval: an always-shown panel such as the Workspace
 * never moves, so its dot stays in the oval's end slot and the panels parked between it and the rest wait outside the oval.
 */
export function withParked(layout, map, parked) {
    const dots = [];
    const shifts = [];
    let at = 0;
    const n = layout.dots.length;
    const sideOf = (before) => (waitsLeft(before, n) ? 0 : n);
    const park = (k) => {
        for (const p of parked) {
            if (sideOf(p.before) !== k)
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
    const oval = { left: layout.oval.left + shifts[0], width: layout.oval.width };
    return { dots, oval, width: Math.max(0, at - DOT_GAP_PX), parked: new Set(parked.map((p) => p.id)) };
}
