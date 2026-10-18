/**
 * The geometry of the dot bar: pure functions from the row's numbers to where each dot, the window oval and a
 * centring scroll sit. Internal; `usePanelDots` is the one public door.
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
 * piecewise: inside a panel's span, the track moves across that panel's dot, so the oval tracks the scroll smoothly.
 */
export interface DotMap {
  readonly lefts: readonly number[];
  readonly widths: readonly number[];
  readonly strips: readonly number[];
  readonly spans: readonly number[];
  readonly width: number;
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
  return { lefts, widths, strips, spans, width: Math.max(0, at - DOT_GAP_PX) };
}

/** The index of the last entry of `starts` that is at or before `at`, 0 when none is. */
function segmentOf(starts: readonly number[], at: number): number {
  let k = 0;
  for (let j = 0; j < starts.length; j++) if (starts[j]! <= at) k = j;
  return k;
}

/** The track px for strip scroll `at`, piecewise over the panels. */
export function toTrack(map: DotMap, at: number): number {
  if (map.lefts.length === 0) return 0;
  const k = segmentOf(map.strips, at);
  const span = map.spans[k]!;
  const t = span > 0 ? Math.min(Math.max((at - map.strips[k]!) / span, 0), 1) : 0;
  return map.lefts[k]! + t * map.widths[k]!;
}

/** The strip scroll for track px `at`: the inverse of `toTrack`, clamped to the bar. */
export function toScroll(map: DotMap, at: number): number {
  if (map.lefts.length === 0) return 0;
  const k = segmentOf(map.lefts, at);
  const dot = map.widths[k]!;
  const t = dot > 0 ? Math.min(Math.max((at - map.lefts[k]!) / dot, 0), 1) : 0;
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
  const left = toTrack(i.map, i.scrollLeft);
  const right = Number.isFinite(i.windowWidth) ? toTrack(i.map, i.scrollLeft + i.windowWidth) : i.map.width;
  return { dots, oval: { left, width: Math.max(0, right - left) } };
}

/**
 * The scroll that centres panel `index` in the window, clamped to the row's legal range. Null when the row cannot
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
