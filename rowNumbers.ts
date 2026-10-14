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
   * For each stop, the panels it draws smaller than their own width, each as its index in `ids` and the slots it is drawn at: the
   * first panel when the window starts part way into it, the last when the window ends part way into it. Empty for a stop that
   * draws every panel whole, and for every stop unless `shrink` is 'visible'. Same order as `stops`.
   */
  stopShrinks: readonly (readonly { index: number; slots: number }[])[];
  /**
   * For each stop, a number that names it and rises with it. A stepping row keeps the stop it is on by this number, not by its
   * place in `stops`, because two stops can share a scroll position and differ only in what they draw.
   */
  stopFirsts: readonly number[];
  /** The width each drawn entry is drawn at on the current stop (`atFirst`): `widths` with that stop's shrunk panels narrowed. Every stop and offset above is read from `widths`, never from these. */
  drawnWidths: readonly number[];
  /** Each drawn entry's resting x on the current stop, from `drawnWidths`. */
  drawnOffsets: readonly number[];
  /** True when 'hidden' shrinking is on: a panel outside the stop's panels is never drawn part way. */
  hideOutside: boolean;
  /** The index in `stops` of the stop the row is on, when it follows stops ('visible'), else -1. Two stops can share a scroll position, so a fade cannot read the stop from the scroll. */
  atStop: number;
  /** True when 'off' is on and the row steps: every panel stays drawn at its own size and the window edge cuts the neighbour of a stop. */
  showPartial: boolean;
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
  /** What a stepping row does with the panels the window would leave cut off (`tuning.shrinkOutOfView`). Default 'off'. */
  shrink?: 'off' | 'visible' | 'hidden';
  /** The stop the row is on, as its `stopFirsts` number; the drawn widths are those of that stop. Default the first stop. */
  atFirst?: number;
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
  const stepsBySlot = i.shrink === 'visible';
  const whole = i.wholePanels === true && rowScroll && measured && stripWidth > windowWidth
    ? stepsBySlot
      ? slotWindowStops(widths, leftOffsets, stripWidth, i.gap, windowWidth, i.phoneWidth, present.map((p) => p.slots !== undefined))
      : wholePanelStops(widths, leftOffsets, stripWidth, i.gap, windowWidth, i.phoneWidth)
    : null;
  let rowMarginLeft: number;
  if (whole !== null) {
    rowMarginLeft = whole.rowMargin;
  } else if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [widths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || stripWidth > windowWidth ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stops = whole === null ? [] : whole.margins.map((margin, k) => rowMarginLeft + leftOffsets[whole.starts[k]!]! - margin + whole.insets[k]!);
  const stopSpans = whole === null ? [] : whole.ends.map((end, k) => ({ first: whole.starts[k]!, end }));
  const endPad = whole === null ? 0 : whole.endPad;
  const stopShrinks = whole === null ? [] : whole.shrinks;
  const stopFirsts = whole === null ? [] : whole.firsts;
  const drawnWidths = [...widths];
  for (const shrunk of stopShrinks[stopIndexOfFirst(stopFirsts, i.atFirst ?? 0)] ?? []) drawnWidths[shrunk.index] = slotWidth(shrunk.slots, i.phoneWidth, i.gap);
  const drawnOffsets: number[] = [];
  let drawnRunning = 0;
  for (const width of drawnWidths) {
    drawnOffsets.push(drawnRunning);
    drawnRunning += width + i.gap;
  }
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids: present.map((p) => p.id), widths, leftOffsets, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stopSpans, endPad, stopShrinks, stopFirsts, drawnWidths, drawnOffsets, hideOutside: i.shrink === 'hidden' && whole !== null, showPartial: (i.shrink ?? 'off') === 'off' && whole !== null, atStop: stepsBySlot && whole !== null ? stopIndexOfFirst(stopFirsts, i.atFirst ?? 0) : -1 };
}

type Shrink = { index: number; slots: number };
type Pick = { first: number; start: number; end: number; margin: number; shrinks: Shrink[]; inset?: number };
type StopSet = { firsts: number[]; starts: number[]; ends: number[]; margins: number[]; insets: number[]; shrinks: Shrink[][]; rowMargin: number; endPad: number };

