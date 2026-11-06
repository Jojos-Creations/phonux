/**
 * Locking a panel at an edge while the row rests moves nothing on screen but what the lock itself requires: the panels of
 * the strip are carried by the left group's width at the commit, so their own slide does not start from a place the group
 * has already moved them out of.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { cleanup, advanceFrames } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row, ROOT } from './support/scroll-row.js';
import { setRowOffset } from './support/strip.js';

afterEach(() => cleanup());

const translateX = (el: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform)?.[1] ?? 0);

/** Where the slot of `id` is drawn in the row: the left group, the strip's translate and the slot's own, as jsdom has no layout. */
function screenX(m: ReturnType<typeof mountRow>, id: string): number {
  const strip = m.container.querySelector<HTMLElement>('[data-row-strip]')!;
  const slot = m.container.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"]`)!;
  return m.latest().rowNumbers.leftInset + translateX(strip) + translateX(slot);
}

test('locking the first panel at the left leaves the strip panels where they are drawn, then lets go the same way', async () => {
  const m = mountRow(row(rootEntry(), made('a'), made('b'), made('c')), 1000);
  await advanceFrames(2000);
  const ids = m.latest().entries.map((p) => p.id).filter((id) => id !== ROOT);
  const before = ids.map((id) => screenX(m, id));
  assert.equal(m.latest().rowNumbers.leftInset, 0, 'control: nothing is held yet');

  await act(async () => {
    m.workspace.panels.configure(ROOT, { edgeHold: 'left' });
  });
  assert.ok(m.latest().rowNumbers.leftInset > 0, 'control: the lock took the left group');
  assert.deepEqual(ids.map((id) => screenX(m, id)), before, 'at the commit that locks, no strip panel has moved');
  await advanceFrames(2000);
  assert.deepEqual(ids.map((id) => screenX(m, id)), before, 'and none moves after it');

  await act(async () => {
    m.workspace.panels.configure(ROOT, { edgeHold: 'off' });
  });
  assert.deepEqual(ids.map((id) => screenX(m, id)), before, 'letting go moves none either');
});

test('a panel that is let go draws where its line puts it, not where the lock held it', async () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d'), made('e')), 1000, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  const hostOf = (): HTMLElement => m.container.querySelector<HTMLElement>('[data-row-id="a"]')!.closest<HTMLElement>('[data-row-hold]')!;
  setRowOffset(m.container, 812);
  await advanceFrames(100);
  assert.notEqual(hostOf().style.transform, '', 'control: the held panel is shifted to its edge once the row has moved on');
  await act(async () => {
    m.workspace.panels.configure('a', { edgeHold: 'off' });
  });
  await advanceFrames(100);
  assert.equal(hostOf().style.transform, '', 'let go, it is drawn where its line puts it');
});
