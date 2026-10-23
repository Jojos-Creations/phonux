/** useRecaptureOnSettle: one round when the grid opens and one after the scroll settles, never one per scroll event. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useRecaptureOnSettle, type CaptureTrigger } from '../index.js';
import { cleanup } from './support/mount-harness.js';

afterEach(() => cleanup());

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function Probe({ trigger, open, ids }: { trigger: CaptureTrigger; open: boolean; ids: readonly string[] }) {
  useRecaptureOnSettle(trigger, { open, liveIds: () => ids, settleMs: 40 });
  return null;
}

test('evidence 6: recapture runs once when scrolling settles, not on every scroll event', async () => {
  const captured: string[] = [];
  const trigger: CaptureTrigger = { capture: (id) => void captured.push(id), evict: () => {} };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Probe, { trigger, open: true, ids: ['a', 'b'] }));
  });
  await wait(60);
  assert.deepEqual(captured, ['a', 'b'], 'opening the grid must picture every live panel once');
  captured.length = 0;
  for (let i = 0; i < 25; i++) {
    document.dispatchEvent(new Event('scroll'));
    await wait(2);
  }
  assert.deepEqual(captured, [], 'a scroll still in progress must not capture');
  await wait(120);
  assert.deepEqual(captured, ['a', 'b'], 'the settled scroll must capture once per panel');
  act(() => root.unmount());
});
