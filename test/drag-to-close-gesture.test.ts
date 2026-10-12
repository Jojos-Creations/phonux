/**
 * DragToClose's gesture layer: the release velocity the close rule reads, and a pointercancel, which a native pan sends
 * and which has to end the gesture with no hop and no close. The gesture runs through dnd-kit's pointer sensor and
 * motion's springs on the virtual frame clock.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, flick } from './support/drag-gesture.js';

afterEach(() => cleanup());

function mountBox(onClose: () => void, onReorder: (offset: number) => void = () => undefined) {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose,
      reorder: { onDragEnd: onReorder },
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  const box = handle.closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, 'the handle sits in a drag box');
  return { handle, box };
}
const translateX = (el: HTMLElement): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('a short drag down closes when it is released fast and not when it is released at rest', async () => {
  const closes: number[] = [];
  const { handle } = mountBox(() => closes.push(1));
  await drag(handle, { dx: 0, dy: 60, steps: 3, hold: 8 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], '60 px released at rest is under the 80 px minimum');
  await drag(handle, { dx: 0, dy: 60, steps: 3, hold: 0 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [1], 'the same 60 px released at 1250 px/s is a flick');
});

test('a pointercancel in a horizontal drag springs the box home and reports no hop', async () => {
  const hops: number[] = [];
  const { handle, box } = mountBox(() => undefined, (offset) => void hops.push(offset));
  await drag(handle, { dx: 200, dy: 0, keepDown: true });
  assert.ok(translateX(box) > 100, 'the box followed the pointer');
  await act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 300, clientY: 100, button: 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(2000);
  assert.ok(Math.abs(translateX(box)) < 1, `the box is back at rest, not at ${Math.round(translateX(box))} px`);
  assert.deepEqual(hops, [], 'a cancelled gesture hops nowhere');
});

test('a flick of a few fast moves inside one frame still closes, and the same moves spread slowly do not', async () => {
  const closes: number[] = [];
  const { handle } = mountBox(() => closes.push(1));
  await flick(handle, { dy: 60, moves: 3, gapMs: 10 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [1], '60 px in 30 ms is 2000 px/s, under the 80 px minimum but a flick');
  await flick(handle, { dy: 60, moves: 3, gapMs: 400 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [1], '60 px over 1200 ms is under the 80 px minimum and no flick');
});

// The speed of a flick is read between samples at least 8 ms apart: closer ones share a timestamp's worth of noise.
async function closesFor(gapMs: number): Promise<number> {
  const closes: number[] = [];
  const { handle } = mountBox(() => closes.push(1));
  await flick(handle, { dy: 60, moves: 2, gapMs });
  await advanceFrames(2000);
  return closes.length;
}

test('two moves on one timestamp make no speed: 60 px is under the 80 px minimum and is no flick', async () => {
  assert.equal(await closesFor(0), 0);
});

test('the speed floor sits at 8 ms: moves 7 ms apart make no speed, moves 8 ms apart are a flick', async () => {
  assert.equal(await closesFor(7), 0, '7 ms is under the floor, so the segment is skipped');
  cleanup();
  assert.equal(await closesFor(8), 1, '30 px in 8 ms is 3750 px/s');
});
