/**
 * DragToClose when React re-runs its effects while the release spring is in flight. React 19.2 does that to a keyed
 * child that a reorder moves under StrictMode, and Activity does it on hide and show in any React; the box must keep
 * springing home instead of staying at its drag offset. The gesture runs through motion's real drag machinery on the
 * virtual frame clock.
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

let setVisible: (visible: boolean) => void = () => undefined;
function Hosted(): React.ReactElement {
  const [visible, set] = React.useState(true);
  setVisible = set;
  return React.createElement(
    React.Activity,
    {
      mode: visible ? 'visible' : 'hidden',
      children: React.createElement(DragToClose, {
        onClose: () => undefined,
        reorder: { onDragEnd: () => undefined },
        children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
      }),
    },
  );
}

const translateX = (el: HTMLElement): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('a release spring survives its box having its effects cleaned up and set up again, and still reaches rest', async () => {
  const mounted = mount(React.createElement(Hosted));
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  const box = handle.closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, 'the handle sits in a drag box');
  await drag(handle, { dx: 200, dy: 0 });
  await advanceFrames(32);
  assert.ok(translateX(box) > 0, 'the spring is in flight');
  await act(async () => setVisible(false));
  await act(async () => setVisible(true));
  await advanceFrames(2000);
  assert.ok(Math.abs(translateX(box)) < 1, `the box is back at rest, not stuck at ${Math.round(translateX(box))} px`);
});

test('a box unmounted while its close exit runs never calls onClose', async () => {
  const closes: number[] = [];
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose: () => void closes.push(1),
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  await drag(handle, { dx: 0, dy: 300 });
  await advanceFrames(32);
  mounted.unmount();
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'the exit ended on a box that is gone');
});
