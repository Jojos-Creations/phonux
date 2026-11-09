import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { emblaAsideFor, emblaSummonPlan, markedScroll, type EmblaRowMark, type StripLayout } from '../emblaRow.js';

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
const maxOf = (layout: StripLayout, windowWidth: number): number => Math.max(0, layout.lefts.at(-1)! + layout.widths.at(-1)! - windowWidth);

test('emblaSummonPlan: a root off to the left takes the far left slot; the pages between it and the view and the one in that slot step out', () => {
  // root, p1..p24, one slot each; the view rests at slot 9 (p9..p12) in a window of four.
  const layout = layoutOf(Array(25).fill(1), ['root', ...Array.from({ length: 24 }, (_, k) => `p${k + 1}`)]);
  const plan = emblaSummonPlan(layout, 9 * PITCH, windowOf(4), PHONE, 'root');
  assert.deepEqual(plan, { side: 'left', parks: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'], edge: { id: 'p9', edge: 'left', screen: 0 } });
});

test('emblaSummonPlan: a root off to the right takes the far right slot', () => {
  const layout = layoutOf(Array(10).fill(1), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'root']);
  const plan = emblaSummonPlan(layout, 0, windowOf(4), PHONE, 'root');
  assert.deepEqual(plan, { side: 'right', parks: ['p9', 'p8', 'p7', 'p6', 'p5', 'p4'], edge: { id: 'p4', edge: 'right', screen: 0 } });
});

test('emblaSummonPlan: a wider page in the edge slot stays on the strip and is the page the dismiss rests on', () => {
  // root, p1 (1), p2 (2), p3 (1), ...: at slot 2 the view starts with the two-slot p2.
  const layout = layoutOf([1, 1, 2, 1, 1, 1, 1], ['root', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  const plan = emblaSummonPlan(layout, 2 * PITCH, windowOf(4), PHONE, 'root');
  assert.deepEqual(plan, { side: 'left', parks: ['p1'], edge: { id: 'p2', edge: 'left', screen: 0 } });
  // The same page cut by the window's left edge: still in view, still stays.
  const cut = emblaSummonPlan(layout, 3 * PITCH, windowOf(4), PHONE, 'root');
  assert.deepEqual(cut, { side: 'left', parks: ['p1'], edge: { id: 'p2', edge: 'left', screen: -PITCH } });
});

test('emblaSummonPlan: nothing to plan for a root in view or off the strip', () => {
  const layout = layoutOf(Array(8).fill(1), ['root', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  assert.equal(emblaSummonPlan(layout, 0, windowOf(4), PHONE, 'root'), null);
  assert.equal(emblaSummonPlan(layout, 2 * PITCH, windowOf(4), PHONE, 'gone'), null);
});

test('emblaSummonPlan: every page between the root and the view steps out, and none in view but the edge slot one (property)', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 6, maxLength: 20 }), fc.integer({ min: 2, max: 5 }), fc.nat(), (slots, fit, at) => {
      const names = ['root', ...slots.slice(1).map((_, k) => `p${k + 1}`)];
      const layout = layoutOf([1, ...slots.slice(1)], names);
      const w = windowOf(fit);
      const max = maxOf(layout, w);
      const stops = layout.lefts.filter((l) => l <= max);
      const scroll = stops[at % stops.length]!;
      const plan = emblaSummonPlan(layout, scroll, w, PHONE, 'root');
      if (scroll === 0) return plan === null;
      if (plan === null || plan.side !== 'left') return false;
      const between = layout.ids.filter((id, k) => k > 0 && layout.lefts[k]! + layout.widths[k]! <= scroll + 0.5);
      const inView = layout.ids.filter((id, k) => k > 0 && layout.lefts[k]! + layout.widths[k]! > scroll + 0.5 && layout.lefts[k]! < scroll + w - 0.5);
      const first = inView[0]!;
      const k = layout.ids.indexOf(first);
      const fitsSlot = layout.lefts[k]! >= scroll - 0.5 && layout.widths[k]! <= PHONE + 0.5;
      return plan.parks.join() === [...between, ...(fitsSlot ? [first] : [])].join() && plan.edge?.id === first;
    }),
    { numRuns: 400 },
  );
});

test('emblaAsideFor: a cut page beside a whole root that cannot fit beside it but fits alone', () => {
  // root (1), p1 (3), p2 (1): a window of three slots shows the root and two thirds of p1.
  const layout = layoutOf([1, 3, 1], ['root', 'p1', 'p2']);
  assert.deepEqual(emblaAsideFor(layout, 0, windowOf(3), GAP, 'root'), { id: 'p1', side: 'left' });
  // The root right of the page: p1 (3), root (1), at the strip's end.
  const right = layoutOf([1, 3, 1], ['p0', 'p1', 'root']);
  assert.deepEqual(emblaAsideFor(right, maxOf(right, windowOf(3)), windowOf(3), GAP, 'root'), { id: 'p1', side: 'right' });
});

