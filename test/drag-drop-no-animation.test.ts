/** A released drag that reorders puts the box in its new slot at once, with Reduce Motion off: no slide, no spring from the old slot. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, registerView, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

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
    reorder: { onDragEnd: (offset: number) => void (stepsFor(offset) > 0 && panels.move(id, 'right')) },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!.parentElement!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0));
const SPAN = 406;


test('the drop lands the dragged box in its new slot at once; the neighbours made room by sliding and stay put', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's1');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(2);
  assert.ok(xOf(m.container, 's2') > rest, 'the neighbour slides, not snaps, while the pointer is held');
  await advanceFrames(2000);
  await release(213, 0);
  await advanceFrames(2);
  assert.equal(m.latest().entries.map((p) => p.id).join(','), 'root,s2,s1,s3');
  assert.equal(xOf(m.container, 's1'), rest + SPAN, 'the slot is at its new rest on the next frames, not sliding to it');
  assert.equal(xOf(m.container, 's2'), rest, 'the crossed neighbour stays where it moved to');
});

test('a release that hops nowhere still springs the box home', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's1');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 40, dy: 0, steps: 6, hold: 4, keepDown: true });
  await release(40, 0);
  await advanceFrames(100);
  assert.equal(xOf(m.container, 's1'), rest);
});
