/**
 * Edge scrolling through a mounted DragToClose and through a mounted row. jsdom has no PointerEvent, so every pointer
 * event is a MouseEvent of the pointer type name carrying the pointer fields motion reads.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

test('pin: a 40 px horizontal drag on a reorder DragToClose reports onDragEnd(40)', async () => {
  const offsets: number[] = [];
  const mounted = mount(
    React.createElement(
      'div',
      { 'data-row-scroller': '' },
      React.createElement(DragToClose, {
        reorder: { onDragEnd: (offsetX: number) => void offsets.push(offsetX) },
        children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
      }),
    ),
  );
  const handle = mounted.container.querySelector('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  await drag(handle, { dx: 40, dy: 0 });
  await advanceFrames(30 * 16);
  assert.deepEqual(offsets, [40]);
});
