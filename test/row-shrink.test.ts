/** A one-slot panel leaving a scrolling row shrinks into the edge it leaves by. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHRINK_LAG_MS, shrinkPose, shrinkStyle, trailSize } from '../rowShrink.js';

// Three 390 px slots, 16 px apart, in a window from 100 to 1302.
const at = (left: number, sticky: { stickyStart?: boolean; stickyEnd?: boolean } = {}) =>
  shrinkPose({ left, width: 390, viewLeft: 100, viewRight: 1302, pitch: 406, gap: 16, stickyStart: false, stickyEnd: false, ...sticky });
/** The drawn box's edges when the size has caught up with its place. */
const edges = (left: number, p: { goal: number; dx: number }) => {
  const c = left + 195 + p.dx;
  return [c - (390 * p.goal) / 2, c + (390 * p.goal) / 2] as const;
};

test('a panel wholly in the window is its full size in its place', () => {
  for (const left of [100, 300, 912]) assert.deepEqual(at(left), { goal: 1, dx: 0 });
});

test('leaving either side: it shrinks by how far it has gone and stays flush with the edge', () => {
  for (const gone of [1, 100, 203, 300, 405]) {
    const l = at(100 - gone);
    assert.ok(Math.abs(l.goal - (1 - gone / 406)) < 1e-9, `left ${gone}`);
    assert.ok(Math.abs(edges(100 - gone, l)[0] - 100) < 1e-9, `left edge at ${gone}`);
    const r = at(912 + gone);
    assert.ok(Math.abs(r.goal - (1 - gone / 406)) < 1e-9, `right ${gone}`);
    assert.ok(Math.abs(edges(912 + gone, r)[1] - 1302) < 1e-9, `right edge at ${gone}`);
  }
  assert.equal(at(100 - 406).goal, 0);
  assert.equal(at(100 - 900).goal, 0);
});

test('a shrinking panel never overlaps the one after it', () => {
  for (let gone = 1; gone < 406; gone += 5) assert.ok(edges(100 - gone, at(100 - gone))[1] <= 100 - gone + 406 + 1e-9, `at ${gone}`);
});

test('beside a sticky panel the point is half a gap toward it, never under it', () => {
  for (let gone = 1; gone <= 406; gone += 5) {
    assert.ok(edges(100 - gone, at(100 - gone, { stickyStart: true }))[0] >= 100 - 8 - 1e-9, `start at ${gone}`);
    assert.ok(edges(912 + gone, at(912 + gone, { stickyEnd: true }))[1] <= 1302 + 8 + 1e-9, `end at ${gone}`);
  }
  assert.ok(Math.abs(edges(100 - 406, at(100 - 406, { stickyStart: true }))[0] - 92) < 1e-9);
});

test('the drawn size trails its goal and arrives', () => {
  const one = trailSize(0, 1, SHRINK_LAG_MS / 3);
  assert.ok(one > 0.2 && one < 0.4, `${one}`);
  let s = 0;
  for (let k = 0; k < 60; k++) s = trailSize(s, 1, 16);
  assert.equal(s, 1);
  assert.ok(trailSize(0, 1, 10_000) < 0.4, 'a long idle does not jump the size to its goal');
});

test('the drawn style: nothing at full size, hidden when gone, never larger than the place allows', () => {
  assert.deepEqual(shrinkStyle(1, 1, 0), { translate: '', scale: '', opacity: '' });
  assert.deepEqual(shrinkStyle(1, 0.5, 10), { translate: '10px 0px', scale: '0.5', opacity: '0.8' });
  assert.equal(shrinkStyle(0.5, 1, 0).scale, '0.5');
  assert.equal(shrinkStyle(0, 0, 0).opacity, '0');
});
