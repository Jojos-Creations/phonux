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
  /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
  windowWidth: number;
  /** The width of every drawn entry plus one gap between each two. */
  stripWidth: number;
  /** The row's left margin: centring for a strip that fits, the first whole run's centring for a stepping row that overflows, else 0. */
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
   * The `scrollLeft` values a stepping row rests on, ascending; the first is 0. Each rests on the one-phone grid and centres the
   * whole panels it shows; the last is the row's end (`maxScrollOf`). Empty when the row does not scroll, or its strip fits the window and keeps its centring.
   */
  stops: readonly number[];
  /** The same values as `stops`, under the step's name. Empty when `stops` is. */
  stepStops: readonly number[];
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** The space after the strip: the centring of the tail's whole panels on a stepping row that overflows, else 0. */
  endPad: number;
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the 0.1.0 numbers
 * (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centres only a strip that fits.
 * @public
 * @deprecated The provider computes the row's numbers from its tuning; read them as `useProvidePanels(...).rowNumbers`.
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
  /** How many fixed columns a hand-built row prices its capacity from. Default: the drawn entries that are not collapsible. */
  fixedItemCount?: number;
  /** True for a row whose gesture is 'step': the row then rests on the one-phone grid, `stops`. Default false. */
  wholePanels?: boolean;
}): RowNumbers {
  const present = i.entries.filter(isPresent);
  // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
  // and would turn every hand-built row into a scrolling one.
  const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
  const measured = i.containerWidth !== 0;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
  const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
  const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount });
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
  const overflows = rowScroll && measured && stripWidth > windowWidth;
  const stepping = i.wholePanels === true && overflows;
  // A non-stepping overflowing row starts flush at the window's left: it has no stops to centre on.
  let rowMarginLeft: number;
  if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else if (stepping) {
    rowMarginLeft = Math.max(0, (windowWidth - wholeRunWidth(0, widths, i.gap, windowWidth)) / 2);
  } else {
    rowMarginLeft = !measured || overflows ? 0 : (windowWidth - stripWidth) / 2;
  }
  // The tail is centred the same way, so the row's last rest shows its last whole panels with even room on both sides.
  const endPad = stepping ? Math.max(0, (windowWidth - tailWidth(widths, i.gap, windowWidth)) / 2) : 0;
  const maxScroll = stepping ? rowMarginLeft + stripWidth + endPad - windowWidth : 0;
  const stops = stepping ? restStops(maxScroll, i.phoneWidth + i.gap, { widths, offsets: leftOffsets, rowMarginLeft, gap: i.gap, windowWidth }) : [];
  const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, windowWidth));
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops: stops, stopSpans, endPad };
}

/** The width of the whole panels a window holds from `first` on: `first` itself, then each next one that still fits. */
function wholeRunWidth(first: number, widths: readonly number[], gap: number, windowWidth: number): number {
  let width = widths[first]!;
  for (let k = first + 1; k < widths.length && width + gap + widths[k]! <= windowWidth; k++) width += gap + widths[k]!;
  return width;
}

/** The width of the whole panels at the end of the strip that a window holds, counted back from the last one. */
function tailWidth(widths: readonly number[], gap: number, windowWidth: number): number {
  let width = widths[widths.length - 1]!;
  for (let k = widths.length - 2; k >= 0 && width + gap + widths[k]! <= windowWidth; k--) width += gap + widths[k]!;
  return width;
}


/** The drawn entries a window at scroll `at` shows: the first one its right edge passes and one past the last one its left edge reaches. */
function spanAt(at: number, widths: readonly number[], offsets: readonly number[], rowMarginLeft: number, windowWidth: number): { first: number; end: number } {
  let first = 0;
  while (first < widths.length - 1 && rowMarginLeft + offsets[first]! + widths[first]! <= at) first++;
  let end = first + 1;
  while (end < widths.length && rowMarginLeft + offsets[end]! < at + windowWidth) end++;
  return { first, end };
}

/**
 * The rests of a stepping row: the one-phone grid, plus a rest centring the whole run that starts at each panel the grid never
 * shows whole. A grid stop can miss a panel that fits the window, and a panel must be fully visible at some rest.
 * Ascending, and the last one is `maxScroll`.
 */
function restStops(maxScroll: number, step: number, g: { widths: readonly number[]; offsets: readonly number[]; rowMarginLeft: number; gap: number; windowWidth: number }): number[] {
  const grid = stepGrid(maxScroll, step);
  const rests = [...grid];
  g.widths.forEach((width, j) => {
    if (width > g.windowWidth) return;
    const left = g.rowMarginLeft + g.offsets[j]!;
    if (grid.some((at) => left - at >= 0 && left - at + width <= g.windowWidth)) return;
    const leftover = g.windowWidth - wholeRunWidth(j, g.widths, g.gap, g.windowWidth);
    rests.push(clampTo(left - leftover / 2, 0, maxScroll));
  });
  rests.sort((a, b) => a - b);
  return rests.filter((at, k) => k === rests.length - 1 || rests[k + 1]! - at > 1);
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Every phone width from scroll 0 up to `maxScroll`, then `maxScroll` itself: a step moves one phone width, and the last one
 * moves the rest. Empty when the row does not scroll.
 */
function stepGrid(maxScroll: number, step: number): number[] {
  if (maxScroll <= 0) return [];
  const grid: number[] = [];
  for (let at = 0; at < maxScroll; at += step) grid.push(at);
  grid.push(maxScroll);
  return grid;
}

/**
 * The index in `n.stops` of the stop to rest at to show panel `index` whole: of the stops whose panels include it, drawn at its
 * full width, the one nearest `target`. Of stops that share a position, the earliest. -1 when the row has no such stop. @internal
 */
export function snapToStopIndex(n: RowNumbers, index: number, target: number): number {
  let best = -1;
  for (const [k, span] of n.stopSpans.entries()) {
    if (index < span.first || index >= span.end) continue;
    if (best < 0 || Math.abs(n.stops[k]! - target) < Math.abs(n.stops[best]! - target)) best = k;
  }
  return best;
}

/**
 * The stop to rest at to show panel `index` whole: where `snapToStopIndex` points, `target` itself when the row has none. @internal
 */
export function snapToStop(n: RowNumbers, index: number, target: number): number {
  const k = snapToStopIndex(n, index, target);
  return k < 0 ? target : n.stops[k]!;
}

/** The stop of `n` nearest `at`; `at` itself when the row has none. @internal */
export function nearestStop(n: RowNumbers, at: number): number {
  let best = at;
  for (const [k, stop] of n.stops.entries()) if (k === 0 || Math.abs(stop - at) < Math.abs(best - at)) best = stop;
  return best;
}

/**
 * The `scrollLeft` that puts the pinned edge of entry `k` back at `edge` px from the window's left, with `n`'s margin, offset and
 * width: its right edge when the width was pinned at its end (a left grabber), its left edge when pinned at its start. `at` itself
 * when the entry is not in `n`. @internal
 */
export function scrollHoldingEdge(n: RowNumbers, k: number, pin: 'start' | 'end', edge: number, at: number): number {
  if (k < 0 || k >= n.ids.length) return at;
  const left = n.rowMarginLeft + n.leftOffsets[k]!;
  return (pin === 'end' ? left + n.widths[k]! : left) - edge;
}

/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n: RowNumbers): number {
  return Number.isFinite(n.windowWidth) ? Math.max(0, n.rowMarginLeft + n.stripWidth + n.endPad - n.windowWidth) : 0;
}
