/**
 * The row follows a horizontal drag live: the panels the drag would cross hold a slot offset shifted by the dragged
 * panel's own span, the dragged slot is raised, and the drop commits the order the preview showed. Slots are read
 * through their drawn translateX, since jsdom has no layout.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { ROW_LAYER_Z } from '../rowConstants.js';
import { centerRank, slotZ } from '../rowSlotZ.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';
import { slotTransform } from './support/strip.js';

afterEach(() => cleanup());

const reported: Array<{ id: string; offset: number; steps: number }> = [];
function DraggableView({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        const steps = stepsFor(offset);
        reported.push({ id, offset, steps });
        for (let k = 0; k < Math.abs(steps); k += 1) panels.move(id, steps > 0 ? 'right' : 'left');
      },
    },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(DraggableView, { id: panel.id }));

const slotOf = (m: MountedRow, id: string): HTMLElement => {
  const grab = m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`);
  assert.ok(grab, `${id} rendered`);
  const slot = grab.closest<HTMLElement>('[data-drag-to-close]')?.closest<HTMLElement>('[data-row-slot]');
  assert.ok(slot, `${id} sits in a slot`);
  return slot;
};
const xOf = (m: MountedRow, id: string): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(slotTransform(slotOf(m, id)));
  return match === null ? 0 : Math.round(Number(match[1]));
};
const zOf = (m: MountedRow, id: string): string => slotOf(m, id).style.zIndex;
const restZ = (m: MountedRow, id: string, tier: number = ROW_LAYER_Z.BASE): string => {
  const ids = ['root', ...m.live()];
  return String(slotZ(tier, centerRank(ids.indexOf(id), ids.length), false));
};
const DRAGGED = String(ROW_LAYER_Z.DRAGGED);
const order = (m: MountedRow): string => m.latest().entries.map((p) => p.id).join(',');
const handleOf = (m: MountedRow, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!;

// One phone span: 390 + the 16 px gap.
const SPAN = 406;

test('nothing is previewed for a panel that is not movable, though the held panel is lifted', async () => {
  const m = mountRow(row(rootEntry(), made('s1', { movable: false }), made('s2')), 3000);
  await advanceFrames(2000);
  const before = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: SPAN, dy: 0, steps: 8, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), before);
  assert.equal(zOf(m, 's1'), DRAGGED, 'the held panel is lifted over the row, whether or not it can be moved');
  await release(SPAN, 0);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's1'), restZ(m, 's1'), 'and the lift ends when it settles');
});

test('the preview stops at a panel that cannot be crossed, as the hop rule does', async () => {
  const m = mountRow(row(rootEntry(), made('s1'), made('s2', { crossable: false }), made('s3')), 3000);
  await advanceFrames(2000);
  const before = { s2: xOf(m, 's2'), s3: xOf(m, 's3') };
  await drag(handleOf(m, 's1'), { dx: SPAN * 2 + 10, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), before.s2);
  assert.equal(xOf(m, 's3'), before.s3);
  await release(SPAN * 2 + 10, 0);
  await advanceFrames(2000);
  assert.equal(order(m), 'root,s1,s2,s3');
});

test('closing the dragged panel mid-drag leaves no neighbour shifted', async () => {
  const m = mountRow(panelsOf(4), 3000);
  await advanceFrames(2000);
  await drag(handleOf(m, 's1'), { dx: SPAN * 0.5 + 10, dy: 0, steps: 8, hold: 4, keepDown: true });
  await advanceFrames(1000);
  act(() => m.latest().close('s1'));
  await advanceFrames(3000);
  await release(0, 0);
  await advanceFrames(2000);
  assert.equal(order(m), 'root,s2,s3,s4');
  assert.equal(xOf(m, 's2'), SPAN, 'the neighbours closed up to their own slots');
  assert.equal(xOf(m, 's3'), 2 * SPAN);
  act(() => m.latest().undoClose());
  await advanceFrames(3000);
  assert.equal(order(m), 'root,s1,s2,s3,s4');
  assert.equal(zOf(m, 's1'), restZ(m, 's1'), 'the revived panel is not still raised');
  assert.equal(xOf(m, 's2'), 2 * SPAN, 'and no neighbour is still shifted for it');
});

test('a drag that locks vertical previews nothing: no neighbour moves, and the held slot is lifted until it settles', async () => {
  const m = mountRow(panelsOf(4), 3000);
  await advanceFrames(2000);
  const rest = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: 20, dy: 60, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), rest);
  assert.equal(zOf(m, 's1'), DRAGGED);
  await release(20, 60);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's1'), restZ(m, 's1'));
});
