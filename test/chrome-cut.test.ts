/**
 * The cut a row writes for a wide panel's header and footer: how far in from the slot's sides they lie so they span what the
 * window shows of it, never narrower than one phone. Literal numbers on a phone of 390, a gap of 16 and a fold of 796.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { chromeCutOf } from '../emblaRow.js';
import { CHROME_CUT_LEFT_PROPERTY, CHROME_CUT_RIGHT_PROPERTY, chromeCutSides } from '../rowDom.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';

const PHONE = 390;
const FOLD = 2 * PHONE + 16;
const VIEW = { left: 100, right: 100 + 3 * 406 - 16 };

test('a fold half past the right edge: the chrome spans its shown left half', () => {
  const left = VIEW.right - FOLD / 2;
  assert.deepEqual(chromeCutOf(left, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: FOLD / 2 });
});

test('a fold half past the left edge: the chrome spans its shown right half', () => {
  const left = VIEW.left - FOLD / 2;
  assert.deepEqual(chromeCutOf(left, FOLD, VIEW.left, VIEW.right, PHONE), { left: FOLD / 2, right: 0 });
});

test('a whole panel is not cut, and the cut reaches zero as the panel comes whole: no jump', () => {
  assert.deepEqual(chromeCutOf(VIEW.left, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: 0 });
  assert.deepEqual(chromeCutOf(VIEW.right - FOLD, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: 0 });
  assert.deepEqual(chromeCutOf(VIEW.right - FOLD + 0.5, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: 0.5 });
});

test('below one phone shown the chrome stops shrinking and goes off with the panel', () => {
  // 200 px shown at the right edge: the chrome keeps a phone's width from the panel's left.
  assert.deepEqual(chromeCutOf(VIEW.right - 200, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: FOLD - PHONE });
  // The same at the left edge.
  assert.deepEqual(chromeCutOf(VIEW.left + 200 - FOLD, FOLD, VIEW.left, VIEW.right, PHONE), { left: FOLD - PHONE, right: 0 });
  // A panel the window does not show at all keeps its chrome a phone wide.
  assert.deepEqual(chromeCutOf(VIEW.right + 50, FOLD, VIEW.left, VIEW.right, PHONE), { left: 0, right: FOLD - PHONE });
});

test('a panel wider than the window, cut on both sides, spans the window', () => {
  const wide = 5 * 406 - 16;
  assert.deepEqual(chromeCutOf(VIEW.left - 300, wide, VIEW.left, VIEW.right, PHONE), { left: 300, right: wide - 300 - (VIEW.right - VIEW.left) });
});

test('property: the chrome lies inside the panel, is never narrower than a phone, and spans what is shown when that is wide enough', () => {
  fc.assert(
    fc.property(fc.integer({ min: -3000, max: 3000 }), fc.integer({ min: 2, max: 8 }), (left, slots) => {
      const width = slots * 406 - 16;
      const c = chromeCutOf(left, width, VIEW.left, VIEW.right, PHONE);
      assert.ok(c.left >= 0 && c.right >= 0);
      const span = width - c.left - c.right;
      assert.ok(span >= PHONE - 1e-9, `span ${span}`);
      const shown = Math.min(left + width, VIEW.right) - Math.max(left, VIEW.left);
      if (shown >= PHONE) {
        assert.ok(Math.abs(left + c.left - Math.max(left, VIEW.left)) < 1e-9);
        assert.ok(Math.abs(left + width - c.right - Math.min(left + width, VIEW.right)) < 1e-9);
      }
    }),
  );
});

test('the header and footer read the cut from the slot, zero where it carries none; a fold follows by default', () => {
  assert.deepEqual(chromeCutSides(), { left: `calc(var(${CHROME_CUT_LEFT_PROPERTY}, 0px) + 0px)`, right: `calc(var(${CHROME_CUT_RIGHT_PROPERTY}, 0px) + 0px)` });
  assert.equal(LIBRARY_TUNING_DEFAULTS.chrome.fitVisibleMaxSlots, 2);
});
