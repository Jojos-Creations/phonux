/**
 * Under Reduce Motion the panels a sideways drag makes room among move straight to their slots, since a slide while the
 * pointer is held carries no information. Motion reads the preference once, so this file is the process's first caller.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';
import { slotTransform } from './support/strip.js';

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
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!.closest<HTMLElement>('[data-row-slot]')!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotTransform(slotOf(container, id)))?.[1] ?? 0));
const SPAN = 406;

async function dropOnto(m: ReturnType<typeof mountRow>): Promise<void> {
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(32);
  await release(213, 0);
}

test('Reduce Motion leaves a move nobody is dragging a slide', async () => {
  reduceMotion(true);
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const from = xOf(m.container, 's1');
  act(() => void m.latest().move('s1', 'right'));
  await advanceFrames(2);
  const mid = xOf(m.container, 's1');
  assert.ok(mid !== from, 'it has begun to move');
  await advanceFrames(100);
  const end = xOf(m.container, 's1');
  assert.ok(end !== from && mid !== end, 'it is not there yet');
});
