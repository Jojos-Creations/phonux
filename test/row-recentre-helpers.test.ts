/**
 * The pure parts of the row's own motion: reading a drawn translate and clip, and how long a wheel waits before it settles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipRightOf, rowClip, translateXOf } from '../rowRecentre.js';
import { WHEEL_SLOW_PX_PER_MS, nextWheelPace, wheelIdleMs } from '../emblaRow.js';

test('translateXOf reads the x of a computed translate, and none as 0', () => {
  assert.equal(translateXOf('none'), 0);
  assert.equal(translateXOf('12.5px'), 12.5);
  assert.equal(translateXOf('-184px 0px'), -184);
});

test('clipRightOf reads back the right edge of the clip rowClip writes, and null for another shape', () => {
  assert.equal(clipRightOf(rowClip(1202, 16)), 1218);
  assert.equal(clipRightOf('polygon(-16px -100000px, 1623.52px -100000px, 1623.52px 100000px, -16px 100000px)'), 1623.52);
  assert.equal(clipRightOf('none'), null);
  assert.equal(clipRightOf('inset(0px)'), null);
});

test('a slow wheel waits longer to settle than a quick one; a momentum wheel waits least', () => {
  const slow = wheelIdleMs(WHEEL_SLOW_PX_PER_MS / 2, false);
  const quick = wheelIdleMs(WHEEL_SLOW_PX_PER_MS * 4, false);
  assert.ok(slow > quick, `slow ${slow} ms, quick ${quick} ms`);
  assert.ok(slow >= 250, 'a pause mid-creep shorter than this would settle the row under a resting finger');
  assert.ok(wheelIdleMs(0, true) <= quick, 'a momentum tail is a lift: it never waits as a slow creep does');
});

test('the wheel pace is a running average: one large wheel in a slow creep does not make the gesture quick', () => {
  let pace: number | null = null;
  for (let k = 0; k < 10; k++) pace = nextWheelPace(pace, 2, 16);
  assert.ok(pace! < WHEEL_SLOW_PX_PER_MS, `a 2 px per 16 ms creep reads ${pace} px/ms`);
  const after = nextWheelPace(pace, 12, 16);
  assert.ok(after < WHEEL_SLOW_PX_PER_MS * 2, `one 12 px wheel moved the pace to ${after}`);
  assert.ok(nextWheelPace(null, 40, 16) > WHEEL_SLOW_PX_PER_MS, 'a quick first wheel reads as quick');
});
