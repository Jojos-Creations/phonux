/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { panelWidthOf } from './panelTiers.js';
import { slotWidth } from './rowConstants.js';
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
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** Room after the strip so the last stop can leave an even margin at both edges; 0 when there are no stops. */
  endPad: number;
  /**
   * For each stop, the neighbour its group would leave cut off that 'visible' shrinking draws smaller: its index in
   * `ids` and the slots it is drawn at; null where nothing shrinks. Always all null unless `shrink` is 'visible'. Same order as `stops`.
   * It is the panel after the group when the row leans 'forward' and the one before it when it leans 'backward'.
   */
  stopShrinks: readonly ({ index: number; slots: number } | null)[];
  /**
   * For each stop, the index of the panel its group starts at. Stops are identified by it, not by their place in `stops`:
   * leaning backward a stop that would repeat the view before it is left out, so the two leans' lists differ in length.
   */
  stopFirsts: readonly number[];
  /** The width each drawn entry is drawn at on the current stop (`atFirst`): `widths` with the shrunk neighbour narrowed. Every stop and offset above is read from `widths`, never from these. */
  drawnWidths: readonly number[];
  /** Each drawn entry's resting x on the current stop, from `drawnWidths`. */
  drawnOffsets: readonly number[];
  /** True when 'hidden' shrinking is on: a panel outside the shown panels is never drawn part way. */
  hideOutside: boolean;
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the 0.1.0 numbers
 * (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, prices a tablet at its own
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
  /** How many fixed columns a hand-built row prices its capacity from. Default: the drawn entries that are not collapsible. */
  fixedItemCount?: number;
  /** True for a row whose gesture is 'step': the window then shows only whole panels, at the stops. Default false. */
  wholePanels?: boolean;
  /** What the row does with the neighbour its shown panels would leave cut off (`tuning.shrinkOutOfView`). Default 'off'. */
  shrink?: 'off' | 'visible' | 'hidden';
  /** The stop the row is on, named by the panel its group starts at; the drawn widths are those of that stop. Default the first stop. */
  atFirst?: number;
  /**
   * The side the room the group leaves free goes to: 'forward' (the panel after the group, the default) or 'backward'
   * (the one before it). Changes each stop's position and margin, never `rowMarginLeft` or `endPad`.
   */
  lean?: 'forward' | 'backward';
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
  const shrinkable = i.shrink === 'visible' ? present.map((p) => p.slots !== undefined) : null;
  const whole = i.wholePanels === true && rowScroll && measured && stripWidth > windowWidth ? wholePanelStops(widths, leftOffsets, stripWidth, i.gap, windowWidth, i.phoneWidth, shrinkable, i.lean ?? 'forward') : null;
  let rowMarginLeft: number;
  if (whole !== null) {
    rowMarginLeft = whole.rowMargin;
  } else if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stops = whole === null ? [] : whole.margins.map((margin, k) => rowMarginLeft + leftOffsets[whole.starts[k]!]! - margin);
  const stopSpans = whole === null ? [] : whole.ends.map((end, k) => ({ first: whole.starts[k]!, end }));
  const endPad = whole === null ? 0 : whole.endPad;
  const stopShrinks = whole === null ? [] : whole.shrinks;
  const stopFirsts = whole === null ? [] : whole.firsts;
  const drawnWidths = [...widths];
  const shrunk = stopShrinks[stopIndexOfFirst(stopFirsts, i.atFirst ?? 0)];
  if (shrunk != null) drawnWidths[shrunk.index] = slotWidth(shrunk.slots, i.phoneWidth, i.gap);
  const drawnOffsets: number[] = [];
  let drawnRunning = 0;
  for (const width of drawnWidths) {
    drawnOffsets.push(drawnRunning);
    drawnRunning += width + i.gap;
  }
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stopSpans, endPad, stopShrinks, stopFirsts, drawnWidths, drawnOffsets, hideOutside: i.shrink === 'hidden' && whole !== null };
}

/**
 * Per start panel, the end of the whole panels that fit the window from it (at least one) and the even margin left over,
 * for every start up to the first one from which everything remaining fits: a later stop would only add blank room.
 * Where `shrinkable` marks the neighbour on the `lean` side of the group, it is drawn at the whole slots the group leaves
 * free when that is fewer than it has, joins the shown panels, and takes its room out
 * of the margin; a stop with no such neighbour (the first stop leaning backward) shows what it shows leaning forward.
 * Groups come from `widths` alone. The row's left margin and end pad are the least that let every stop of either lean sit
 * at a scroll position inside the strip, so leaning one way or the other never moves the strip.
 */
