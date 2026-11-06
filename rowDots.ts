/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centering scroll sit. Internal; `usePanelDots` is the one public door.
 */

/** A dot's place in the bar's track, in px, and whether it is the hollow one. */
export interface DotPlace {
  readonly id: string;
  readonly left: number;
  readonly width: number;
  readonly hollow: boolean;
}

/** Every dot plus the oval for the visible window, all in track px. */
export interface DotLayout {
  readonly dots: readonly DotPlace[];
  readonly oval: { readonly left: number; readonly width: number };
}

/** The width of a one-phone panel's dot, in px. */
export const DOT_PHONE_PX = 22;

/** The space between two dots, in px. */
export const DOT_GAP_PX = 8;

/** A panel `slots` phones wide draws one dot as wide as that many phone dots and the gaps between them. */
const dotWidthOf = (slots: number): number => slots * DOT_PHONE_PX + (slots - 1) * DOT_GAP_PX;

/**
 * Where each dot sits in the track, and the strip span each panel covers. A scroll position maps onto the track
 * piecewise: a panel's span (the panel and the gap after it) maps onto its dot and the dot gap after it, so the map has
 * no jump at a boundary and the oval tracks the scroll smoothly.
 */
export interface DotMap {
  readonly lefts: readonly number[];
  readonly widths: readonly number[];
  readonly strips: readonly number[];
  readonly spans: readonly number[];
  readonly width: number;
  /** One phone slot (a phone and a row gap) in strip px, and the phone width, which size the oval to the window. */
  readonly pitch: number;
  readonly phone: number;
}

/** The dot bar's map for the row's panels. Dot widths come from the panel's size, not from the track. */
export function dotMap(i: { widths: readonly number[]; leftOffsets: readonly number[] }): DotMap {
  const positive = i.widths.filter((w) => w > 0);
  const unit = positive.length === 0 ? 1 : Math.min(...positive);
  const lefts: number[] = [];
  const widths: number[] = [];
  const strips: number[] = [];
  const spans: number[] = [];
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
  const pitches = spans.slice(0, -1).map((span, k) => span / Math.max(1, Math.round(i.widths[k]! / unit)));
  const pitch = pitches.length === 0 ? unit : Math.min(...pitches);
  return { lefts, widths, strips, spans, width: Math.max(0, at - DOT_GAP_PX), pitch, phone: unit };
}

/** The index of the last entry of `starts` that is at or before `at`, 0 when none is. */
function segmentOf(starts: readonly number[], at: number): number {
  let k = 0;
  for (let j = 0; j < starts.length; j++) if (starts[j]! <= at) k = j;
  return k;
}

/** The track width segment `k` covers: its dot, and the dot gap after it unless it is the last. */
const trackSpan = (map: DotMap, k: number): number => map.widths[k]! + (k < map.lefts.length - 1 ? DOT_GAP_PX : 0);

/** The track px for strip scroll `at`, piecewise over the panels. */
export function toTrack(map: DotMap, at: number): number {
  if (map.lefts.length === 0) return 0;
  const k = segmentOf(map.strips, at);
  const span = map.spans[k]!;
  const t = span > 0 ? Math.min(Math.max((at - map.strips[k]!) / span, 0), 1) : 0;
  return map.lefts[k]! + t * trackSpan(map, k);
}

/** The strip scroll for track px `at`: the inverse of `toTrack`, clamped to the bar. */
export function toScroll(map: DotMap, at: number): number {
  if (map.lefts.length === 0) return 0;
  const k = segmentOf(map.lefts, at);
  const track = trackSpan(map, k);
  const t = track > 0 ? Math.min(Math.max((at - map.lefts[k]!) / track, 0), 1) : 0;
  return map.strips[k]! + t * map.spans[k]!;
}

