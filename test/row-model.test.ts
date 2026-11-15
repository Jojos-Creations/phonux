/**
 * The row's position model, by hand on literal rows (phone 390, gap 16, pitch 406) and by property over random operation
 * sequences. The same stillness check is run over today's computeRowNumbers and rowAnchor, where it must find a counterexample:
 * a property that cannot fail proves nothing. Reproduce a failure with ROW_MODEL_SEED=<seed from the failure>.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, rowAnchor } from '../rowNumbers.js';
import {
  atRest, close, dotsOf, dragBy, hold, holdBoth, holdRight, layoutOf, onScreenIds, open, parkedIds, reorder, resize, screenOf, setWindow,
  settle, step, viewRange, type RowModel, type RowPanel,
} from '../rowModel.js';

const SEED = Number(process.env.ROW_MODEL_SEED ?? 20261105);

const model = (slots: number[], over: Partial<RowModel> = {}): RowModel => ({
  panels: slots.map((s, k) => ({ id: `p${k}`, slots: s })),
  heldLeft: null,
  phonePx: 390,
  gapPx: 16,
  windowPx: 1000,
  view: 0,
  ...over,
});

test('ruler: x is the running sum of widths and gaps, parked panels included, and a 2-slot panel is 796 wide', () => {
  const l = layoutOf(model([1, 2, 1]));
  assert.deepEqual(l.drawn.map((p) => [p.x, p.w]), [[0, 390], [406, 796], [1218, 390]]);
  assert.equal(l.stripPx, 1608);
});

test('ruler: a hidden panel takes no length and no dot', () => {
  const m: RowModel = { ...model([1, 1, 1]), panels: [{ id: 'a', slots: 1 }, { id: 'h', slots: 3, hidden: true }, { id: 'b', slots: 1 }] };
  assert.deepEqual(layoutOf(m).drawn.map((p) => [p.id, p.x]), [['a', 0], ['b', 406]]);
  assert.deepEqual(dotsOf(m, 100).dots.map((d) => d.id), ['a', 'b']);
});

test('stops: a window of 1000 shows two whole slots (812 + 16 less than 1000), centered by 94 on each side, and the strip rests every 406', () => {
  const l = layoutOf(model([1, 1, 1, 1, 1]));
  assert.equal(l.centerPx, (1000 + 16 - 2 * 406) / 2);
  assert.deepEqual(l.stops, [-102, 304, 710, 1116]);
  assert.deepEqual([l.lo, l.hi], [102, 898]);
});

test('stops: a strip that fits has the one rest that centers it', () => {
  const l = layoutOf(model([1, 1], { windowPx: 1000 }));
  assert.deepEqual(l.stops, [-(1000 - 796) / 2]);
});

test('on screen: at the first rest panels 0 and 1 are shown, 2 is not; one step shows 1 and 2', () => {
  const m = model([1, 1, 1, 1, 1], { view: -102 });
  assert.deepEqual(onScreenIds(m), ['p0', 'p1']);
  assert.deepEqual(onScreenIds(step(m, 1)), ['p1', 'p2']);
  assert.equal(step(m, 1).view, 304);
});

test('hold: the held panel stays at 0 and is shown while the next panels rest after it', () => {
  const m = hold(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p0');
  assert.equal(layoutOf(m).held?.id, 'p0');
  const s = step(step(m, 1), 1);
  assert.equal(screenOf(s, 'p0'), 0);
  assert.ok(onScreenIds(s).includes('p0'));
  assert.deepEqual(onScreenIds(s).slice(0, 1), ['p0']);
});

test('hold: a window with less than a phone beside the held panel does not hold it', () => {
  const m = hold(model([1, 1, 1, 1], { windowPx: 790 }), 'p0');
  assert.equal(m.heldLeft, 'p0');
  assert.equal(layoutOf(m).held, null);
});

test('hold: flipping the hold moves no other panel and no rest', () => {
  const base = model([1, 1, 1, 1, 1, 1], { windowPx: 1300, view: 406 });
  const held = hold(base, 'p0');
  assert.deepEqual(layoutOf(held).stops, layoutOf(base).stops);
  for (const id of ['p1', 'p2', 'p3']) assert.equal(screenOf(held, id), screenOf(base, id));
  assert.equal(held.view, base.view);
});

test('hold right: the last panel stays against the right edge at every rest, and only the last panel can be held', () => {
  const m = holdRight(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p5');
  assert.equal(layoutOf(m).heldRight?.id, 'p5');
  for (const view of [0, step(m, 1).view, step(step(m, 1), 1).view]) assert.equal(screenOf({ ...m, view }, 'p5'), 1300 - 390);
  assert.equal(holdRight(model([1, 1, 1], { windowPx: 1300 }), 'p1').heldRight ?? null, null);
});

test('hold right: a window with less than a phone beside the held panel does not hold it, and flipping it moves no other panel', () => {
  assert.equal(layoutOf(holdRight(model([1, 1, 1, 1], { windowPx: 790 }), 'p3')).heldRight, null);
  const base = model([1, 1, 1, 1, 1, 1], { windowPx: 1300, view: 406 });
  const held = holdRight(base, 'p5');
  for (const id of ['p1', 'p2', 'p3']) assert.equal(screenOf(held, id), screenOf(base, id));
  assert.equal(held.view, base.view);
});

test('list changes: closing a panel left of the window keeps the panels on screen where they are', () => {
  const m = model([1, 1, 1, 1, 1, 1], { view: 2 * 406 - 102 });
  const after = close(m, 'p0');
  for (const id of ['p2', 'p3']) assert.equal(screenOf(after, id), screenOf(m, id));
  assert.equal(after.view, m.view - 406);
});

test('list changes: opening a panel before the window shifts the view by its length', () => {
  const m = model([1, 1, 1, 1, 1, 1], { view: 406 - 102 });
  const after = open(m, { id: 'n', slots: 2 }, 0);
  assert.equal(after.view, m.view + 2 * 406);
  assert.equal(screenOf(after, 'p1'), screenOf(m, 'p1'));
});

test('list changes: nothing opens or moves in front of the held panel', () => {
  const m = hold(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p0');
  assert.equal(open(m, { id: 'n', slots: 1 }, 0).panels[0]!.id, 'p0');
  assert.equal(reorder(m, 'p3', 0).panels[0]!.id, 'p0');
  assert.equal(reorder(m, 'p0', 3), m);
});

const ids = (m: RowModel): string[] => m.panels.map((p) => p.id);

test('right hold, list changes: a list change keeps the right hold, and nothing opens or moves after the right-held panel', () => {
  const m = holdRight(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p5');
  const opened = open(m, { id: 'n', slots: 1 });
  assert.equal(opened.heldRight, 'p5', 'opening a panel keeps the hold');
  assert.equal(layoutOf(opened).heldRight?.id, 'p5', 'and the hold is still in effect');
  assert.deepEqual(ids(opened).slice(-2), ['n', 'p5'], 'opening at the end lands before the right-held panel');
  assert.deepEqual(ids(open(m, { id: 'n', slots: 1 }, 99)).slice(-2), ['n', 'p5'], 'so does an index past the end');
  assert.deepEqual(ids(reorder(m, 'p1', 99)).slice(-2), ['p1', 'p5'], 'a reorder to the end lands before it');
  assert.deepEqual(ids(reorder(m, 'p1', 5)).slice(-2), ['p1', 'p5']);
  assert.equal(reorder(m, 'p5', 0), m, 'the right-held panel does not move');
  assert.equal(close(m, 'p2').heldRight, 'p5', 'closing another panel keeps the hold');
  assert.equal(close(m, 'p5').heldRight ?? null, null, 'closing the held panel drops it');
});

test('right hold, list changes: a panel opened or closed left of the window keeps the panels on screen, with the right panel docked', () => {
  const m = holdRight(model([1, 1, 1, 1, 1, 1], { windowPx: 1300, view: 406 }), 'p5');
  const opened = open(m, { id: 'n', slots: 1 }, 0);
  for (const id of ['p2', 'p3']) assert.equal(screenOf(opened, id), screenOf(m, id), `${id} stayed`);
  assert.equal(screenOf(opened, 'p5'), 1300 - 390, 'the right-held panel is docked and was never the anchor');
});

test('both: one panel held at whichever edge of the list it is at, and a list change never lets it drop', () => {
  const first = holdBoth(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p0');
  assert.equal(layoutOf(first).held?.id, 'p0', 'first in the list, it holds at the left');
  assert.equal(layoutOf(first).heldRight, null, 'and not at the right');
  assert.equal(open(first, { id: 'n', slots: 1 }, 0).panels[0]!.id, 'p0', 'nothing opens in front of it');
  assert.equal(layoutOf(open(first, { id: 'n', slots: 1 }, 0)).held?.id, 'p0', 'so its hold is still in effect');
  assert.equal(layoutOf(open(first, { id: 'n', slots: 1 })).held?.id, 'p0', 'opening at the end leaves it held');
  assert.equal(layoutOf(reorder(first, 'p3', 0)).held?.id, 'p0', 'a reorder to the front leaves it held');
  assert.equal(reorder(first, 'p0', 3), first, 'and it does not move');
  const last = holdBoth(model([1, 1, 1, 1, 1, 1], { windowPx: 1300 }), 'p5');
  assert.equal(layoutOf(last).heldRight?.id, 'p5', 'last in the list, it holds at the right');
  assert.deepEqual(ids(open(last, { id: 'n', slots: 1 })).slice(-2), ['n', 'p5'], 'nothing opens after it');
  assert.equal(layoutOf(open(last, { id: 'n', slots: 1 }, 0)).heldRight?.id, 'p5', 'and opening at the front leaves it held');
  assert.deepEqual(ids(reorder(last, 'p1', 99)).slice(-2), ['p1', 'p5']);
  const alone = holdBoth(model([1], { windowPx: 1300 }), 'p0');
  assert.deepEqual(ids(open(alone, { id: 'n', slots: 1 })), ['p0', 'n'], 'a lone both panel stays first: the left hold wins');
  assert.equal(layoutOf(open(alone, { id: 'n', slots: 1 })).held?.id, 'p0');
});

test('both: a panel that is neither first nor last is not held, and holdBoth refuses it', () => {
  const m = model([1, 1, 1, 1, 1, 1], { windowPx: 1300 });
  assert.equal(holdBoth(m, 'p2'), m);
  assert.equal(holdBoth(holdBoth(m, 'p0'), null).heldLeft, null, 'null lets go of both edges');
  assert.equal(holdBoth(holdBoth(m, 'p0'), null).heldRight ?? null, null);
});

test('step: stepping right then left returns to the same view, and the end of the range is a clamp', () => {
  const m = model([1, 1, 1, 1, 1], { view: -102 });
  assert.equal(step(step(m, 1), -1).view, m.view);
  assert.equal(step(m, -1), m);
  const end = { ...m, view: 1116 };
  assert.equal(step(end, 1), end);
});

test('drag then release: the content follows the pointer and a release rests on the nearest stop', () => {
  const m = model([1, 1, 1, 1, 1], { view: -102 });
  assert.equal(dragBy(m, -250).view, 148);
  assert.equal(settle(dragBy(m, -250)).view, 304, 'past half a pitch goes on');
  assert.equal(settle(dragBy(m, -150)).view, -102, 'less than half a pitch returns');
  assert.equal(dragBy(m, 500).view, -102, 'a drag cannot leave the range');
});

test('range: the view runs from the first rest to the last, and a strip that fits has one', () => {
  assert.deepEqual(viewRange(model([1, 1, 1, 1, 1])), { min: -102, max: 1116 });
  assert.deepEqual(viewRange(model([1, 1])), { min: -102, max: -102 });
  assert.deepEqual(viewRange(model([])), { min: -500, max: -500 });
});

test('settle: halfway between two rests goes to the earlier one, and a view on a rest stays', () => {
  const m = model([1, 1, 1, 1, 1]);
  assert.equal(settle({ ...m, view: 101 }).view, -102);
  assert.equal(settle({ ...m, view: 507 }).view, 304);
  assert.equal(settle({ ...m, view: 710 }).view, 710);
  assert.equal(settle({ ...m, view: 5000 }).view, 1116, 'beyond the range goes to the end');
});

test('parked: a panel is parked by its distance from the window, never by leaving the list', () => {
  const m = model([1, 1, 1, 1, 1], { view: -102 });
  assert.deepEqual(parkedIds(m), ['p3', 'p4']);
  assert.deepEqual(parkedIds({ ...m, overscanPx: 406 }), ['p4']);
  assert.equal(layoutOf(m).drawn.length, 5);
});

test('dots: the oval is the window scaled, a dot is a panel scaled, and lit dots are the shown panels', () => {
  const m = model([1, 1, 1, 1, 1], { view: 304 });
  const d = dotsOf(m, 203);
  const k = 203 / 2014;
  assert.deepEqual(d.dots.map((x) => x.lit), [false, true, true, false, false]);
  assert.ok(Math.abs(d.oval.left - k * (304 + 102)) < 1e-9);
  assert.ok(Math.abs(d.dots[2]!.left - k * 812) < 1e-9);
});

// ---- the property ----

interface Init {
  phone: number;
  gap: number;
  window: number;
  track: number;
  panels: { slots: number; hidden: boolean }[];
  held: boolean;
  right: boolean;
  /** 1: the first panel is held at either edge, 2: the last one is. The same id in both fields. */
  both: number;
  rest: number;
}

