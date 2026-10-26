/**
 * A touch on the drag-to-close handle never drags it: the browser keeps the handle's native pan, so a vertical touch scrolls the
 * page and cannot close the box. The mouse drags at once, so the same move closes under the mouse and not under a touch.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_MS } from './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

const ORIGIN = 100;

function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup', pointerType: 'mouse' | 'touch', x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType, isPrimary: true, timeStamp: performance.now() })) Object.defineProperty(event, key, { value });
  return event;
}

function mountBox(onClose: () => void) {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  return { handle };
}

// A touch that moves down `dy` in three steps, starting `holdMs` after the press (0 moves at once), then releases.
async function touchDrag(handle: Element, { dy, holdMs }: { dy: number; holdMs: number }): Promise<void> {
  await act(async () => {
    handle.dispatchEvent(pointerEvent('pointerdown', 'touch', ORIGIN, ORIGIN));
  });
  if (holdMs > 0) await advanceFrames(holdMs);
  for (let step = 1; step <= 3; step += 1) {
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', 'touch', ORIGIN, ORIGIN + (dy * step) / 3));
    });
    await advanceFrames(FRAME_MS);
  }
  await advanceFrames(8 * FRAME_MS);
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointerup', 'touch', ORIGIN, ORIGIN + dy));
  });
}

test('a touch that moves down before its hold does not close the box, and the same move with a mouse does', async () => {
  const mouseCloses: number[] = [];
  const mouse = mountBox(() => mouseCloses.push(1));
  await drag(mouse.handle, { dx: 0, dy: 300, steps: 3, hold: 8 });
  await advanceFrames(2000);
  assert.deepEqual(mouseCloses, [1], 'the control: a mouse dragged 300 px down closes');
  cleanup();

  const touchCloses: number[] = [];
  const touch = mountBox(() => touchCloses.push(1));
  await touchDrag(touch.handle, { dy: 300, holdMs: 0 });
  await advanceFrames(2000);
  assert.deepEqual(touchCloses, [], 'a touch dragged down is a page pan, not a close');
});

test('a touch held on the handle and then dragged down does not close the box either', async () => {
  const closes: number[] = [];
  const { handle } = mountBox(() => closes.push(1));
  await touchDrag(handle, { dy: 300, holdMs: 400 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'a held touch never starts the close drag');
});

test('a touch whose moves keep coming (a page that cannot pan sends no pointercancel) never moves the box', async () => {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose: () => undefined,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]')!;
  const box = mounted.container.querySelector<HTMLElement>('[data-drag-to-close]')!;
  const moved = (): boolean => /translate|matrix/.test(box.style.transform) && !/^(none|translateY\(0px\)|)$/.test(box.style.transform);
  await act(async () => {
    handle.dispatchEvent(pointerEvent('pointerdown', 'touch', ORIGIN, ORIGIN));
  });
  let seen = false;
  for (let step = 1; step <= 10; step += 1) {
    await act(async () => {
      document.dispatchEvent(pointerEvent('pointermove', 'touch', ORIGIN, ORIGIN + step * 30));
    });
    await advanceFrames(FRAME_MS);
    seen ||= moved();
  }
  assert.equal(seen, false, `the box stayed at rest under the finger (transform ${box.style.transform})`);
  await act(async () => {
    document.dispatchEvent(pointerEvent('pointerup', 'touch', ORIGIN, ORIGIN + 300));
  });
});
