/**
 * The row's position model: one ordered list of every panel on one continuous ruler, and one number, `view`, for where the
 * window sits on it. Everything else (where a panel is on screen, which panels are shown, parked or held, where the dots are)
 * is derived from those two and never stored. Pure: no DOM, no React, no animation state.
 */

/** A panel is a whole number of slots wide, so every width plus its gap is a multiple of the pitch; the stops rely on it. */
export interface RowPanel {
  readonly id: string;
  readonly slots: number;
  /** Not drawn and given no dot and no length on the ruler, as a panel that never reveals on scroll. */
  readonly hidden?: boolean;
}

export interface RowModel {
  /** Every panel in order. Nothing leaves this list for being parked or held. */
  readonly panels: readonly RowPanel[];
  /** The id of the panel held at the left edge, or null. Held only while it is the first drawn panel and the window leaves it a phone's room. */
  readonly heldLeft: string | null;
  readonly phonePx: number;
  readonly gapPx: number;
  /** The measured container less its padding. A finite number: an unmeasured row has no model. */
  readonly windowPx: number;
  /** The window's left edge along the ruler, in px. The one scalar a driver animates. */
  readonly view: number;
  /** How far outside the window a panel stays mounted. Default 0. */
  readonly overscanPx?: number;
}

/** Positions within this many px are the same position; the arithmetic is exact for integers and this absorbs a centering half-pixel. */
export const EPS_PX = 0.5;

/** How little of a panel may be missing from the grid and still count as shown: the tolerance plus a margin over the float noise of scaling it to a dot. */
export const SHOWN_TOLERANCE_PX = EPS_PX + 1e-6;

export interface DrawnPanel {
  readonly id: string;
  /** Index in `RowModel.panels`. */
  readonly index: number;
  readonly slots: number;
  /** Left edge on the ruler: the running sum of the drawn widths and gaps before it, parked panels included. */
  readonly x: number;
  readonly w: number;
}

export interface RowLayout {
  readonly drawn: readonly DrawnPanel[];
  readonly pitchPx: number;
  readonly stripPx: number;
  /** The held panel when the hold is in effect, else null. */
  readonly held: DrawnPanel | null;
  /** Space left of the first whole slot and right of the last, so the slots a rest shows are centered. */
  readonly centerPx: number;
  /** The span of the window, in window px, that unheld panels count as shown inside: the grid less the held panel. */
  readonly lo: number;
  readonly hi: number;
  /** Every `view` the row rests on, ascending. */
  readonly stops: readonly number[];
}

const widthOf = (slots: number, phonePx: number, gapPx: number): number => slots * phonePx + (slots - 1) * gapPx;

export function layoutOf(m: RowModel): RowLayout {
  const pitchPx = m.phonePx + m.gapPx;
  const drawn: DrawnPanel[] = [];
  let x = 0;
  let totalSlots = 0;
  m.panels.forEach((p, index) => {
    if (p.hidden === true) return;
    const w = widthOf(p.slots, m.phonePx, m.gapPx);
    drawn.push({ id: p.id, index, slots: p.slots, x, w });
    x += w + m.gapPx;
    totalSlots += p.slots;
  });
  const stripPx = drawn.length === 0 ? 0 : x - m.gapPx;
  const first = drawn[0];
  // A hold that leaves less than a phone of room is a plain first panel, so a narrowing window never needs a second code path.
  const held = first !== undefined && first.id === m.heldLeft && first.w + pitchPx <= m.windowPx ? first : null;
  const fits = stripPx <= m.windowPx;
  const wholeSlots = Math.max(1, Math.floor((m.windowPx + m.gapPx) / pitchPx));
  // The centering depends on the window and the strip alone, never on the hold, so a hold flip cannot change where a rest is.
  const centerPx = fits ? (m.windowPx - stripPx) / 2 : Math.max(0, (m.windowPx + m.gapPx - wholeSlots * pitchPx) / 2);
  const last = fits ? 0 : Math.max(0, totalSlots - wholeSlots);
  const stops: number[] = [];
  for (let n = 0; n <= last; n += 1) stops.push(n * pitchPx - centerPx);
  const heldEdge = held === null ? 0 : held.w + m.gapPx;
  return { drawn, pitchPx, stripPx, held, centerPx, lo: centerPx + heldEdge, hi: m.windowPx - centerPx, stops };
}

