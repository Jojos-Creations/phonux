/** edgeScrollSpeed and edgeScrollStep, pure: every number is a literal the design fixes, with explicit parameters. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeScrollSpeed, edgeScrollStep } from '../edgeScroll.js';

const speedAt = (pointerX: number, left = 0, right = 1000): number => edgeScrollSpeed({ pointerX, left, right, zonePx: 48, maxPxPerSec: 900 });

test('edgeScrollSpeed over a container from 0 to 1000 with a 48 px zone and 900 px/s', () => {
  const expected: Array<[number, number]> = [
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
  for (const [pointerX, speed] of expected) assert.equal(speedAt(pointerX), speed, `pointer ${pointerX}`);
});

test('edgeScrollSpeed: a container 80 wide has zones of 40, never overlapping', () => {
  assert.equal(speedAt(20, 0, 80), -450);
  assert.equal(speedAt(40, 0, 80), 0);
  assert.equal(speedAt(60, 0, 80), 450);
});

test('edgeScrollSpeed measures the zone from the container, not from the window', () => {
  assert.equal(speedAt(300, 300, 1300), -900, 'the container starts at 300: a pointer on its left edge is full speed');
  assert.equal(speedAt(348, 300, 1300), 0);
  assert.equal(speedAt(1300, 300, 1300), 900);
});

test('edgeScrollSpeed is 0 for a container with no width or a zone of 0', () => {
  assert.equal(speedAt(0, 0, 0), 0);
  assert.equal(edgeScrollSpeed({ pointerX: 0, left: 0, right: 1000, zonePx: 0, maxPxPerSec: 900 }), 0);
});

const stepFrom = (speed: number, dtMs: number, scrollLeft = 100, maxScroll = 3482): number => edgeScrollStep({ speed, dtMs, scrollLeft, maxScroll });

test('edgeScrollStep: speed x dt, the frame capped at 50 ms, and kept inside [0, maxScroll]', () => {
  assert.equal(stepFrom(900, 20), 18);
  assert.equal(stepFrom(900, 500), 45, 'the 50 ms cap');
  assert.equal(stepFrom(900, 20, 3482), 0, 'already at the end');
  assert.equal(stepFrom(-900, 20, 0), 0, 'already at the start');
  assert.equal(Object.is(stepFrom(-900, 20, 0), 0), true, 'a zero delta is +0');
  assert.equal(stepFrom(900, 20, 3470), 12, 'the end clamps the last step');
  assert.equal(stepFrom(-900, 20, 5), -5, 'the start clamps the last step');
  assert.equal(stepFrom(-900, 20), -18, 'toward the left edge is negative');
});

test('edgeScrollStep returns the unclamped delta itself, so repeated additions match the caller\'s own', () => {
  let walked = 0;
  let expected = 0;
  for (let frame = 0; frame < 99; frame += 1) {
    walked += stepFrom(900, 16, walked);
    expected += 14.4;
  }
  assert.equal(walked, expected);
});