/**
 * The row margin and end pad the picks need, and the picks that go forward: a stop whose scroll position lies left of the one
 * before it is left out. The margin and pad are the least that let every stop sit at a scroll position inside the strip, and
 * the strip, as drawn at ANY stop, reach every stop: the browser clamps the scroll the moment a stop draws it shorter than
 * the position the row is on.
 */
function settleStops(picks: readonly Pick[], widths: readonly number[], offsets: readonly number[], stripWidth: number, windowWidth: number, phoneWidth: number, gap: number): StopSet {
  let rowMargin = 0;
  let reach = Number.NEGATIVE_INFINITY;
  let shortest = 0;
  for (const pick of picks) {
    rowMargin = Math.max(rowMargin, pick.margin - offsets[pick.start]!);
    reach = Math.max(reach, offsets[pick.start]! - pick.margin + (pick.inset ?? 0) + windowWidth - stripWidth);
    shortest = Math.max(shortest, pick.shrinks.reduce((sum, s) => sum + widths[s.index]! - slotWidth(s.slots, phoneWidth, gap), 0));
  }
  const endPad = Math.max(0, reach + shortest);
  const kept: Pick[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const pick of picks) {
    const at = rowMargin + offsets[pick.start]! - pick.margin + (pick.inset ?? 0);
    if (at < last) continue;
    last = at;
    kept.push(pick);
  }
  return { firsts: kept.map((p) => p.first), starts: kept.map((p) => p.start), ends: kept.map((p) => p.end), margins: kept.map((p) => p.margin), insets: kept.map((p) => p.inset ?? 0), shrinks: kept.map((p) => p.shrinks), rowMargin, endPad };
}

/**
 * Per start panel, the end of the whole panels that fit the window from it (at least one) and the even margin left over,
 * for every start up to the first one from which everything remaining fits: a later stop would only add blank room.
 * Groups come from `widths` alone. A panel as wide as the window with a panel after it also gets a stop slid left, by the
 * whole panels that fit beside its right part or, when none does, by one slot.
 */
function wholePanelStops(widths: readonly number[], offsets: readonly number[], stripWidth: number, gap: number, windowWidth: number, phoneWidth: number): StopSet {
  const picks: Pick[] = [];
  for (let first = 0; first < widths.length; first++) {
    let used = widths[first]!;
    let end = first + 1;
    while (end < widths.length && used + gap + widths[end]! <= windowWidth) used += gap + widths[end++]!;
    picks.push({ first: picks.length, start: first, end, margin: Math.max(0, (windowWidth - used) / 2), shrinks: [] });
    if (end === first + 1 && widths[first]! >= windowWidth) {
      // The next stop starts at the panel after this one and would drop it whole; this stop slides it so a right part of at least a phone's width stays beside what follows.
      let reachEnd = first + 1;
      let beside = 0;
      while (reachEnd < widths.length && beside + gap + widths[reachEnd]! <= windowWidth - phoneWidth) beside += gap + widths[reachEnd++]!;
      if (reachEnd > first + 1) picks.push({ first: picks.length, start: first, end: reachEnd, margin: 0, shrinks: [], inset: widths[first]! + beside - windowWidth });
      // No whole panel fits beside it, so slide one slot: the next panel's first slot comes in as a neighbour the mode cuts or hides.
      else if (reachEnd < widths.length) picks.push({ first: picks.length, start: first, end: first + 1, margin: 0, shrinks: [], inset: phoneWidth + gap });
    }
    if (end === widths.length) break;
  }
  return settleStops(picks, widths, offsets, stripWidth, windowWidth, 0, gap);
}

/**
 * The stops of a row that steps one slot at a time. The strip is a run of slot units: a panel that can be drawn smaller is as
 * many units as its width holds slots, one that cannot (an entry without `slots`, or at a width that is no whole number of
 * slots) is one unit as wide as itself. A stop is a window position: it starts at a unit and holds every unit that fits the
 * window after it. The first and last panel the window meets are drawn at the units of them it holds, so a panel steps through
 * every size on its way in (1, 2, ... its own) and on its way out (its own, ... 2, 1), then leaves the window. The window is
 * centred by the room it leaves. The same stops are walked forward and back.
 */
