import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { loadedNear, type StripLayout } from '../emblaRow.js';
import { EDGE_MAX_SLOTS_PER_SEC, EDGE_ZONE_PX, edgeSpeed, emblaBarOf } from '../emblaDots.js';
import { DOT_GAP_PX, DOT_PHONE_PX } from '../rowBar.js';
import { rowPricing, settleKeeping, type RowEnv } from '../panels/rowSettle.js';
import type { PanelWindow } from '../panelWindow.js';

const PHONE = 390;
const GAP = 16;
const PITCH = PHONE + GAP;
const layoutOf = (slots: readonly number[]): StripLayout => {
  const lefts: number[] = [];
  let at = 0;
  for (const s of slots) {
    lefts.push(at);
    at += s * PITCH;
  }
  return { ids: slots.map((_, k) => `p${k}`), lefts, widths: slots.map((s) => s * PITCH - GAP) };
};
const W4 = 4 * PITCH - GAP;
const near = (layout: StripLayout, scroll: number, o: { near?: number; limit?: number | null; fixed?: string[]; was?: ReadonlySet<string> | null } = {}) =>
  loadedNear({ layout, scroll, windowWidth: W4, pitch: PITCH, gap: GAP, near: o.near ?? 2, limit: o.limit ?? null, unloadable: (id) => !(o.fixed ?? []).includes(id), was: o.was ?? null });

test('loadedNear: the panels in view and those under `near` slots past each edge load; the rest unload', () => {
  const l = layoutOf(Array(20).fill(1));
  assert.deepEqual([...near(l, 6 * PITCH)].sort(), ['p10', 'p11', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.deepEqual([...near(l, 6 * PITCH, { near: 0 })].sort(), ['p6', 'p7', 'p8', 'p9']);
  assert.deepEqual([...near(l, 0)].sort(), ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
});

test('loadedNear: a panel that is not unloadable is always loaded and takes nothing from the cap', () => {
  const l = layoutOf(Array(20).fill(1));
  const got = near(l, 10 * PITCH, { fixed: ['p0'], limit: 4 });
  assert.ok(got.has('p0'));
  assert.deepEqual([...got].filter((id) => id !== 'p0').sort(), ['p10', 'p11', 'p12', 'p13']);
});

test('loadedNear: the cap keeps the nearest, and never unloads a panel in view', () => {
  const l = layoutOf(Array(20).fill(1));
  assert.deepEqual([...near(l, 6 * PITCH, { limit: 6 })].sort(), ['p10', 'p5', 'p6', 'p7', 'p8', 'p9']);
  assert.deepEqual([...near(l, 6 * PITCH, { limit: 2 })].sort(), ['p6', 'p7', 'p8', 'p9']);
});

test('loadedNear: one loaded stays until a whole slot further than `near`, so a row resting on the line does not flip', () => {
  const l = layoutOf(Array(20).fill(1));
  const at = 6 * PITCH;
  const first = near(l, at);
  assert.ok(first.has('p4') && !first.has('p3'));
  // 1.2 slots on: p4 is 2.2 slots away, past `near`, but was loaded.
  const on = near(l, at + PITCH * 1.2, { was: first });
  assert.ok(on.has('p4'));
  assert.ok(!near(l, at + PITCH * 1.2).has('p4'), 'without the hold it unloads');
  assert.ok(!near(l, at + PITCH * 2.1, { was: on }).has('p4'), 'a whole slot past `near` it unloads');
});

test('loadedNear: property: in view always loaded, the cap holds above the view count, each loaded one is within near+1', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 30 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 4 }), fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }), (slots, f, n, limit) => {
      const l = layoutOf(slots);
      const strip = l.lefts[l.lefts.length - 1]! + l.widths[l.widths.length - 1]!;
      const scroll = f * Math.max(0, strip - W4);
      const got = near(l, scroll, { near: n, limit });
      let inView = 0;
      l.ids.forEach((id, k) => {
        const shows = Math.min(l.lefts[k]! + l.widths[k]!, scroll + W4) - Math.max(l.lefts[k]!, scroll) > 0.5;
        if (shows) {
          inView += 1;
          assert.ok(got.has(id), `${id} in view`);
        }
        const outside = Math.max(scroll - (l.lefts[k]! + l.widths[k]!), l.lefts[k]! - scroll - W4, 0);
        if (got.has(id) && !shows) assert.ok((outside - GAP) / PITCH < n + 1);
      });
      if (limit !== null) assert.ok(got.size <= Math.max(limit, inView));
    }),
    { numRuns: 300 },
  );
});

