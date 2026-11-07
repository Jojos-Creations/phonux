/**
 * A slot's rest is its `translate`, written by the row's drawing pass; its mover only holds how far the slot is from there. A rest
 * that moves is drawn at once while the mover takes up the difference, so the slot stays where it was and glides in.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/jsdom-globals.js';
import { act } from 'react';
import { cleanup, advanceFrames } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';
import { slotTransform } from './support/strip.js';

afterEach(() => cleanup());

const slotOf = (m: ReturnType<typeof mountRow>, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;
const drawnX = (el: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotTransform(el))?.[1] ?? 0);
const restX = (el: HTMLElement): number => Number.parseFloat(el.style.translate) || 0;

test('at rest a slot is drawn by its translate alone, at the offset it rendered', async () => {
  const m = mountRow(row(rootEntry(), made('a'), made('b')), 3000);
  await advanceFrames(2000);
  const slots = [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  assert.ok(slots.length >= 3, 'control: the row drew its slots');
  assert.ok(slots.some((s) => Number(s.dataset.rowSlot) > 0), 'control: a slot rests away from 0');
  for (const s of slots) {
    assert.equal(restX(s), Number(s.dataset.rowSlot), `${s.dataset.rowId}: its translate is its rest`);
    assert.equal(s.style.transform, 'none', `${s.dataset.rowId}: its mover adds nothing at rest`);
  }
});

test('a rest that moves is written at once and the mover starts from where the slot was drawn', async () => {
  const m = mountRow(row(rootEntry(), made('a'), made('b'), made('c')), 3000);
  await advanceFrames(2000);
  const ids = m.latest().entries.map((p) => p.id);
  const last = slotOf(m, ids.at(-1)!);
  const before = restX(last);
  assert.ok(before > 0, 'control: the last slot rests away from 0');
  await act(async () => {
    m.latest().setSlots(ids[1]!, 2);
  });
  const after = Number(last.dataset.rowSlot);
  assert.ok(after > before, 'control: the panel before it grew, so its rest moved');
  assert.equal(restX(last), after, 'the pass drew the new rest in the commit that made it');
  assert.ok(Math.abs(drawnX(last) - before) < 1, `it is still drawn where it was, at ${before}, not ${drawnX(last)}`);
  await advanceFrames(2000);
  assert.equal(last.style.transform, 'none', 'and lands with nothing left to add');
  assert.equal(drawnX(last), after);
});

test('only the drawing pass writes a slot rest, and the mover replaces the transform rather than adding to it', () => {
  const mover = readFileSync(new URL('../slotMover.ts', import.meta.url), 'utf8');
  const slot = readFileSync(new URL('../PanelRowSlot.tsx', import.meta.url), 'utf8');
  const pass = readFileSync(new URL('../rowDraw.ts', import.meta.url), 'utf8');
  assert.match(pass, /slot\.style\.translate = /, 'control: the pass does write it, in the form this looks for');
  assert.doesNotMatch(mover, /style\.translate\b/);
  assert.doesNotMatch(slot, /style\.translate\b/);
  // An animation added onto a style of the same property leaves the compositor, which is what a row with no hold must stay on.
  assert.doesNotMatch(mover, /composite:/);
});