type Op =
  | { k: 'stepL' }
  | { k: 'stepR' }
  | { k: 'setWindow'; extra: number }
  | { k: 'open'; uid: number; slots: number; at: number; hidden: boolean }
  | { k: 'close'; i: number }
  | { k: 'reorder'; i: number; to: number }
  | { k: 'resize'; i: number; slots: number }
  | { k: 'holdOn' }
  | { k: 'holdOff' }
  | { k: 'holdRightOn' }
  | { k: 'holdRightOff' }
  | { k: 'drag'; dx: number }
  | { k: 'release' };

const initArb: fc.Arbitrary<Init> = fc.record({
  phone: fc.integer({ min: 320, max: 430 }),
  gap: fc.constantFrom(0, 8, 16, 24),
  window: fc.integer({ min: 0, max: 1500 }),
  track: fc.integer({ min: 120, max: 480 }),
  panels: fc.array(fc.record({ slots: fc.integer({ min: 1, max: 3 }), hidden: fc.integer({ min: 0, max: 9 }).map((n) => n === 0) }), { minLength: 1, maxLength: 9 }),
  held: fc.boolean(),
  right: fc.boolean(),
  both: fc.integer({ min: 0, max: 3 }),
  rest: fc.nat(20),
});

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<Op>({ k: 'stepL' }) },
  { weight: 4, arbitrary: fc.constant<Op>({ k: 'stepR' }) },
  { weight: 2, arbitrary: fc.nat(1400).map((extra): Op => ({ k: 'setWindow', extra })) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('open' as const), uid: fc.nat(1e6), slots: fc.integer({ min: 1, max: 4 }), at: fc.nat(12), hidden: fc.integer({ min: 0, max: 9 }).map((n) => n === 0) }) },
  { weight: 2, arbitrary: fc.nat(12).map((i): Op => ({ k: 'close', i })) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('reorder' as const), i: fc.nat(12), to: fc.nat(12) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant('resize' as const), i: fc.nat(12), slots: fc.integer({ min: 1, max: 4 }) }) },
  { weight: 2, arbitrary: fc.constant<Op>({ k: 'holdOn' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'holdOff' }) },
  { weight: 2, arbitrary: fc.constant<Op>({ k: 'holdRightOn' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'holdRightOff' }) },
  { weight: 3, arbitrary: fc.integer({ min: -900, max: 900 }).map((dx): Op => ({ k: 'drag', dx })) },
  { weight: 3, arbitrary: fc.constant<Op>({ k: 'release' }) },
);

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

