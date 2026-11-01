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
