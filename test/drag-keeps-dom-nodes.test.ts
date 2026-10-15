/**
 * A drag reorders the row without moving any panel's DOM node: a web view inside a panel survives the drop, so every
 * panel's node is the same element, in the same DOM position, before the drag, during it and after the drop.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

function DraggableView({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        const steps = stepsFor(offset);
        for (let k = 0; k < Math.abs(steps); k += 1) panels.move(id, steps > 0 ? 'right' : 'left');
      },
    },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(DraggableView, { id: panel.id }));

const nodes = (m: MountedRow): Map<string, Element> => new Map([...m.container.querySelectorAll('[data-grab]')].map((el) => [el.getAttribute('data-grab')!, el]));
/** The panels' nodes in DOM order. React moves a node exactly when a reorder changes this sequence. */
const domOrder = (m: MountedRow): string[] => [...m.container.querySelectorAll('[data-grab]')].map((el) => el.getAttribute('data-grab')!);
const handleOf = (m: MountedRow, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!;

for (const [name, from, dx] of [
  ['left', 's3', -420],
  ['right', 's1', 420],
] as const) {
  test(`dragging a panel ${name} moves no panel's DOM node, through the drag and the drop`, async () => {
    const m = mountRow(panelsOf(5), 3000);
    await advanceFrames(2000);
    const before = nodes(m);
    const startDomOrder = domOrder(m);
    const startOrder = m.latest().entries.map((p) => p.id).join(',');
    await drag(handleOf(m, from), { dx, dy: 0, steps: 12, hold: 8, keepDown: true });
    await advanceFrames(500);
    for (const [id, el] of nodes(m)) assert.equal(before.get(id), el, `${id} node kept during the drag`);
    assert.deepEqual(domOrder(m), startDomOrder, 'no panel node moved during the drag');
    await release(dx, 0);
    await advanceFrames(2000);
    for (const [id, el] of nodes(m)) assert.equal(before.get(id), el, `${id} node kept after the drop`);
    assert.deepEqual(domOrder(m), startDomOrder, 'no panel node moved in the DOM at the drop');
    assert.notEqual(m.latest().entries.map((p) => p.id).join(','), startOrder, 'the drop changed the order');
  });
}
