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
  atRest, close, dotsOf, dragBy, EPS_PX, hold, SHOWN_TOLERANCE_PX, layoutOf, onScreenIds, open, parkedIds, reorder, resize, screenOf, setWindow,
  settle, step, type RowModel, type RowPanel,
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
  | { k: 'drag'; dx: number }
  | { k: 'release' };

const initArb: fc.Arbitrary<Init> = fc.record({
  phone: fc.integer({ min: 320, max: 430 }),
  gap: fc.constantFrom(0, 8, 16, 24),
  window: fc.integer({ min: 0, max: 1500 }),
  track: fc.integer({ min: 120, max: 480 }),
  panels: fc.array(fc.record({ slots: fc.integer({ min: 1, max: 3 }), hidden: fc.integer({ min: 0, max: 9 }).map((n) => n === 0) }), { minLength: 1, maxLength: 9 }),
  held: fc.boolean(),
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
  const first = layoutOf(base).drawn[0];
  const held = init.held && first !== undefined ? { ...base, heldLeft: first.id } : base;
  const stops = layoutOf(held).stops;
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
    case 'holdOn': { const first = layoutOf(m).drawn[0]; return { next: first === undefined ? m : hold(m, first.id) }; }
    case 'holdOff': return { next: hold(m, null) };
    case 'drag': return { next: dragBy(m, op.dx) };
    case 'release': return { next: settle(m) };
  }
}

// What the checks below read is computed here from the panel list again, not taken from layoutOf, so an error in the model's
// ruler or hold rule is a disagreement and not a shared assumption.
function ruler(m: RowModel): { id: string; x: number; w: number }[] {
  let x = 0;
  const out: { id: string; x: number; w: number }[] = [];
  for (const p of m.panels) {
    if (p.hidden === true) continue;
    const w = p.slots * m.phonePx + (p.slots - 1) * m.gapPx;
    out.push({ id: p.id, x, w });
    x += w + m.gapPx;
  }
  return out;
}

function heldId(m: RowModel): string | null {
  const first = ruler(m)[0];
  return first !== undefined && first.id === m.heldLeft && first.w + m.phonePx + m.gapPx <= m.windowPx ? first.id : null;
}

function frame(m: RowModel): { lo: number; hi: number } {
  const c = 0 - layoutOf(m).stops[0]!;
  const h = heldId(m);
  const first = ruler(m)[0];
  return { lo: c + (h !== null && first !== undefined ? first.w + m.gapPx : 0), hi: m.windowPx - c };
}

function screens(m: RowModel): Map<string, number> {
  const h = heldId(m);
  return new Map(ruler(m).map((p) => [p.id, p.id === h ? Math.max(p.x - m.view, 0) : p.x - m.view]));
}

function shown(m: RowModel): string[] {
  const { lo, hi } = frame(m);
  const h = heldId(m);
  return ruler(m)
    .filter((p) => {
      if (p.id === h) return true;
      const s = p.x - m.view;
      return Math.min(s + p.w, hi) - Math.max(s, lo) >= Math.min(p.w, hi - lo) - SHOWN_TOLERANCE_PX;
    })
    .map((p) => p.id);
}

const range = (m: RowModel): { min: number; max: number } => {
  const { stops } = layoutOf(m);
  return { min: stops[0]!, max: stops[stops.length - 1]! };
};
const forced = (after: RowModel, wanted: number): boolean => wanted < range(after).min - EPS_PX || wanted > range(after).max + EPS_PX;

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
  const flips = op.k === 'holdOn' || op.k === 'holdOff' || op.k === 'setWindow';
  const skip = new Set(flips ? [before.heldLeft, after.heldLeft, subject] : [heldId(before), heldId(after), subject]);
  const kept = ruler(before).filter((p) => sa.has(p.id) && !skip.has(p.id));
  if (op.k === 'holdOn' || op.k === 'holdOff' || op.k === 'setWindow') {
    const wanted = before.view;
    if (forced(after, wanted)) {
      const r = range(after);
      assert.ok(Math.abs(after.view - Math.min(r.max, Math.max(r.min, wanted))) < EPS_PX, 'a forced move goes no further than the range');
      return;
    }
    tick(`still:${op.k}`);
    assert.ok(largestMove(sb, sa, kept.map((p) => p.id)) < 1, `${op.k} moved a kept panel by ${largestMove(sb, sa, kept.map((p) => p.id))}px`);
    return;
  }
  const xa = new Map(ruler(after).map((p) => [p.id, p.x]));
  const { lo, hi } = frame(before);
  const visible = kept.filter((p) => Math.min(p.x - before.view + p.w, hi) - Math.max(p.x - before.view, lo) > EPS_PX);
  const anchor = visible[0] ?? kept[0];
  if (anchor === undefined) return;
  const shift = xa.get(anchor.id)! - anchor.x;
  const wanted = before.view + shift;
  if (forced(after, wanted)) {
    const r = range(after);
    assert.ok(Math.abs(after.view - Math.min(r.max, Math.max(r.min, wanted))) < EPS_PX, 'a forced move goes no further than the range');
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
  const s = screens(m);
  for (const p of ruler(m)) {
    if (p.id === h) {
      assert.equal(s.get(p.id), Math.max(p.x - m.view, 0));
      continue;
    }
    const at = p.x - m.view;
    const cutL = Math.min(p.w, Math.max(0, lo - at));
    const cutR = Math.min(p.w, Math.max(0, at + p.w - hi));
    const outside = cutL + cutR >= p.w - EPS_PX;
    tick(outside ? 'slots:outside' : cutL + cutR > EPS_PX ? 'slots:cut' : 'slots:whole');
    if (outside) continue;
    for (const cut of [cutL, cutR]) {
      if (cut <= EPS_PX) continue;
      assert.ok(p.w > m.phonePx, `${p.id}: a one-slot panel is cut by ${cut}px`);
      const slots = cut / pitch;
      assert.ok(Math.abs(slots - Math.round(slots)) * pitch <= EPS_PX + 1e-9, `${p.id}: cut by ${cut}px, not a whole number of slots`);
    }
  }
}

