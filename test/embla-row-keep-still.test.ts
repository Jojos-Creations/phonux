/**
 * The keep-the-view-still rule of the Embla row, as the property test docs/row-position-core-redesign.md section 5 proposes:
 * random sequences of operations on a model of the row (stepL, stepR, setWindow, open, close, reorder, resize), and after every
 * one the invariants it names that apply here: stillness (a change that is not a step moves no panel the change did not push),
 * whole slots (at rest no one-slot panel is cut, and the rest is on the slot grid) and reversibility (stepR then stepL returns).
 * The model draws a panel no wider than the window, as the row's numbers do, so a narrower window clamps a wide panel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { emblaRests, emblaWindowOf, keptScroll, restsOnGrid, slotMarkerLefts, type StripLayout } from '../emblaRow.js';

const PHONE = 390;
const GAP = 16;
const PITCH = PHONE + GAP;

interface Row { panels: { id: string; slots: number }[]; room: number; scroll: number }
type Keep = (before: StripLayout, after: StripLayout, scroll: number, max: number) => number;

function layoutOf(row: Row): StripLayout & { window: number; strip: number; max: number; rests: number[] } {
  const fit = emblaWindowOf(row.room, PHONE, GAP, Number.POSITIVE_INFINITY).fit;
  const widths = row.panels.map((p) => Math.min(p.slots, fit) * PITCH - GAP);
  const lefts: number[] = [];
  let at = 0;
  for (const w of widths) {
    lefts.push(at);
    at += w + GAP;
  }
  const strip = Math.max(0, at - GAP);
  const window = emblaWindowOf(row.room, PHONE, GAP, strip).width;
  const max = Math.max(0, strip - window);
  return { ids: row.panels.map((p) => p.id), lefts, widths, window, strip, max, rests: emblaRests(slotMarkerLefts(strip, PHONE, GAP), strip, window) };
}

/** Each panel's screen x in the window, for those the window shows any of. */
function onScreen(row: Row): Map<string, number> {
  const l = layoutOf(row);
  const out = new Map<string, number>();
  l.ids.forEach((id, k) => {
    const x = l.lefts[k]! - row.scroll;
    if (x + l.widths[k]! > 0.5 && x < l.window - 0.5) out.set(id, x);
  });
  return out;
}

type Op =
  | { kind: 'stepR' | 'stepL' }
  | { kind: 'setWindow'; slots: number }
  | { kind: 'open'; at: number; slots: number }
  | { kind: 'close'; at: number }
  | { kind: 'reorder'; from: number; to: number }
  | { kind: 'resize'; at: number; slots: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant({ kind: 'stepR' as const }),
  fc.constant({ kind: 'stepL' as const }),
  fc.record({ kind: fc.constant('setWindow' as const), slots: fc.integer({ min: 1, max: 6 }) }),
  fc.record({ kind: fc.constant('open' as const), at: fc.nat(40), slots: fc.integer({ min: 1, max: 3 }) }),
  fc.record({ kind: fc.constant('close' as const), at: fc.nat(40) }),
  fc.record({ kind: fc.constant('reorder' as const), from: fc.nat(40), to: fc.nat(40) }),
  fc.record({ kind: fc.constant('resize' as const), at: fc.nat(40), slots: fc.integer({ min: 1, max: 3 }) }),
);

let seq = 0;
/** Applies `op` and returns the row after it with the scroll `keep` gives, plus the strip span the change touched (null: none). */
function apply(row: Row, op: Op, keep: Keep): { next: Row; touched: [number, number] | null } {
  const before = layoutOf(row);
  const panels = row.panels.slice();
  let room = row.room;
  let touched: [number, number] | null = null;
  const span = (k: number): [number, number] => [before.lefts[k]!, before.lefts[k]! + before.widths[k]!];
  if (op.kind === 'stepR' || op.kind === 'stepL') {
    const rests = before.rests;
    if (rests.length === 0) return { next: { ...row, scroll: 0 }, touched: null };
    let k = 0;
    for (let i = 1; i < rests.length; i += 1) if (Math.abs(rests[i]! - row.scroll) < Math.abs(rests[k]! - row.scroll)) k = i;
    const to = rests[Math.min(rests.length - 1, Math.max(0, k + (op.kind === 'stepR' ? 1 : -1)))]!;
    return { next: { ...row, scroll: to }, touched: null };
  }
  if (op.kind === 'setWindow') room = op.slots * PITCH - GAP;
  else if (panels.length === 0) return { next: row, touched: null };
  else if (op.kind === 'open') {
    const at = op.at % (panels.length + 1);
    panels.splice(at, 0, { id: `n${seq++}`, slots: op.slots });
    const x = at < before.lefts.length ? before.lefts[at]! : before.strip;
    touched = [x, x];
  } else if (op.kind === 'close') {
    const at = op.at % panels.length;
    touched = span(at);
    panels.splice(at, 1);
  } else if (op.kind === 'reorder') {
    const from = op.from % panels.length;
    const to = op.to % panels.length;
    const [moved] = panels.splice(from, 1);
    panels.splice(to, 0, moved!);
    touched = [Math.min(span(from)[0], span(to)[0]), Math.max(span(from)[1], span(to)[1])];
  } else if (op.kind === 'resize') {
    const at = op.at % panels.length;
    panels[at] = { ...panels[at]!, slots: op.slots };
    touched = span(at);
  }
  const moved: Row = { panels, room, scroll: row.scroll };
  const after = layoutOf(moved);
  return { next: { ...moved, scroll: keep(before, after, row.scroll, after.max) }, touched };
}

