/**
 * The stop a wheel gesture on the Embla row settles on: never one behind the travel, so the row never moves against the scroll.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { stopAhead } from '../emblaRow.js';

const STOPS = [0, 406, 812, 1218, 1500];

test('a wheel gesture rests on the first stop ahead of its travel, or where it stands on one', () => {
  assert.equal(stopAhead(STOPS, 440, 1), 2, 'just past 406 going right: 812, not 406 behind');
  assert.equal(stopAhead(STOPS, 360, 1), 1, 'just before 406 going right: 406');
  assert.equal(stopAhead(STOPS, 780, -1), 1, 'just past 812 going left: 406, not 812 behind');
  assert.equal(stopAhead(STOPS, 812.3, 1), 2, 'on a stop within half a px: stays');
  assert.equal(stopAhead(STOPS, 1600, 1), 4, 'past the last stop: the last');
  assert.equal(stopAhead(STOPS, 600, 0), 1, 'no direction: the nearest');
  assert.equal(stopAhead([], 50, 1), 0);
});

test('the stop is never behind the travel and never past the next one', () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 1500, noNaN: true }), fc.constantFrom(-1, 1), (from, dir) => {
      const to = STOPS[stopAhead(STOPS, from, dir)]!;
      assert.ok(dir * (to - from) >= -0.5, `${from} going ${dir} rests at ${to}`);
      assert.ok(!STOPS.some((s) => dir * (s - from) >= -0.5 && dir * (to - s) > 0.5), `${from} going ${dir} skips a stop to ${to}`);
    }),
  );
});