function initialModel(init: Init): RowModel {
  const panels: RowPanel[] = init.panels.map((p, k) => ({ id: `i${k}`, slots: p.slots, ...(p.hidden ? { hidden: true } : {}) }));
  const base: RowModel = { panels, heldLeft: null, phonePx: init.phone, gapPx: init.gap, windowPx: init.phone + init.window, view: 0 };
  const first = ruler(base)[0];
  const last = ruler(base).at(-1);
  const left = init.held && first !== undefined ? { ...base, heldLeft: first.id } : base;
  const sided = init.right && last !== undefined ? { ...left, heldRight: last.id } : left;
  const both = init.both === 1 ? first : init.both === 2 ? last : undefined;
  const held = both === undefined ? sided : { ...sided, heldLeft: both.id, heldRight: both.id };
  const stops = rests(held);
  return { ...held, view: stops[init.rest % stops.length]! };
}

function applyOp(m: RowModel, op: Op): { next: RowModel; subject?: string } {
  const at = (i: number): RowPanel | undefined => (m.panels.length === 0 ? undefined : m.panels[i % m.panels.length]);
  switch (op.k) {
    case 'stepL': return { next: step(m, -1) };
    case 'stepR': return { next: step(m, 1) };
    case 'setWindow': return { next: setWindow(m, m.phonePx + op.extra) };
    case 'open': return { next: open(m, { id: `o${op.uid}`, slots: op.slots, ...(op.hidden ? { hidden: true } : {}) }, op.at) };
    case 'close': { const p = at(op.i); return { next: p === undefined ? m : close(m, p.id) }; }
    case 'reorder': { const p = at(op.i); return p === undefined ? { next: m } : { next: reorder(m, p.id, op.to), subject: p.id }; }
    case 'resize': { const p = at(op.i); return { next: p === undefined ? m : resize(m, p.id, op.slots) }; }
    case 'holdOn': { const first = ruler(m)[0]; return { next: first === undefined ? m : hold(m, first.id) }; }
    case 'holdOff': return { next: hold(m, null) };
    case 'holdRightOn': { const last = ruler(m).at(-1); return { next: last === undefined ? m : holdRight(m, last.id) }; }
    case 'holdRightOff': return { next: holdRight(m, null) };
    case 'drag': return { next: dragBy(m, op.dx) };
    case 'release': return { next: settle(m) };
  }
}