function slotWindowStops(widths: readonly number[], offsets: readonly number[], stripWidth: number, gap: number, windowWidth: number, phoneWidth: number, shrinkable: readonly boolean[]): StopSet {
  const units: { panel: number; at: number; of: number; width: number }[] = [];
  for (const [panel, width] of widths.entries()) {
    const slots = Math.round((width + gap) / (phoneWidth + gap));
    const divides = shrinkable[panel] === true && slots >= 1 && Math.abs(slotWidth(slots, phoneWidth, gap) - width) < 0.5;
    if (divides) for (let at = 0; at < slots; at++) units.push({ panel, at, of: slots, width: phoneWidth });
    else units.push({ panel, at: 0, of: 1, width });
  }
  const picks: Pick[] = [];
  for (let from = 0; from < units.length; from++) {
    let used = units[from]!.width;
    let to = from;
    while (to + 1 < units.length && used + gap + units[to + 1]!.width <= windowWidth) used += gap + units[++to]!.width;
    const first = units[from]!;
    const lastUnit = units[to]!;
    const shrinks: Shrink[] = [];
    if (first.panel === lastUnit.panel) {
      if (to - from + 1 < first.of) shrinks.push({ index: first.panel, slots: to - from + 1 });
    } else {
      if (first.at > 0) shrinks.push({ index: first.panel, slots: first.of - first.at });
      if (lastUnit.at + 1 < lastUnit.of) shrinks.push({ index: lastUnit.panel, slots: lastUnit.at + 1 });
    }
    picks.push({ first: picks.length, start: first.panel, end: lastUnit.panel + 1, margin: Math.max(0, (windowWidth - used) / 2), shrinks });
    if (to === units.length - 1) break;
  }
  return settleStops(picks, widths, offsets, stripWidth, windowWidth, phoneWidth, gap);
}

/**
 * The index in `n.stops` of the stop to rest at to show panel `index` whole: of the stops whose panels include it, drawn at its
 * full width, the one nearest `target`. Of stops that share a position, `prefer` (the stop the row is on) when it is one, else the earliest. -1 when the row has no such stop. @internal
 */
export function snapToStopIndex(n: RowNumbers, index: number, target: number, prefer?: number): number {
  let best = -1;
  for (const [k, span] of n.stopSpans.entries()) {
    if (index < span.first || index >= span.end) continue;
    // A panel the stop draws smaller is not shown whole by it.
    if (n.stopShrinks[k]!.some((shrunk) => shrunk.index === index)) continue;
    const nearer = best < 0 || Math.abs(n.stops[k]! - target) < Math.abs(n.stops[best]! - target);
    if (nearer || (k === prefer && n.stops[k] === n.stops[best])) best = k;
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

/** The place in `n.stops` of the stop that group-start panel `first` names: the last one at or before it, or the first. @internal */
export function stopIndexOfFirst(firsts: readonly number[], first: number): number {
  let found = 0;
  for (const [k, f] of firsts.entries()) if (f <= first) found = k;
  return found;
}

/** The index in `n.stops` of the stop nearest `at`, the earliest of stops that share a position; 0 when the row has none. @internal */
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

/**
 * How opaque each drawn entry is at `scrollLeft`: 1 for a panel shown whole at the stop on either side of the position,
 * fading from one stop's panels to the next's as the row travels between them, so a panel leaving fades out while the one
 * arriving fades in. All 1 when the row has no stops or shows partial panels. @internal
 */
export function fadeAt(n: RowNumbers, scrollLeft: number): number[] {
  const count = n.ids.length;
  const last = n.stops.length - 1;
  if (last < 0 || n.showPartial) return Array.from({ length: count }, () => 1);
  const shown = (stop: number, k: number): number => (k >= n.stopSpans[stop]!.first && k < n.stopSpans[stop]!.end ? 1 : 0);
  if (n.atStop >= 0 && n.atStop <= last) {
    const at = n.stops[n.atStop]!;
    if (Math.abs(scrollLeft - at) < 0.5) return Array.from({ length: count }, (_, k) => shown(n.atStop, k));
    // Between the stop the row is heading to and its neighbour on the side it is coming from.
    const other = n.stops[scrollLeft < at ? n.atStop - 1 : n.atStop + 1];
    if (other !== undefined && other !== at && scrollLeft > Math.min(at, other) && scrollLeft < Math.max(at, other)) {
      const progress = Math.abs(scrollLeft - other) / Math.abs(at - other);
      const from = scrollLeft < at ? n.atStop - 1 : n.atStop + 1;
      return Array.from({ length: count }, (_, k) => shown(from, k) * (1 - progress) + shown(n.atStop, k) * progress);
    }
  }
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
