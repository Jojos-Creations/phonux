/**
 * How the cells of a `WorkspaceColumn` move when the current workspace changes: React-free, written straight to each cell's style
 * after every commit. DESIGN.md, "The workspace column", "Switch motion".
 */
import type { WorkspaceEnterSide } from './columnHandle.js';

/** A cell's offset from where it rests in view, in its own widths (x) and heights (y). */
export interface CellPos {
  x: number;
  y: number;
}

/** One mounted cell, in list order. */
export interface MotionCell {
  id: string;
  el: HTMLElement;
  /** Whether the window shows it: the current workspace, and with side by side the other shown ones. */
  shown: boolean;
}

/** What the column hands the motion after each commit. */
export interface MotionInput {
  cells: readonly MotionCell[];
  /** The current workspace's id. */
  current: string | undefined;
  /** False until the column has been placed on its first workspace: until then every change snaps. */
  placed: boolean;
  reduced: boolean;
  /** Whether a switch under Reduce Motion fades instead of snapping. */
  fade: boolean;
  slide: { duration: number; ease: readonly number[] };
  /** Several cells share the window, so a sideways move is clipped to the cell's own place. */
  split: boolean;
  /** The side the workspace `to` comes in from, after `from` was current. Asked once per switch that moves. */
  side(from: string, to: string): WorkspaceEnterSide;
}

/** The reduced-motion fade, in seconds. */
export const SWITCH_FADE_SEC = 0.15;

const VECTOR: Record<WorkspaceEnterSide, CellPos> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, above: { x: 0, y: -1 }, below: { x: 0, y: 1 } };

/** The side a workspace at `to` comes in from without an app's say: above when it stands before `from`, else below. */
export const sideByIndex = (from: number, to: number): WorkspaceEnterSide => (to < from ? 'above' : 'below');

/**
 * Where the arriving cell starts: just past every cell already moving, on its side, so it never starts on top of one that is
 * still in sight. With nothing moving that is one cell away from the rest place.
 */
export function entryStart(side: WorkspaceEnterSide, moving: readonly CellPos[]): CellPos {
  const v = VECTOR[side];
  const all = moving.length === 0 ? [{ x: 0, y: 0 }] : moving;
  if (v.x !== 0) return { x: v.x > 0 ? Math.max(...all.map((p) => p.x)) + 1 : Math.min(...all.map((p) => p.x)) - 1, y: 0 };
  return { x: 0, y: v.y > 0 ? Math.max(...all.map((p) => p.y)) + 1 : Math.min(...all.map((p) => p.y)) - 1 };
}

const pct = (n: number): string => `${Math.round(n * 1e6) / 1e4}%`;

/** The transform for a position, one axis named where the other is 0. */
export function cellTransform(p: CellPos): string {
  if (p.x === 0) return `translateY(${pct(p.y)})`;
  if (p.y === 0) return `translateX(${pct(p.x)})`;
  return `translate(${pct(p.x)}, ${pct(p.y)})`;
}

/** Cuts off the part of a cell moved sideways out of its own place, so it never draws over the space beside it. */
export const cellClip = (p: CellPos): string => `inset(0% ${pct(Math.max(0, p.x))} 0% ${pct(Math.max(0, -p.x))})`;

/** Where the browser draws a cell this frame, or undefined where it cannot say (no layout, as in jsdom). */
export function drawnPos(el: HTMLElement): CellPos | undefined {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!(w > 0 && h > 0) || typeof getComputedStyle !== 'function') return undefined;
  const t = getComputedStyle(el).transform;
  if (t === 'none') return { x: 0, y: 0 };
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(t);
  if (m === null) return undefined;
  const n = m[2]!.split(',').map(Number);
  const [tx, ty] = m[1] === undefined ? [n[4], n[5]] : [n[12], n[13]];
  return tx === undefined || ty === undefined || !Number.isFinite(tx) || !Number.isFinite(ty) ? undefined : { x: tx / w, y: ty / h };
}

function drawnOpacity(el: HTMLElement): number | undefined {
  if (!(el.offsetWidth > 0) || typeof getComputedStyle !== 'function') return undefined;
  const o = Number.parseFloat(getComputedStyle(el).opacity);
  return Number.isFinite(o) ? o : undefined;
}

/** The column's motion: `sync` after every commit, `dispose` when the column goes. */
export interface ColumnMotion {
  sync(input: MotionInput): void;
  dispose(): void;
}