// The oracle: everything the checks below read is worked out here from the panel list and the owner's rules, never from
// layoutOf, so an error in the model's ruler, rests, hold or on-screen rule is a disagreement and not a shared assumption.

/** Half a pixel: an odd window centers its slots on a half pixel, so positions this close are the same position. */
const TOL = 0.5;

function ruler(m: RowModel): { id: string; x: number; w: number; slots: number }[] {
  let x = 0;
  const out: { id: string; x: number; w: number; slots: number }[] = [];
  for (const p of m.panels) {
    if (p.hidden === true) continue;
    const w = p.slots * m.phonePx + (p.slots - 1) * m.gapPx;
    out.push({ id: p.id, x, w, slots: p.slots });
    x += w + m.gapPx;
  }
  return out;
}

const pitchOf = (m: RowModel): number => m.phonePx + m.gapPx;

function stripOf(m: RowModel): number {
  const last = ruler(m).at(-1);
  return last === undefined ? 0 : last.x + last.w;
}

/** The rests, by the rule: whole slots centered in the window, one rest per slot boundary; a strip that fits has one, centered. */
function rests(m: RowModel): number[] {
  const strip = stripOf(m);
  if (strip <= m.windowPx) return [0 - (m.windowPx - strip) / 2];
  let fit = 1;
  while ((fit + 1) * m.phonePx + fit * m.gapPx <= m.windowPx) fit += 1;
  const centering = Math.max(0, (m.windowPx - (fit * m.phonePx + (fit - 1) * m.gapPx)) / 2);
  const slots = ruler(m).reduce((sum, p) => sum + p.slots, 0);
  const out: number[] = [];
  for (let k = 0; k <= Math.max(0, slots - fit); k += 1) out.push(k * pitchOf(m) - centering);
  return out;
}