function wholePanelStops(
  widths: readonly number[],
  offsets: readonly number[],
  stripWidth: number,
  gap: number,
  windowWidth: number,
  phoneWidth: number,
  shrinkable: readonly boolean[] | null,
  lean: 'forward' | 'backward',
): { firsts: number[]; starts: number[]; ends: number[]; margins: number[]; shrinks: ({ index: number; slots: number } | null)[]; rowMargin: number; endPad: number } {
  type Pick = { first: number; start: number; end: number; margin: number; shrink: { index: number; slots: number } | null };
  const picked: Pick[] = [];
  const forwards: Pick[] = [];
  const backwards: Pick[] = [];
  let rowMargin = 0;
  let endPad = 0;
  for (let first = 0; first < widths.length; first++) {
    let used = widths[first]!;
    let end = first + 1;
    while (end < widths.length && used + gap + widths[end]! <= windowWidth) used += gap + widths[end++]!;
    const free = Math.floor((windowWidth - used) / (phoneWidth + gap));
    const groupEnd = end;
    const evenMargin = (shown: number): number => Math.max(0, (windowWidth - shown) / 2);
    let forward: Pick = { first, start: first, end, margin: evenMargin(used), shrink: null };
    if (shrinkable?.[groupEnd] === true && free >= 1 && groupEnd < widths.length) {
      forward = { first, start: first, end: groupEnd + 1, margin: evenMargin(used + gap + slotWidth(free, phoneWidth, gap)), shrink: { index: groupEnd, slots: free } };
    }
    // A neighbour behind the group that already fits is not drawn as the one the room goes to: the stop before shows it whole.
    let backward = forward;
    if (first > 0 && shrinkable?.[first - 1] === true && free >= 1 && widths[first - 1]! > slotWidth(free, phoneWidth, gap)) {
      backward = { first, start: first - 1, end: groupEnd, margin: evenMargin(used + gap + slotWidth(free, phoneWidth, gap)), shrink: { index: first - 1, slots: free } };
    }
    forwards.push(forward);
    backwards.push(backward);
    if (groupEnd === widths.length) break;
  }
  // A stop of either lean needs rowMargin + offset - margin >= 0, and the strip, as drawn at ANY stop, must reach every stop's
  // position: the browser clamps the scroll the moment a lean flip draws the strip shorter than the position the row is on.
  let reach = Number.NEGATIVE_INFINITY;
  let shortest = 0;
  for (const pick of [...forwards, ...backwards]) {
    rowMargin = Math.max(rowMargin, pick.margin - offsets[pick.start]!);
    reach = Math.max(reach, offsets[pick.start]! - pick.margin + windowWidth - stripWidth);
    shortest = Math.max(shortest, pick.shrink === null ? 0 : widths[pick.shrink.index]! - slotWidth(pick.shrink.slots, phoneWidth, gap));
  }
  endPad = Math.max(0, reach + shortest);
  // Leaning backward, a stop whose view repeats the one before it, or lies left of it, is left out: a step onto it would move nothing or go the wrong way.
  let last = Number.NEGATIVE_INFINITY;
  for (const [k, forward] of forwards.entries()) {
    const pick = lean === 'forward' ? forward : backwards[k]!;
    const at = rowMargin + offsets[pick.start]! - pick.margin;
    const before = picked[picked.length - 1];
    const repeats = before !== undefined && before.start === pick.start && before.end === pick.end && before.shrink?.index === pick.shrink?.index && before.shrink?.slots === pick.shrink?.slots;
    if (at < last || repeats) continue;
    last = at;
    picked.push(pick);
  }
  return { firsts: picked.map((p) => p.first), starts: picked.map((p) => p.start), ends: picked.map((p) => p.end), margins: picked.map((p) => p.margin), shrinks: picked.map((p) => p.shrink), rowMargin, endPad };
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

/** The place in `n.stops` of the stop that group-start panel `first` names: the last one at or before it, or the first. @internal */
export function stopIndexOfFirst(firsts: readonly number[], first: number): number {
  let found = 0;
  for (const [k, f] of firsts.entries()) if (f <= first) found = k;
  return found;
}

/** The index in `n.stops` of the stop nearest `at`; 0 when the row has none. @internal */
export function nearestStopIndex(n: RowNumbers, at: number): number {
  let best = 0;
  for (const [k, stop] of n.stops.entries()) if (Math.abs(stop - at) < Math.abs(n.stops[best]! - at)) best = k;
  return best;
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
  // 'hidden' draws no panel part way: one in either stop's shown panels is whole all the way, every other is hidden.
  // A browser rounds scrollLeft, so within half a pixel of a stop the row is at rest on it.
  if (n.hideOutside) {
    const at = scrollLeft - n.stops[from]! < 0.5 ? from : n.stops[from + 1]! - scrollLeft < 0.5 ? from + 1 : null;
    return Array.from({ length: count }, (_, k) => (at === null ? Math.max(shown(from, k), shown(from + 1, k)) : shown(at, k)));
  }
  const progress = (scrollLeft - n.stops[from]!) / (n.stops[from + 1]! - n.stops[from]!);
  return Array.from({ length: count }, (_, k) => shown(from, k) * (1 - progress) + shown(from + 1, k) * progress);
}
