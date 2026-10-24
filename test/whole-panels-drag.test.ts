/**
 * A drag released after edge scrolling in a stepping row settles on a stop, in continuous and in reduced motion. Window
 * 1000 with phone panels: two fit, so the stops are 0, 320, 726 ... (each panel start less 86, which centers the two whole
 * slots) and the last is maxScroll 3482.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import type { WorkspaceTuning } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

// jsdom has no matchMedia. Motion reads the query once and then follows its 'change' event, so the stub exists before
// the first mount and a test flips it with `reduceMotion(true)` before mounting.
const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}

afterEach(async () => {
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  await frames(5);
  cleanup();
  reduceMotion(false);
});

function EdgeBox({ id }: { id: string }): React.ReactElement {
  return React.createElement(DragToClose, {
    reorder: { onDragEnd: () => {} },
    children: (handle) => React.createElement('div', { 'data-handle': id, onPointerDown: handle.onPointerDown }, 'grab'),
  });
}
registerTestView('whole-edge-view', ({ panel }) => React.createElement(EdgeBox, { id: panel.id }));

const WINDOW = 1000;
function mountEdgeRow(tuning: WorkspaceTuning = {}): MountedRow {
  const entries = row(rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`, {}, { view: 'whole-edge-view' })));
  const m = mountRow(entries, WINDOW, { tuning: { rowGesture: 'step', ...tuning } });
  Object.defineProperty(m.container, 'clientWidth', { value: WINDOW, configurable: true });
  m.container.getBoundingClientRect = () => ({ left: 0, right: WINDOW, top: 0, bottom: 700, width: WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  return m;
}

function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y = 100): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const press = (target: Element, x: number): Promise<void> => act(async () => void target.dispatchEvent(pointer('pointerdown', x)));
const moveTo = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointermove', x, y)));
const liftAt = (x: number, y = 100): Promise<void> => act(async () => void document.dispatchEvent(pointer('pointerup', x, y)));
const frames = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);
const handleOf = (m: MountedRow, id: string): Element => {
  const handle = m.container.querySelector(`[data-handle="${id}"]`);
  assert.ok(handle, `${id}'s grab bar rendered`);
  return handle;
};
const boxOf = (m: MountedRow, id = 's1'): HTMLElement => {
  const box = handleOf(m, id).closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, `${id}'s box rendered`);
  return box;
};
/** A horizontal drag of s1 from 40 px left of `at` to `at`: the axis locks x, and a frame lets the lock take. */
async function dragTo(m: MountedRow, at: number, id = 's1'): Promise<void> {
  await press(handleOf(m, id), at - 40);
  await moveTo(at);
  await frames(1);
}
// The one-phone grid (390 + the 16 gap apart) from 0, each inner stop moved back 86, half of (968 + 16) % 406, then maxScroll.
const STOPS = [0, ...Array.from({ length: 8 }, (_, k) => 406 * (k + 1) - 86), 3482];
const atAStop = (left: number): boolean => STOPS.some((stop) => Math.abs(left - stop) < 1e-6);
const nearestStop = (left: number): number => STOPS.reduce((best, stop) => (Math.abs(stop - left) < Math.abs(best - left) ? stop : best));

test('a drag held at the right edge and released settles the row on a stop', async () => {
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(100);
  assert.ok(m.container.scrollLeft > 1000 && !atAStop(m.container.scrollLeft), `positive control: the loop left the row between stops at ${m.container.scrollLeft}`);
  const before = m.container.scrollLeft;
  await liftAt(1000);
  await frames(60);
  assert.ok(atAStop(m.container.scrollLeft), `settled at ${m.container.scrollLeft}`);
  assert.equal(m.container.scrollLeft, nearestStop(before), 'the nearest stop');
});

test('under reduced motion a held edge jumps stop by stop, to 320 and not to the panel start 406', async () => {
  reduceMotion(true);
  const m = mountEdgeRow();
  await dragTo(m, 1000);
  await frames(60);
  assert.ok(atAStop(m.container.scrollLeft), `at ${m.container.scrollLeft}`);
  assert.notEqual(m.container.scrollLeft % 406, 0, 'not on a panel start');
  assert.ok(m.container.scrollLeft >= STOPS[1]!, 'positive control: it jumped');
});

test('a released drag settles along slide.glideEase: a quarter of the way through a slow settle a linear one has covered about a quarter and the default most of it', async () => {
  const settled = async (glideEase: 'cubic-out' | 'linear'): Promise<number> => {
    const m = mountEdgeRow({ slide: { durationSec: 1.6, glideEase } });
    await dragTo(m, 1000);
    await frames(100);
    const from = m.container.scrollLeft;
    await liftAt(1000);
    await frames(25);
    const mid = m.container.scrollLeft;
    await frames(150);
    const to = m.container.scrollLeft;
    assert.ok(Math.abs(to - from) > 20, `control: the settle moved the row, ${from} to ${to}`);
    cleanup();
    return (mid - from) / (to - from);
  };
  const linear = await settled('linear');
  const cubic = await settled('cubic-out');
  assert.ok(Math.abs(linear - 0.25) < 0.08, `linear covered ${linear}`);
  assert.ok(cubic > 0.5, `cubic-out covered ${cubic}`);
});
