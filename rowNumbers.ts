/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { computeMaxLiveWidth, computeRowLayout } from './panelRowLayout.js';
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { drawnSlotsOf, panelWidthOf } from './panelTiers.js';
import { parksForRoom } from './panelWindow.js';
import { layoutOf, type RowModel } from './rowModel.js';
import type { RowRest } from './rowRest.js';

/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
  /** True when any drawn entry carries settings whose `overflow` is 'scroll': the row scrolls instead of parking for room. */
  rowScroll: boolean;
  /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
  windowWidth: number;
  /** The width of every drawn entry plus one gap between each two. */
  stripWidth: number;
  /** The row's left margin: centering for a strip that fits, the centering space before the strip on a stepping row that overflows, else 0. */
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
  /**
   * The edgeHold 'both' panels that stick, in row order: each is drawn in the strip at its own place and holds at whichever edge
   * the scroll takes it past. `left` and `right` are the insets from the scrollport's edges that it keeps clear of the fixed
   * groups and of the 'both' panels stacked on its edge. Empty when the row does not scroll.
   */
  stuck: readonly {
    /** The panel's id. */
    id: string;
    /** The inset from the scrollport's left edge the panel's left edge keeps. */
    left: number;
    /** The inset from the scrollport's right edge the panel's right edge keeps. */
    right: number;
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
  /** The widths of the drawn entries the row never parks for room, the held and sticky panels included. */
  reservedWidths: readonly number[];
  /** The widths of the drawn entries the row may park for room. */
  parkLiveWidths: readonly number[];
  /**
   * The `scrollLeft` values a stepping row rests on, ascending; the first is 0 and the last is the row's end (`maxScrollOf`).
   * No two are more than one phone width apart. Empty when the row does not scroll, or its strip fits the window and keeps its centering.
   */
  stops: readonly number[];
  /** The same values as `stops`, under the step's name. Empty when `stops` is. */
  stepStops: readonly number[];
  /** For each stop, the drawn entries it shows: the index of its first one and one past its last. Same order as `stops`. */
  stopSpans: readonly { first: number; end: number }[];
  /** The blank a rest leaves before the parking panels, in px; `leftOffsets` already hold it. Absent reads as none. */
  leadPx?: number;
  /** The space after the strip: on a stepping row that overflows, the same centering space as before it, so the last rest centers too; else 0. */
  endPad: number;
  /** Set for the commit a hold starts or lets go, or a step swaps panels: how far the strip's kept panels moved in strip px. The row takes it into its offset so nothing on screen moves. */
  anchor?: number;
}

/**
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centers only a strip that fits.
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
  /** The blanks a parking row rests with: a strip that fits draws them, one that overflows ignores them. Default none. */
  rest?: RowRest | null;
}): RowNumbers {
  return rowNumbersViaModel(i) ?? legacyRowNumbers(i);
}

/**
 * The row's numbers by the arithmetic that predates the position model, kept as the reference the model's adapter is compared with.
 * The numbers for one row. A row whose entries carry no `overflow: 'scroll'` settings gets the numbers of a row that
 * never scrolls (`computeMaxLiveWidth`, `computeRowLayout`'s margin). A scrolling row draws every entry, sizes each panel from its slots
 * and no wider than the window, and centers only a strip that fits.
 * @internal
 */
