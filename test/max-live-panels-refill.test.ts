/**
 * Raising `tuning.maxLivePanels` brings back the 'manual' panels the CAPACITY parked, most recently parked first, in one commit,
 * up to the new value. Nothing else does: an equal or lower value, a mount, a resize, a panel the host hid, and a raise
 * before the workspace has loaded all return nothing.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { createWorkspace } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { markerTemplate } from './support/workspace-row.js';
import { capRig } from './support/cap-rig.js';

afterEach(cleanup);

const raise = (r: Awaited<ReturnType<typeof capRig>>, n: number | null) => r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: n }));

test('append order: the cap parks w1 then w2, so a raise by one returns w2 and a second raise returns w1', async () => {
  const r = await capRig({ count: 6, width: 4000, cap: 3 });
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w6');
  raise(r, 4);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4 w5 w6');
  raise(r, 5);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w3 w4 w5 w6');
});

test('the bound is the new value: a raise by two returns two of three and leaves the oldest parked; the live count never passes it', async () => {
  const r = await capRig({ count: 6, width: 4000, cap: 3, record: true });
  raise(r, 5);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w3 w4 w5 w6');
  for (const row of r.commits) assert.ok(row.split(' ').filter((n) => n !== 'root' && !n.endsWith('*')).length <= 5, row);
});

test('one commit: two returning panels appear in the same commit, never one then the other', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2, record: true });
  const before = r.commits.length;
  raise(r, 4);
  await r.settle();
  const rows = r.commits.slice(before).filter((row, k, all) => k === 0 || row !== all[k - 1]);
  assert.ok(rows.every((row) => row === 'root w1* w2* w3* w4 w5' || row === 'root w1* w2 w3 w4 w5'), rows.join(' | '));
  assert.equal(r.row(), 'root w1* w2 w3 w4 w5');
});

test('an equal value, a lower value and a resize return nothing', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2 });
  const parked = r.row();
  raise(r, 2);
  await r.settle();
  assert.equal(r.row(), parked, 'equal');
  raise(r, 1);
  await r.settle();
  raise(r, 1);
  await r.settle();
  assert.equal(r.parked().length, 4, 'lower parks one more and returns nothing');
  r.m.setWidth(3000);
  await r.settle();
  assert.equal(r.parked().length, 4, 'a resize returns nothing under manual');
});

test('a panel the host hid stays hidden through a raise, while the cap-parked ones return', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2 });
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5');
  r.turn(() => r.h.w4!.hide());
  await r.settle();
  assert.deepEqual(r.parked(), ['w1', 'w2', 'w3', 'w4']);
  raise(r, 5);
  await r.settle();
  assert.deepEqual(r.parked(), ['w4'], 'w1, w2 and w3 returned, the hidden w4 did not');
});

test('under StrictMode a raise returns once and the next render returns nothing more', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2, strict: true });
  raise(r, 3);
  await r.settle();
  assert.equal(r.parked().length, 2, 'one of three parked panels returned');
  await r.settle();
  assert.equal(r.parked().length, 2);
});

test('a raise before the workspace has loaded is refused, so nothing is dropped into a half-restored row', () => {
  const ws = createWorkspace({ root: markerTemplate('root'), templates: [markerTemplate('a')], tuning: { maxLivePanels: 2 } });
  const result = ws.panels.configureTuning({ maxLivePanels: 4 });
  assert.equal(result.ok, false);
  assert.equal(ws.tuning.maxLivePanels, 2);
});

test('pinned panels do not count: a raise returns up to the new value of unpinned panels', async () => {
  const r = await capRig({ count: 6, width: 4000, cap: 2, pinned: ['w1'] });
  raise(r, 3);
  await r.settle();
  assert.equal(r.unpinnedLive().length, 3);
  assert.deepEqual(r.pinnedLive(), ['w1']);
});

test('returned panels land where they were and the panels already live keep their order', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2 });
  const liveBefore = r.unpinnedLive();
  raise(r, 4);
  await r.settle();
  assert.deepEqual(r.unpinnedLive().filter((n) => liveBefore.includes(n)), liveBefore);
  assert.equal(r.row().split(' ').indexOf('w2') < r.row().split(' ').indexOf('w3'), true, 'w2 returned in place, left of the live w3');
});
