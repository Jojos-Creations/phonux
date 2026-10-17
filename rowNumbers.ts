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
  /**
   * Where a step lands: `stops`, plus a stop every phone width from the left edge of each panel wider than a phone, ascending.
   * Drag snap and the nearest-stop settle still read `stops`, so a drag never settles inside a panel. Empty when `stops` is.
   */
  stepStops: readonly number[];
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** Always 0: the space after the strip is one row gap wide, and the last stop leaves the last panel one gap from the window edge. */
  endPad: number;
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the 0.1.0 numbers
 * (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, prices a tablet at its own
 * width and a desktop panel at no more than the window, and centres only a strip that fits.
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
  /** True for a row whose gesture is 'step': the window then shows only whole panels, at the stops. Default false. */
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
  const whole = i.wholePanels === true && rowScroll && measured && stripWidth > windowWidth ? wholePanelStops(widths, leftOffsets, i.gap, windowWidth, i.phoneWidth) : null;
  let rowMarginLeft: number;
  if (whole !== null) {
    rowMarginLeft = whole.rowMargin;
  } else if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stepStops = whole === null ? [] : stepGrid(Math.max(0, rowMarginLeft + stripWidth - windowWidth), i.phoneWidth + i.gap);
  // Every stop is on the one-phone grid, so drag snap, the rest settle and drag release all land on it.
  const stops = stepStops;
  const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, windowWidth));
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops, stopSpans, endPad: 0 };
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

type Pick = { start: number; end: number; margin: number; inset?: number };
type StopSet = { starts: number[]; ends: number[]; margins: number[]; insets: number[]; rowMargin: number };

/**
 * The row margin the picks need, and the picks that go forward: a stop whose scroll position lies left of the one before it
 * is left out. The margin is the least that lets every stop sit at a scroll position inside the strip.
 */
function settleStops(picks: readonly Pick[], offsets: readonly number[]): StopSet {
  let rowMargin = 0;
  for (const pick of picks) rowMargin = Math.max(rowMargin, pick.margin - offsets[pick.start]!);
  const kept: Pick[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const pick of picks) {
    const at = rowMargin + offsets[pick.start]! - pick.margin + (pick.inset ?? 0);
    if (at < last) continue;
    last = at;
    kept.push(pick);
  }
  return { starts: kept.map((p) => p.start), ends: kept.map((p) => p.end), margins: kept.map((p) => p.margin), insets: kept.map((p) => p.inset ?? 0), rowMargin };
}

/**
 * Per start panel, the end of the whole panels that fit the window from it (at least one) and the even margin left over,
 * for every start up to the first one from which everything remaining fits: a later stop would only add blank room.
 * Groups come from `widths` alone. A panel as wide as the window with a panel after it also gets a stop slid left, by the
 * whole panels that fit beside its right part or, when none does, by one slot.
 */
function wholePanelStops(widths: readonly number[], offsets: readonly number[], gap: number, windowWidth: number, phoneWidth: number): StopSet {
  const picks: Pick[] = [];
  for (let first = 0; first < widths.length; first++) {
    let used = widths[first]!;
    let end = first + 1;
    while (end < widths.length && used + gap + widths[end]! <= windowWidth) used += gap + widths[end++]!;
    picks.push({ start: first, end, margin: Math.max(0, (windowWidth - used) / 2) });
    if (end === first + 1 && widths[first]! >= windowWidth) {
      // The next stop starts at the panel after this one and would drop it whole; this stop slides it so a right part of at least a phone's width stays beside what follows.
      let reachEnd = first + 1;
      let beside = 0;
      while (reachEnd < widths.length && beside + gap + widths[reachEnd]! <= windowWidth - phoneWidth) beside += gap + widths[reachEnd++]!;
      if (reachEnd > first + 1) picks.push({ start: first, end: reachEnd, margin: 0, inset: widths[first]! + beside - windowWidth });
      // No whole panel fits beside it, so slide one slot: the next panel's first slot comes in as a neighbour the window edge cuts.
      else if (reachEnd < widths.length) picks.push({ start: first, end: first + 1, margin: 0, inset: phoneWidth + gap });
    }
    if (end === widths.length) break;
  }
  return settleStops(picks, offsets);
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