const restAt = (m: RowModel): boolean => rests(m).some((r) => Math.abs(r - m.view) <= TOL);

/** The nearest rest; the earlier one on a tie. */
function nearestRest(m: RowModel): number {
  let best = rests(m)[0]!;
  for (const r of rests(m)) if (Math.abs(r - m.view) < Math.abs(best - m.view)) best = r;
  return best;
}

function heldId(m: RowModel): string | null {
  const first = ruler(m)[0];
  return first !== undefined && first.id === m.heldLeft && first.w + pitchOf(m) <= m.windowPx ? first.id : null;
}

/** The mirror: the last drawn panel, with a phone's room beside it and beside the left-held panel. */
function heldRId(m: RowModel): string | null {
  const last = ruler(m).at(-1);
  const first = ruler(m)[0];
  const leftEdge = heldId(m) !== null && first !== undefined ? first.w + m.gapPx : 0;
  return last !== undefined && last.id === m.heldRight && last.id !== heldId(m) && last.w + pitchOf(m) + leftEdge <= m.windowPx ? last.id : null;
}

/** The part of the window that counts as the grid: inside the centering margins and between the held panels. */
function frame(m: RowModel): { lo: number; hi: number } {
  const centering = 0 - rests(m)[0]!;
  const h = heldId(m);
  const r = heldRId(m);
  const first = ruler(m)[0];
  const last = ruler(m).at(-1);
  return { lo: centering + (h !== null && first !== undefined ? first.w + m.gapPx : 0), hi: m.windowPx - centering - (r !== null && last !== undefined ? last.w + m.gapPx : 0) };
}

function screens(m: RowModel): Map<string, number> {
  const h = heldId(m);
  const r = heldRId(m);
  return new Map(ruler(m).map((p) => [p.id, p.id === h ? Math.max(p.x - m.view, 0) : p.id === r ? Math.min(p.x - m.view, m.windowPx - p.w) : p.x - m.view]));
}

/** On screen, by the owner's rule: all of the panel is in the grid, or the panel is wider than the grid and covers all of it. */
function shown(m: RowModel): string[] {
  const { lo, hi } = frame(m);
  const h = heldId(m);
  const r = heldRId(m);
  return ruler(m)
    .filter((p) => {
      if (p.id === h || p.id === r) return true;
      const left = p.x - m.view;
      const right = left + p.w;
      const inside = left >= lo - TOL && right <= hi + TOL;
      const covers = p.w > hi - lo && left <= lo + TOL && right >= hi - TOL;
      return inside || covers;
    })
    .map((p) => p.id);
}

const range = (m: RowModel): { min: number; max: number } => {
  const all = rests(m);
  return { min: all[0]!, max: all.at(-1)! };
};
const forced = (after: RowModel, wanted: number): boolean => wanted < range(after).min - TOL || wanted > range(after).max + TOL;

/** The largest move, in px, of any panel in `ids` that is drawn both before and after. */
function largestMove(before: Map<string, number>, after: Map<string, number>, ids: Iterable<string>): number {
  let worst = 0;
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    if (b !== undefined && a !== undefined) worst = Math.max(worst, Math.abs(a - b));
  }
  return worst;
}

// Counts of the checks that really ran, so a property that skipped its branches cannot pass for one that held.
const ran: Record<string, number> = {};
const tick = (key: string): void => { ran[key] = (ran[key] ?? 0) + 1; };

