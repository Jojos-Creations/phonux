/**
 * Reduced motion runs no spring, so a press has none to stop: a press that ends without moving leaves the box at rest.
 * Motion reads the preference once, so this file is the process's first caller.
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

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

test('under reduced motion a press that ends without moving leaves the box exactly at rest and the scroll parent unlocked', async () => {
  const mounted = mount(
    React.createElement(
      'div',
      { 'data-scroller': '', style: { overflowY: 'auto' } },
      React.createElement(DragToClose, {
        onClose: () => undefined,
        reorder: { onDragEnd: () => undefined },
        children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
      }),
    ),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]')!;
  const box = handle.closest<HTMLElement>('[data-drag-to-close]')!;
  await drag(handle, { dx: 0, dy: 40, steps: 4, hold: 8 });
  const event = (type: string): Event => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, buttons: type === 'pointerdown' ? 1 : 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(e, key, { value });
    return e;
  };
  await act(async () => void handle.dispatchEvent(event('pointerdown')));
  await act(async () => void document.dispatchEvent(event('pointerup')));
  await advanceFrames(4);
  assert.ok(!/translateY\(-?[1-9]/.test(box.style.transform), `at rest, not ${box.style.transform}`);
  assert.equal(mounted.container.querySelector<HTMLElement>('[data-scroller]')!.style.overflowY, 'auto');
});