function dotsAgree(m: RowModel, track: number): void {
  const d = dotsOf(m, track);
  const lit = d.dots.filter((x) => x.lit).map((x) => x.id);
  assert.deepEqual(lit, onScreenIds(m), 'the lit dots are the panels on screen');
  assert.deepEqual(lit, shown(m), 'and match the panels the window shows');
  const h = heldId(m);
  const chain = d.dots.filter((x) => x.id !== h);
  const l = layoutOf(m);
  const k = l.stripPx > 0 ? track / l.stripPx : 0;
  for (let i = 1; i < chain.length; i += 1) {
    const gapBetween = chain[i]!.left - (chain[i - 1]!.left + chain[i - 1]!.width);
    assert.ok(Math.abs(gapBetween - k * m.gapPx) < 1e-6, `dots ${i - 1} and ${i} are ${gapBetween} apart, not ${k * m.gapPx}`);
  }
  for (const x of d.dots) {
    if (!x.lit || x.id === h || x.width > d.oval.width + 1e-6) continue;
    assert.ok(x.left >= d.oval.left - EPS_PX * k - 1e-6 && x.left + x.width <= d.oval.left + d.oval.width + EPS_PX * k + 1e-6, `${x.id} is lit outside the oval`);
  }
}

function derived(m: RowModel, track: number): string {
  return JSON.stringify({ l: layoutOf(m), shown: onScreenIds(m), parked: parkedIds(m), dots: dotsOf(m, track) });
}

function checkState(m: RowModel, track: number): void {
  assert.ok(Number.isFinite(m.view), 'view is finite');
  const l = layoutOf(m);
  assert.deepEqual(l.drawn.map((p) => [p.id, p.x, p.w]), ruler(m).map((p) => [p.id, p.x, p.w]), 'one ruler: the running sum over every drawn panel');
  l.stops.forEach((s, k) => k > 0 && assert.ok(Math.abs(s - l.stops[k - 1]! - l.pitchPx) < 1e-9, 'rests are one pitch apart'));
  assert.equal(derived(m, track), derived(structuredClone(m), track), 'deriving twice from equal models gives equal output');
  dotsAgree(m, track);
  const parked = parkedIds(m);
  const on = onScreenIds(m);
  assert.ok(parked.every((id) => !on.includes(id)), 'a parked panel is not on screen');
  assert.ok(heldId(m) === null || !parked.includes(heldId(m)!), 'the held panel is never parked');
  const h = heldId(m);
  if (h !== null) tick('hold:effective');
  if (h !== null) assert.ok(screens(m).get(h)! >= 0, 'the held panel is never left of the window');
}

function checkStep(m: RowModel): void {
  // Exactly on a rest: a view within the tolerance of one steps to the next rest, which need not come back to the view.
  if (!layoutOf(m).stops.some((s) => Math.abs(s - m.view) < 1e-9)) return;
  for (const dir of [1, -1] as const) {
    const there = step(m, dir);
    if (there.view === m.view) continue;
    tick('step:reversed');
    assert.ok(Math.abs(there.view - m.view) <= layoutOf(m).pitchPx + 1e-9, 'a step moves one slot');
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
      if (atRest(m)) wholeSlots(m);
      if (op.k === 'release') assert.ok(atRest(m), 'a release rests');
      if (op.k === 'stepL' || op.k === 'stepR') {
        if (m.view !== before.view) assert.ok(atRest(m), 'a step lands on a rest');
        assert.ok(Math.abs(m.view - before.view) <= layoutOf(m).pitchPx + EPS_PX + 1e-9, `a step moves at most one slot: view ${before.view} -> ${m.view}, stops ${layoutOf(m).stops.join(',')}`);
      }
      checkStep(m);
      const a = layoutOf(before);
      const b = layoutOf(m);
      const listOp = op.k === 'open' || op.k === 'close' || op.k === 'reorder' || op.k === 'resize' || op.k === 'holdOn' || op.k === 'holdOff';
      if (listOp && atRest(before) && a.stripPx > before.windowPx && b.stripPx > m.windowPx) assert.ok(atRest(m), 'a list change keeps an overflowing row on its rests');
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
  const wanted = ['still:holdOn', 'still:holdOff', 'still:setWindow', 'still:open', 'still:close', 'still:reorder', 'still:resize', 'still:open:shifted', 'still:close:shifted', 'still:resize:shifted', 'slots:whole', 'slots:cut', 'slots:outside', 'step:reversed', 'hold:effective'];
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
  const stops = layoutOf(base).stops;
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
