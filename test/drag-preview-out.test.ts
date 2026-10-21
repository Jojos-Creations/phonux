/**
 * A vertical drag with `previewOut` grabs a tile instead of moving the box. A release calls `exitFor`, and its side decides
 * whether the real panel closes; null leaves the panel where it is.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, type GrabDragEnd, type PreviewExit } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

function mountPreviewBox(exitFor: (end: GrabDragEnd) => PreviewExit | null, onClose: () => void) {
  const mounted = mount(
    React.createElement(DragToClose, {
      onClose,
      previewOut: { width: 120, height: 80, render: () => React.createElement('span', null, 'tile') },
      exitFor,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  return { handle };
}

test('a vertical drag past the threshold grabs a tile, and a release with no side leaves the panel in place', async () => {
  const calls: Array<GrabDragEnd> = [];
  let closes = 0;
  const { handle } = mountPreviewBox((end) => {
    calls.push(end);
    return null;
  }, () => (closes += 1));
  await drag(handle, { dx: 0, dy: 120, steps: 4, hold: 8 });
  await advanceFrames(2000);
  assert.equal(document.querySelectorAll('[data-drag-preview]').length, 0, 'the tile is gone once released');
  assert.equal(calls.length, 1, 'exitFor is asked once at release');
  assert.ok(calls[0]!.offsetY > 100, 'the release carries the vertical travel');
  assert.equal(closes, 0, 'a null side closes nothing');
});

test('a release that picks a side slides the real panel that way and then closes it', async () => {
  let closes = 0;
  const { handle } = mountPreviewBox(() => 'bottom', () => (closes += 1));
  await drag(handle, { dx: 0, dy: 120, steps: 4, hold: 8 });
  await advanceFrames(2000);
  assert.equal(closes, 1, 'the chosen side closes the panel once its exit ends');
});
