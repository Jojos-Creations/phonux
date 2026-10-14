/**
 * DragToClose under the theme's MotionConfig reducedMotion "always" with the system's preference off: the drag box must
 * take the reduced-motion path on the MotionConfig value alone. Motion reads the OS preference once per process, so this
 * file gets its own process, as drag-to-close-reduced-motion.test.ts does.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

test('under MotionConfig reducedMotion "always" a horizontal release gives the scroll parent its overflow back at once', async () => {
  const mounted = mount(
    React.createElement(
      MotionConfig,
      { reducedMotion: 'always' },
      React.createElement(
        'div',
        { 'data-scroller': '', style: { overflowY: 'auto' } },
        React.createElement(DragToClose, {
          onClose: () => undefined,
          reorder: { onDragEnd: () => undefined },
          children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
        }),
      ),
    ),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  const scroller = mounted.container.querySelector<HTMLElement>('[data-scroller]');
  assert.ok(handle && scroller, 'the box rendered');
  await drag(handle, { dx: 200, dy: 0, keepDown: true });
  assert.equal(scroller.style.overflowY, 'hidden', 'control: the drag locked it');
  await release(200, 0);
  await advanceFrames(2);
  assert.equal(scroller.style.overflowY, 'auto', 'and the release, with no spring to wait for, gave it back');
});
