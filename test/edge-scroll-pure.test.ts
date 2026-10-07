/** edgeScrollSpeed and edgeScrollStep, pure: every number is a literal the design fixes, with explicit parameters. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeScrollSpeed, edgeScrollStep } from '../edgeScroll.js';

const speedAt = (pointerX: number, left = 0, right = 1000): number => edgeScrollSpeed({ pointerX, left, right, zonePx: 48, maxPxPerSec: 900 });

// A container from 0 to 1000, a 48 px zone, 900 px/s.
const SPEED_ROWS: Array<[pointerX: number, speed: number]> = [
  [500, 0],
  [48, 0],
  [47, -18.75],
  [24, -450],
  [0, -900],
  [-50, -900],
  [952, 0],
  [953, 18.75],
  [976, 450],
  [1000, 900],
  [1500, 900],
];
for (const [pointerX, speed] of SPEED_ROWS) {
  test(`edgeScrollSpeed: a pointer at ${pointerX} over a container from 0 to 1000 gives ${speed}`, () => {
    assert.equal(speedAt(pointerX), speed);
  });
}

// A container 80 wide has zones of 40 whatever zonePx says: the two bands never overlap.
for (const [pointerX, speed] of [[20, -450], [40, 0], [60, 450]] as const) {
  test(`edgeScrollSpeed: a pointer at ${pointerX} over a container from 0 to 80 gives ${speed}`, () => {
    assert.equal(speedAt(pointerX, 0, 80), speed);
  });
}

// The zone is measured from the container, not from the window: the same offsets from a container that starts at 300.
for (const [pointerX, speed] of [[300, -900], [348, 0], [1300, 900]] as const) {
  test(`edgeScrollSpeed: a pointer at ${pointerX} over a container from 300 to 1300 gives ${speed}`, () => {
    assert.equal(speedAt(pointerX, 300, 1300), speed);
  });
}

test('edgeScrollSpeed is 0 for a container with no width', () => {
  assert.equal(speedAt(0, 0, 0), 0);
});

test('edgeScrollSpeed is 0 for a zone of 0', () => {
  assert.equal(edgeScrollSpeed({ pointerX: 0, left: 0, right: 1000, zonePx: 0, maxPxPerSec: 900 }), 0);
});

const stepFrom = (speed: number, dtMs: number, scrollLeft = 100, maxScroll = 3482): number => edgeScrollStep({ speed, dtMs, scrollLeft, maxScroll });

const STEP_ROWS: Array<[name: string, got: () => number, expected: number]> = [
  ['speed 900 for 20 ms moves 18', () => stepFrom(900, 20), 18],
  ['speed 900 for 500 ms is capped at 50 ms and moves 45', () => stepFrom(900, 500), 45],
  ['speed 900 with scrollLeft equal to maxScroll moves 0', () => stepFrom(900, 20, 3482), 0],
  ['speed -900 at scrollLeft 0 moves 0', () => stepFrom(-900, 20, 0), 0],
  ['speed 900 at scrollLeft 3470 of 3482 moves the last 12', () => stepFrom(900, 20, 3470), 12],
  ['speed -900 at scrollLeft 5 moves the last -5', () => stepFrom(-900, 20, 5), -5],
  ['speed -900 toward the left edge is negative', () => stepFrom(-900, 20), -18],
];
for (const [name, got, expected] of STEP_ROWS) {
  test(`edgeScrollStep: ${name}`, () => {
    assert.equal(got(), expected);
  });
}

test('edgeScrollStep: a zero delta is +0, never -0', () => {
  assert.equal(Object.is(stepFrom(-900, 20, 0), 0), true);
  assert.equal(Object.is(stepFrom(0, 20), 0), true);
});

test("edgeScrollStep returns the unclamped delta itself, so repeated additions match the caller's own", () => {
  let walked = 0;
  let expected = 0;
  for (let frame = 0; frame < 99; frame += 1) {
    walked += stepFrom(900, 16, walked);
    expected += 14.4;
  }
  assert.equal(walked, expected);
});