test('emblaBarOf: one dot per panel at its place scaled to dots; the oval spans the dots of the panels in view', () => {
  const l = layoutOf([1, 3, 1, 2, 1, 1]);
  const strip = { layout: l, windowWidth: W4, stripWidth: 9 * PITCH - GAP, pitch: PITCH, gap: GAP };
  const scale = (DOT_PHONE_PX + DOT_GAP_PX) / PITCH;
  const bar = emblaBarOf(strip, 4 * PITCH, () => false);
  assert.equal(bar.dots.length, 6);
  assert.deepEqual(bar.dots.map((d) => d.width), [22, 82, 22, 52, 22, 22]);
  assert.equal(bar.width, 9 * 30 - 8);
  assert.equal(bar.oval.left, 4 * 30);
  assert.equal(bar.oval.width, 4 * 30 - 8);
  // In view at slot 4: p2 (slot 4), p3 (slots 5-6), p4 (slot 7).
  assert.deepEqual(bar.shown, ['p2', 'p3', 'p4']);
  assert.equal(bar.oval.left, bar.dots[2]!.left);
  assert.equal(bar.oval.left + bar.oval.width, bar.dots[4]!.left + bar.dots[4]!.width);
  assert.ok(Math.abs(bar.scale - scale) < 1e-12);
  // Past the end the oval stops at the strip's end.
  assert.equal(emblaBarOf(strip, 99 * PITCH, () => false).oval.left, bar.max * scale);
});

test('edgeSpeed: zero between the zones, growing with depth past either end, capped', () => {
  const span = { left: 100, right: 400 };
  assert.equal(edgeSpeed(250, span, PITCH), 0);
  assert.equal(edgeSpeed(400 - EDGE_ZONE_PX, span, PITCH), 0);
  assert.ok(edgeSpeed(400, span, PITCH) > 0);
  assert.ok(edgeSpeed(430, span, PITCH) > edgeSpeed(410, span, PITCH));
  assert.ok(edgeSpeed(100, span, PITCH) < 0);
  assert.equal(edgeSpeed(5000, span, PITCH), (EDGE_MAX_SLOTS_PER_SEC * PITCH) / 1000);
});

test('rowPricing on a strip: nothing parks for room or the cap', () => {
  const panel = (id: string): PanelWindow => ({ id, view: id, title: id, live: true, collapsible: true, settings: { overflow: 'park' } }) as unknown as PanelWindow;
  const row = Array.from({ length: 12 }, (_, k) => panel(`p${k}`));
  const env: RowEnv = { phoneWidth: PHONE, containerWidth: 1800, gap: GAP, fixedColumnCount: 0, maxLive: 4, dropTieBreak: 'leftmost' };
  assert.equal(rowPricing({ ...env, strip: true }, row).capacityFor(row), Number.POSITIVE_INFINITY);
  assert.equal(settleKeeping({ ...env, strip: true }, row, []), row);
  // Control: the same row off the strip parks down to the cap.
  assert.equal(settleKeeping(env, row, []).filter((p) => p.live).length, 4);
});

test('loadedNear: what the next frames of a glide bring into view, and the window where it goes, load whatever the cap', () => {
  const l = layoutOf(Array(24).fill(1));
  const base = { layout: l, windowWidth: W4, pitch: PITCH, gap: GAP, near: 0, limit: 4, unloadable: () => true, was: null };
  // At cap 4 with four in view, a row moving right 300 px in the next frames loads p6 before it enters (p6's left is 6 * PITCH).
  const ahead = loadedNear({ ...base, scroll: 2 * PITCH, ahead: 300 });
  assert.ok(ahead.has('p6'), 'the page entering on the right loads ahead of the view');
  assert.ok(!loadedNear({ ...base, scroll: 2 * PITCH }).has('p6'), 'control: not without the lookahead');
  assert.ok(loadedNear({ ...base, scroll: 2 * PITCH, ahead: -300 }).has('p1'), 'moving left, the page on the left loads');
  // A far glide's destination loads at the start, past the cap: the view's four and the destination's four.
  const toward = loadedNear({ ...base, scroll: 0, toward: 18 * PITCH });
  assert.deepEqual([...toward].sort(), ['p0', 'p1', 'p18', 'p19', 'p2', 'p20', 'p21', 'p3']);
});
