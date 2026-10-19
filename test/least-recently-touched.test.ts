/**
 * The panel a full row parks for room is the one touched longest ago: created, shown from parked, or focused. Real
 * createWorkspace and PanelRow under `tuning.maxLivePanels` 3, the virtual clock stepped between steps so touch times differ.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { cleanup } from './support/mount-harness.js';
import { capRig } from './support/cap-rig.js';
import type { CapRig } from './support/cap-rig.js';

afterEach(() => cleanup());

/** Adds `names` one after another, a settled row between them. */
async function openAll(r: CapRig, names: readonly string[]): Promise<void> {
  for (const name of names) {
    r.add(name);
    await r.settle();
  }
}

/** A focus entering the panel `name`, as a person's Tab or click into it does. */
async function focusIn(r: CapRig, name: string): Promise<void> {
  const slot = r.m.container.querySelector<HTMLElement>(`[data-row-id="${r.entry(name).id}"]`);
  assert.ok(slot, `${name} is drawn in a slot`);
  act(() => {
    slot.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
  await r.settle();
}

test('opening a panel parks the oldest-created one, although it is not the farthest from the new panel', async () => {
  const r = await capRig({ count: 4, initial: 0, cap: 3, own: { w4: { placeOnAdd: 'parkable-start' } } });
  await openAll(r, ['w1', 'w2', 'w3']);
  assert.equal(r.row(), 'root w1 w2 w3');
  r.add('w4');
  await r.settle();
  assert.equal(r.row(), 'root w4 w1* w2 w3', 'w1 is the oldest; w3, the farthest from the new w4, stays');
});

test('focusing the oldest panel refreshes it, so the next oldest is parked instead', async () => {
  const r = await capRig({ count: 4, initial: 0, cap: 3 });
  await openAll(r, ['w1', 'w2', 'w3']);
  await focusIn(r, 'w1');
  r.add('w4');
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3 w4', 'w1 was touched after w3 was created, so w2 is the oldest');
});

test('showing a parked panel refreshes it: the next panel opened parks an older one, not the one just shown', async () => {
  const r = await capRig({ count: 5, initial: 0, cap: 3 });
  await openAll(r, ['w1', 'w2', 'w3', 'w4']);
  assert.equal(r.row(), 'root w1* w2 w3 w4');
  const shown = r.turn(() => r.h.w1!.show());
  assert.equal(shown.ok, true);
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3 w4', 'showing w1 parks the oldest of the rest, w2');
  r.add('w5');
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3* w4 w5', 'w1 was touched when it was shown, so w3 is the oldest now');
});

test('a pinned panel is never the one parked, even when it is the oldest', async () => {
  const r = await capRig({ count: 5, initial: 0, cap: 3, pinned: ['w1'], own: { w5: { placeOnAdd: { before: 'w2' } } } });
  await openAll(r, ['w2', 'w3', 'w4']);
  assert.equal(r.row(), 'w1 root w2 w3 w4');
  r.add('w5');
  await r.settle();
  assert.equal(r.row(), 'w1 root w5 w2* w3 w4', 'w1 is the oldest of all but sits pinned; w2 is the oldest of the rest');
});
