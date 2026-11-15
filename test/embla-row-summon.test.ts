import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { emblaSummonMove, wholeInView, type StripLayout } from '../emblaRow.js';

const PHONE = 390;
const GAP = 16;
const PITCH = PHONE + GAP;
const windowOf = (slots: number): number => slots * PITCH - GAP;
const layoutOf = (slots: readonly number[], names?: readonly string[]): StripLayout => {
  const lefts: number[] = [];
  let at = 0;
  for (const s of slots) {
    lefts.push(at);
    at += s * PITCH;
  }
  return { ids: names ?? slots.map((_, k) => `p${k}`), lefts, widths: slots.map((s) => s * PITCH - GAP) };
};
const names = (n: number, rootAt: number): string[] => Array.from({ length: n }, (_, k) => (k === rootAt ? 'root' : `p${k}`));
/** The strip after the move: the root taken out and put in next to `beside` on `side` (at that end for none). */
const moved = (layout: StripLayout, move: { side: 'left' | 'right'; beside: string | null }): StripLayout => {
  const slots = layout.widths.map((w) => Math.round((w + GAP) / PITCH));
  const k = layout.ids.indexOf('root');
  const ids = layout.ids.filter((id) => id !== 'root');
  const sl = slots.filter((_, j) => j !== k);
  const at = move.beside === null ? (move.side === 'left' ? 0 : ids.length) : ids.indexOf(move.beside) + (move.side === 'left' ? 0 : 1);
  ids.splice(at, 0, 'root');
  sl.splice(at, 0, slots[k]!);
  return layoutOf(sl, ids);
};

test('emblaSummonMove: a root off to the left goes next to the first page in the view, on its left', () => {
  const layout = layoutOf(Array(25).fill(1), names(25, 0));
  assert.deepEqual(emblaSummonMove(layout, 14 * PITCH, windowOf(4), 'root'), { side: 'left', beside: 'p14' });
});

test('emblaSummonMove: a root off to the right goes next to the last page in the view, on its right', () => {
  const layout = layoutOf(Array(25).fill(1), names(25, 24));
  assert.deepEqual(emblaSummonMove(layout, 0, windowOf(4), 'root'), { side: 'right', beside: 'p3' });
});

test('emblaSummonMove: a page cut by the edge counts as in the view, so the root goes past it, and none for a root in view or off the strip', () => {
  // p2 is three slots wide and the view starts one slot into it: the root goes left of p2, which stays where it is.
  const layout = layoutOf([1, 1, 3, 1, 1, 1, 1], ['root', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  assert.deepEqual(emblaSummonMove(layout, 3 * PITCH, windowOf(4), 'root'), { side: 'left', beside: 'p2' });
  assert.equal(emblaSummonMove(layout, 0, windowOf(4), 'root'), null, 'whole in view');
  assert.equal(emblaSummonMove(layout, 2 * PITCH, windowOf(4), 'gone'), null, 'not on the strip');
});

test('emblaSummonMove: a root cut by an edge stays on that side, and one wider than the view goes left', () => {
  const layout = layoutOf(Array(12).fill(1), names(12, 5));
  // The view heading for 5.5 slots cuts the root at its left edge, for 1.5 slots at its right edge.
  assert.deepEqual(emblaSummonMove(layout, 5.5 * PITCH, windowOf(4), 'root'), { side: 'left', beside: 'p6' });
  assert.deepEqual(emblaSummonMove(layout, 1.5 * PITCH, windowOf(4), 'root'), { side: 'right', beside: 'p4' });
  const wide = layoutOf([1, 1, 6, 1, 1], ['p0', 'p1', 'root', 'p3', 'p4']);
  assert.deepEqual(emblaSummonMove(wide, 3 * PITCH, windowOf(4), 'root'), { side: 'left', beside: 'p3' });
});

test('emblaSummonMove: the root lands one gap outside the view on its side and every page reaching into the view keeps its place (property)', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 6, maxLength: 30 }), fc.nat(), fc.nat(), fc.integer({ min: 1, max: 5 }), (slots, rootPick, stopPick, fit) => {
      const n = slots.length;
      const rootAt = rootPick % n;
      const one = slots.map((s, k) => (k === rootAt ? 1 : s));
      const layout = layoutOf(one, names(n, rootAt));
      const w = windowOf(fit);
      const end = layout.lefts.at(-1)! + layout.widths.at(-1)!;
      const max = Math.max(0, end - w);
      const at = Math.min((stopPick % Math.max(1, Math.ceil(max / PITCH) + 1)) * PITCH, max);
      const move = emblaSummonMove(layout, at, w, 'root');
      const k = layout.ids.indexOf('root');
      if (wholeInView(layout, k, at, w)) {
        assert.equal(move, null);
        return;
      }
      assert.notEqual(move, null);
      const after = moved(layout, move!);
      const j = after.ids.indexOf('root');
      // Every other page that reached into the view stands where it stood: the view keeps still across the move.
      layout.ids.forEach((id, i) => {
        if (id === 'root' || layout.lefts[i]! + layout.widths[i]! <= at + 0.5 || layout.lefts[i]! >= at + w - 0.5) return;
        assert.equal(after.lefts[after.ids.indexOf(id)], layout.lefts[i], `${id} moved`);
      });
      if (move!.beside === null) return;
      const b = after.ids.indexOf(move!.beside);
      // The root sits right next to that page, outside the view or at most where it already reached into it.
      if (move!.side === 'left') assert.equal(after.lefts[j]! + after.widths[j]! + GAP, after.lefts[b]);
      else assert.equal(after.lefts[b]! + after.widths[b]! + GAP, after.lefts[j]);
      const wasIn = layout.lefts[k]! + layout.widths[k]! > at + 0.5 && layout.lefts[k]! < at + w - 0.5;
      if (!wasIn) assert.ok(after.lefts[j]! + after.widths[j]! <= at + 0.5 || after.lefts[j]! >= at + w - 0.5, 'a root out of the view lands out of it');
    }),
    { numRuns: 400 },
  );
});