function stillness(before: RowModel, after: RowModel, op: Op, subject: string | undefined): void {
  const sb = screens(before);
  const sa = screens(after);
  const flips = op.k === 'holdOn' || op.k === 'holdOff' || op.k === 'holdRightOn' || op.k === 'holdRightOff' || op.k === 'setWindow';
  const skip = new Set(flips ? [before.heldLeft, after.heldLeft, before.heldRight, after.heldRight, subject] : [heldId(before), heldId(after), heldRId(before), heldRId(after), subject]);
  const kept = ruler(before).filter((p) => sa.has(p.id) && !skip.has(p.id));
  if (flips) {
    const wanted = before.view;
    if (forced(after, wanted)) {
      const r = range(after);
      assert.ok(Math.abs(after.view - Math.min(r.max, Math.max(r.min, wanted))) < TOL, 'a forced move goes no further than the range');
      return;
    }
    tick(`still:${op.k}`);
    assert.ok(largestMove(sb, sa, kept.map((p) => p.id)) < 1, `${op.k} moved a kept panel by ${largestMove(sb, sa, kept.map((p) => p.id))}px`);
    return;
  }
  const xa = new Map(ruler(after).map((p) => [p.id, p.x]));
  const { lo, hi } = frame(before);
  const visible = kept.filter((p) => Math.min(p.x - before.view + p.w, hi) - Math.max(p.x - before.view, lo) > TOL);
  const anchor = visible[0] ?? kept[0];
  if (anchor === undefined) return;
  const shift = xa.get(anchor.id)! - anchor.x;
  const wanted = before.view + shift;
  if (forced(after, wanted)) {
    const r = range(after);
    assert.ok(Math.abs(after.view - Math.min(r.max, Math.max(r.min, wanted))) < TOL, 'a forced move goes no further than the range');
    return;
  }
  const still = kept.filter((p) => Math.abs(xa.get(p.id)! - p.x - shift) < 1e-9).map((p) => p.id);
  tick(`still:${op.k}`);
  if (visible.length > 0 && shift !== 0) tick(`still:${op.k}:shifted`);
  assert.ok(still.includes(anchor.id));
  assert.ok(largestMove(sb, sa, still) < 1, `${op.k} moved a kept panel by ${largestMove(sb, sa, still)}px`);
}

function wholeSlots(m: RowModel): void {
  const { lo, hi } = frame(m);
  const pitch = m.phonePx + m.gapPx;
  const h = heldId(m);
  const r = heldRId(m);
  for (const p of ruler(m)) {
    if (p.id === h) {
      assert.equal(screenOf(m, p.id), Math.max(p.x - m.view, 0), 'the held panel is at the left edge once the window has passed it');
      continue;
    }
    if (p.id === r) {
      assert.equal(screenOf(m, p.id), Math.min(p.x - m.view, m.windowPx - p.w), 'the right-held panel is at the right edge once the window has passed it');
      continue;
    }
    const at = p.x - m.view;
    const cutL = Math.min(p.w, Math.max(0, lo - at));
    const cutR = Math.min(p.w, Math.max(0, at + p.w - hi));
    const outside = cutL + cutR >= p.w - TOL;
    tick(outside ? 'slots:outside' : cutL + cutR > TOL ? 'slots:cut' : 'slots:whole');
    if (outside) continue;
    for (const cut of [cutL, cutR]) {
      if (cut <= TOL) continue;
      assert.ok(p.w > m.phonePx, `${p.id}: a one-slot panel is cut by ${cut}px`);
      const slots = cut / pitch;
      assert.ok(Math.abs(slots - Math.round(slots)) * pitch <= TOL + 1e-9, `${p.id}: cut by ${cut}px, not a whole number of slots`);
    }
  }
}

function dotsAgree(m: RowModel, track: number): void {
  const d = dotsOf(m, track);
  const lit = d.dots.filter((x) => x.lit).map((x) => x.id);
  assert.deepEqual(lit, onScreenIds(m), 'the lit dots are the panels on screen');
  assert.deepEqual(lit, shown(m), 'and match the panels the window shows');
  const h = heldId(m);
  const r = heldRId(m);
  const chain = d.dots.filter((x) => x.id !== h && x.id !== r);
  const k = stripOf(m) > 0 ? track / stripOf(m) : 0;
  for (let i = 1; i < chain.length; i += 1) {
    const gapBetween = chain[i]!.left - (chain[i - 1]!.left + chain[i - 1]!.width);
    assert.ok(Math.abs(gapBetween - k * m.gapPx) < 1e-6, `dots ${i - 1} and ${i} are ${gapBetween} apart, not ${k * m.gapPx}`);
  }
  for (const x of d.dots) {
    if (!x.lit || x.id === h || x.id === r || x.width > d.oval.width + 1e-6) continue;
    assert.ok(x.left >= d.oval.left - TOL * k - 1e-6 && x.left + x.width <= d.oval.left + d.oval.width + TOL * k + 1e-6, `${x.id} is lit outside the oval`);
  }
}

function derived(m: RowModel, track: number): string {
  return JSON.stringify({ l: layoutOf(m), shown: onScreenIds(m), parked: parkedIds(m), dots: dotsOf(m, track) });
}