test('emblaAsideFor: none when the page fits beside the root, is wider than the window, is whole, is not shown, or the root is not whole', () => {
  const fits = layoutOf([1, 3, 1], ['root', 'p1', 'p2']);
  assert.equal(emblaAsideFor(fits, 0, windowOf(4), GAP, 'root'), null, 'root and p1 fit a window of four');
  const wide = layoutOf([1, 4, 1], ['root', 'p1', 'p2']);
  assert.equal(emblaAsideFor(wide, 0, windowOf(3), GAP, 'root'), null, 'p1 is wider than the window: stepping aside would not show it whole');
  const whole = layoutOf([1, 1, 3], ['root', 'p1', 'p2']);
  assert.equal(emblaAsideFor(whole, 0, windowOf(3), GAP, 'root'), null, 'p1 is whole and p2 is not beside the root');
  const hidden = layoutOf([1, 1, 3, 1, 1, 1], ['p0', 'root', 'p2', 'p3', 'p4', 'p5']);
  assert.equal(emblaAsideFor(hidden, 0, windowOf(1) + PITCH, GAP, 'root'), null, 'p2 is not in view at all');
  assert.equal(emblaAsideFor(fits, PITCH / 2, windowOf(3), GAP, 'root'), null, 'the root is cut');
  assert.equal(emblaAsideFor(fits, 0, windowOf(3), GAP, 'gone'), null);
});

const mark = (m: Partial<EmblaRowMark>): EmblaRowMark => ({ pin: null, reveal: null, seq: 1, ...m });

test('markedScroll: a left pin rests the panel its screen px right of the window edge; a right pin its right edge that far left of the right edge', () => {
  const layout = layoutOf(Array(12).fill(1));
  const w = windowOf(4);
  const max = maxOf(layout, w);
  assert.equal(markedScroll(mark({ pin: { id: 'p5', edge: 'left', screen: 0 } }), layout, w, 0, max), 5 * PITCH);
  assert.equal(markedScroll(mark({ pin: { id: 'p5', edge: 'left', screen: PITCH } }), layout, w, 0, max), 4 * PITCH);
  // p5's right edge at the window's right edge: p2..p5 in view.
  assert.equal(markedScroll(mark({ pin: { id: 'p5', edge: 'right', screen: 0 } }), layout, w, 0, max), 2 * PITCH);
  // Clamped to the strip's ends.
  assert.equal(markedScroll(mark({ pin: { id: 'p11', edge: 'left', screen: 0 } }), layout, w, 0, max), max);
  assert.equal(markedScroll(mark({ pin: { id: 'p1', edge: 'right', screen: 0 } }), layout, w, 0, max), 0);
});

test('markedScroll: a pin puts the panel exactly where it asks whenever the strip allows (property)', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 2, maxLength: 16 }), fc.integer({ min: 1, max: 5 }), fc.nat(), fc.integer({ min: 0, max: 3 }), fc.boolean(), (slots, fit, pick, by, left) => {
      const layout = layoutOf(slots);
      const w = windowOf(fit);
      const max = maxOf(layout, w);
      const k = pick % slots.length;
      const screen = by * PITCH;
      const got = markedScroll(mark({ pin: { id: `p${k}`, edge: left ? 'left' : 'right', screen } }), layout, w, 0, max)!;
      if (got < -0.01 || got > max + 0.01) return false;
      const at = left ? layout.lefts[k]! - got : w - (layout.lefts[k]! + layout.widths[k]! - got);
      return got <= 0.01 || got >= max - 0.01 || Math.abs(at - screen) < 0.01;
    }),
    { numRuns: 400 },
  );
});

test('markedScroll: a reveal moves the least from the kept scroll that shows the panel whole; a whole one keeps it', () => {
  const layout = layoutOf(Array(12).fill(1));
  const w = windowOf(4);
  const max = maxOf(layout, w);
  const kept = 4 * PITCH;
  assert.equal(markedScroll(mark({ reveal: 'p5' }), layout, w, kept, max), kept);
  assert.equal(markedScroll(mark({ reveal: 'p9' }), layout, w, kept, max), 6 * PITCH, 'from the right: p9 lands at the right edge');
  assert.equal(markedScroll(mark({ reveal: 'p1' }), layout, w, kept, max), PITCH, 'from the left: p1 lands at the left edge');
});

test('markedScroll: null for a mark naming no panel on the strip, and for an empty mark', () => {
  const layout = layoutOf(Array(6).fill(1));
  assert.equal(markedScroll(mark({ pin: { id: 'gone', edge: 'left', screen: 0 } }), layout, windowOf(4), 0, PITCH * 2), null);
  assert.equal(markedScroll(mark({ reveal: 'gone' }), layout, windowOf(4), 0, PITCH * 2), null);
  assert.equal(markedScroll(mark({}), layout, windowOf(4), 0, PITCH * 2), null);
});
