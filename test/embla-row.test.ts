import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { JSDOM } from 'jsdom';
import { emblaRests, emblaWindowOf, pressStartsRowDrag, restsOnGrid, revealScroll, slotMarkerLefts } from '../emblaRow.js';

const PHONE = 390;
const GAP = 16;
const PITCH = PHONE + GAP;
const stripOf = (slots: readonly number[]): number => slots.reduce((a, b) => a + b, 0) * PITCH - GAP;

test('emblaWindowOf: the window holds whole slots only, and a strip that fits is its own window', () => {
  assert.deepEqual(emblaWindowOf(1768, PHONE, GAP, stripOf(Array(20).fill(1))), { fit: 4, width: 4 * PITCH - GAP, scrolls: true });
  assert.deepEqual(emblaWindowOf(1768, PHONE, GAP, stripOf([1, 2])), { fit: 4, width: stripOf([1, 2]), scrolls: false });
  assert.deepEqual(emblaWindowOf(300, PHONE, GAP, stripOf([1, 1])), { fit: 1, width: PHONE, scrolls: true });
  assert.equal(emblaWindowOf(Number.POSITIVE_INFINITY, PHONE, GAP, stripOf([1, 3])).width, stripOf([1, 3]), 'unmeasured: the strip itself');
});

test('slotMarkerLefts: one marker per slot, one pitch apart, and every panel edge is a marker', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 30 }), (slots) => {
      const markers = slotMarkerLefts(stripOf(slots), PHONE, GAP);
      assert.equal(markers.length, slots.reduce((a, b) => a + b, 0));
      markers.forEach((m, k) => assert.equal(m, k * PITCH));
      let at = 0;
      for (const s of slots) {
        assert.ok(markers.includes(at * PITCH), `a panel starting at slot ${at} has a marker`);
        at += s;
      }
    }),
  );
  assert.deepEqual(slotMarkerLefts(0, PHONE, GAP), []);
});

test('emblaRests: every rest is on the slot grid or the end, the end is a rest, and no one-slot panel is cut at any rest', () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 6 }), (slots, fit) => {
      const strip = stripOf(slots);
      const win = emblaWindowOf(fit * PITCH - GAP, PHONE, GAP, strip);
      const rests = emblaRests(slotMarkerLefts(strip, PHONE, GAP), strip, win.width);
      const max = Math.max(0, strip - win.width);
      assert.equal(rests[0], 0);
      assert.equal(rests[rests.length - 1], max);
      for (let k = 1; k < rests.length; k += 1) assert.ok(rests[k]! > rests[k - 1]!, 'ascending, each once');
      for (const r of rests) {
        assert.ok(restsOnGrid(r, PITCH, max));
        let at = 0;
        for (const s of slots) {
          const left = at * PITCH - r;
          const width = s * PITCH - GAP;
          const inside = left + width > 0.5 && left < win.width - 0.5;
          const whole = left >= -0.5 && left + width <= win.width + 0.5;
          if (s === 1 && inside) assert.ok(whole, `a one-slot panel at slot ${at} is cut at rest ${r}`);
          at += s;
        }
      }
    }),
  );
});

test('restsOnGrid: a whole number of pitches or the end, nothing between', () => {
  assert.equal(restsOnGrid(812, PITCH, 4000), true);
  assert.equal(restsOnGrid(4000, PITCH, 4000), true);
  assert.equal(restsOnGrid(813, PITCH, 4000), false);
  assert.equal(restsOnGrid(600, PITCH, 4000), false);
});

test('revealScroll: a panel cut on either side comes in by the least move, and one already whole stays', () => {
  const W = 4 * PITCH - GAP;
  assert.equal(revealScroll(PITCH, PHONE, 0, W), null);
  assert.equal(revealScroll(4 * PITCH, PHONE, 0, W), PITCH, 'cut on the right: its right edge to the window right');
  assert.equal(revealScroll(0, PHONE, PITCH, W), 0, 'cut on the left: its left edge to the window left');
  assert.equal(revealScroll(2 * PITCH, 5 * PITCH - GAP, 0, W), 2 * PITCH, 'wider than the window: its own left edge');
});

test('pressStartsRowDrag: a wheel gesture always, a mouse press only off the panels, a touch anywhere but a control', () => {
  const doc = new JSDOM('<div id="box"><div data-row-slot="0"><p id="text">x</p><button id="btn">b</button></div></div>').window.document;
  const at = (id: string, type: string, isTrusted = true) => ({ isTrusted, type, target: doc.getElementById(id) });
  assert.equal(pressStartsRowDrag(at('text', 'mousedown', false)), true, 'the wheel plugin dispatches untrusted mouse events');
  assert.equal(pressStartsRowDrag(at('box', 'mousedown')), true);
  assert.equal(pressStartsRowDrag(at('text', 'mousedown')), false);
  assert.equal(pressStartsRowDrag(at('text', 'touchstart')), true);
  assert.equal(pressStartsRowDrag(at('btn', 'touchstart')), false);
});
