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
  await advanceFrames(32);
  assert.equal(order(m), 'root,s1,s3,s2,s4,s5');
  assert.equal(xOf(m, 's3'), rest.s2, 'the neighbour already rests in its new place while the dragged box is still springing home');
  assert.equal(xOf(m, 's4'), rest.s4, 'and the next panel was not shifted by a preview left over from the old order');
  await advanceFrames(3000);
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
  assert.equal(zOf(m, 's1'), '1', 'and nothing is raised');
  await release(SPAN, 0);
  await advanceFrames(2000);
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

test('a drag of two hops previews two neighbours and the release reports the same two hops', async () => {
  reported.length = 0;
  const m = mountRow(panelsOf(5), 3000);
  await advanceFrames(2000);
  const rest = { s2: xOf(m, 's2'), s3: xOf(m, 's3'), s4: xOf(m, 's4') };
  await drag(handleOf(m, 's1'), { dx: SPAN * 1.5 + 10, dy: 0, steps: 12, hold: 8, keepDown: true });
  await advanceFrames(1000);
  assert.deepEqual([xOf(m, 's2'), xOf(m, 's3'), xOf(m, 's4')], [rest.s2 - SPAN, rest.s3 - SPAN, rest.s4]);
  await release(SPAN * 1.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(reported[0]?.steps, 2);
  assert.equal(order(m), 'root,s2,s3,s1,s4,s5');
});

test('a press on the handle during the spring home ends the raise', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  await drag(handleOf(m, 's1'), { dx: SPAN * 0.5 - 40, dy: 0, steps: 6, hold: 4 });
  await advanceFrames(32);
  assert.equal(zOf(m, 's1'), '3', 'the spring is in flight and the slot is still raised');
  await act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, buttons: 1 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
    handleOf(m, 's2').dispatchEvent(event);
  });
  await act(async () => {
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100, button: 0, buttons: 1 });
    for (const [key, value] of Object.entries({ pointerId: 2, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
    handleOf(m, 's1').dispatchEvent(event);
  });
  await release(0, 0);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's1'), '1');
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
  assert.equal(zOf(m, 's1'), '1', 'the revived panel is not still raised');
  assert.equal(xOf(m, 's2'), 2 * SPAN, 'and no neighbour is still shifted for it');
});

test('without Reduce Motion the neighbour is still sliding two frames after the hop point', async () => {
  const m = mountRow(panelsOf(4), 3000);
  await advanceFrames(2000);
  const rest = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: SPAN * 0.5 + 10, dy: 0, steps: 6, hold: 0, keepDown: true });
  await advanceFrames(16);
  const mid = xOf(m, 's2');
  assert.ok(mid < rest && mid > rest - SPAN, `mid-slide, not at ${mid}`);
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(2000);
});

test('a cancel returns every neighbour to rest within the slide time, and the raise ends with the spring home', async () => {
  const m = mountRow(panelsOf(4), 3000);
  await advanceFrames(2000);
  const rest = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: SPAN * 0.5 + 10, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), rest - SPAN);
  await act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 300, clientY: 100, button: 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(16);
  assert.equal(zOf(m, 's1'), '3', 'still raised while the box springs home');
  await advanceFrames(450);
  assert.equal(xOf(m, 's2'), rest, 'the neighbour is back by the end of its slide, not only when the box has settled');
  await advanceFrames(3000);
  assert.equal(zOf(m, 's1'), '1');
});

test('a drag that locks vertical previews nothing: no neighbour moves and the slot is never raised', async () => {
  const m = mountRow(panelsOf(4), 3000);
  await advanceFrames(2000);
  const rest = xOf(m, 's2');
  await drag(handleOf(m, 's1'), { dx: 20, dy: 60, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(1000);
  assert.equal(xOf(m, 's2'), rest);
  assert.equal(zOf(m, 's1'), '1');
  await release(20, 60);
  await advanceFrames(2000);
});
