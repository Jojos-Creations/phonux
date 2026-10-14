/**
 * A hopped drop re-inserts the dragged panel's DOM node and no crossed neighbour's, whichever way it was dragged: a re-inserted node
 * restarts what it holds (a web view reloads). Mutant: rendering the row in plain order in PanelRow.tsx fails the leftward case.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => {
  cleanup();
  reduceMotion(false);
});

// Motion reads the query once and then follows its 'change' event, so the stub exists before the first mount and the test flips it.
const reduced = { matches: false, listeners: new Set<() => void>() };
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    media: query,
    get matches() {
      return reduced.matches;
    },
    addEventListener: (_type: string, listener: () => void) => void reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void reduced.listeners.delete(listener),
  }),
});
function reduceMotion(on: boolean): void {
  reduced.matches = on;
  for (const listener of [...reduced.listeners]) listener();
}


function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        const steps = stepsFor(offset);
        if (steps !== 0) panels.move(id, steps < 0 ? 'left' : 'right');
      },
    },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const boxOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!;
const slotOf = (container: HTMLElement, id: string): HTMLElement => boxOf(container, id).parentElement!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0));
const boxX = (container: HTMLElement, id: string): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(boxOf(container, id).style.transform)?.[1] ?? 0);
const SPAN = 406;


/** Ids of the row slots the browser is asked to insert while `during` runs. */
async function insertedDuring(during: () => Promise<void>): Promise<string[]> {
  const inserted: string[] = [];
  const { insertBefore, appendChild } = Node.prototype;
  const note = (node: Node): void => {
    const id = node instanceof HTMLElement ? node.dataset.rowId : undefined;
    if (id !== undefined) inserted.push(id);
  };
  Node.prototype.insertBefore = function insert<T extends Node>(this: Node, node: T, before: Node | null): T {
    note(node);
    return insertBefore.call(this, node, before) as T;
  };
  Node.prototype.appendChild = function append<T extends Node>(this: Node, node: T): T {
    note(node);
    return appendChild.call(this, node) as T;
  };
  try {
    await during();
  } finally {
    Node.prototype.insertBefore = insertBefore;
    Node.prototype.appendChild = appendChild;
  }
  return inserted;
}

for (const [dx, from, order] of [
  [-213, 's3', 'root,s1,s3,s2'],
  [213, 's1', 'root,s2,s1,s3'],
] as const) {
  test(`a drop of ${from} ${dx < 0 ? 'left' : 'right'} re-inserts only ${from}'s node`, async () => {
    const m = mountRow(panelsOf(3), 3000);
    await advanceFrames(2000);
    await drag(m.container.querySelector<HTMLElement>(`[data-grab="${from}"]`)!, { dx, dy: 0, steps: 6, hold: 4, keepDown: true });
    await advanceFrames(2000);
    const inserted = await insertedDuring(async () => {
      await release(dx, 0);
      await advanceFrames(2000);
    });
    assert.equal(m.latest().entries.map((p) => p.id).join(','), order);
    assert.ok(inserted.every((id) => id === from), `inserted ${inserted.join(',')}`);
    assert.equal(
      [...m.container.querySelectorAll<HTMLElement>('[data-row-id]')].map((n) => n.dataset.rowId).join(','),
      order,
      'the row is back in reading order once the drag is over',
    );
  });
}
