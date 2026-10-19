/**
 * The engine's reading of the setting that decides how a held drag scrolls the row: tuning.edgeScroll. A
 * differential through the real slot context: the same drag, the pointer half a default zone inside the right
 * edge, under two values must scroll the row differently. The literal rows are in
 * edge-scroll-pure.test.ts and edge-scroll-drag.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import type { WorkspaceTuning } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await advanceFrames(5 * FRAME_MS);
  cleanup();
});

const OWNED = ['tuning.edgeScroll'];
const EDGE = LIBRARY_TUNING_DEFAULTS.edgeScroll;
const WINDOW = 1000;
/** Half the default zone inside the right edge: full-ramp speed halved under the defaults. */
const POINTER = WINDOW - EDGE.zonePx / 2;

registerTestView('enforce-edge-view', ({ panel }) =>
  React.createElement(DragToClose, {
    reorder: { onDragEnd: () => undefined },
    children: (handle) => React.createElement('div', { 'data-handle': panel.id, onPointerDown: handle.onPointerDown }, 'grab'),
  }),
);

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, screenX: x, screenY: 100, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}

/** How far the row scrolls in 50 held frames, the pointer at `POINTER`, under the workspace `tuning`. */
async function scrolledUnder(tuning: WorkspaceTuning): Promise<number> {
  const entries = row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, {}, { view: 'enforce-edge-view' })));
  const m = mountRow(entries, WINDOW, { tuning });
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  const handle = m.container.querySelector('[data-handle="s1"]');
  assert.ok(handle, 'the grab bar rendered');
  await act(async () => void handle.dispatchEvent(pointer('pointerdown', POINTER - 40)));
  await act(async () => void document.dispatchEvent(pointer('pointermove', POINTER)));
  await advanceFrames(FRAME_MS);
  await advanceFrames(50 * FRAME_MS);
  const at = m.container.scrollLeft;
  await act(async () => void document.dispatchEvent(pointer('pointerup', POINTER)));
  await advanceFrames(30 * FRAME_MS);
  cleanup();
  return at;
}

test('differential tuning.edgeScroll: a zone of a quarter of the default leaves the same pointer outside the band', async () => {
  const outcomes = new Map<number, number>([
    [EDGE.zonePx, await scrolledUnder({ edgeScroll: { zonePx: EDGE.zonePx } })],
    [EDGE.zonePx / 4, await scrolledUnder({ edgeScroll: { zonePx: EDGE.zonePx / 4 } })],
  ]);
  assert.equal(outcomes.get(EDGE.zonePx / 4), 0);
  differential('tuning.edgeScroll', (run) => {
    run(EDGE.zonePx, () => outcomes.get(EDGE.zonePx));
    run(EDGE.zonePx / 4, () => outcomes.get(EDGE.zonePx / 4));
  });
});

test('tuning.edgeScroll maxPxPerSec at half the default halves the distance', async () => {
  const full = await scrolledUnder({});
  const half = await scrolledUnder({ edgeScroll: { maxPxPerSec: EDGE.maxPxPerSec / 2 } });
  assert.ok(full > 0);
  assert.ok(Math.abs(half - full / 2) < 1e-6, `${half} against half of ${full}`);
});

test('the differentials covered are exactly the name this file owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
