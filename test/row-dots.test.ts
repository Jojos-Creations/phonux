/**
 * The dot bar's geometry (rowDots.ts), pure: a dot is as many phone dashes as its panel is phones wide, the oval is the
 * window at a fixed width and slides with the scroll without a jump at a panel boundary, a click's centering target clamps
 * to the row, and a drag maps track px to scroll px.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOT_GAP_PX, DOT_PHONE_PX, centreScroll, dotLayout, dotMap, dragScroll, toScroll, toTrack } from '../rowDots.js';

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
