/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { panelWidthOf } from './panelTiers.js';
import { parksForRoom } from './panelWindow.js';

/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
  /** True when any drawn entry carries settings whose `overflow` is 'scroll': the row scrolls instead of parking for room. */
  rowScroll: boolean;
  /** The width the strip is seen through: the container less the edge space each side. `Infinity` before the row is measured. */
  windowWidth: number;
  /** The width of every drawn entry plus one gap between each two. */
  stripWidth: number;
  /** The row's left margin: centring for a strip that fits, 0 for one that does not. */
  rowMarginLeft: number;
  /** The ids of the drawn entries, in row order. */
  ids: readonly string[];
  /** The width of each drawn entry, in the order of `ids`. */
  widths: readonly number[];
  /** Each drawn entry's resting x: the widths before it plus one gap each. */
  leftOffsets: readonly number[];
  /** The widest one panel can be in this row; `Infinity` before the row is measured. */
  maxLiveWidth: number;
  /** The widths of the drawn entries the row never parks for room. */
  reservedWidths: readonly number[];
  /** The widths of the drawn entries the row may park for room. */
  parkLiveWidths: readonly number[];
  /**
   * The `scrollLeft` values at which the window shows only whole panels, ascending; the first is 0. Empty when the row
   * does not scroll or its strip fits the window, which keeps its centring.
   */
  stops: readonly number[];
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** Room after the strip so the last stop can leave an even margin at both edges; 0 when there are no stops. */
  endPad: number;
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets `computeMaxLiveWidth`'s
 * capacity and `computeRowLayout`'s margin. A scrolling row draws every entry, prices a tablet at its own
 * width and a desktop panel at no more than the window, and centres only a strip that fits.
 * @public
 */
export function computeRowNumbers(i: {
  /** The row's whole list; the entries `isPresent` drops (parked ones, the marker) are not drawn and are ignored. */
  entries: readonly PanelRowEntry[];
  /** The phone frame's width in px: what a phone panel and a fixed column are drawn at. */
  phoneWidth: number;
  /** The row container's measured width; 0 before the first measurement. */
  containerWidth: number;
  /** The row's gap in px. */
  gap: number;
  /** The space between the row and the container's edge, each side. Default `gap`. */
  edge?: number;
  /** How many fixed columns a hand-built row prices its capacity from. Default: the drawn entries that are not collapsible. */
  fixedItemCount?: number;
  /** True for a row whose gesture is 'step': the window then shows only whole panels, at the stops. Default false. */
  wholePanels?: boolean;
}): RowNumbers {
  const present = i.entries.filter(isPresent);
  // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
  // and would turn every hand-built row into a scrolling one.
  const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
  const measured = i.containerWidth !== 0;
  const edge = i.edge ?? i.gap;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * edge) : Number.POSITIVE_INFINITY;
  const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
  const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, edge });
  const widths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  const parks = present.map((p) => parksForRoom(p));
  const parkLiveWidths = widths.filter((_, k) => parks[k]);
  const reservedWidths = widths.filter((_, k) => !parks[k]);
  const stripWidth = widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * i.gap;
  const leftOffsets: number[] = [];
  let running = 0;
  for (const width of widths) {
    leftOffsets.push(running);
    running += width + i.gap;
  }
  const whole = i.wholePanels === true && rowScroll && measured && stripWidth > windowWidth ? wholePanelStops(widths, i.gap, windowWidth) : null;
  let rowMarginLeft: number;
  if (whole !== null) {
    rowMarginLeft = whole.margins[0]!;
  } else if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, edge, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stops = whole === null ? [] : whole.margins.map((margin, k) => rowMarginLeft + leftOffsets[k]! - margin);
  const stopSpans = whole === null ? [] : whole.ends.map((end, first) => ({ first, end }));
  const endPad = whole === null ? 0 : whole.margins[whole.margins.length - 1]!;
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stopSpans, endPad };
}

/**
 * Per start panel, the end of the whole panels that fit the window from it (at least one) and the even margin left over,
 * for every start up to the first one from which everything remaining fits: a later stop would only add blank room.
 */
function wholePanelStops(widths: readonly number[], gap: number, windowWidth: number): { ends: number[]; margins: number[] } {
  const ends: number[] = [];
  const margins: number[] = [];
  for (let first = 0; first < widths.length; first++) {
    let used = widths[first]!;
    let end = first + 1;
    while (end < widths.length && used + gap + widths[end]! <= windowWidth) used += gap + widths[end++]!;
    ends.push(end);
    margins.push(Math.max(0, (windowWidth - used) / 2));
    if (end === widths.length) break;
  }
  return { ends, margins };
}

/**
 * The stop to rest at to show panel `index` whole: of the stops whose panels include it, the one nearest `target`.
 * `target` itself when the row has no stops. @internal
 */
export function snapToStop(n: RowNumbers, index: number, target: number): number {
  let best: number | null = null;
  for (const [k, span] of n.stopSpans.entries()) {
    if (index < span.first || index >= span.end) continue;
    const stop = n.stops[k]!;
    if (best === null || Math.abs(stop - target) < Math.abs(best - target)) best = stop;
  }
  return best ?? target;
}

/** The stop of `n` nearest `at`; `at` itself when the row has none. @internal */
export function nearestStop(n: RowNumbers, at: number): number {
  let best = at;
  for (const [k, stop] of n.stops.entries()) if (k === 0 || Math.abs(stop - at) < Math.abs(best - at)) best = stop;
  return best;
}

/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n: RowNumbers): number {
  return Number.isFinite(n.windowWidth) ? Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth) : 0;
}

/**
 * How opaque each drawn entry is at `scrollLeft`: 1 for a panel shown whole at the stop on either side of the position,
 * fading from one stop's panels to the next's as the row travels between them, so a panel leaving fades out while the one
 * arriving fades in. All 1 when the row has no stops. @internal
 */
export function fadeAt(n: RowNumbers, scrollLeft: number): number[] {
  const count = n.ids.length;
  const last = n.stops.length - 1;
  if (last < 0) return Array.from({ length: count }, () => 1);
  const shown = (stop: number, k: number): number => (k >= n.stopSpans[stop]!.first && k < n.stopSpans[stop]!.end ? 1 : 0);
  if (scrollLeft <= n.stops[0]!) return Array.from({ length: count }, (_, k) => shown(0, k));
  if (scrollLeft >= n.stops[last]!) return Array.from({ length: count }, (_, k) => shown(last, k));
  let from = 0;
  while (n.stops[from + 1]! < scrollLeft) from++;
  const progress = (scrollLeft - n.stops[from]!) / (n.stops[from + 1]! - n.stops[from]!);
  return Array.from({ length: count }, (_, k) => shown(from, k) * (1 - progress) + shown(from + 1, k) * progress);
}
