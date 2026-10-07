/**
 * The engine's reading of the two settings that decide whether a held drag scrolls the row: scrollOnDrag and
 * tuning.edgeScroll. One differential per name through the real slot context: the same drag, the pointer half a
 * default zone inside the right edge, under two values must scroll the row differently. The literal rows are in
 * edge-scroll-pure.test.ts and edge-scroll-drag.test.ts.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, registerView } from '../index.js';
import type { PanelSettings } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';

afterEach(async () => {
  // A test that left the pointer down must not leave motion's window listeners live for the next one.
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await advanceFrames(5 * FRAME_MS);
  cleanup();
});

const OWNED = ['scrollOnDrag', 'tuning.edgeScroll'];
const EDGE = LIBRARY_TUNING_DEFAULTS.edgeScroll;
const WINDOW = 1000;
/** Half the default zone inside the right edge: full-ramp speed halved under the defaults. */
const POINTER = WINDOW - EDGE.zonePx / 2;

registerView('enforce-edge-view', ({ panel }) =>
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

/** How far the row scrolls in 50 held frames, the pointer at `POINTER`, under `layer` on every panel. */
async function scrolledUnder(layer: PanelSettings): Promise<number> {
  const entries = row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, layer, { view: 'enforce-edge-view' })));
  const m = mountRow(entries, WINDOW);
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  const handle = m.container.querySelector('[data-handle="s1"]');
  assert.ok(handle, 'the grab bar rendered');
  await act(async () => void handle.dispatchEvent(pointer('pointerdown', POINTER - 40)));
  await act(async () => void window.dispatchEvent(pointer('pointermove', POINTER)));
  await advanceFrames(FRAME_MS);
  await advanceFrames(50 * FRAME_MS);
  const at = m.container.scrollLeft;
  await act(async () => void window.dispatchEvent(pointer('pointerup', POINTER)));
  await advanceFrames(30 * FRAME_MS);
  cleanup();
  return at;
}

test('differential scrollOnDrag: a drag held half a zone inside the edge scrolls under edge and not under none', async () => {
  const outcomes = new Map<string, number>([
    ['edge', await scrolledUnder({ scrollOnDrag: 'edge' })],
    ['none', await scrolledUnder({ scrollOnDrag: 'none' })],
  ]);
  assert.ok(outcomes.get('edge')! > 0, 'the control moves');
  differential('scrollOnDrag', (run) => {
    run('edge', () => outcomes.get('edge'));
    run('none', () => outcomes.get('none'));
  });
});

test('differential tuning.edgeScroll: a zone of a quarter of the default leaves the same pointer outside the band', async () => {
  const outcomes = new Map<number, number>([
    [EDGE.zonePx, await scrolledUnder({ tuning: { edgeScroll: { zonePx: EDGE.zonePx } } })],
    [EDGE.zonePx / 4, await scrolledUnder({ tuning: { edgeScroll: { zonePx: EDGE.zonePx / 4 } } })],
  ]);
  assert.equal(outcomes.get(EDGE.zonePx / 4), 0);
  differential('tuning.edgeScroll', (run) => {
    run(EDGE.zonePx, () => outcomes.get(EDGE.zonePx));
    run(EDGE.zonePx / 4, () => outcomes.get(EDGE.zonePx / 4));
  });
});

test('tuning.edgeScroll maxPxPerSec at half the default halves the distance', async () => {
  const full = await scrolledUnder({});
  const half = await scrolledUnder({ tuning: { edgeScroll: { maxPxPerSec: EDGE.maxPxPerSec / 2 } } });
  assert.ok(full > 0);
  assert.ok(Math.abs(half - full / 2) < 1e-6, `${half} against half of ${full}`);
});

test('the differentials covered are exactly the two names this file owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
