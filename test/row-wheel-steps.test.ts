/** What a sideways wheel asks of the row: whole stops. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHEEL_AGAINST_PX, WHEEL_START_PX, WHEEL_STEP_GAP_MS, wheelSteps, type WheelStepState } from '../rowWheelSteps.js';

const PITCH = 400;
/** Feeds `[at, by]` wheels and answers the steps each one asked for. */
function run(wheels: readonly (readonly [number, number])[]): number[] {
  let state: WheelStepState | undefined;
  return wheels.map(([at, by]) => {
    const out = wheelSteps(state, by, PITCH, at);
    state = out.state;
    return out.steps;
  });
}
const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

test('the first wheel steps at once, and each further pitch of travel is one more', () => {
  assert.deepEqual(run([[0, 20]]), [1]);
  assert.deepEqual(run([[0, 20], [16, 300], [32, 79], [48, 1], [64, 400]]), [1, 0, 0, 1, 1]);
  assert.deepEqual(run([[0, -20], [16, -400]]), [-1, -1]);
});

test('a touch under the start travel does not move the row', () => {
  assert.deepEqual(run([[0, WHEEL_START_PX - 1]]), [0]);
  assert.deepEqual(run([[0, 2], [16, 2]]), [0, 1]);
});

test('a slow, uneven creep is one gesture: no pause under the gap steps again by itself', () => {
  const creep = [0, 90, 330, 390, 700, 830, 910, 1180].map((at) => [at, 40] as const);
  assert.equal(sum(run(creep)), 1);
});

test('a gap longer than the limit starts afresh', () => {
  assert.deepEqual(run([[0, 20], [WHEEL_STEP_GAP_MS, 20], [WHEEL_STEP_GAP_MS * 2 + 1, 20]]), [1, 0, 1]);
});

test('a flick passes several stops, momentum included', () => {
  assert.equal(sum(run(Array.from({ length: 26 }, (_, k) => [k * 16, 65] as const))), 5);
});

test('a flicker the other way is ignored; a real turn steps back at once', () => {
  assert.deepEqual(run([[0, 20], [16, -(WHEEL_AGAINST_PX - 1)], [32, 10]]), [1, 0, 0]);
  assert.deepEqual(run([[0, 20], [16, -4], [32, -4], [48, -400]]), [1, 0, -1, -1]);
});

test('a row with no pitch yet still steps once and never loops', () => {
  assert.equal(wheelSteps(undefined, 900, 0, 0).steps, 1);
});
