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
  /** The ids of the drawn entries in the strip, in row order. Panels held at an edge are not here; `held` lists them. */
  ids: readonly string[];
  /** The width of each drawn entry, in the order of `ids`. */
  widths: readonly number[];
  /** Each drawn entry's resting x inside the strip: the widths before it plus one gap each. */
  leftOffsets: readonly number[];
  /** The panels held at an edge, left group first. Each is drawn in its edge's group, which the row keeps in view while the strip scrolls. */
  held: readonly {
    /** The panel's id. */
    id: string;
    /** The edge the panel holds at. */
    side: 'left' | 'right';
    /** The panel's width in px. */
    width: number;
    /** Where the panel sits inside its edge's group, in px from the group's left. */
    offset: number;
  }[];
  /** The width the left group takes before the strip, its trailing gap included; 0 with no left group. */
  leftInset: number;
  /** The width the right group takes after the strip, its leading gap included; 0 with no right group. */
  rightInset: number;
  /** The scrollLeft at which the strip's first slot rests: the left group and the row's margin. */
  stripStart: number;
  /** The width the strip is seen through: the window less both groups. `windowWidth` when no panel is held. */
  stripWindow: number;
  /** The widest one panel can be in this row; `Infinity` before the row is measured. */
  maxLiveWidth: number;
  /** The widths of the drawn entries the row never parks for room, the held panels included: a held panel is never parked. */
  reservedWidths: readonly number[];
  /** The widths of the drawn entries the row may park for room. */
  parkLiveWidths: readonly number[];
  /**
   * The `scrollLeft` values a stepping row rests on, ascending; the first is 0. They are one phone width apart, and the last
   * is the row's end (`maxScrollOf`). Empty when the row does not scroll, or its strip fits the window and keeps its centring.
   */
  stops: readonly number[];
  /** The same values as `stops`, under the step's name. Empty when `stops` is. */
  stepStops: readonly number[];
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** Always 0: the space after the strip is one row gap wide, and the last stop leaves the last panel one gap from the window edge. */
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
  const allWidths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  const edges = rowScroll && measured ? chooseEdges(present, allWidths, i.gap, i.phoneWidth, windowWidth) : [];
  const heldAt = new Set(edges.map((e) => e.k));
  const strip = present.flatMap((p, k) => (heldAt.has(k) ? [] : [{ p, k }]));
  const ids = strip.map((x) => x.p.id);
  const widths = strip.map((x) => allWidths[x.k]!);
  const parks = strip.map((x) => parksForRoom(x.p));
  const parkLiveWidths = widths.filter((_, n) => parks[n]);
  const reservedWidths = [...widths.filter((_, n) => !parks[n]), ...edges.map((e) => allWidths[e.k]!)];
  const stripWidth = contentLength(widths, i.gap);
  const { leftInset, rightInset, held } = edgeGroups(edges, present, allWidths, i.gap);
  const stripWindow = windowWidth - leftInset - rightInset;
  const leftOffsets: number[] = [];
  let running = 0;
  for (const width of widths) {
    leftOffsets.push(running);
    running += width + i.gap;
  }
  const overflows = rowScroll && measured && stripWidth > stripWindow;
  // A strip that overflows starts flush at the window's left: a centring margin would show as blank room at scroll 0 and
  // push every grid stop off the panel starts.
  let rowMarginLeft: number;
  if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [allWidths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured || overflows ? 0 : (windowWidth - stripWidth) / 2;
  }
  const stepStops = i.wholePanels === true && overflows ? stepGrid(stripWidth - stripWindow, i.phoneWidth + i.gap) : [];
  const stops = stepStops;
  const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, stripWindow));
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids, widths, leftOffsets, held, leftInset, rightInset, stripStart: leftInset + rowMarginLeft, stripWindow, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops, stopSpans, endPad: 0 };
}

/** The length of `widths` laid end to end with one gap between each two: 0 for none. */
function contentLength(widths: readonly number[], gap: number): number {
  return widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * gap;
}

/** The edge a panel holds at, or null. `both` takes the left group: see the setting's doc comment in panelSettings.ts. */
function edgeSideOf(p: PanelRowEntry): 'left' | 'right' | null {
  const hold = p.settings?.edgeHold;
  if (hold === 'left' || hold === 'both') return 'left';
  return hold === 'right' ? 'right' : null;
}

/** The widths the two edge groups take in flow for `picks`: the left group with its trailing gap, the right with its leading one. */
function insetsOf(picks: readonly { k: number; side: 'left' | 'right' }[], allWidths: readonly number[], gap: number): { leftInset: number; rightInset: number } {
  const left = picks.filter((e) => e.side === 'left').map((e) => allWidths[e.k]!);
  const right = picks.filter((e) => e.side === 'right').map((e) => allWidths[e.k]!);
  return { leftInset: left.length === 0 ? 0 : contentLength(left, gap) + gap, rightInset: right.length === 0 ? 0 : gap + contentLength(right, gap) };
}

/**
 * The panels that hold at an edge, in row order, or none. A candidate joins while the window keeps at least one phone's width of
 * strip beside every held panel; one that cannot fit lets go and scrolls with the strip. The holds stand only while the strip
 * without them still overflows the window that remains, so a row that would not scroll releases them all.
 */
function chooseEdges(present: readonly PanelRowEntry[], allWidths: readonly number[], gap: number, phoneWidth: number, windowWidth: number): { k: number; side: 'left' | 'right' }[] {
  const picked: { k: number; side: 'left' | 'right' }[] = [];
  for (const [k, p] of present.entries()) {
    const side = edgeSideOf(p);
    if (side === null) continue;
    const trial = [...picked, { k, side }];
    const { leftInset, rightInset } = insetsOf(trial, allWidths, gap);
    if (windowWidth - leftInset - rightInset >= phoneWidth) picked.push({ k, side });
  }
  if (picked.length === 0) return [];
  const { leftInset, rightInset } = insetsOf(picked, allWidths, gap);
  const heldK = new Set(picked.map((e) => e.k));
  const restWidths = allWidths.filter((_, k) => !heldK.has(k));
  return contentLength(restWidths, gap) > windowWidth - leftInset - rightInset ? picked : [];
}

/** The group sizes and each held panel's x inside its group, left group first in row order, then the right. */
function edgeGroups(edges: readonly { k: number; side: 'left' | 'right' }[], present: readonly PanelRowEntry[], allWidths: readonly number[], gap: number): { leftInset: number; rightInset: number; held: RowNumbers['held'] } {
  const { leftInset, rightInset } = insetsOf(edges, allWidths, gap);
  const held: RowNumbers['held'][number][] = [];
  let x = 0;
  for (const e of edges) {
    if (e.side !== 'left') continue;
    held.push({ id: present[e.k]!.id, side: 'left', width: allWidths[e.k]!, offset: x });
    x += allWidths[e.k]! + gap;
  }
  x = gap;
  for (const e of edges) {
    if (e.side !== 'right') continue;
    held.push({ id: present[e.k]!.id, side: 'right', width: allWidths[e.k]!, offset: x });
    x += allWidths[e.k]! + gap;
  }
  return { leftInset, rightInset, held };
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
  const left = n.stripStart + n.leftOffsets[k]!;
  return (pin === 'end' ? left + n.widths[k]! : left) - edge;
}

/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n: RowNumbers): number {
  return Number.isFinite(n.windowWidth) ? Math.max(0, n.stripStart + n.stripWidth + n.rightInset + n.endPad - n.windowWidth) : 0;
}
