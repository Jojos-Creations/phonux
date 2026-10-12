/**
 * The live reorder under reduced motion: Motion reads the preference once, so this file is the process's first caller.
 * The neighbour is still shifted (by its usual slide) while the drag is held, and the raise ends at the release because no spring runs.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DragToClose, registerView, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: query.includes('prefers-reduced-motion'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
});

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

test('under reduced motion the neighbour makes room while the drag is held and the raise ends at the release', async () => {
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's2');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(2000);
  assert.equal(xOf(m.container, 's2'), rest - 406);
  assert.equal(slotOf(m.container, 's1').style.zIndex, '3');
  await release(213, 0);
  await advanceFrames(100);
  assert.equal(slotOf(m.container, 's1').style.zIndex, '1');
  assert.equal(m.latest().entries.map((p) => p.id).join(','), 'root,s2,s1,s3');
  assert.equal(xOf(m.container, 's2'), rest - 406, 'the drop moves nobody');
});