function checkState(m: RowModel, track: number): void {
  assert.ok(Number.isFinite(m.view), 'view is finite');
  const l = layoutOf(m);
  assert.deepEqual(l.drawn.map((p) => [p.id, p.x, p.w]), ruler(m).map((p) => [p.id, p.x, p.w]), 'one ruler: the running sum over every drawn panel');
  assert.deepEqual(l.stops, rests(m), 'the model rests where the rule says: every slot boundary, first to last');
  assert.deepEqual(viewRange(m), range(m), 'the range of the view is the first rest to the last');
  assert.equal(atRest(m), restAt(m), 'atRest agrees with the rests');
  const where = screens(m);
  for (const [id, y] of where) assert.ok(Math.abs((screenOf(m, id) ?? Number.NaN) - y) < 1e-9, `${id}: the model puts it at ${screenOf(m, id)}, the rule at ${y}`);
  for (const p of m.panels.filter((q) => q.hidden === true)) assert.equal(screenOf(m, p.id), undefined, 'a hidden panel has no place');
  assert.equal(derived(m, track), derived(structuredClone(m), track), 'deriving twice from equal models gives equal output');
  dotsAgree(m, track);
  const parked = parkedIds(m);
  const on = onScreenIds(m);
  assert.ok(parked.every((id) => !on.includes(id)), 'a parked panel is not on screen');
  assert.ok(heldId(m) === null || !parked.includes(heldId(m)!), 'the held panel is never parked');
  const h = heldId(m);
  if (h !== null) tick('hold:effective');
  if (h !== null) assert.ok(screens(m).get(h)! >= 0, 'the held panel is never left of the window');
  const r = heldRId(m);
  if (r !== null) tick('holdR:effective');
  if (r !== null) assert.ok(screens(m).get(r)! + ruler(m).find((p) => p.id === r)!.w <= m.windowPx + 1e-9, 'the right-held panel is never right of the window');
  assert.ok(r === null || !parked.includes(r), 'the right-held panel is never parked');
}

function checkStep(m: RowModel): void {
  // Exactly on a rest: a view within the tolerance of one steps to the next rest, which need not come back to the view.
  if (!rests(m).some((s) => Math.abs(s - m.view) < 1e-9)) return;
  for (const dir of [1, -1] as const) {
    const there = step(m, dir);
    if (there.view === m.view) continue;
    tick('step:reversed');
    assert.ok(Math.abs(there.view - m.view) <= pitchOf(m) + 1e-9, 'a step moves one slot');
    assert.equal(step(there, (0 - dir) as 1 | -1).view, m.view, 'a step back returns to the same view');
  }
}

function runSequence(init: Init, ops: Op[]): void {
  let m = deepFreeze(initialModel(init));
  checkState(m, init.track);
  for (const op of ops) {
    const before = m;
    const { next, subject } = applyOp(structuredClone(before), op);
    const replay = applyOp(deepFreeze(structuredClone(before)), op).next;
    assert.equal(JSON.stringify(next), JSON.stringify(replay), 'the same operation on the same model gives the same model');
    m = deepFreeze(next);
    const label = JSON.stringify(op);
    try {
      checkState(m, init.track);
      if (op.k !== 'stepL' && op.k !== 'stepR' && op.k !== 'drag' && op.k !== 'release') stillness(before, m, op, subject);
      if (restAt(m)) wholeSlots(m);
      if (op.k === 'release') {
        assert.ok(restAt(m), 'a release rests');
        assert.equal(m.view, nearestRest(before), 'a release goes to the nearest rest, the earlier on a tie');
      }
      if (op.k === 'stepL' || op.k === 'stepR') {
        if (m.view !== before.view) assert.ok(restAt(m), 'a step lands on a rest');
        assert.ok(Math.abs(m.view - before.view) <= pitchOf(m) + TOL + 1e-9, `a step moves at most one slot: view ${before.view} -> ${m.view}, rests ${rests(m).join(',')}`);
      }
      checkStep(m);
      const listOp = op.k === 'open' || op.k === 'close' || op.k === 'reorder' || op.k === 'resize' || op.k === 'holdOn' || op.k === 'holdOff' || op.k === 'holdRightOn' || op.k === 'holdRightOff';
      if (listOp && restAt(before) && stripOf(before) > before.windowPx && stripOf(m) > m.windowPx) assert.ok(restAt(m), 'a list change keeps an overflowing row on its rests');
    } catch (e) {
      (e as Error).message = `after ${label} (${before.panels.length} -> ${m.panels.length} panels, view ${before.view} -> ${m.view}): ${(e as Error).message}`;
      throw e;
    }
  }
}

test('property: random sequences keep the row still, on whole slots, with dots that agree and steps that reverse', () => {
  const runs = Number(process.env.ROW_MODEL_RUNS ?? 400);
  let sequences = 0;
  let operations = 0;
  fc.assert(
    fc.property(initArb, fc.array(opArb, { minLength: 20, maxLength: 60 }), (init, ops) => {
      sequences += 1;
      operations += ops.length;
      runSequence(init, ops);
    }),
    { seed: SEED, numRuns: runs },
  );
  assert.ok(sequences >= runs, `ran ${sequences} sequences, wanted ${runs}`);
  const wanted = ['still:holdOn', 'still:holdOff', 'still:holdRightOn', 'still:holdRightOff', 'still:setWindow', 'still:open', 'still:close', 'still:reorder', 'still:resize', 'still:open:shifted', 'still:close:shifted', 'still:resize:shifted', 'slots:whole', 'slots:cut', 'slots:outside', 'step:reversed', 'hold:effective', 'holdR:effective'];
  const thin = wanted.filter((key) => (ran[key] ?? 0) < 50);
  assert.deepEqual(thin, [], `checks that ran fewer than 50 times: ${JSON.stringify(ran)}`);
  if (process.env.ROW_MODEL_COVERAGE !== undefined) console.log(JSON.stringify(ran));
  assert.ok(operations >= runs * 20, `ran ${operations} operations`);
});

