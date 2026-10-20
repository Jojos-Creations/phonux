/**
 * A grab-handle drag cancelled mid-gesture (Escape, or a pointercancel from a native pan) must return the box to rest on
 * both axes. The cancel springs x and the row's scroll back; the vertical offset has to spring home too.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

function mountBox() {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose: () => undefined,
      reorder: { onDragEnd: () => undefined },
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  const box = handle.closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, 'the handle sits in a drag box');
  return { handle, box };
}
const axis = (el: HTMLElement, name: 'translateX' | 'translateY'): number => {
  const match = new RegExp(`${name}\\((-?[\\d.e+-]+)px\\)`).exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('an Escape that cancels a vertical drag springs the box back to rest on y', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: -90, steps: 4, hold: 8, keepDown: true });
  assert.ok(axis(box, 'translateY') < -60, 'control: the box followed the pointer up');
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  });
  await advanceFrames(2000);
  assert.equal(axis(box, 'translateY'), 0, 'the box is back at rest on y');
  assert.equal(axis(box, 'translateX'), 0);
});

test('a pointercancel that cancels a vertical drag returns the box to rest on y', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: 90, steps: 4, hold: 8, keepDown: true });
  assert.ok(axis(box, 'translateY') > 60, 'control: the box followed the pointer down');
  await act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 100, clientY: 190, button: 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(2000);
  assert.equal(axis(box, 'translateY'), 0, 'the box is back at rest on y');
});
