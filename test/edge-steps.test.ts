/**
 * depthSpeed and edgeSteps: the time-driven travel past a row's end that the dot bar's drag steps by. A pointer held still at a
 * depth steps at a steady rate, a deeper one faster, and nothing moves at depth 0.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { depthSpeed, edgeSteps } from '../edgeScroll.js';

test('depthSpeed ramps from 0 at the end to the maximum one zone past it, signed by the side, and holds beyond', () => {
  assert.equal(depthSpeed(0, 48, 900), 0);
  assert.equal(depthSpeed(24, 48, 900), 450);
  assert.equal(depthSpeed(-24, 48, 900), -450);
  assert.equal(depthSpeed(48, 48, 900), 900);
  assert.equal(depthSpeed(500, 48, 900), 900);
  assert.equal(depthSpeed(10, 0, 900), 0, 'no zone, no speed');
});

test('edgeSteps: a pointer held still at full depth steps once per unit of time-driven travel, carrying the rest', () => {
  let carried = 0;
  let steps = 0;
  // One second of 60 Hz frames at 900 px/s with a 406 px unit: two whole steps, 88 px carried.
  for (let k = 0; k < 60; k += 1) {
    const next = edgeSteps({ carried, speed: 900, dtMs: 1000 / 60, unitPx: 406 });
    carried = next.carried;
    steps += next.steps;
  }
  assert.equal(steps, 2);
  assert.ok(Math.abs(carried - 88) < 1e-6, String(carried));
});

test('edgeSteps: half the depth steps half as often, speed 0 drops what was carried, a reversal starts from nothing, and a huge frame is capped', () => {
  let carried = 0;
  let steps = 0;
  for (let k = 0; k < 120; k += 1) {
    const next = edgeSteps({ carried, speed: 450, dtMs: 1000 / 60, unitPx: 406 });
    carried = next.carried;
    steps += next.steps;
  }
  assert.equal(steps, 2, 'two seconds at half speed: as many steps as one at full');
  assert.deepEqual(edgeSteps({ carried: 300, speed: 0, dtMs: 16, unitPx: 406 }), { steps: 0, carried: 0 });
  assert.deepEqual(edgeSteps({ carried: 300, speed: -900, dtMs: 0, unitPx: 406 }), { steps: 0, carried: 0 });
  assert.deepEqual(edgeSteps({ carried: 0, speed: 900, dtMs: 5000, unitPx: 406 }), { steps: 0, carried: 45 }, 'a background tab returns with one 50 ms frame');
});