// ---- the negative control: today's numbers fail the same stillness check ----

const made = (id: string, layer: PanelSettings): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'row-model-view' }, id, 'root')[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
};

interface FlipCase { slots: number[]; container: number; stopAt: number; on: boolean; holdAt: number }

const flipArb: fc.Arbitrary<FlipCase> = fc.record({
  slots: fc.array(fc.integer({ min: 1, max: 2 }), { minLength: 3, maxLength: 9 }),
  container: fc.integer({ min: 700, max: 1700 }),
  stopAt: fc.nat(30),
  on: fc.boolean(),
  holdAt: fc.nat(8),
});

type Moves = { before: Map<string, number>; after: Map<string, number>; kept: string[] };

/**
 * Today's row across a hold flip of the panel at `holdAt`: the numbers before and after, the offset taken through rowAnchor,
 * and the screen of each panel. The new model holds only the first panel, so only the first-panel flips are comparable to it.
 */
function todayAcrossHoldFlip(c: FlipCase): Moves | null {
  const holdAt = c.holdAt % c.slots.length;
  const entries = (held: boolean): PanelWindow[] => c.slots.map((slots, k) => made(`p${k}`, { slots, ...(held && k === holdAt ? { edgeHold: 'left' as const } : {}) }));
  const run = (held: boolean) => computeRowNumbers({ entries: entries(held), phoneWidth: 390, containerWidth: c.container, gap: 16, wholePanels: true });
  const from = run(c.on);
  const to = run(!c.on);
  if (from.stops.length === 0 || (to.held.length > 0) === (from.held.length > 0)) return null;
  const at = from.stops[c.stopAt % from.stops.length]!;
  const next = Math.min(maxScrollOf(to), Math.max(0, at + (rowAnchor(from, to, at, false) ?? 0)));
  const screensOf = (n: ReturnType<typeof run>, scroll: number): Map<string, number> => new Map(n.ids.map((id, k) => [id, n.stripStart + n.leftOffsets[k]! - scroll]));
  const before = screensOf(from, at);
  const after = screensOf(to, next);
  return { before, after, kept: [...before.keys()].filter((id) => after.has(id)) };
}

/** The same case on the new model: the same slots, the window today's numbers see, a starting rest, and the first panel held. */
function newAcrossHoldFlip(c: FlipCase): Moves | null {
  const panels = c.slots.map((slots, k) => ({ id: `p${k}`, slots }));
  const base: RowModel = { panels, heldLeft: c.on ? 'p0' : null, phonePx: 390, gapPx: 16, windowPx: c.container - 32, view: 0 };
  const stops = rests(base);
  const from = { ...base, view: stops[c.stopAt % stops.length]! };
  const to = hold(from, c.on ? null : 'p0');
  if (heldId(from) === heldId(to)) return null;
  const before = screens(from);
  const after = screens(to);
  return { before, after, kept: [...before.keys()].filter((id) => after.has(id) && id !== 'p0') };
}

function stillnessOver(moves: (c: FlipCase) => Moves | null): fc.IPropertyWithHooks<[FlipCase]> {
  return fc.property(flipArb, (c) => {
    const r = moves(c);
    if (r === null) return;
    const moved = largestMove(r.before, r.after, r.kept);
    assert.ok(moved < 1, `a hold flip moved a kept panel by ${moved}px`);
  });
}

function mustFail(t: { diagnostic: (m: string) => void }, moves: (c: FlipCase) => Moves | null): void {
  const result = fc.check(stillnessOver(moves), { seed: SEED, numRuns: 300 });
  assert.equal(result.failed, true, 'the check must fail on this old behavior, or it proves nothing');
  t.diagnostic(`counterexample (seed ${SEED}): ${JSON.stringify(result.counterexample)} after ${result.numRuns} runs`);
}

test('negative control: today\'s numbers and rowAnchor fail the stillness check when a panel in the middle of the row is held', (t) => {
  mustFail(t, todayAcrossHoldFlip);
});

test('positive control: the same check over the same cases passes on the new model, and reaches enough of them to mean it', () => {
  let compared = 0;
  fc.assert(stillnessOver((c) => {
    const r = newAcrossHoldFlip(c);
    if (r !== null) compared += 1;
    return r;
  }), { seed: SEED, numRuns: 300 });
  assert.ok(compared > 100, `compared ${compared} cases`);
});
