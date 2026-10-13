/** The dragging flag of a panel whose release reorders the row ends at the release, not after a spring that never runs. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, registerView, useHost, usePanelDragging, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  const dragging = usePanelDragging();
  return React.createElement(DragToClose, {
    reorder: { onDragEnd: (offset: number) => void (stepsFor(offset) > 0 && panels.move(id, 'right')) },
    children: (handle) => React.createElement('div', { 'data-grab': id, 'data-flag': String(dragging), onPointerDown: handle.onPointerDown }, id),
  });
}
registerView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const flag = (container: HTMLElement, id: string): string | null => container.querySelector(`[data-grab="${id}"]`)!.getAttribute('data-flag');

test('a horizontal drop that hops ends the dragging flag on the frames after the release', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(2);
  assert.equal(flag(m.container, 's1'), 'true', 'raised while the pointer is held');
  await release(213, 0);
  await advanceFrames(3);
  assert.equal(m.latest().entries.map((p) => p.id).join(','), 'root,s2,s1,s3');
  assert.equal(flag(m.container, 's1'), 'false');
});

test('a horizontal release that hops nowhere keeps the flag up until the box is home', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 40, dy: 0, steps: 6, hold: 4, keepDown: true });
  await release(40, 0);
  await advanceFrames(2);
  assert.equal(flag(m.container, 's1'), 'true');
  await advanceFrames(2000);
  assert.equal(flag(m.container, 's1'), 'false');
});
