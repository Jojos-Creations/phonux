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

/** Every unheld slot draws at the offset its numbers give it: the slot's own translate is its `data-row-slot`. */
function drawnOffNumbers(m: ReturnType<typeof mountRow>): string[] {
  const held = new Set([...m.latest().rowNumbers.held.map((h) => h.id), ...m.latest().rowNumbers.stuck.map((s) => s.id)]);
  const off: string[] = [];
  for (const slot of m.container.querySelectorAll<HTMLElement>('[data-row-slot]')) {
    const id = slot.dataset.rowId!;
    if (held.has(id)) continue;
    const want = Number(slot.getAttribute('data-row-slot'));
    if (Math.abs(translateX(slot) - want) > 0.5) off.push(`${id}: drawn at ${translateX(slot)}, numbers say ${want}`);
  }
  return off;
}

test('locking a middle panel at the left draws every panel where the numbers put it, at rest and after scrolling away and back', async () => {
  const m = mountRow(row(rootEntry(), made('a'), made('b'), made('c'), made('d'), made('e')), 1000, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  assert.deepEqual(drawnOffNumbers(m), [], 'control: the check passes with nothing held');
  await act(async () => {
    m.workspace.panels.configure('b', { edgeHold: 'left' });
  });
  await advanceFrames(2000);
  assert.deepEqual(m.latest().rowNumbers.held.map((h) => h.id), ['b'], 'control: b took the left group');
  assert.deepEqual(drawnOffNumbers(m), [], 'at rest after the lock');
  const stops = m.latest().rowNumbers.stops;
  setRowOffset(m.container, stops.at(-1)!);
  await advanceFrames(2000);
  setRowOffset(m.container, stops[0]!);
  await advanceFrames(2000);
  assert.deepEqual(drawnOffNumbers(m), [], 'after scrolling to the far end and back');
});

test('a held middle panel growing leaves every strip panel where the numbers put it', async () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d'), made('e'), made('f'), made('g')), 1500, { tuning: { rowGesture: 'step' } });
  await advanceFrames(2000);
  assert.deepEqual(drawnOffNumbers(m), [], 'control: the check passes before the growth');
  const inset = m.latest().rowNumbers.leftInset;
  await act(async () => void m.latest().setSlots('a', 2));
  await advanceFrames(2000);
  assert.ok(m.latest().rowNumbers.leftInset > inset, 'control: the left group grew');
  assert.deepEqual(drawnOffNumbers(m), [], 'at rest after the growth');
});
