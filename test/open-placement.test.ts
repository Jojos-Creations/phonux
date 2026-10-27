/**
 * `addPanel`'s `place`: a developer's function picks the slot among the panels in view and what the panel there does. The
 * pure resolver over literal rows first, then a capped row through the real workspace, written as the cap rig writes it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { resolveOpen } from '../openPlacement.js';
import type { PlaceOpen } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { capRig } from './support/cap-rig.js';

afterEach(() => cleanup());

const view = ['a', 'b', 'c'];

test('resolveOpen: a slot past the last panel lands at the far right, the leftmost leaving if room is short', () => {
  assert.deepEqual(resolveOpen(view, { slot: 3 }), { place: { after: 'c' }, leaves: 'a' });
  assert.deepEqual(resolveOpen(view, { slot: 9, occupant: 'shift-right' }), { place: { after: 'c' }, leaves: 'a' });
  assert.deepEqual(resolveOpen([], { slot: 0 }), { place: 'row-end' });
});

test('resolveOpen: shift-left, shift-right and close each name the anchor and the panel that goes', () => {
  assert.deepEqual(resolveOpen(view, { slot: 1 }), { place: { after: 'b' }, leaves: 'a' });
  assert.deepEqual(resolveOpen(view, { slot: 1, occupant: 'shift-right' }), { place: { before: 'b' }, leaves: 'c' });
  assert.deepEqual(resolveOpen(view, { slot: 1, occupant: 'close' }), { place: { after: 'a' }, leaves: 'b', closes: 'b' });
  assert.deepEqual(resolveOpen(view, { slot: 0, occupant: 'close' }), { place: { before: 'b' }, leaves: 'a', closes: 'a' });
  assert.deepEqual(resolveOpen(['a'], { slot: 0, occupant: 'close' }), { place: 'row-end', leaves: 'a', closes: 'a' });
  assert.deepEqual(resolveOpen(view, { slot: -2 }), { place: { after: 'a' }, leaves: 'a' }, 'a negative slot is the first');
});

const openWith = async (place: PlaceOpen | undefined) => {
  const r = await capRig({ count: 6, initial: 5, cap: 3 });
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5');
  let seen: readonly string[] = [];
  act(() => {
    r.ws.addPanel('w6', place === undefined ? undefined : { place: (row) => ((seen = row.inView), place(row)) });
  });
  await r.settle();
  return { row: r.row(), seen };
};

test('without place a full row opens at the far right and the leftmost in view parks', async () => {
  assert.equal((await openWith(undefined)).row, 'root w1* w2* w3* w4 w5 w6');
});

test('place sees the panels in view and can open in the middle, shifting left, right, or closing the occupant', async () => {
  const left = await openWith(() => ({ slot: 1 }));
  assert.deepEqual(left.seen, ['w3', 'w4', 'w5']);
  assert.equal(left.row, 'root w1* w2* w3* w4 w6 w5');
  assert.equal((await openWith(() => ({ slot: 1, occupant: 'shift-right' }))).row, 'root w1* w2* w3 w6 w4 w5*');
  assert.equal((await openWith(() => ({ slot: 1, occupant: 'close' }))).row, 'root w1* w2* w3 w6 w5');
});