export function legacyRowNumbers(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers {
  const present = i.entries.filter(isPresent);
  // Reads the settings the entry carries, never effective(): a hand-built fixed History reads 'scroll' under effective()
  // and would turn every hand-built row into a scrolling one.
  const rowScroll = present.some((p) => p.settings?.overflow === 'scroll');
  const measured = i.containerWidth !== 0;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
  const fixedItemCount = i.fixedItemCount ?? present.filter((p) => !p.collapsible).length;
  const maxLiveWidth = rowScroll ? Math.max(i.phoneWidth, windowWidth) : computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount });
  const allWidths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  const admitted = rowScroll && measured ? admitHolds(present, allWidths, i.gap, i.phoneWidth, windowWidth) : [];
  const admittedKs = new Set(admitted.map((a) => a.k));
  // Only the left and right holds take a group in flow; a 'both' panel stays in the strip and sticks where it is drawn.
  const edges: Edge[] = admitted.flatMap((a) => (a.hold === 'both' ? [] : [{ k: a.k, side: a.hold }]));
  const { leftInset, rightInset, held } = edgeGroups(edges, present, allWidths, i.gap);
  const heldAt = new Set(edges.map((e) => e.k));
  const strip = present.flatMap((p, k) => (heldAt.has(k) ? [] : [{ p, k }]));
  const ids = strip.map((x) => x.p.id);
  const widths = strip.map((x) => allWidths[x.k]!);
  const panelsWidth = contentLength(widths, i.gap);
  const stripWindow = windowWidth - leftInset - rightInset;
  const leftOffsets: number[] = [];
  let running = 0;
  for (const width of widths) {
    leftOffsets.push(running);
    running += width + i.gap;
  }
  const overflows = rowScroll && measured && panelsWidth > stripWindow;
  // A rest's blanks count as strip, so the margin stays the full row's and the always-shown columns do not move.
  const rest = !overflows && measured ? (i.rest ?? null) : null;
  const slotPx = i.phoneWidth + i.gap;
  const firstParking = rest === null ? -1 : strip.findIndex((x) => parksForRoom(x.p));
  if (rest !== null && firstParking >= 0) for (let k = firstParking; k < leftOffsets.length; k += 1) leftOffsets[k] = leftOffsets[k]! + rest.lead * slotPx;
  const headPx = (rest?.head ?? 0) * slotPx;
  if (headPx > 0) for (let k = 0; k < leftOffsets.length; k += 1) leftOffsets[k] = leftOffsets[k]! + headPx;
  const stripWidth = panelsWidth + headPx + (rest === null ? 0 : (rest.lead + rest.tail) * slotPx);
  const stepping = i.wholePanels === true && overflows;
  // A stepping row centers the whole slots at every rest, the ends included: the window's leftover past its whole slots is split
  // into a space before the strip and one after it. Any other overflowing row is flush at both ends. A strip that fits centers
  // between the held groups' insets, so a held panel stays flush to its edge.
  const centering = stepping ? ((stripWindow + i.gap) % (i.phoneWidth + i.gap)) / 2 : 0;
  let rowMarginLeft: number;
  if (!rowScroll) {
    rowMarginLeft = computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap, fixedItemCount, liveWidths: present.flatMap((p, k) => (p.collapsible ? [allWidths[k]!] : [])) }).computedRowMarginLeft;
  } else {
    rowMarginLeft = !measured ? 0 : overflows ? centering : (stripWindow - stripWidth) / 2;
  }
  const endPad = centering;
  const maxScroll = stepping ? flushEndRest({ rowMarginLeft, stripWidth, endPad, stripWindow }) : 0;
  // A 'both' panel keeps clear of the fixed groups and of the 'both' panels that stack on its edge. Scroll pins an earlier one
  // whenever it pins a later one, so the stack on the left runs in row order from the left group, and on the right it runs in
  // row order from the right group: the outermost panel of each stack sits nearest the window edge.
  const bothKs = admitted.filter((a) => a.hold === 'both').map((a) => a.k);
  const stacked = (ks: readonly number[]): number => ks.reduce((sum, k) => sum + allWidths[k]! + i.gap, 0);
  const stuck: RowNumbers['stuck'][number][] = bothKs.map((k, j) => ({
    id: present[k]!.id,
    left: leftInset + stacked(bothKs.slice(0, j)),
    right: rightInset + i.gap + stacked(bothKs.slice(j + 1)),
  }));
  const stops = stepping ? restStops(maxScroll, i.phoneWidth + i.gap, { widths, offsets: leftOffsets, rowMarginLeft, gap: i.gap, windowWidth: stripWindow }) : [];
  const stepStops = stops;
  const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, stripWindow));
  // A panel the row admits is never parked for room, whether it is held or sticks in the strip.
  const reservedWidths = [...present.flatMap((p, k) => (admittedKs.has(k) || parksForRoom(p) ? [] : [allWidths[k]!])), ...admitted.map((a) => allWidths[a.k]!)];
  const parkLiveWidths = present.flatMap((p, k) => (admittedKs.has(k) || !parksForRoom(p) ? [] : [allWidths[k]!]));
  return { rowScroll, windowWidth, stripWidth, rowMarginLeft, ids, widths, leftOffsets, held, stuck, leftInset, rightInset, stripStart: leftInset + rowMarginLeft, stripWindow, maxLiveWidth, reservedWidths, parkLiveWidths, stops, stepStops, stopSpans, endPad, ...(rest !== null && rest.lead > 0 ? { leadPx: rest.lead * slotPx } : {}) };
}

