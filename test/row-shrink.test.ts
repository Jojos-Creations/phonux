/** A one-slot panel leaving a scrolling row shrinks into the middle of the next place beyond the edge. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHRINK_LAG_MS, shrinkGoal, shrinkStyle, trailSize } from '../rowShrink.js';

// Three 390 px slots, 16 px apart, in a window from 100 to 1302.
const at = (left: number) => shrinkGoal({ left, width: 390, viewLeft: 100, viewRight: 1302, pitch: 406 });

test('a panel wholly in the window is its full size', () => {
  for (const left of [100, 300, 912]) assert.equal(at(left), 1);
});

test('leaving either side: it shrinks by how far it has gone, and is gone a whole slot out', () => {
  for (const gone of [1, 100, 203, 300, 405]) {
    assert.ok(Math.abs(at(100 - gone) - (1 - gone / 406)) < 1e-9, `left ${gone}`);
    assert.ok(Math.abs(at(912 + gone) - (1 - gone / 406)) < 1e-9, `right ${gone}`);
  }
  for (const left of [100 - 406, 100 - 900, 912 + 406]) assert.equal(at(left), 0);
});

test('shrinking about its own center, it never overlaps the one after it nor reaches past the window cut a slot out', () => {
  for (let gone = 1; gone < 406; gone += 5) {
    const left = 100 - gone;
    const half = (390 * at(left)) / 2;
    assert.ok(left + 195 + half <= left + 406 + 1e-9, `neighbor at ${gone}`);
    assert.ok(left + 195 - half >= 100 - 406 - 1e-9, `cut at ${gone}`);
  }
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
  assert.deepEqual(shrinkStyle(1, 1), { scale: '', opacity: '' });
  assert.deepEqual(shrinkStyle(1, 0.5), { scale: '0.5', opacity: '0.8' });
  assert.equal(shrinkStyle(0.5, 1).scale, '0.5');
  assert.equal(shrinkStyle(0, 0).opacity, '0');
});