function check(keep: Keep): fc.IPropertyWithHooks<[number[], number, Op[]]> {
  return fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 20 }), fc.integer({ min: 1, max: 6 }), fc.array(opArb, { minLength: 20, maxLength: 60 }), (slots, fit, ops) => {
    let row: Row = { panels: slots.map((s, k) => ({ id: `p${k}`, slots: s })), room: fit * PITCH - GAP, scroll: 0 };
    for (const op of ops) {
      const seen = onScreen(row);
      const { next, touched } = apply(row, op, keep);
      const l = layoutOf(next);
      // Whole slots: the rest is on the grid and inside the row, so a one-slot panel is wholly in the window or wholly out.
      assert.ok(next.scroll >= -0.5 && next.scroll <= l.max + 0.5, `${op.kind}: scroll ${next.scroll} outside 0..${l.max}`);
      assert.ok(restsOnGrid(next.scroll, PITCH, l.max), `${op.kind}: rest ${next.scroll} off the grid`);
      l.ids.forEach((id, k) => {
        const x = l.lefts[k]! - next.scroll;
        const w = l.widths[k]!;
        if (w <= PHONE + 0.5 && x + w > 0.5 && x < l.window - 0.5) assert.ok(x >= -0.5 && x + w <= l.window + 0.5, `${op.kind}: one-slot panel ${id} cut at ${x}`);
      });
      // Stillness: a change that is not a step leaves every shown panel it did not push where it was; a window change keeps the
      // panel at the window's left edge. Not asserted where the row's end or start clamped the scroll.
      const clamped = Math.abs(next.scroll - l.max) < 0.5 || next.scroll < 0.5;
      if (!clamped && op.kind === 'setWindow') {
        const left = [...seen.entries()].sort((a, b) => a[1] - b[1])[0];
        const now = onScreen(next);
        if (left !== undefined && left[1] >= -0.5 && now.has(left[0])) assert.ok(Math.abs(now.get(left[0])! - left[1]) < 1, `setWindow: the left-edge panel ${left[0]} moved`);
      } else if (!clamped && touched !== null) {
        const now = onScreen(next);
        const leftOfView = touched[1] <= row.scroll + 0.5;
        for (const [id, x] of seen) {
          const k = layoutOf(row).ids.indexOf(id);
          const pushed = !leftOfView && layoutOf(row).lefts[k]! + 0.5 >= touched[0];
          if (pushed || !now.has(id)) continue;
          assert.ok(Math.abs(now.get(id)! - x) < 1, `${op.kind}: panel ${id} moved ${now.get(id)! - x} px`);
        }
      }
      // Closing the panel at the window's left edge: the panel after it becomes the anchor and stays where it was on screen.
      if (!clamped && op.kind === 'close' && touched !== null && touched[0] <= row.scroll + 0.5 && touched[1] > row.scroll + 0.5) {
        const was = layoutOf(row);
        const k = op.at % row.panels.length;
        const after = was.ids[k + 1];
        const j = after === undefined ? -1 : l.ids.indexOf(after);
        if (j >= 0) assert.ok(Math.abs(l.lefts[j]! - next.scroll - (was.lefts[k + 1]! - row.scroll)) < 1, `close: the anchor ${after} after the closed left-edge panel moved`);
      }
      // Reversibility: a step right then left returns, where neither was clamped.
      if (op.kind === 'stepR' && next.scroll > row.scroll + 0.5) assert.equal(apply(next, { kind: 'stepL' }, keep).next.scroll, row.scroll);
      row = next;
    }
  });
}

test('keep-still: over random sequences of steps, window sizes, opens, closes, reorders and resizes, the view stays still, rests on the grid and cuts no one-slot panel', () => {
  fc.assert(check(keptScroll), { numRuns: 500 });
});

test('keep-still: closing the panel at the window\'s left edge keeps the panel after it where it was', () => {
  // p0-p2 one slot, p3 three, p4-p6 one; a two-slot window (p3 clamps to two) at p3's second slot, so p3 is the left-edge panel, cut.
  const row: Row = { panels: [1, 1, 1, 3, 1, 1, 1].map((s, k) => ({ id: `p${k}`, slots: s })), room: 2 * PITCH - GAP, scroll: 4 * PITCH };
  const before = layoutOf(row);
  const { next } = apply(row, { kind: 'close', at: 3 }, keptScroll);
  const after = layoutOf(next);
  assert.equal(after.lefts[after.ids.indexOf('p4')]! - next.scroll, before.lefts[before.ids.indexOf('p4')]! - row.scroll);
  assert.equal(next.scroll, 2 * PITCH);
});

test('keep-still: the property fails for a rule that keeps the scroll when the left-edge panel itself closes', () => {
  // The mutant the audit found surviving: the anchor gone, it keeps the scroll instead of moving with the next panel.
  const anchorGoneKeeps: Keep = (b, a, scroll, max) => {
    const order = b.ids.map((_, k) => k).sort((x, y) => b.lefts[x]! - b.lefts[y]!);
    const first = order.find((k) => b.lefts[k]! + b.widths[k]! > scroll + 0.5);
    if (first !== undefined && !a.ids.includes(b.ids[first]!)) return Math.min(Math.max(0, scroll), max);
    return keptScroll(b, a, scroll, max);
  };
  const result = fc.check(check(anchorGoneKeeps), { numRuns: 500 });
  assert.equal(result.failed, true, 'a rule that ignores a closed left-edge anchor must fail');
  assert.match(String(result.errorInstance), /the anchor/);
});

test('keep-still: the same property fails for a row that keeps its scroll as it was, so the test sees the jump', () => {
  const asIs: Keep = (_b, _a, scroll, max) => Math.min(Math.max(0, scroll), max);
  const result = fc.check(check(asIs), { numRuns: 500 });
  assert.equal(result.failed, true, 'a row with no keep-still rule must fail stillness');
  assert.match(String(result.errorInstance), /moved/);
});