/**
 * The row's numbers read off the position model, or null for a row the model does not express: an unmeasured window, a row
 * that does not scroll, a window narrower than a phone, a hold that is not the first panel's left hold, and rests that draw
 * blanks. `computeRowNumbers` then answers with the older arithmetic. @internal
 */
export function rowNumbersViaModel(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers | null {
  const present = i.entries.filter(isPresent);
  const measured = i.containerWidth !== 0;
  if (!measured || !present.some((p) => p.settings?.overflow === 'scroll')) return null;
  const windowWidth = Math.max(0, i.containerWidth - 2 * i.gap);
  if (windowWidth < i.phoneWidth) return null;
  const holds = present.flatMap((p, k) => (p.settings?.edgeHold === 'left' || p.settings?.edgeHold === 'right' || p.settings?.edgeHold === 'both' ? [{ k, hold: p.settings.edgeHold }] : []));
  if (holds.some((h) => h.hold !== 'left' || h.k !== 0)) return null;
  const maxLiveWidth = Math.max(i.phoneWidth, windowWidth);
  const model: RowModel = {
    panels: present.map((p) => ({ id: p.id, slots: drawnSlotsOf(p, i.phoneWidth, maxLiveWidth, i.gap) ?? 1 })),
    heldLeft: holds.length > 0 ? present[0]!.id : null,
    phonePx: i.phoneWidth,
    gapPx: i.gap,
    windowPx: windowWidth,
    view: 0,
  };
  const l = layoutOf(model);
  const overflows = l.stripPx > windowWidth;
  if (!overflows && i.rest != null) return null;
  // Only a row that overflows holds: a row that fits gives the hold back, as it always has.
  const held = overflows ? l.held : null;
  const leftInset = held === null ? 0 : held.w + i.gap;
  const strip = l.drawn.filter((d) => d !== held);
  const widths = strip.map((d) => d.w);
  const leftOffsets = strip.map((d) => d.x - leftInset);
  const stripWidth = strip.length === 0 ? 0 : l.stripPx - leftInset;
  const stripWindow = windowWidth - leftInset;
  const stepping = i.wholePanels === true && overflows;
  const rowMarginLeft = stepping || !overflows ? l.centerPx : 0;
  const endPad = stepping ? l.centerPx : 0;
  // The model's rests are views; the row's are scroll offsets, which start where the strip's first slot does.
  const stops = stepping ? l.stops.map((s) => s + l.centerPx) : [];
  const allWidths = l.drawn.map((d) => d.w);
  const heldAt = held === null ? -1 : 0;
  return {
    rowScroll: true,
    windowWidth,
    stripWidth,
    rowMarginLeft,
    ids: strip.map((d) => d.id),
    widths,
    leftOffsets,
    held: held === null ? [] : [{ id: held.id, side: 'left', width: held.w, offset: 0 }],
    stuck: [],
    leftInset,
    rightInset: 0,
    stripStart: leftInset + rowMarginLeft,
    stripWindow,
    maxLiveWidth,
    reservedWidths: [...present.flatMap((p, k) => (k === heldAt || parksForRoom(p) ? [] : [allWidths[k]!])), ...(held === null ? [] : [held.w])],
    parkLiveWidths: present.flatMap((p, k) => (k === heldAt || !parksForRoom(p) ? [] : [allWidths[k]!])),
    stops,
    stepStops: stops,
    stopSpans: stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, stripWindow)),
    endPad,
  };
}

/**
 * The last rest of a stepping row, flush: the last panel fills the last slot, and no slot after it is empty. The one place the end
 * rest is decided; a centered end (empty slots after the last panel) would replace this call alone.
 */
function flushEndRest(g: { rowMarginLeft: number; stripWidth: number; endPad: number; stripWindow: number }): number {
  return g.rowMarginLeft + g.stripWidth + g.endPad - g.stripWindow;
}

/** The two edges of a row's slot grid, in the window's coordinates (0 is the window's left edge): nothing of a panel draws outside them. @internal */
export function gridEdgesOf(n: RowNumbers): { lo: number; hi: number } {
  return { lo: n.rowMarginLeft, hi: n.windowWidth - n.endPad };
}

/**
 * The window a strip panel may show in at scroll `at`, in the window's coordinates: the grid less the held groups, and less a
 * 'both' panel the scroll has stuck at an edge there with its gap. Nothing of the strip draws under or beside a held or stuck panel. @internal
 */
