/**
 * The stop a wheel gesture on the Embla row rests on: ahead once it covered a quarter of the gap, else back where it came from.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACK_FRACTION, restStop } from '../emblaRow.js';

const EVEN = [0, 400, 800, 1200];
// Uneven: a wide page's gap (800 to 1600) and a short end gap (1600 to 1700).
const UNEVEN = [0, 400, 800, 1600, 1700];

test('the threshold is a quarter of a gap', () => {
  assert.equal(BACK_FRACTION, 0.25);
});

test('going right: under a quarter of the gap returns, a quarter or more rests ahead', () => {
  assert.equal(restStop(EVEN, 400 + 96, 1), 1, '24%');
  assert.equal(restStop(EVEN, 400 + 100, 1), 2, '25%');
  assert.equal(restStop(EVEN, 400 + 104, 1), 2, '26%');
  assert.equal(restStop(EVEN, 400 + 390, 1), 2, 'most of the way');
});

test('going left: the same quarter, measured from the stop on the right', () => {
  assert.equal(restStop(EVEN, 800 - 96, -1), 2, '24%');
  assert.equal(restStop(EVEN, 800 - 100, -1), 1, '25%');
  assert.equal(restStop(EVEN, 800 - 104, -1), 1, '26%');
});

test('uneven gaps: the quarter is of the gap the row is in', () => {
  assert.equal(restStop(UNEVEN, 800 + 190, 1), 2, '190 of a wide 800 gap (24%) returns');
  assert.equal(restStop(UNEVEN, 800 + 200, 1), 3, '200 of 800 (25%) rests ahead');
  assert.equal(restStop(UNEVEN, 1600 - 190, -1), 3, 'left in the wide gap, 24%');
  assert.equal(restStop(UNEVEN, 1600 - 210, -1), 2, 'left in the wide gap, 26%');
  assert.equal(restStop(UNEVEN, 1600 + 24, 1), 3, '24 of the short 100 end gap');
  assert.equal(restStop(UNEVEN, 1600 + 26, 1), 4, '26 of the short 100 end gap');
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

test('a return never moves the row back a quarter of a gap or more', () => {
  for (let from = 0; from <= 1700; from += 0.25)
    for (const dir of [-1, 1]) {
      const to = UNEVEN[restStop(UNEVEN, from, dir)]!;
      const k = UNEVEN.findIndex((s) => s > from);
      const gap = k > 0 ? UNEVEN[k]! - UNEVEN[k - 1]! : 0;
      if (dir * (to - from) < 0) assert.ok(Math.abs(to - from) < BACK_FRACTION * gap + 0.5, `${from} going ${dir} returns to ${to}`);
      assert.ok(Math.abs(to - from) <= gap + 0.5, `${from} going ${dir} skips past the next stop to ${to}`);
    }
});
