/**
 * A workspace made with no root template keeps an invisible marker as its root, so its row starts with no slot at all. Embla built
 * on a row with no slides has no stop: its index is -1 and its position reads that missing stop, NaN, which every later rebuild
 * carried on, so the row drew nothing even once panels were added. The row builds Embla only once it has a slot.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace } from '../index.js';
import { EMBLA_UNLOADED_ATTRIBUTE, emblaDrawnOf, emblaOf, emblaScrollOf, emblaTargetOf } from '../emblaRow.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace, flush } from './support/workspace-row.js';
import { advanceUntilRowRests, emblaWindowIn, rowBoxOf, rowOffsetOf, stubSlotBoxes } from './support/strip.js';

afterEach(() => cleanup());

const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });

async function rootlessRow(cap: number | null) {
  const ws = createWorkspace({ mount: false, templates: ['a', 'b', 'c'].map((id) => markerTemplate(id)), tuning: { maxLivePanels: cap } });
  const m = mountWorkspace(ws, { width: 1000 });
  await flush();
  m.container.getBoundingClientRect = () => rect(0, 1000);
  stubSlotBoxes(m.container, 16);
  return { ws, m };
}

const positions = (container: HTMLElement): number[] => {
  const win = emblaWindowIn(container);
  const embla = win === null ? undefined : emblaOf(win);
  assert.ok(embla !== undefined, 'the row runs Embla once it has a slot');
  return [emblaScrollOf(embla), emblaDrawnOf(embla), emblaTargetOf(embla)];
};

test('a rootless workspace with no panel draws an empty row and no NaN position', async () => {
  const { m } = await rootlessRow(null);
  assert.equal(m.slots().length, 0, 'no panel yet');
  assert.ok(!(rowBoxOf(m.container)?.style.transform ?? '').includes('NaN'), `the box is not drawn at NaN: ${rowBoxOf(m.container)?.style.transform}`);
});

test('a rootless workspace that gets its panels later draws them: the row stands at the start and loads what the window shows', async () => {
  const { ws, m } = await rootlessRow(2);
  act(() => {
    for (const id of ['a', 'b', 'c']) ws.addPanel(id);
  });
  await flush();
  stubSlotBoxes(m.container, 16);
  for (const p of positions(m.container)) assert.ok(Number.isFinite(p), `Embla's location, drawn place and target are numbers: ${positions(m.container).join(', ')}`);
  assert.equal(rowOffsetOf(m.container), 0, 'the row stands at its start');
  assert.ok(!(rowBoxOf(m.container)?.style.transform ?? '').includes('NaN'), `the box is drawn at a number: ${rowBoxOf(m.container)?.style.transform}`);
  const slots = [...(rowBoxOf(m.container)?.querySelectorAll<HTMLElement>('[data-row-slot]') ?? [])];
  assert.equal(slots.length, 3, 'three slots');
  const loaded = slots.map((s) => s.querySelector(`[${EMBLA_UNLOADED_ATTRIBUTE}]`) === null);
  assert.deepEqual(loaded.slice(0, 2), [true, true], 'the two panels the window shows are loaded, not placeholders');
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), 406, 'an arrow key steps the row one slot');
  act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  await advanceUntilRowRests(m.container);
  // Every panel closed empties the row again, and the next panel added draws at the start.
  act(() => {
    for (const id of ['a', 'b', 'c']) ws.panels.get(id)?.close();
  });
  await flush();
  await advanceFrames(2000);
  assert.ok(!(rowBoxOf(m.container)?.style.transform ?? '').includes('NaN'), 'emptied: not drawn at NaN');
  act(() => void ws.addPanel('b'));
  await flush();
  stubSlotBoxes(m.container, 16);
  for (const p of positions(m.container)) assert.ok(Number.isFinite(p), `refilled: ${positions(m.container).join(', ')}`);
  assert.equal(rowOffsetOf(m.container), 0, 'refilled: at the start');
  assert.ok(m.slots().includes('b'), 'refilled: the panel draws its view');
});

test('control: a workspace with a root draws its panels at the start the same way', async () => {
  const ws = createWorkspace({ mount: false, root: markerTemplate('root'), templates: ['a', 'b', 'c'].map((id) => markerTemplate(id)), tuning: { maxLivePanels: 2 } });
  const m = mountWorkspace(ws, { width: 1000 });
  await flush();
  m.container.getBoundingClientRect = () => rect(0, 1000);
  act(() => {
    for (const id of ['a', 'b']) ws.addPanel(id);
  });
  await flush();
  stubSlotBoxes(m.container, 16);
  for (const p of positions(m.container)) assert.ok(Number.isFinite(p));
  assert.equal(rowOffsetOf(m.container), 0);
});