export function stripWindowAt(n: RowNumbers, at: number, gap: number): { lo: number; hi: number } {
  const grid = gridEdgesOf(n);
  let lo = grid.lo + n.leftInset;
  let hi = grid.hi - n.rightInset;
  for (const s of n.stuck) {
    const k = n.ids.indexOf(s.id);
    if (k < 0) continue;
    const { left, right } = slotSpanAt(n, k, at);
    if (left < s.left) lo = Math.max(lo, s.left + n.widths[k]! + gap);
    else if (right > n.windowWidth + gap - s.right) hi = Math.min(hi, n.windowWidth - s.right - n.widths[k]!);
  }
  return { lo, hi };
}

/** Where the drawn entry `k` of `n` rests at scroll `at`, in the window's coordinates. @internal */
export function slotSpanAt(n: RowNumbers, k: number, at: number): { left: number; right: number } {
  const left = n.stripStart + n.leftOffsets[k]! - at;
  return { left, right: left + n.widths[k]! };
}

/**
 * How much of the drawn entry `k` of `n` lies outside its strip window at scroll `at`, in px off each side, and whether it lies
 * wholly outside (`away`): the cut a slot is drawn with, and the reach it keeps. A whole panel at rest cuts 0 and 0. @internal
 */
export function slotCutAt(n: RowNumbers, k: number, at: number, gap: number): { left: number; right: number; away: boolean } {
  const { lo, hi } = stripWindowAt(n, at, gap);
  const span = slotSpanAt(n, k, at);
  const width = span.right - span.left;
  const left = Math.min(width, Math.max(0, lo - span.left));
  const right = Math.min(width, Math.max(0, span.right - hi));
  return { left, right, away: left + right >= width };
}

/**
 * How entry `k` of `n` is drawn in a row whose only hold is a left one, at scroll `at`, in px of its own box: `fade` is where the
 * fade across the held panel's gap starts (it ends one gap further, and null is no fade), and `left` and `right` are the cuts. The
 * left cut is the held panel's edge. The right cut lets a panel past the grid run on toward the window's edge by as much as it has
 * inside the grid, so one wholly past stays hidden and one coming in grows out of the grid's edge with no jump. @internal
 */
export function slotEdgesAt(n: RowNumbers, k: number, at: number, gap: number): { fade: number | null; left: number; right: number } {
  const span = slotSpanAt(n, k, at);
  const width = span.right - span.left;
  const { lo } = stripWindowAt(n, at, gap);
  const under = lo - span.left;
  const cut = slotCutAt(n, k, at, gap);
  const inside = width - cut.left - cut.right;
  const right = cut.right - Math.min(cut.right, inside, n.endPad + gap);
  if (under <= 0) return { fade: null, left: 0, right };
  return { fade: under - gap, left: Math.min(width, Math.max(0, under - gap)), right };
}

/** Whether the drawn entry `index` of `n` lies wholly inside its strip window at scroll `at`, within a pixel. @internal */
export function drawsWhole(n: RowNumbers, index: number, at: number): boolean {
  const { left, right } = slotCutAt(n, index, at, 0);
  return left <= 1 && right <= 1;
}

/** One held entry: the entry's index in the present list and the edge it holds at. */
interface Edge {
  k: number;
  side: 'left' | 'right';
}

/** The length of `widths` laid end to end with one gap between each two: 0 for none. */
function contentLength(widths: readonly number[], gap: number): number {
  return widths.length === 0 ? 0 : widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * gap;
}

/**
 * An entry the row admits to an edge, and the hold it asked for. A `both` entry is admitted on the left's room, since it may
 * stick at either edge, and `side` is the group it counts in for that room.
 */
interface Admitted {
  k: number;
  hold: 'left' | 'right' | 'both';
  side: 'left' | 'right';
}

/**
 * The panels admitted to an edge, in row order, or none. A candidate joins while the window keeps at least one phone's width of
 * strip beside every admitted panel; one that cannot fit lets go and scrolls with the strip. The admissions stand only while the
 * strip without them still overflows the window that remains, so a row that would not scroll releases them all.
 */
function admitHolds(present: readonly PanelRowEntry[], allWidths: readonly number[], gap: number, phoneWidth: number, windowWidth: number): Admitted[] {
  const picked: Admitted[] = [];
  for (const [k, p] of present.entries()) {
    const hold = p.settings?.edgeHold;
    if (hold !== 'left' && hold !== 'right' && hold !== 'both') continue;
    const side = hold === 'right' ? 'right' : 'left';
    const { leftInset, rightInset } = insetsOf([...picked, { k, side }], allWidths, gap);
    if (windowWidth - leftInset - rightInset >= phoneWidth) picked.push({ k, hold, side });
  }
  if (picked.length === 0) return [];
  const { leftInset, rightInset } = insetsOf(picked, allWidths, gap);
  const heldK = new Set(picked.map((e) => e.k));
  const restWidths = allWidths.filter((_, k) => !heldK.has(k));
  return contentLength(restWidths, gap) > windowWidth - leftInset - rightInset ? picked : [];
}

