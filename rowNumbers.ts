/**
 * The row's one set of numbers: which entries are drawn, how wide each is, where each rests and where the strip
 * starts. The shell, the row and the capacity hooks all read this result, so none of them can disagree with another.
 * Pure: no DOM, no React.
 */
import { isPresent, type PanelRowEntry } from './panelRowEntry.js';
import { drawnSlotsOf, panelWidthOf } from './panelTiers.js';
import { layoutOf, type RowModel } from './rowModel.js';

/** What `computeRowNumbers` returns: one row's measurements, derived from its entries and never stored. @public */
export interface RowNumbers {
  /** Always true: every row is one scrolling strip, and no panel is parked for room. */
  rowScroll: boolean;
  /** The width the strip is seen through: the container less one gap each side. `Infinity` before the row is measured. */
  windowWidth: number;
  /** The width of every drawn entry plus one gap between each two. */
  stripWidth: number;
  /** The row's left margin: centering for a strip that fits, the centering space before the strip on a stepping row that overflows, else 0. */
  rowMarginLeft: number;
  /** The ids of the drawn entries in the strip, in row order. Sticky panels are not here; `held` lists them. */
  ids: readonly string[];
  /** The width of each drawn entry, in the order of `ids`. */
  widths: readonly number[];
  /** Each drawn entry's resting x inside the strip: the widths before it plus one gap each. */
  leftOffsets: readonly number[];
  /** The sticky panels, left group first. Each is drawn in its edge's group, beside the strip and never inside it, so it does not move while the strip scrolls. */
  held: readonly {
    /** The panel's id. */
    id: string;
    /** The end of the row the panel's group sits at: 'left' for `sticky: 'start'`, 'right' for `'end'`. */
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
  /** The width the strip is seen through: the window less both groups. `windowWidth` when no panel is sticky. */
  stripWindow: number;
  /** The widest one panel can be in this row; `Infinity` before the row is measured. */
  maxLiveWidth: number;
  /** The widths of every drawn entry, the sticky panels included: the row never parks a panel for room. */
  reservedWidths: readonly number[];
  /** Always empty: the row never parks a panel for room. */
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
  /** The space after the strip: on a stepping row that overflows, the same centering space as before it, so the last rest centers too; else 0. */
  endPad: number;
  /** Set for the commit a panel turns sticky or stops being sticky, or a step swaps panels: how far the strip's kept panels moved in strip px. The row takes it into its offset so nothing on screen moves. */
  anchor?: number;
}

/**
 * The numbers for one row. Every row is one scrolling strip: it draws every entry, sizes each panel from its slots and no
 * wider than the window, and centers only a strip that fits.
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
  /** Ignored: every row is a scrolling strip, which no fixed-column count prices. */
  fixedItemCount?: number;
  /** True for a row whose gesture is 'step': the row then rests on the one-phone grid, `stops`. Default false. */
  wholePanels?: boolean;
  /** The fewest slots the scrolling row keeps beside the sticky panels (`tuning.minScrollSlots`). Default 1. */
  minScrollSlots?: number;
}): RowNumbers {
  return rowNumberSources.model(i) ?? legacyRowNumbers(i);
}

/** Where `computeRowNumbers` asks first. A test swaps `model` to see that the answer really comes through it. @internal */
export const rowNumberSources: { model: (i: Parameters<typeof computeRowNumbers>[0]) => RowNumbers | null } = { model: (i) => rowNumbersViaModel(i) };

/**
 * The row's numbers by the arithmetic that predates the position model, kept as the reference the model's adapter is compared with,
 * and the answer for the rows the model does not express.
 * @internal
 */
export function legacyRowNumbers(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers {
  const present = i.entries.filter(isPresent);
  const measured = i.containerWidth !== 0;
  const windowWidth = measured ? Math.max(0, i.containerWidth - 2 * i.gap) : Number.POSITIVE_INFINITY;
  const maxLiveWidth = Math.max(i.phoneWidth, windowWidth);
  const allWidths = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  const plan = stickyPlanOf(present, allWidths, { gap: i.gap, phoneWidth: i.phoneWidth, windowWidth, minScrollSlots: i.minScrollSlots ?? 1 });
  const edges: Edge[] = plan.picks;
  const { leftInset, rightInset, held } = edgeGroups(edges, present, allWidths, i.gap);
  const heldAt = new Set(edges.map((e) => e.k));
  const strip = present.flatMap((p, k) => (heldAt.has(k) ? [] : [{ p, k }]));
  const ids = strip.map((x) => x.p.id);
  const widths = strip.map((x) => allWidths[x.k]!);
  const panelsWidth = contentLength(widths, i.gap);
  const stripWindow = Math.max(0, windowWidth - leftInset - rightInset);
  const leftOffsets: number[] = [];
  let running = 0;
  for (const width of widths) {
    leftOffsets.push(running);
    running += width + i.gap;
  }
  const overflows = measured && panelsWidth > stripWindow;
  const stripWidth = panelsWidth;
  const stepping = i.wholePanels === true && overflows;
  // A stepping row centers the whole slots at every rest, the ends included: the window's leftover past its whole slots is split
  // into a space before the strip and one after it. Any other overflowing row is flush at both ends. A strip that fits centers
  // between the sticky groups' insets, so a sticky panel stays flush to its edge.
  const centering = stepping ? ((stripWindow + i.gap) % (i.phoneWidth + i.gap)) / 2 : 0;
  const rowMarginLeft = !measured ? 0 : overflows ? centering : (stripWindow - stripWidth) / 2;
  const endPad = centering;
  const maxScroll = stepping ? flushEndRest({ rowMarginLeft, stripWidth, endPad, stripWindow }) : 0;
  const stops = stepping ? restStops(maxScroll, i.phoneWidth + i.gap, { widths, offsets: leftOffsets, rowMarginLeft, gap: i.gap, windowWidth: stripWindow }) : [];
  const stepStops = stops;
  const stopSpans = stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, stripWindow));
  const reservedWidths = [...present.flatMap((_, k) => (heldAt.has(k) ? [] : [allWidths[k]!])), ...edges.map((e) => allWidths[e.k]!)];
  return { rowScroll: true, windowWidth, stripWidth, rowMarginLeft, ids, widths, leftOffsets, held, leftInset, rightInset, stripStart: leftInset + rowMarginLeft, stripWindow, maxLiveWidth, reservedWidths, parkLiveWidths: [], stops, stepStops, stopSpans, endPad };
}

