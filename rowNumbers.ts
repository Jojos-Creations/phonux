/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { drawnSlotsOf, panelWidthOf } from './panelTiers.js';
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
   * The slots each drawn entry is drawn at, in the order of `ids`: its chosen count capped at what fits, less what the
   * shrink rule takes at the current stop. `undefined` for an entry that carries no slots, which the rule never touches.
   */
  drawnSlots: readonly (number | undefined)[];
  /**
   * For each stop, the `scrollLeft` it has once the row rests there: the shrink rule changes how wide the panels before it
   * are, so this is the stop's position in the layout drawn AT that stop, which is where a scroll to it must end. Equal to
   * `stops` when the shrink rule is off.
   */
  stopTargets: readonly number[];
  /** The index into `stops` the shrink rule read, or -1 when it did not apply (mode 'off', no stops, a free or non-scrolling row). */
  shrinkStop: number;
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
  /**
   * The shrink rule for a stepping row: `stop` is the row's logical stop index (a stop of the chosen-width layout, which
   * does not change with the shrink). Omitted, or in a row with no stops: every entry is drawn at its chosen slots.
   */
  shrink?: { mode: 'visible' | 'hidden'; stop: number };
}, targets = true): RowNumbers {
  const present = i.entries.filter(isPresent);
  // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
  // and would turn every hand-built row into a scrolling one.
  const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
  const measured = i.containerWidth !== 0;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
  const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
  const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount });
  const chosenWidths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  let widths = chosenWidths;
  const parks = present.map((p) => parksForRoom(p));
  // Capacity prices the chosen widths: a panel that is narrowed for being out of view still holds its place.
  const parkLiveWidths = chosenWidths.filter((_, k) => parks[k]);
  const reservedWidths = chosenWidths.filter((_, k) => !parks[k]);
  const offsetsOf = (ws: readonly number[]): number[] => {
    const out: number[] = [];
    let at = 0;
    for (const width of ws) {
      out.push(at);
      at += width + i.gap;
    }
    return out;
  };
  const stripOf = (ws: readonly number[]): number => (ws.length === 0 ? 0 : ws.reduce((sum, width) => sum + width, 0) + (ws.length - 1) * i.gap);
  const chosenStrip = stripOf(chosenWidths);
  // The stops, their groups and their margins come from the chosen widths alone, so scrolling never changes how many there are.
  const whole = i.wholePanels === true && rowScroll && measured && chosenStrip > windowWidth ? wholePanelStops(chosenWidths, i.gap, windowWidth) : null;
  const drawnSlots: (number | undefined)[] = present.map((p) => drawnSlotsOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  let shrinkStop = -1;
  if (whole !== null && i.shrink !== undefined) {
    shrinkStop = Math.min(whole.margins.length - 1, Math.max(0, Math.round(i.shrink.stop)));
    const steps = stepsOutside(chosenWidths, whole.margins, shrinkStop, whole.starts, i.gap, windowWidth);
    widths = chosenWidths.map((w, k) => {
      const chosen = drawnSlots[k];
      if (chosen === undefined) return w;
      const drawn = steps[k] === 0 ? chosen : i.shrink!.mode === 'hidden' ? 1 : Math.max(1, chosen - steps[k]!);
      drawnSlots[k] = drawn;
      return slotWidth(drawn, i.phoneWidth, i.gap);
    });
  }
  const stripWidth = stripOf(widths);
  const leftOffsets = offsetsOf(widths);
  let rowMarginLeft: number;
  if (whole !== null) {
    rowMarginLeft = whole.margins[0]!;
  } else if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stops = whole === null ? [] : whole.margins.map((margin, k) => rowMarginLeft + leftOffsets[k]! - margin);
  const stopSpans = whole === null ? [] : whole.ends.map((end, first) => ({ first, end }));
  const endPad = whole === null ? 0 : whole.margins[whole.margins.length - 1]!;
  const stopTargets = shrinkStop < 0 || !targets ? stops : stops.map((_, k) => computeRowNumbers({ ...i, shrink: { mode: i.shrink!.mode, stop: k } }, false).stops[k]!);
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stopSpans, endPad, drawnSlots, shrinkStop, stopTargets };
}

/**
 * Per start panel, the end of the whole panels that fit the window from it (at least one) and the even margin left over,
 * for every start up to the first one from which everything remaining fits: a later stop would only add blank room.
 */
function wholePanelStops(widths: readonly number[], gap: number, windowWidth: number): { ends: number[]; margins: number[]; starts: number[] } {
  const ends: number[] = [];
  const starts: number[] = [];
  const margins: number[] = [];
  for (let first = 0; first < widths.length; first++) {
    let used = widths[first]!;
    let end = first + 1;
    while (end < widths.length && used + gap + widths[end]! <= windowWidth) used += gap + widths[end++]!;
    starts.push(first);
    ends.push(end);
    margins.push(Math.max(0, (windowWidth - used) / 2));
    if (end === widths.length) break;
  }
  return { ends, margins, starts };
}

// A neighbour counts as in view when more than this many px of it are inside the container, so float noise in an even margin
// of 0 cannot make a panel peek.
const PEEK_EPS = 1e-6;

/**
 * For each panel, how many panels lie between it and the nearest panel in view at stop `stop`, read from the chosen
 * widths. In view means more than 0 px of the panel lies inside the container, margins and the gap beside the strip
 * included, so the stop's own panels and any neighbour that shows in a margin are 0 steps and a panel past them is 1.
 */
function stepsOutside(widths: readonly number[], margins: readonly number[], stop: number, starts: readonly number[], gap: number, windowWidth: number): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const width of widths) {
    offsets.push(at);
    at += width + gap;
  }
  // The strip begins one gap in from the container's edge, after the first margin.
  const stripLeft = gap + margins[0]!;
  const scrollLeft = margins[0]! + offsets[starts[stop]!]! - margins[stop]!;
  const containerWidth = windowWidth + 2 * gap;
  const inView = widths.map((width, k) => {
    const left = stripLeft + offsets[k]!;
    return Math.min(left + width, scrollLeft + containerWidth) - Math.max(left, scrollLeft) > PEEK_EPS;
  });
  const first = inView.indexOf(true);
  const last = inView.lastIndexOf(true);
  return widths.map((_, k) => (first < 0 ? 0 : k < first ? first - k : k > last ? k - last : 0));
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
