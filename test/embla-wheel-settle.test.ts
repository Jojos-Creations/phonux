/**
 * The stop a wheel gesture on the Embla row rests on: ahead once it moved more than a touch, else back where it came from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_FRACTION, restStop } from '../emblaRow.js';

const EVEN = [0, 400, 800, 1200];
// Uneven: a wide page's gap (800 to 1600) and a short end gap (1600 to 1700).
const UNEVEN = [0, 400, 800, 1600, 1700];

test('the threshold is a touch: a fiftieth of a gap', () => {
  assert.equal(BACK_FRACTION, 0.02);
});

test('going right: a touch returns, anything more rests ahead', () => {
  assert.equal(restStop(EVEN, 400 + 6, 1), 1, 'under 2%');
  assert.equal(restStop(EVEN, 400 + 8, 1), 2, '2%');
  assert.equal(restStop(EVEN, 400 + 40, 1), 2, '10%');
  assert.equal(restStop(EVEN, 400 + 390, 1), 2, 'most of the way');
});

test('going left: the same, measured from the stop on the right', () => {
  assert.equal(restStop(EVEN, 800 - 6, -1), 2, 'under 2%');
  assert.equal(restStop(EVEN, 800 - 8, -1), 1, '2%');
  assert.equal(restStop(EVEN, 800 - 40, -1), 1, '10%');
});

test('uneven gaps: the share is of the gap the row is in', () => {
  assert.equal(restStop(UNEVEN, 800 + 14, 1), 2, '14 of a wide 800 gap returns');
  assert.equal(restStop(UNEVEN, 800 + 16, 1), 3, '16 of 800 (2%) rests ahead');
  assert.equal(restStop(UNEVEN, 1600 - 14, -1), 3, 'left in the wide gap, under 2%');
  assert.equal(restStop(UNEVEN, 1600 - 18, -1), 2, 'left in the wide gap, over 2%');
  assert.equal(restStop(UNEVEN, 1600 + 1, 1), 3, '1 of the short 100 end gap');
  assert.equal(restStop(UNEVEN, 1600 + 3, 1), 4, '3 of the short 100 end gap');
});

test('on a stop within half a px it stays; at or past the ends it rests on the end', () => {
  assert.equal(restStop(EVEN, 800.4, 1), 2);
  assert.equal(restStop(EVEN, 799.6, -1), 2);
  assert.equal(restStop(EVEN, 0, -1), 0);
  assert.equal(restStop(EVEN, 1200, 1), 3);
  assert.equal(restStop(EVEN, -5, -1), 0);
  assert.equal(restStop(EVEN, 1210, 1), 3);
  assert.equal(restStop([], 50, 1), 0);
});

test('a return never moves the row back more than a touch', () => {
  for (let from = 0; from <= 1700; from += 0.25)
    for (const dir of [-1, 1]) {
      const to = UNEVEN[restStop(UNEVEN, from, dir)]!;
      const k = UNEVEN.findIndex((s) => s > from);
      const gap = k > 0 ? UNEVEN[k]! - UNEVEN[k - 1]! : 0;
      if (dir * (to - from) < 0) assert.ok(Math.abs(to - from) < BACK_FRACTION * gap + 0.5, `${from} going ${dir} returns to ${to}`);
      assert.ok(Math.abs(to - from) <= gap + 0.5, `${from} going ${dir} skips past the next stop to ${to}`);
    }
});
