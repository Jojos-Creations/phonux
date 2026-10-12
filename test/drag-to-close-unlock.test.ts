/**
 * DragToClose locks the scroll parents while a drag is live and gives each one back the overflow-y it had. One test per
 * way the lock ends except a reduced-motion release (drag-to-close-reduced-motion.test.ts): an unmount, a revive from
 * AnimatePresence and the spring home.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DragToClose } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

function box(reorder: boolean): React.ReactElement {
  return React.createElement(
    'div',
    { 'data-scroller': '', style: { overflowY: 'auto' } },
    React.createElement(DragToClose, {
      onClose: () => undefined,
      reorder: reorder ? { onDragEnd: () => undefined } : undefined,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
}

function parts(container: HTMLElement) {
  const handle = container.querySelector<HTMLElement>('[data-handle]');
  const scroller = container.querySelector<HTMLElement>('[data-scroller]');
  assert.ok(handle && scroller, 'the box rendered');
  return { handle, scroller };
}

test('an unmount in the middle of a drag gives the scroll parent its overflow back', async () => {
  const mounted = mount(box(false));
  const { handle, scroller } = parts(mounted.container);
  await drag(handle, { dx: 0, dy: 30, keepDown: true });
  assert.equal(scroller.style.overflowY, 'hidden', 'control: the drag locked it');
  mounted.unmount();
  assert.equal(scroller.style.overflowY, 'auto');
});

test('a box AnimatePresence revives mid-exit gives the scroll parent its overflow back', async () => {
  let setShown: (shown: boolean) => void = () => undefined;
  function Host(): React.ReactElement {
    const [shown, set] = React.useState(true);
    setShown = set;
    return React.createElement(
      AnimatePresence,
      null,
      shown ? React.createElement(motion.div, { key: 'view', initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 60 } } }, box(false)) : null,
    );
  }
  const mounted = mount(React.createElement(Host));
  const { handle, scroller } = parts(mounted.container);
  await drag(handle, { dx: 0, dy: 30, keepDown: true });
  assert.equal(scroller.style.overflowY, 'hidden', 'control: the drag locked it');
  await act(async () => setShown(false));
  await advanceFrames(32);
  assert.ok(mounted.container.contains(scroller), 'control: the exit is still holding the view');
  assert.equal(scroller.style.overflowY, 'hidden', 'control: a departing view stays locked');
  await act(async () => setShown(true));
  assert.equal(scroller.style.overflowY, 'auto');
});

test('a horizontal release springs the box home and the scroll parent gets its overflow back when it lands', async () => {
  const mounted = mount(box(true));
  const { handle, scroller } = parts(mounted.container);
  await drag(handle, { dx: 200, dy: 0 });
  assert.equal(scroller.style.overflowY, 'hidden', 'control: still locked while the spring runs');
  await advanceFrames(2000);
  assert.equal(scroller.style.overflowY, 'auto');
});
