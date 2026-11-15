/**
 * onPanelRect follows a row scroll on the Embla row: a host drawing a native view over a panel hears the panel's box move as the
 * row moves by key, wheel or code, and a settled box where the panel rests. Mounted provider, Workspace and PanelRow at 1000 px,
 * laid out by `stubSlotBoxes` (window at 16 on screen, slots of 406).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelRectEvent } from '../index.js';
import { advanceUntilRowRests, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

async function laidOut(): Promise<{ m: MountedRow; events: PanelRectEvent[] }> {
  const events: PanelRectEvent[] = [];
  const m = mountRow(panelsOf(8), 1000, { onPanelRect: (e) => void events.push(e) });
  stubSlotBoxes(m.container, 16);
  await advanceFrames(400);
  events.length = 0;
  return { m, events };
}

const keyOf = (m: MountedRow, id: string): string => m.latest().entries.find((p) => p.id === id)?.key ?? id;
const slotX = (m: MountedRow, id: string): number => m.container.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${id}"]`)!.getBoundingClientRect().x;
const lastSettled = (events: PanelRectEvent[], key: string): PanelRectEvent | undefined => events.filter((e) => e.key === key && e.phase === 'settled').at(-1);

async function rests(m: MountedRow): Promise<void> {
  await advanceUntilRowRests(m.container);
  await advanceFrames(200);
}

test('a row step by key reports every moved panel moving, then settled where it rests', async () => {
  const { m, events } = await laidOut();
  const before = slotX(m, 's3');
  m.key('ArrowRight');
  // Mid-glide the last report follows the box as it is drawn this frame.
  await advanceFrames(48);
  const mid = events.filter((e) => e.key === keyOf(m, 's3') && e.phase === 'moving').at(-1);
  assert.ok(mid !== undefined && Math.abs(slotX(m, 's3') - before) > 1, 'mid-glide: the box has moved and been reported');
  assert.ok(Math.abs(mid.rect.x - slotX(m, 's3')) < 0.5, `mid-glide report at the drawn box: ${mid.rect.x} vs ${slotX(m, 's3')}`);
  await rests(m);
  assert.ok(rowOffsetOf(m.container) > 0, 'the row moved');
  const key = keyOf(m, 's3');
  assert.ok(events.some((e) => e.key === key && e.phase === 'moving'), `s3 reported moving: ${events.length} events`);
  const settled = lastSettled(events, key);
  assert.ok(settled !== undefined, 's3 reported settled');
  assert.ok(Math.abs(settled.rect.x - slotX(m, 's3')) < 0.5, `settled at the panel's box: ${settled.rect.x} vs ${slotX(m, 's3')}`);
  assert.ok(Math.abs(slotX(m, 's3') - before) > 100, 'and the box did move');
});

test('a wheel and a scroll by code are reported too', async () => {
  const { m, events } = await laidOut();
  m.wheel({ deltaX: 400 });
  // The wheel gesture ends on a real-time wait for the next wheel, then glides to its stop.
  await act(async () => void (await new Promise((r) => setTimeout(r, 150))));
  await rests(m);
  const key = keyOf(m, 's4');
  assert.ok(rowOffsetOf(m.container) > 0, 'the wheel moved the row');
  assert.ok(Math.abs((lastSettled(events, key)?.rect.x ?? Number.NaN) - slotX(m, 's4')) < 0.5, 'a wheel: s4 settled at its box');
  events.length = 0;
  act(() => void m.latest().scrollTo('s8'));
  await rests(m);
  assert.ok(Math.abs((lastSettled(events, key)?.rect.x ?? Number.NaN) - slotX(m, 's4')) < 0.5, 'by code: s4 settled at its new box');
});

test('control: a row that does not move reports nothing', async () => {
  const { events } = await laidOut();
  await advanceFrames(400);
  assert.equal(events.length, 0, JSON.stringify(events.slice(0, 3)));
});
