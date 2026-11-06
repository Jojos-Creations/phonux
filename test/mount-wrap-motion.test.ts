/**
 * The app's `MotionConfig` placed in `wrap` reaches the row's slots: the panels that make room for a dragged one snap, as they do
 * under the system's Reduce Motion. The row is drawn inside the wrap exactly as the mount draws it. Motion reads the preference
 * once, so this file is the process's first caller.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import type { WorkspaceWrapProps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(cleanup);

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ media: query, matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});

function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: { onDragEnd: (offset: number) => void (stepsFor(offset) > 0 && panels.move(id, 'right')) },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

/** An app's wrap: reduced motion for everything under it. */
const appWrap = ({ children }: WorkspaceWrapProps): React.ReactElement => React.createElement(MotionConfig, { reducedMotion: 'always' }, children);

const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!.closest<HTMLElement>('[data-row-slot]')!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0));
const SPAN = 406;

async function neighbourAfterHop(wrapped: boolean): Promise<{ rest: number; x: number }> {
  const around = wrapped ? (row: React.ReactElement) => React.createElement(appWrap, { workspace: undefined as never, children: row }) : (row: React.ReactElement) => row;
  const m = mountRow(panelsOf(3), 3000, {}, around);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's2');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(32);
  const x = xOf(m.container, 's2');
  await release(213, 0);
  await advanceFrames(100);
  return { rest, x };
}

test('a MotionConfig in the wrap makes the neighbour of a dragged slot snap aside, and without it the neighbour is still sliding', async () => {
  const reduced = await neighbourAfterHop(true);
  assert.equal(reduced.x, reduced.rest - SPAN, 'snapped on the frames after the hop point');
  cleanup();
  const eased = await neighbourAfterHop(false);
  assert.notEqual(eased.x, eased.rest - SPAN, 'control: without the wrap it has not arrived yet');
});
