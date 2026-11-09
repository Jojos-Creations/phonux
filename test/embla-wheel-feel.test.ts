/**
 * The mouse wheel's speed curve and coast on the Embla row: slow notches move half a notch and never coast, a fast spin moves further
 * per notch and coasts, a trackpad's momentum never gets a coast of its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { COAST_MS, COAST_QUIET_MAX_MS, COAST_QUIET_MIN_MS, FAST_SPEED, SLOW_SPEED, feelWheel, wheelSpeed, type WheelFeel } from '../emblaWheelFeel.js';

const run = (wheels: [number, number, boolean?][]): ReturnType<typeof feelWheel>[] => {
  const feel: WheelFeel = [];
  return wheels.map(([t, px, m]) => feelWheel(feel, t, px, m === true));
};

test('slow notches move half a notch each and leave no coast', () => {
  const out = run(Array.from({ length: 8 }, (_, k): [number, number] => [k * 150, 40]));
  for (const o of out) assert.deepEqual(o, { row: 40 * SLOW_SPEED, coast: 0, quietMs: null });
});

test('a fast spin moves further per notch as it speeds up, and coasts', () => {
  const out = run(Array.from({ length: 8 }, (_, k): [number, number] => [k * 16, 40]));
  assert.ok(out.every((o, k) => k === 0 || o.row >= out[k - 1]!.row), `rising speed: ${out.map((o) => o.row)}`);
  assert.equal(out.at(-1)!.row, 40 * FAST_SPEED, 'a notch every 16 ms is at the fast end');
  const last = out.at(-1)!;
  assert.ok(last.coast > 1000, `coast ${last.coast}`);
  // The row's speed over the last 100 ms (the wheels at 16..112 ms) for COAST_MS.
  assert.ok(Math.abs(last.coast - (out.slice(1).reduce((n, o) => n + o.row, 0) / 100) * COAST_MS) < 1e-9);
  assert.ok(last.quietMs! >= COAST_QUIET_MIN_MS && last.quietMs! <= COAST_QUIET_MAX_MS);
});

test('the coast goes the spin\'s way', () => {
  const out = run(Array.from({ length: 6 }, (_, k): [number, number] => [k * 30, -40]));
  assert.ok(out.at(-1)!.coast < -300, `coast ${out.at(-1)!.coast}`);
});

test('a trackpad\'s momentum never gets a coast of its own', () => {
  const swipe: [number, number, boolean?][] = Array.from({ length: 10 }, (_, k): [number, number] => [k * 16, 30]);
  const tail: [number, number, boolean?][] = Array.from({ length: 6 }, (_, k): [number, number, boolean] => [160 + k * 16, 30 * 0.9 ** (k + 1), true]);
  const out = run([...swipe, ...tail]);
  assert.ok(out[9]!.coast > 0, 'the finger\'s own fast swipe would coast if nothing followed');
  for (const o of out.slice(10)) assert.deepEqual([o.coast, o.quietMs], [0, null]);
});

test('the speed rises with the rate and stays within its ends', () => {
  fc.assert(
    fc.property(fc.double({ min: 0, max: 10, noNaN: true }), fc.double({ min: 0, max: 10, noNaN: true }), (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      assert.ok(wheelSpeed(lo) <= wheelSpeed(hi) + 1e-12);
      assert.ok(wheelSpeed(lo) >= SLOW_SPEED && wheelSpeed(hi) <= FAST_SPEED);
    }),
  );
});