const clampTo = (v: number, low: number, high: number): number => Math.min(high, Math.max(low, v));

function clampView(l: RowLayout, v: number): number {
  const low = l.stops[0];
  const high = l.stops[l.stops.length - 1];
  return low === undefined || high === undefined ? v : clampTo(v, low, high);
}

/** Where `p` is in the window; the held panel never leaves the left edge. */
function screenAt(l: RowLayout, view: number, p: DrawnPanel): number {
  const s = p.x - view;
  return l.held !== null && p.id === l.held.id ? Math.max(s, 0) : s;
}

export function screenOf(m: RowModel, id: string): number | undefined {
  const l = layoutOf(m);
  const p = l.drawn.find((d) => d.id === id);
  return p === undefined ? undefined : screenAt(l, m.view, p);
}

/**
 * The one on-screen predicate. A panel is shown when all of it lies in the grid less the held panel; one wider than that is shown
 * while it fills it, since no rest can show it whole.
 */
function shownAt(l: RowLayout, view: number, p: DrawnPanel): boolean {
  if (l.held !== null && p.id === l.held.id) return true;
  const s = p.x - view;
  const seen = Math.min(s + p.w, l.hi) - Math.max(s, l.lo);
  return seen >= Math.min(p.w, l.hi - l.lo) - SHOWN_TOLERANCE_PX;
}

export function onScreenIds(m: RowModel): string[] {
  const l = layoutOf(m);
  return l.drawn.filter((p) => shownAt(l, m.view, p)).map((p) => p.id);
}

/** Panels the row need not keep mounted: wholly outside the window by more than the overscan. The held panel is never one. */
export function parkedIds(m: RowModel): string[] {
  const l = layoutOf(m);
  const overscan = m.overscanPx ?? 0;
  return l.drawn
    .filter((p) => {
      if (l.held !== null && p.id === l.held.id) return false;
      const s = p.x - m.view;
      return s + p.w <= -overscan || s >= m.windowPx + overscan;
    })
    .map((p) => p.id);
}

export interface RowDots {
  readonly dots: readonly { id: string; left: number; width: number; lit: boolean }[];
  /** The grid the window shows, less the held panel: the same span as `lo` to `hi`, scaled. */
  readonly oval: { left: number; width: number };
}

/** The ruler shrunk to `trackPx`. A dot is lit by the same rule as `onScreenIds`, applied to the scaled numbers. */
export function dotsOf(m: RowModel, trackPx: number): RowDots {
  const l = layoutOf(m);
  const k = l.stripPx > 0 ? trackPx / l.stripPx : 0;
  const oval = { left: k * (m.view + l.lo), width: k * (l.hi - l.lo) };
  const eps = SHOWN_TOLERANCE_PX * k;
  const dots = l.drawn.map((p) => {
    const isHeld = l.held !== null && p.id === l.held.id;
    // The held panel's dot rides the left edge of the window as the panel does.
    const left = k * (isHeld ? Math.max(p.x, m.view) : p.x);
    const width = k * p.w;
    const seen = Math.min(left + width, oval.left + oval.width) - Math.max(left, oval.left);
    return { id: p.id, left, width, lit: isHeld || seen >= Math.min(width, oval.width) - eps };
  });
  return { dots, oval };
}

export function viewRange(m: RowModel): { min: number; max: number } | null {
  const { stops } = layoutOf(m);
  const min = stops[0];
  const max = stops[stops.length - 1];
  return min === undefined || max === undefined ? null : { min, max };
}

/**
 * Takes a list change into the model: `view` moves by what the leftmost kept panel in the grid moved, so what is on screen
 * stays put. `subject` is the panel the caller is moving on purpose and so cannot be the anchor.
 */
