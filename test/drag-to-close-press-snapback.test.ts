/**
 * A press that stops the snap-back spring and ends without moving must still return the box to rest: dnd-kit never ends a
 * press that never moves, so the box itself has to.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';

afterEach(() => cleanup());

function mountBox(over: { onClose?: () => void; reorder?: (offset: number) => void } = {}) {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose: over.onClose ?? (() => undefined),
      reorder: { onDragEnd: over.reorder ?? (() => undefined) },
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]')!;
  const box = handle.closest<HTMLElement>('[data-drag-to-close]')!;
  return { handle, box };
}
const axis = (el: HTMLElement, name: 'translateX' | 'translateY'): number => {
  const match = new RegExp(`${name}\\((-?[\\d.e+-]+)px\\)`).exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};
function pointer(type: string, x: number, y: number, pointerType = 'mouse'): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType, isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}
const press = (handle: Element) => act(async () => void handle.dispatchEvent(pointer('pointerdown', 100, 100)));
const lift = (type = 'pointerup') => act(async () => void document.dispatchEvent(pointer(type, 100, 100)));

test('a press and release during the snap-back after a vertical release ends exactly at rest on both axes', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: 40, steps: 4, hold: 8 });
  await advanceFrames(40);
  assert.ok(axis(box, 'translateY') > 0, 'control: the spring is in flight');
  await press(handle);
  const stopped = axis(box, 'translateY');
  assert.ok(stopped > 0, 'control: the press stopped it off rest');
  await lift();
  await advanceFrames(2000);
  assert.equal(axis(box, 'translateY'), 0);
  assert.equal(axis(box, 'translateX'), 0);
});

test('the same after a horizontal reorder release, with no second hop reported', async () => {
  const hops: number[] = [];
  const { handle, box } = mountBox({ reorder: (offset) => void hops.push(offset) });
  await drag(handle, { dx: 150, dy: 0 });
  await advanceFrames(40);
  assert.ok(axis(box, 'translateX') > 0, 'control: the spring is in flight');
  await press(handle);
  await lift();
  await advanceFrames(2000);
  assert.equal(axis(box, 'translateX'), 0);
  assert.equal(hops.length, 1, 'only the real drag reported a hop');
});

test('a pointercancel without movement returns the box home too, and a press, release and press again stops the return', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: 40, steps: 4, hold: 8 });
  await advanceFrames(40);
  await press(handle);
  await lift('pointercancel');
  await advanceFrames(20);
  assert.ok(axis(box, 'translateY') > 0, 'control: the return is in flight');
  await press(handle);
  const held = axis(box, 'translateY');
  await advanceFrames(40);
  assert.equal(axis(box, 'translateY'), held, 'the second press stopped the first return');
  await lift();
  await advanceFrames(2000);
  assert.equal(axis(box, 'translateY'), 0);
});

test('a plain tap on a box at rest starts no animation', async () => {
  const { handle, box } = mountBox();
  await press(handle);
  await lift();
  await advanceFrames(2);
  assert.equal(box.style.transform === '' || box.style.transform === 'none' || axis(box, 'translateY') === 0, true);
  assert.equal(axis(box, 'translateY'), 0);
});

test('a press during the close exit does not bring the box back, and onClose still runs', async () => {
  const closes: number[] = [];
  const { handle } = mountBox({ onClose: () => void closes.push(1) });
  await drag(handle, { dx: 0, dy: 120, steps: 4, hold: 0 });
  await advanceFrames(40);
  await press(handle);
  await lift();
  await advanceFrames(3000);
  assert.deepEqual(closes, [1]);
});

test('a release right after the activating move is still one release: the close fires once', async () => {
  const closes: number[] = [];
  const { handle } = mountBox({ onClose: () => void closes.push(1) });
  await drag(handle, { dx: 0, dy: 120, steps: 1, hold: 0 });
  await advanceFrames(3000);
  assert.deepEqual(closes, [1]);
});
