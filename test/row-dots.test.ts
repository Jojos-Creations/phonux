/**
 * The dot bar's geometry (rowDots.ts), pure: a dot is as many phone dashes as its panel is phones wide, the oval is the
 * window at a fixed width and slides with the scroll without a jump at a panel boundary, a click's centring target clamps
 * to the row, and a drag maps track px to scroll px.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOT_GAP_PX, DOT_PHONE_PX, centreScroll, dotLayout, dotMap, dragScroll, toScroll, toTrack, withParked } from '../rowDots.js';

// Three phones 390 wide with a 16 gap: one slot is 406 strip px and 30 track px (a 22 dash and an 8 gap).
const row = { ids: ['a', 'b', 'c'], widths: [390, 390, 390], leftOffsets: [0, 406, 812], windowWidth: 600, maxScroll: 602 };
const map = dotMap(row);
const SLOT = DOT_PHONE_PX + DOT_GAP_PX;
const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} vs ${b}`);

test('a dot is one phone dash per slot its panel spans, with one dot gap between dots, the odd one hollow', () => {
  const wide = dotMap({ widths: [390, 796, 390], leftOffsets: [0, 406, 1218] });
  const l = dotLayout({ ids: ['a', 'b', 'c'], hollow: [false, true, false], map: wide, windowWidth: 600, scrollLeft: 0 });
  assert.deepEqual(l.dots.map((d) => d.width), [22, 52, 22]);
  assert.deepEqual(l.dots.map((d) => d.left), [0, 30, 90]);
  assert.deepEqual(l.dots.map((d) => d.hollow), [false, true, false]);
  assert.equal(wide.width, 112);
});

test('the oval keeps one width at every scroll, as many slots as the window holds, and only its left moves', () => {
  const width = ((600 + 16) / 406) * SLOT - DOT_GAP_PX;
  for (const scrollLeft of [0, 100, 203, 405, 406, 500, 602]) {
    const l = dotLayout({ ...row, hollow: [], map, scrollLeft });
    near(l.oval.width, width, `width at ${scrollLeft}`);
  }
  near(dotLayout({ ...row, hollow: [], map, scrollLeft: 0 }).oval.left, 0, 'left at 0');
  near(dotLayout({ ...row, hollow: [], map, scrollLeft: 203 }).oval.left, SLOT / 2, 'left half a slot in');
  near(dotLayout({ ...row, hollow: [], map, scrollLeft: 406 }).oval.left, SLOT, 'left one slot in');
});

test('the scroll-to-track map has no jump at a panel boundary, a wide one included', () => {
  const wide = dotMap({ widths: [390, 796, 390], leftOffsets: [0, 406, 1218] });
  for (const m of [map, wide]) {
    for (const edge of m.strips.slice(1)) near(toTrack(m, edge - 1e-6), toTrack(m, edge), `at ${edge}`);
  }
  // A wide panel spans its slots at the same rate as a phone, so the oval's width does not change across it.
  const at = (s: number) => dotLayout({ ids: ['a', 'b', 'c'], hollow: [], map: wide, windowWidth: 600, scrollLeft: s }).oval;
  near(at(300).width, at(900).width, 'width across the wide panel');
});

test('toScroll undoes toTrack inside the bar', () => {
  for (const s of [0, 50, 406, 600, 1000]) near(toScroll(map, toTrack(map, s)), s, `round trip ${s}`);
});

test('a row that fits, or whose window is not measured, shows the oval over the whole bar', () => {
  assert.deepEqual(dotLayout({ ...row, windowWidth: 2000, hollow: [], map, scrollLeft: 0 }).oval, { left: 0, width: map.width });
  assert.deepEqual(dotLayout({ ...row, windowWidth: Infinity, hollow: [], map, scrollLeft: 0 }).oval, { left: 0, width: map.width });
});

test('the oval stops at the bar end even when the scroll would carry it past', () => {
  const l = dotLayout({ ...row, hollow: [], map, scrollLeft: 5000 });
  near(l.oval.left + l.oval.width, map.width, 'right edge');
});

test('an empty row and a single panel lay out without a dot gap or a divide by zero', () => {
  const none = dotMap({ widths: [], leftOffsets: [] });
  assert.equal(none.width, 0);
  assert.deepEqual(dotLayout({ ids: [], hollow: [], map: none, windowWidth: Infinity, scrollLeft: 0 }).dots, []);
  const one = dotLayout({ ids: ['a'], hollow: [true], map: dotMap({ widths: [390], leftOffsets: [0] }), windowWidth: 600, scrollLeft: 0 });
  assert.deepEqual(one.dots, [{ id: 'a', left: 0, width: DOT_PHONE_PX, hollow: true }]);
});

test('a click centres a 390 panel, as near as the row allows at either end', () => {
  assert.equal(centreScroll({ ...row, index: 1 }), 406 + 195 - 300);
  assert.equal(centreScroll({ ...row, index: 0 }), 0);
  assert.equal(centreScroll({ ...row, index: 2 }), 602);
});

test('a row that cannot scroll, or an unmeasured window, gives no centring target', () => {
  assert.equal(centreScroll({ ...row, index: 1, maxScroll: 0 }), null);
  assert.equal(centreScroll({ ...row, index: 1, windowWidth: Infinity }), null);
});

test('a drag maps track px to scroll px and clamps to the row', () => {
  near(dragScroll({ startScroll: 0, dx: SLOT / 2, map, maxScroll: 602 }), 203, 'half a slot');
  assert.equal(dragScroll({ startScroll: 100, dx: -5000, map, maxScroll: 602 }), 0);
  assert.equal(dragScroll({ startScroll: 100, dx: 5000, map, maxScroll: 602 }), 602);
});

test('parked panels get dots at their places in the row order, and the oval moves with the drawn dots it covers', () => {
  const drawn = dotLayout({ ...row, hollow: [], map, scrollLeft: 0 });
  const bar = withParked(drawn, map, [
    { id: 'p0', before: 0, slots: 1, hollow: false },
    { id: 'p1', before: 0, slots: 2, hollow: false },
    { id: 'p3', before: 3, slots: 1, hollow: true },
  ]);
  assert.deepEqual(bar.dots.map((d) => d.id), ['p0', 'p1', 'a', 'b', 'c', 'p3']);
  assert.deepEqual(bar.dots.map((d) => d.left), [0, 30, 90, 120, 150, 180]);
  assert.equal(bar.dots[1]!.width, 52, 'a parked panel two phones wide draws a two-phone dot');
  assert.equal(bar.dots[5]!.hollow, true);
  assert.equal(bar.width, 202);
  near(bar.oval.left, drawn.oval.left + 90, 'the oval sits over the drawn dots, past the parked ones on the left');
  near(bar.oval.width, drawn.oval.width, 'width');
  assert.deepEqual([...bar.parked], ['p0', 'p1', 'p3']);
  const none = withParked(drawn, map, []);
  assert.deepEqual(none.dots, drawn.dots, 'control: with nothing parked the bar is the drawn layout');
  assert.deepEqual(none.oval, drawn.oval);
});

test('parked dots between an always-shown panel and the panels on screen stay outside the oval', () => {
  const drawn = dotLayout({ ...row, hollow: [], map, scrollLeft: 602 });
  const bar = withParked(drawn, map, [{ id: 'p0', before: 1, slots: 1, hollow: false }, { id: 'p1', before: 1, slots: 1, hollow: false }]);
  assert.deepEqual(bar.dots.map((d) => d.id), ['a', 'p0', 'p1', 'b', 'c']);
  const p1 = bar.dots.find((d) => d.id === 'p1')!;
  const c = bar.dots.find((d) => d.id === 'c')!;
  assert.ok(bar.oval.left >= p1.left + p1.width, 'the oval starts past the parked dots');
  near(bar.oval.left + bar.oval.width, c.left + c.width, 'and ends at the last dot, as the drawn oval does at the row end');

  // The window over the always-shown panel and the one after it: the parked dots that sit between them in row order cut the oval to the run on the right.
  const both = withParked(dotLayout({ ...row, hollow: [], map, scrollLeft: 0 }), map, [{ id: 'p0', before: 1, slots: 1, hollow: false }]);
  const p0 = both.dots.find((d) => d.id === 'p0')!;
  assert.ok(both.oval.left >= p0.left + p0.width || both.oval.left + both.oval.width <= p0.left, 'no parked dot inside the oval');
});