function withPanels(m: RowModel, panels: readonly RowPanel[], subject?: string): RowModel {
  const before = layoutOf(m);
  const heldLeft = m.heldLeft !== null && panels.some((p) => p.id === m.heldLeft) ? m.heldLeft : null;
  const next: RowModel = { ...m, panels, heldLeft };
  const after = layoutOf(next);
  const afterX = new Map(after.drawn.map((p) => [p.id, p.x]));
  const kept = before.drawn.filter((p) => afterX.has(p.id) && p.id !== subject && p.id !== before.held?.id && p.id !== after.held?.id);
  const anchor = kept.find((p) => shownOverlap(before, m.view, p)) ?? kept[0];
  const shift = anchor === undefined ? 0 : afterX.get(anchor.id)! - anchor.x;
  return { ...next, view: clampView(after, m.view + shift) };
}

const shownOverlap = (l: RowLayout, view: number, p: DrawnPanel): boolean =>
  Math.min(p.x - view + p.w, l.hi) - Math.max(p.x - view, l.lo) > EPS_PX;

/** The lowest index a list change may use: nothing goes in front of the held panel. */
function floorIndex(m: RowModel): number {
  if (m.heldLeft === null) return 0;
  const at = m.panels.findIndex((p) => p.id === m.heldLeft);
  return at < 0 ? 0 : at + 1;
}

export function open(m: RowModel, panel: RowPanel, index: number = m.panels.length): RowModel {
  if (m.panels.some((p) => p.id === panel.id)) return m;
  const at = clampTo(index, floorIndex(m), m.panels.length);
  return withPanels(m, [...m.panels.slice(0, at), panel, ...m.panels.slice(at)], panel.id);
}

export function close(m: RowModel, id: string): RowModel {
  return m.panels.some((p) => p.id === id) ? withPanels(m, m.panels.filter((p) => p.id !== id)) : m;
}

/** Moves `id` so it ends at `to` in the new list. The held panel does not move, and nothing moves in front of it. */
export function reorder(m: RowModel, id: string, to: number): RowModel {
  const from = m.panels.findIndex((p) => p.id === id);
  if (from < 0 || id === m.heldLeft) return m;
  const rest = m.panels.filter((p) => p.id !== id);
  const at = clampTo(to, floorIndex(m), rest.length);
  return withPanels(m, [...rest.slice(0, at), m.panels[from]!, ...rest.slice(at)], id);
}

export function resize(m: RowModel, id: string, slots: number): RowModel {
  const s = Math.max(1, Math.round(slots));
  if (!m.panels.some((p) => p.id === id && p.slots !== s)) return m;
  return withPanels(m, m.panels.map((p) => (p.id === id ? { ...p, slots: s } : p)));
}

/** Holds `id` at the left edge, or lets go with null. Only the first drawn panel can be held. */
export function hold(m: RowModel, id: string | null): RowModel {
  if (id === null) return m.heldLeft === null ? m : { ...m, heldLeft: null };
  const first = layoutOf(m).drawn[0];
  return first !== undefined && first.id === id && m.heldLeft !== id ? { ...m, heldLeft: id } : m;
}

/** A window change keeps every panel where it is; the grid moves under it, so call `settle` to land on a rest. */
export function setWindow(m: RowModel, windowPx: number): RowModel {
  const next = { ...m, windowPx };
  return { ...next, view: clampView(layoutOf(next), m.view) };
}

/** One slot toward `dir`: the next rest in that direction, and no move when there is none. */
export function step(m: RowModel, dir: -1 | 1): RowModel {
  const { stops } = layoutOf(m);
  const to = dir === 1 ? stops.find((s) => s > m.view + EPS_PX) : [...stops].reverse().find((s) => s < m.view - EPS_PX);
  return to === undefined ? m : { ...m, view: to };
}

/** A drag by `dx` screen px: the content follows the pointer, held inside the range of rests. */
export function dragBy(m: RowModel, dx: number): RowModel {
  return { ...m, view: clampView(layoutOf(m), m.view - dx) };
}

/** The nearest rest: what a release or a window change lands on. The earlier rest wins a tie. */
export function settle(m: RowModel): RowModel {
  const { stops } = layoutOf(m);
  let best: number | undefined;
  for (const s of stops) if (best === undefined || Math.abs(s - m.view) < Math.abs(best - m.view)) best = s;
  return best === undefined ? m : { ...m, view: best };
}

export function atRest(m: RowModel): boolean {
  return layoutOf(m).stops.some((s) => Math.abs(s - m.view) <= EPS_PX);
}
