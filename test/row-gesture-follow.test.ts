/**
 * rowGesture 'follow': a sideways wheel moves the row with it and the row settles on a panel once the wheel is quiet.
 * The settle timer is setTimeout, so cases run under mock timers; the settle glide runs on the virtual frame clock.
 * Rows are eleven panels at 1000 (panel starts every 406, maxScroll 3482).
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const follow = (count = 10, width = 1000) => mountRow(panelsOf(count), width, { tuning: { rowGesture: 'follow' } });
const tick = (ms: number): void => void act(() => mock.timers.tick(ms));

test('a stream of small sideways wheel events moves the row by each delta, with no pause between steps', () => {
  const m = follow();
  mock.timers.enable({ apis: ['setTimeout'] });
  const seen: number[] = [];
  for (let n = 0; n < 40; n += 1) {
    const event = m.wheel({ deltaX: 20 });
    assert.equal(event.defaultPrevented, true);
    tick(16);
    seen.push(m.container.scrollLeft);
  }
  assert.deepEqual(seen, Array.from({ length: 40 }, (_, n) => 20 * (n + 1)));
  assert.equal(m.scroller.glideTarget(), null, 'no glide while the wheel keeps moving');
});

test('once the wheel has been quiet for 120 ms the row glides to the nearest panel start', async () => {
  const m = follow();
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 0; n < 40; n += 1) m.wheel({ deltaX: 20 });
  tick(119);
  assert.equal(m.scroller.glideTarget(), null, 'not yet quiet');
  tick(1);
  assert.equal(m.scroller.glideTarget(), 812, '800 settles on the panel start at 812');
  await advanceFrames(500);
  assert.equal(m.container.scrollLeft, 812);
  assert.equal(m.scroller.claimHeld(), false, 'the claim went back');
});

test('a swipe left settles on the nearest start to the left, and one past the end clamps to the strip end', async () => {
  const m = follow();
  mock.timers.enable({ apis: ['setTimeout'] });
  m.container.scrollLeft = 1000;
  m.wheel({ deltaX: -100 });
  tick(120);
  assert.equal(m.scroller.glideTarget(), 812);
  await advanceFrames(500);
  m.container.scrollLeft = 3300;
  m.wheel({ deltaX: 900 });
  assert.equal(m.container.scrollLeft, 3482);
  tick(120);
  assert.equal(m.scroller.glideTarget(), 3482, 'the strip end is the nearest stop');
});

test('Shift+wheel follows too, and a plain vertical wheel neither follows nor is prevented', () => {
  const m = follow();
  const plain = m.wheel({ deltaY: 100 });
  assert.equal(plain.defaultPrevented, false);
  assert.equal(m.container.scrollLeft, 0);
  const shifted = m.wheel({ deltaY: 100, shiftKey: true });
  assert.equal(shifted.defaultPrevented, true);
  assert.equal(m.container.scrollLeft, 100);
});

test('a drag holding the row claim keeps the wheel from moving it, and the wheel does not take the claim', () => {
  const m = follow();
  const held = m.scroller.claim();
  assert.ok(held, 'the test holds the claim as a drag does');
  held.setMaxScroll(3482);
  m.wheel({ deltaX: 200 });
  assert.equal(m.container.scrollLeft, 0);
  assert.equal(m.scroller.glideTarget(), null);
  held.release();
});

test('a row that cannot scroll takes no claim', () => {
  const m = follow(1);
  m.wheel({ deltaX: 200 });
  assert.equal(m.scroller.claimHeld(), false);
});

test("under 'step' the same stream still moves one stop per burst", () => {
  const m = mountRow(panelsOf(10), 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 0; n < 40; n += 1) m.wheel({ deltaX: 20 });
  assert.equal(m.scroller.glideTarget(), 406);
  assert.equal(m.container.scrollLeft, 0);
});