/** Dots at their sizes, plus the oval for the visible window, in track px from the bar's left edge. */
export function dotLayout(i: { ids: readonly string[]; hollow: readonly boolean[]; map: DotMap; windowWidth: number; scrollLeft: number }): DotLayout {
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
export function centreScroll(i: { index: number; leftOffsets: readonly number[]; widths: readonly number[]; windowWidth: number; maxScroll: number }): number | null {
  if (!(i.maxScroll > 0) || !Number.isFinite(i.windowWidth)) return null;
  const centre = (i.leftOffsets[i.index] ?? 0) + (i.widths[i.index] ?? 0) / 2;
  return Math.min(Math.max(centre - i.windowWidth / 2, 0), i.maxScroll);
}

/** The scroll after the oval has been dragged `dx` track px from where the drag began, clamped to the row's range. */
export function dragScroll(i: { startScroll: number; dx: number; map: DotMap; maxScroll: number }): number {
  const at = toScroll(i.map, toTrack(i.map, i.startScroll) + i.dx);
  return Math.min(Math.max(at, 0), i.maxScroll);
}

/** A parked panel's dot: `before` is how many drawn panels come ahead of it in the row's order. */
export interface ParkedDot {
  readonly id: string;
  readonly before: number;
  readonly slots: number;
  readonly hollow: boolean;
}

/** The whole bar: the drawn panels' layout with each parked panel's dot set at its place in the row's order. */
export interface FullDotLayout extends DotLayout {
  /** The bar's width in px. */
  readonly width: number;
  /** The ids of the parked dots, which a click brings in by stepping the row. */
  readonly parked: ReadonlySet<string>;
}

/**
 * Whether a parked panel with `before` drawn panels ahead of it in the row waits on the bar's left, of `drawn` drawn panels: one
 * inside the drawn run waits on the side nearer its place, a tie on the left. The row's step follows the same rule, so a step
 * toward a dot always reaches it.
 */
export function waitsLeft(before: number, drawn: number): boolean {
  return before <= 0 || (before < drawn && before <= drawn - before);
}

/**
 * Sets the parked dots beside the drawn ones, which stay together under the oval: an always-shown panel such as the Workspace
 * never moves, so its dot stays in the oval's end slot and the panels parked between it and the rest wait outside the oval.
 */
export function withParked(layout: DotLayout, map: DotMap, parked: readonly ParkedDot[]): FullDotLayout {
  const dots: DotPlace[] = [];
  const shifts: number[] = [];
  let at = 0;
  const n = layout.dots.length;
  const sideOf = (before: number): number => (waitsLeft(before, n) ? 0 : n);
  const park = (k: number): void => {
    for (const p of parked) {
      if (sideOf(p.before) !== k) continue;
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
  if (layout.dots.length === 0) return { dots, oval: { left: 0, width: 0 }, width: Math.max(0, at - DOT_GAP_PX), parked: new Set(parked.map((p) => p.id)) };
  const oval = { left: layout.oval.left + shifts[0]!, width: layout.oval.width };
  return { dots, oval, width: Math.max(0, at - DOT_GAP_PX), parked: new Set(parked.map((p) => p.id)) };
}

/**
 * The bar with a dot for each panel held at an edge. A held panel is always on screen, so its dot stays inside the oval, at the
 * oval's end for its edge, and the oval grows to hold it. The dots past it move over to make room.
 */
export function withHeld(bar: FullDotLayout, held: readonly { id: string; side: 'left' | 'right'; slots: number; hollow: boolean }[]): FullDotLayout {
  if (held.length === 0) return bar;
  const widthOf = (h: (typeof held)[number]): number => dotWidthOf(Math.max(1, Math.round(h.slots)));
  const room = (side: 'left' | 'right'): number => held.filter((h) => h.side === side).reduce((sum, h) => sum + widthOf(h) + DOT_GAP_PX, 0);
  const leftRoom = room('left');
  const rightRoom = room('right');
  const inside = (d: DotPlace, edge: number): boolean => d.left + d.width / 2 >= edge;
  const end = bar.oval.left + bar.oval.width;
  const dots = bar.dots.map((d) => ({ ...d, left: d.left + (inside(d, bar.oval.left) ? leftRoom : 0) + (inside(d, end) ? rightRoom : 0) }));
  let at = bar.oval.left;
  const heldDots = (side: 'left' | 'right'): DotPlace[] => held.filter((h) => h.side === side).map((h) => {
    const dot = { id: h.id, left: at, width: widthOf(h), hollow: h.hollow };
    at += dot.width + DOT_GAP_PX;
    return dot;
  });
  const lefts = heldDots('left');
  at = end + leftRoom + DOT_GAP_PX;
  const rights = heldDots('right');
  const all = [...lefts, ...dots, ...rights].sort((a, b) => a.left - b.left);
  return { ...bar, dots: all, oval: { left: bar.oval.left, width: bar.oval.width + leftRoom + rightRoom }, width: bar.width + leftRoom + rightRoom };
}