/**
 * The row's numbers read off the position model, or null for a row the model does not express: an unmeasured window, a scrolling row
 * whose window is narrower than a phone, and any row with a sticky panel, which `computeRowNumbers` answers with the older arithmetic. @internal
 */
export function rowNumbersViaModel(i: Parameters<typeof computeRowNumbers>[0]): RowNumbers | null {
  const present = i.entries.filter(isPresent);
  const measured = i.containerWidth !== 0;
  if (!measured) return null;
  const windowWidth = Math.max(0, i.containerWidth - 2 * i.gap);
  if (windowWidth < i.phoneWidth) return null;
  const maxLiveWidth = Math.max(i.phoneWidth, windowWidth);
  const panels = present.map((p) => ({ id: p.id, slots: drawnSlotsOf(p, i.phoneWidth, maxLiveWidth, i.gap) ?? 1 }));
  const widthsOf = present.map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, i.gap));
  if (stickyPlanOf(present, widthsOf, { gap: i.gap, phoneWidth: i.phoneWidth, windowWidth, minScrollSlots: i.minScrollSlots ?? 1 }).picks.length > 0) return null;
  const model: RowModel = { panels, heldLeft: null, heldRight: null, phonePx: i.phoneWidth, gapPx: i.gap, windowPx: windowWidth, view: 0 };
  const l = layoutOf(model);
  const overflows = l.stripPx > windowWidth;
  const widths = l.drawn.map((d) => d.w);
  const leftOffsets = l.drawn.map((d) => d.x);
  const stripWidth = l.drawn.length === 0 ? 0 : l.stripPx;
  const stepping = i.wholePanels === true && overflows;
  const rowMarginLeft = stepping || !overflows ? l.centerPx : 0;
  const endPad = stepping ? l.centerPx : 0;
  // The model's rests are views; the row's are scroll offsets, which start where the strip's first slot does.
  const stops = stepping ? l.stops.map((s) => s + l.centerPx) : [];
  return {
    rowScroll: true,
    windowWidth,
    stripWidth,
    rowMarginLeft,
    ids: l.drawn.map((d) => d.id),
    widths,
    leftOffsets,
    held: [],
    leftInset: 0,
    rightInset: 0,
    stripStart: rowMarginLeft,
    stripWindow: windowWidth,
    maxLiveWidth,
    reservedWidths: widths,
    parkLiveWidths: [],
    stops,
    stepStops: stops,
    stopSpans: stops.map((at) => spanAt(at, widths, leftOffsets, rowMarginLeft, windowWidth)),
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
 * The window a strip panel may show in at scroll `at`, in the window's coordinates: the grid less the sticky groups.
 * Nothing of the strip draws under or beside a sticky panel. @internal
 */
export function stripWindowAt(n: RowNumbers, _at: number, _gap: number): { lo: number; hi: number } {
  const grid = gridEdgesOf(n);
  return { lo: grid.lo + n.leftInset, hi: grid.hi - n.rightInset };
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

/** The `slots` a panel `width` px wide spans, a half slot rounding up. */
const slotsOfPx = (width: number, phoneWidth: number, gap: number): number => Math.max(1, Math.round((width + gap) / (phoneWidth + gap)));

/** What `stickyPlanOf` decided: the panels that take a slot out of the scrolling row, and how the window's slots divide. @internal */
export interface StickyPlan {
  /** The sticky panels in effect, in row order: the index into the present entries and the group each sits in. */
  picks: { k: number; side: 'left' | 'right' }[];
  /** The whole slots the window holds; 0 while it is unmeasured. */
  totalSlots: number;
  /** The slots the sticky panels take. */
  stickySlots: number;
  /** The slots left to the scrolling row. */
  scrollSlots: number;
}

/**
 * Which sticky panels are in effect. A panel whose `sticky` is 'start' or 'end' takes its slots whenever the window has room, so the
 * scrolling row keeps at least `minScrollSlots` slots (and at least one while a panel is left in it). While they do not fit, the
 * panel with the lowest `stickyRank` goes back into the scrolling row, the later one in the row first among equals; it is sticky
 * again as soon as the room returns, and its setting never changed. A window of one slot has no sticky panels; an unmeasured one has none either.
 * @internal
 */
export function stickyPlanOf(present: readonly PanelRowEntry[], allWidths: readonly number[], g: { gap: number; phoneWidth: number; windowWidth: number; minScrollSlots: number }): StickyPlan {
  const pitch = g.phoneWidth + g.gap;
  if (!Number.isFinite(g.windowWidth) || !(pitch > 0)) return { picks: [], totalSlots: 0, stickySlots: 0, scrollSlots: 0 };
  const totalSlots = Math.max(1, Math.floor((g.windowWidth + g.gap) / pitch));
  const candidates = present.flatMap((p, k) => {
    const sticky = p.settings?.sticky;
    if (sticky !== 'start' && sticky !== 'end') return [];
    return [{ k, side: sticky === 'end' ? ('right' as const) : ('left' as const), slots: slotsOfPx(allWidths[k]!, g.phoneWidth, g.gap), rank: p.settings?.stickyRank ?? 0 }];
  });
  const kept = stickyKept(candidates, present.length, totalSlots, g.minScrollSlots);
  const stickySlots = kept.reduce((sum, c) => sum + c.slots, 0);
  return { picks: kept.map(({ k, side }) => ({ k, side })), totalSlots, stickySlots, scrollSlots: totalSlots - stickySlots };
}

/** A sticky panel that asks for its slots: its index among the present panels, how many slots it takes and its `stickyRank`. @internal */
export interface StickyCandidate {
  k: number;
  slots: number;
  rank: number;
}

/** Whether `a` goes back into the scrolling row before `b`: the lower rank first, and of equal rank the one later in the row. @internal */
export const returnsBefore = (a: StickyCandidate, b: StickyCandidate): boolean => a.rank < b.rank || (a.rank === b.rank && a.k > b.k);

/**
 * The candidates that stay sticky in a window of `totalSlots`: all of them while they and the scrolling row's least room fit, else the
 * lowest-priority one at a time goes back (`returnsBefore`). The least room is `minScrollSlots`, and one slot while a panel is left in
 * the row (`presentCount` is every panel drawn, sticky or not). A window of one slot keeps none.
 * @internal
 */
export function stickyKept<T extends StickyCandidate>(all: readonly T[], presentCount: number, totalSlots: number, minScrollSlots: number): T[] {
  let candidates = totalSlots < 2 ? [] : [...all];
  const used = (): number => candidates.reduce((sum, c) => sum + c.slots, 0);
  while (candidates.length > 0) {
    // A panel left in the scrolling row needs a slot to be drawn in, whatever the minimum says.
    const need = Math.max(minScrollSlots, presentCount - candidates.length > 0 ? 1 : 0);
    if (used() + need <= totalSlots) break;
    let lowest = 0;
    for (const [j, c] of candidates.entries()) if (returnsBefore(c, candidates[lowest]!)) lowest = j;
    candidates = candidates.filter((_, j) => j !== lowest);
  }
  return candidates;
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

/** One piece of the row, read left to right: a sticky panel that never scrolls, or the scrolling row between them. @public */
export type RowSegment =
  | {
      /** A panel that takes its slots out of the scrolling row and never moves. */
      kind: 'sticky';
      /** The sticky panel's id. */
      panelId: string;
      /** The slots the panel takes. */
      slots: number;
      /** Which end of the row the panel sits at: its `sticky` setting. */
      side: 'start' | 'end';
    }
  | {
      /** The scrolling row. */
      kind: 'scroll';
      /** The whole slots of room the scrolling row has in the window; 0 when every slot is sticky. */
      slots: number;
      /** The ids of the panels the scrolling row draws, in row order; empty when it holds none. */
      panelIds: readonly string[];
    };

/**
 * The row read as segments from its numbers: the start group's sticky panels in row order, the scrolling row, then the end group's.
 * The scrolling row is left out only when it has no room and no panel. `pitch` is one phone plus one gap. @internal
 */
export function rowSegmentsOf(n: RowNumbers, pitch: number, gap: number): readonly RowSegment[] {
  const sticky = (side: 'left' | 'right'): RowSegment[] => n.held.filter((h) => h.side === side).map((h) => ({ kind: 'sticky', panelId: h.id, slots: Math.max(1, Math.round((h.width + gap) / pitch)), side: side === 'left' ? 'start' : 'end' }));
  const room = Number.isFinite(n.stripWindow) && pitch > 0 ? Math.max(0, Math.floor((n.stripWindow + gap) / pitch)) : 0;
  const scroll: RowSegment[] = room === 0 && n.ids.length === 0 ? [] : [{ kind: 'scroll', slots: room, panelIds: [...n.ids] }];
  return [...sticky('left'), ...scroll, ...sticky('right')];
}