/** The widths the two edge groups take in flow for `picks`: the left group with its trailing gap, the right with its leading one. */
function insetsOf(picks: readonly { k: number; side: 'left' | 'right' }[], allWidths: readonly number[], gap: number): { leftInset: number; rightInset: number } {
  const left = picks.filter((e) => e.side === 'left').map((e) => allWidths[e.k]!);
  const right = picks.filter((e) => e.side === 'right').map((e) => allWidths[e.k]!);
  return { leftInset: left.length === 0 ? 0 : contentLength(left, gap) + gap, rightInset: right.length === 0 ? 0 : gap + contentLength(right, gap) };
}

/** The group sizes and each held panel's x inside its group, left group first in row order, then the right. */
function edgeGroups(edges: readonly Edge[], present: readonly PanelRowEntry[], allWidths: readonly number[], gap: number): { leftInset: number; rightInset: number; held: RowNumbers['held'] } {
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
 * The rests of a stepping row: one per one-phone grid step, so a panel of N slots takes N steps to pass. The space before and
 * after the strip centers the slots every rest shows, the ends included. A panel no rest shows whole (one sized off the slot
 * grid) gets a rest at its left edge. Ascending; the first is 0 and the last is `maxScroll`.
 */
function restStops(maxScroll: number, step: number, g: { widths: readonly number[]; offsets: readonly number[]; rowMarginLeft: number; gap: number; windowWidth: number }): number[] {
  const rests = stepGrid(maxScroll, step);
  const shows = (at: number, j: number): boolean => g.rowMarginLeft + g.offsets[j]! - at >= 0 && g.rowMarginLeft + g.offsets[j]! + g.widths[j]! - at <= g.windowWidth;
  g.widths.forEach((width, j) => {
    if (width <= g.windowWidth && !rests.some((at) => shows(at, j))) rests.push(clampTo(g.rowMarginLeft + g.offsets[j]!, 0, maxScroll));
  });
  rests.sort((x, y) => x - y);
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
  // A stop that reaches a panel may cut it, and a cut panel is never drawn at rest: a panel narrower than its window counts as
  // shown only where it is drawn whole. One as wide as the window or wider is stepped through, and any stop that reaches it shows it.
  const fits = n.widths[index] !== undefined && n.widths[index]! < n.stripWindow - 1;
  let best = -1;
  for (const [k, span] of n.stopSpans.entries()) {
    if (index < span.first || index >= span.end) continue;
    if (fits && !drawsWhole(n, index, n.stops[k]!)) continue;
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

/**
 * The offset change that keeps every panel `prev` and `now` share where it stands, or undefined when there is none to keep: the
 * row's panels and holds did not change, the change is not one that should hold still, or the offset would leave the row's range. @internal
 */
export function rowAnchor(prev: RowNumbers | undefined, now: RowNumbers, base: number, stepped: boolean): number | undefined {
  if (prev === undefined || prev.windowWidth !== now.windowWidth) return undefined;
  const flipped = (prev.held.length > 0) !== (now.held.length > 0);
  if (!flipped && !stepped) return undefined;
  const kept = now.ids.filter((id) => prev.ids.includes(id));
  const shifts = kept.map((id) => now.stripStart + now.leftOffsets[now.ids.indexOf(id)]! - prev.stripStart - prev.leftOffsets[prev.ids.indexOf(id)]!);
  const shift = shifts[0];
  if (shift === undefined || Math.abs(shift) < 1 || shifts.some((x) => Math.abs(x - shift) >= 1)) return undefined;
  return base + shift < -1 || base + shift > maxScrollOf(now) + 1 ? undefined : shift;
}

/** The farthest legal `scrollLeft` for `n`, from its numbers and never read back from the DOM; 0 while unmeasured. @internal */
export function maxScrollOf(n: RowNumbers): number {
  return Number.isFinite(n.windowWidth) ? Math.max(0, n.stripStart + n.stripWidth + n.rightInset + n.endPad - n.windowWidth) : 0;
}
