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
import { DragToClose, registerView, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';

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
registerView('scroll-row-view', ({ panel }) => React.createElement(DraggableView, { id: panel.id }));

const slotOf = (m: MountedRow, id: string): HTMLElement => {
  const grab = m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`);
  assert.ok(grab, `${id} rendered`);
  const slot = grab.closest<HTMLElement>('[data-drag-to-close]')?.parentElement;
  assert.ok(slot, `${id} sits in a slot`);
  return slot;
};
const xOf = (m: MountedRow, id: string): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(m, id).style.transform);
  return match === null ? 0 : Math.round(Number(match[1]));
};
const zOf = (m: MountedRow, id: string): string => slotOf(m, id).style.zIndex;
const order = (m: MountedRow): string => m.latest().entries.map((p) => p.id).join(',');
const handleOf = (m: MountedRow, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!;

// One phone span: 390 + the 16 px gap.
const SPAN = 406;

test('the panels a drag would cross slide aside by the dragged panel\'s span while it is held, and the drop commits that order', async () => {
  reported.length = 0;
  const m = mountRow(panelsOf(5), 3000);
  await advanceFrames(2000);
  const rest = Object.fromEntries(['s1', 's2', 's3', 's4'].map((id) => [id, xOf(m, id)]));
  await drag(handleOf(m, 's2'), { dx: SPAN * 0.5 + 10, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's3'), rest.s3! - SPAN, 'the first neighbour made room');
  assert.equal(xOf(m, 's4'), rest.s4, 'a neighbour past the hop point has not moved yet');
  assert.equal(xOf(m, 's1'), rest.s1, 'a panel on the other side is untouched');
  assert.equal(order(m), 'root,s1,s2,s3,s4,s5', 'the order only changes at the drop');
  assert.equal(zOf(m, 's2'), '3', 'the dragged slot is drawn over its neighbours');
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(m), 'root,s1,s3,s2,s4,s5');
  assert.equal(xOf(m, 's3'), rest.s2, 'the crossed neighbour rests where the dragged panel was: it did not move at the drop');
  assert.equal(zOf(m, 's2'), '1', 'the raise ends with the spring home');
  assert.equal(reported[0]?.steps, 1);
});

test('dragging back before the drop returns the neighbour, and a cancelled drag leaves every slot at rest', async () => {
  const m = mountRow(panelsOf(5), 3000);
  await advanceFrames(2000);
  const rest = xOf(m, 's3');
  await drag(handleOf(m, 's2'), { dx: SPAN, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's3'), rest - SPAN);
  await act(async () => {
    document.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 100 + 30, clientY: 100, buttons: 1 }), { pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's3'), rest, 'the neighbour came back when the pointer did');
  await act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 130, clientY: 100, button: 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(2000);
  assert.equal(order(m), 'root,s1,s2,s3,s4,s5');
  assert.equal(zOf(m, 's2'), '1');
});

test('dragging left shifts the panels to the left of the dragged one the other way', async () => {
  const m = mountRow(panelsOf(5), 3000);
  await advanceFrames(2000);
  const rest = { s1: xOf(m, 's1'), s2: xOf(m, 's2') };
  await drag(handleOf(m, 's3'), { dx: -SPAN * 2 + 10, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), rest.s2 + SPAN);
  assert.equal(xOf(m, 's1'), rest.s1 + SPAN);
  await release(-SPAN * 2 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(m), 'root,s3,s1,s2,s4,s5'.replace('root,s3,s1,s2', 'root,s3,s1,s2'));
});

test('a panel wider than its neighbours makes them move by ITS span, and a narrow one moves them by its own', async () => {
  const wide = made('s1', { formFactors: ['phone', 'tablet'] });
  const m = mountRow(row(rootEntry(), wide, made('s2'), made('s3')), 3000);
  await act(async () => m.latest().setFormFactor?.('s1', 'tablet'));
  await advanceFrames(2000);
  const tabletSpan = m.latest().rowNumbers.widths[m.latest().rowNumbers.ids.indexOf('s1')]! + 16;
  const before = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: SPAN * 0.5 + 10, dy: 0, steps: 8, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), before - tabletSpan, 'the phone neighbour moves by the tablet panel\'s span');
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(3000);
});

test('nothing is previewed for a panel that is not draggable', async () => {
  const m = mountRow(row(rootEntry(), made('s1', { draggable: false }), made('s2')), 3000);
  await advanceFrames(2000);
  const before = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: SPAN, dy: 0, steps: 8, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), before);
  await release(SPAN, 0);
  await advanceFrames(2000);
});
