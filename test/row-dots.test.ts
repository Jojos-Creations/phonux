/**
 * The dot bar's geometry (rowDots.ts), pure: dot widths follow panel widths, the oval is the window, a click's
 * centring target clamps to the row, and a drag maps track px to scroll px.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { centreScroll, dotLayout, dragScroll, trackScale } from '../rowDots.js';

// Three panels 390 wide with a 16 gap: strip 1218 wide, window 600 wide, a 1000 px track.
const row = { ids: ['a', 'b', 'c'], widths: [390, 390, 390], leftOffsets: [0, 406, 812], stripWidth: 1202, windowWidth: 600, maxScroll: 602 };

test('dot widths follow the panels: a wide panel is a wide dot, the odd one hollow', () => {
  const wide = { ...row, widths: [390, 780, 390], leftOffsets: [0, 406, 1202], stripWidth: 1582 };
  const l = dotLayout({ ...wide, hollow: [false, true, false], scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  const f = 1000 / 1582;
  assert.deepEqual(l.dots.map((d) => d.width), [390 * f, 780 * f, 390 * f]);
  assert.deepEqual(l.dots.map((d) => d.hollow), [false, true, false]);
});

test('the oval is the window in track px, and its left follows the scroll', () => {
  const f = 1000 / 1202;
  const at0 = dotLayout({ ...row, hollow: [], scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  assert.equal(at0.oval.width, 600 * f);
  assert.equal(at0.oval.left, 0);
  const at200 = dotLayout({ ...row, hollow: [], scrollLeft: 200, trackWidth: 1000, minDotPx: 1 });
  assert.equal(at200.oval.left, 200 * f);
});

test('a row that fits, or whose window is not measured, shows the oval over the whole track', () => {
  const fits = dotLayout({ ...row, windowWidth: 2000, hollow: [], scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  assert.deepEqual(fits.oval, { left: 0, width: 1000 });
  const unmeasured = dotLayout({ ...row, windowWidth: Infinity, hollow: [], scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  assert.deepEqual(unmeasured.oval, { left: 0, width: 1000 });
});

test('a dot never narrows below minDotPx', () => {
  const l = dotLayout({ ...row, widths: [10, 390, 390], hollow: [], scrollLeft: 0, trackWidth: 1000, minDotPx: 10 });
  assert.equal(l.dots[0]?.width, 10);
});

test('an empty row and a single panel lay out without a dot gap or a divide by zero', () => {
  const none = dotLayout({ ids: [], widths: [], leftOffsets: [], hollow: [], stripWidth: 0, windowWidth: Infinity, scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  assert.deepEqual(none.dots, []);
  assert.equal(trackScale(1000, 0), 0);
  const one = dotLayout({ ids: ['a'], widths: [390], leftOffsets: [0], hollow: [true], stripWidth: 390, windowWidth: 600, scrollLeft: 0, trackWidth: 1000, minDotPx: 1 });
  assert.equal(one.dots[0]?.left, 0);
  assert.ok(Math.abs((one.dots[0]?.width ?? 0) - 1000) < 1e-9);
  assert.equal(one.dots[0]?.hollow, true);
});

test('a click centres a 390 panel, and a 2/3 or 4/5 wide panel as near as the row allows', () => {
  assert.equal(centreScroll({ ...row, index: 1, maxScroll: 602 }), 406 + 195 - 300);
  // The first panel cannot centre below zero; the last cannot centre past the row's end.
  assert.equal(centreScroll({ ...row, index: 0 }), 0);
  assert.equal(centreScroll({ ...row, index: 2 }), 602);
});

test('a row that cannot scroll, or an unmeasured window, gives no centring target', () => {
  assert.equal(centreScroll({ ...row, index: 1, maxScroll: 0 }), null);
  assert.equal(centreScroll({ ...row, index: 1, windowWidth: Infinity }), null);
});

test('a drag maps track px to scroll px and clamps to the row', () => {
  const f = 1000 / 1202;
  assert.equal(dragScroll({ startScroll: 100, dx: 50, trackWidth: 1000, stripWidth: 1202, maxScroll: 602 }), 100 + 50 / f);
  assert.equal(dragScroll({ startScroll: 100, dx: -5000, trackWidth: 1000, stripWidth: 1202, maxScroll: 602 }), 0);
  assert.equal(dragScroll({ startScroll: 100, dx: 5000, trackWidth: 1000, stripWidth: 1202, maxScroll: 602 }), 602);
  assert.equal(dragScroll({ startScroll: 100, dx: 50, trackWidth: 1000, stripWidth: 0, maxScroll: 602 }), 100);
});
