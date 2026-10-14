/**
 * The horizontal release that tells a MotionConfig's reduced-motion value apart from the system query: under reduced motion the
 * scroll parent's overflow comes back on the release frame, and under motion it comes back only once the spring settles.
 */
import * as React from 'react';
import { MotionConfig, type MotionConfigProps } from 'motion/react';
import { DragToClose } from '../../index.js';
import { advanceFrames, cleanup, mount } from './mount-harness.js';
import { drag, release } from './drag-gesture.js';
import assert from 'node:assert/strict';

/** Mounts a drag-to-close box inside a scroll parent under `reducedMotion` (undefined: no MotionConfig at all), releases it sideways and returns the parent's overflow two frames later and after the spring has had time to settle. */
export async function releaseOverflow(reducedMotion: MotionConfigProps['reducedMotion'] | undefined): Promise<{ early: string; settled: string }> {
  const scroller = React.createElement(
    'div',
    { 'data-scroller': '', style: { overflowY: 'auto' } },
    React.createElement(DragToClose, {
      onClose: () => undefined,
      reorder: { onDragEnd: () => undefined },
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const mounted = mount(reducedMotion === undefined ? scroller : React.createElement(MotionConfig, { reducedMotion }, scroller));
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  const parent = mounted.container.querySelector<HTMLElement>('[data-scroller]');
  assert.ok(handle && parent, 'the box rendered');
  await drag(handle, { dx: 200, dy: 0, keepDown: true });
  assert.equal(parent.style.overflowY, 'hidden', 'control: the drag locked it');
  await release(200, 0);
  await advanceFrames(2);
  const early = parent.style.overflowY;
  await advanceFrames(2000);
  const settled = parent.style.overflowY;
  cleanup();
  return { early, settled };
}