export function createColumnMotion(): ColumnMotion {
  // Where each cell was last sent, and its opacity; the cells of the running slide or fade; what the last commit showed.
  const pos = new Map<string, CellPos>();
  const opacity = new Map<string, number>();
  let moving = new Set<string>();
  let fading = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: MotionInput | undefined;
  let lastCurrent: string | undefined;
  let lastShown = new Set<string>();

  const parkedAt = (input: MotionInput, id: string): CellPos => {
    const at = input.cells.findIndex((c) => c.id === id);
    const cur = input.cells.findIndex((c) => c.id === input.current);
    return { x: 0, y: at < cur ? -1 : 1 };
  };
  const slideCss = (input: MotionInput, clip: boolean): string => {
    const curve = `${input.slide.duration}s cubic-bezier(${input.slide.ease.join(',')})`;
    return clip ? `transform ${curve}, clip-path ${curve}` : `transform ${curve}`;
  };
  const put = (el: HTMLElement, id: string, p: CellPos, transition: string, clip: string): void => {
    pos.set(id, p);
    el.style.transition = transition;
    el.style.transform = cellTransform(p);
    el.style.clipPath = clip;
  };
  const live = (el: HTMLElement, id: string, fallback: CellPos): CellPos => drawnPos(el) ?? pos.get(id) ?? fallback;

  // The slide or fade is over: the cells it carried out of view go back to where a hidden cell waits.
  const settle = (): void => {
    timer = undefined;
    const input = last;
    if (input === undefined) return;
    for (const id of [...moving, ...fading]) {
      const c = input.cells.find((x) => x.id === id);
      if (c === undefined) continue;
      if (fading.has(id)) {
        c.el.style.opacity = '';
        c.el.style.zIndex = '';
        opacity.delete(id);
      }
      if (c.shown) c.el.style.clipPath = '';
      else put(c.el, id, parkedAt(input, id), 'none', '');
    }
    moving = new Set();
    fading = new Set();
  };
  const settleAfter = (sec: number): void => {
    if (timer !== undefined) clearTimeout(timer);
    // A little past the end, so the last frame of the transition has been drawn.
    timer = setTimeout(settle, sec * 1000 + 50);
  };

  const slide = (input: MotionInput, to: MotionCell, side: WorkspaceEnterSide, leaving: readonly MotionCell[]): void => {
    for (const id of fading) {
      const c = input.cells.find((x) => x.id === id);
      if (c !== undefined) {
        c.el.style.opacity = '';
        c.el.style.zIndex = '';
      }
    }
    fading = new Set();
    // Everything already in sight carries on from where it is drawn this frame.
    const from = new Map<string, CellPos>();
    for (const c of input.cells) if (c.id !== to.id && (moving.has(c.id) || leaving.includes(c))) from.set(c.id, live(c.el, c.id, { x: 0, y: 0 }));
    const start = moving.has(to.id) ? live(to.el, to.id, parkedAt(input, to.id)) : entryStart(side, [...from.values()]);
    from.set(to.id, start);
    const by = { x: -start.x, y: -start.y };
    const ends = new Map([...from].map(([id, p]) => [id, { x: p.x + by.x, y: p.y + by.y }]));
    const clip = input.split && [...from.values(), ...ends.values()].some((p) => p.x !== 0);
    const cellOf = (id: string): MotionCell => input.cells.find((c) => c.id === id)!;
    for (const [id, p] of from) put(cellOf(id).el, id, p, 'none', clip ? cellClip(p) : '');
    // Read back so the browser starts each transition from the place just written.
    void to.el.offsetWidth;
    for (const [id, p] of ends) put(cellOf(id).el, id, p, slideCss(input, clip), clip ? cellClip(p) : '');
    moving = new Set(from.keys());
    settleAfter(input.slide.duration);
  };

  const fade = (input: MotionInput, to: MotionCell, leaving: readonly MotionCell[]): void => {
    const out = input.cells.filter((c) => c.id !== to.id && (fading.has(c.id) || leaving.includes(c)));
    const seen = (c: MotionCell, fallback: number): number => drawnOpacity(c.el) ?? opacity.get(c.id) ?? fallback;
    const from = new Map(out.map((c) => [c.id, seen(c, 1)]));
    const toFrom = fading.has(to.id) ? seen(to, 0) : 0;
    // A slide still under way stops where it is drawn, since nothing may move now.
    for (const id of moving) {
      const c = input.cells.find((x) => x.id === id);
      if (c === undefined || c === to) continue;
      if (out.includes(c)) put(c.el, id, live(c.el, id, { x: 0, y: 0 }), 'none', c.el.style.clipPath);
      else put(c.el, id, parkedAt(input, id), 'none', '');
    }
    moving = new Set();
    for (const c of out) {
      c.el.style.transition = 'none';
      c.el.style.opacity = String(from.get(c.id));
      c.el.style.zIndex = '';
    }
    put(to.el, to.id, { x: 0, y: 0 }, 'none', '');
    to.el.style.opacity = String(toFrom);
    // The arriving cell is drawn over the one leaving, whichever comes first in the list.
    to.el.style.zIndex = '1';
    void to.el.offsetWidth;
    const css = `opacity ${SWITCH_FADE_SEC}s ease`;
    for (const c of out) {
      c.el.style.transition = css;
      c.el.style.opacity = '0';
      opacity.set(c.id, 0);
    }
    to.el.style.transition = css;
    to.el.style.opacity = '1';
    opacity.set(to.id, 1);
    fading = new Set([...out.map((c) => c.id), to.id]);
    settleAfter(SWITCH_FADE_SEC);
  };

  return {
    sync: (input) => {
      last = input;
      const mounted = new Set(input.cells.map((c) => c.id));
      for (const id of [...pos.keys()]) if (!mounted.has(id)) pos.delete(id);
      moving = new Set([...moving].filter((id) => mounted.has(id)));
      fading = new Set([...fading].filter((id) => mounted.has(id)));
      const to = input.cells.find((c) => c.id === input.current);
      const switching = input.placed && to !== undefined && lastCurrent !== undefined && lastCurrent !== to.id && !lastShown.has(to.id);
      if (switching) {
        const leaving = input.cells.filter((c) => lastShown.has(c.id) && !c.shown);
        if (input.reduced && input.fade) fade(input, to, leaving);
        else if (!input.reduced) slide(input, to, input.side(lastCurrent!, to.id), leaving);
      }
      // Reduce Motion came on during a slide: what it carried snaps to where it rests.
      if (input.reduced) moving = new Set();
      const glide = input.placed && !input.reduced;
      for (const c of input.cells) {
        if (moving.has(c.id) || fading.has(c.id)) continue;
        // A cell the window starts to show without a switch (a side added) glides in from where it waited.
        if (c.shown) put(c.el, c.id, { x: 0, y: 0 }, glide ? slideCss(input, false) : 'none', '');
        else put(c.el, c.id, parkedAt(input, c.id), 'none', '');
      }
      lastCurrent = input.current;
      lastShown = new Set(input.cells.filter((c) => c.shown).map((c) => c.id));
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
