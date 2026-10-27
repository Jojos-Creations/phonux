/**
 * A released drag that reorders keeps the dragged panel where the pointer left it and glides it into its new slot, with Reduce Motion off:
 * the slot is set at its new rest at once and the box springs from the offset that keeps the panel on screen where it was.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { DragToClose, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
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

// How the host answers the drop: moves the panel, moves it inside flushSync, or ignores it.
let host: 'move' | 'flush' | 'refuse' = 'move';
function View({ id }: { id: string }): React.ReactElement {
  const { panels } = useHost();
  const stepsFor = usePanelReorderSteps();
  return React.createElement(DragToClose, {
    reorder: {
      onDragEnd: (offset: number) => {
        if (host === 'refuse' || stepsFor(offset) <= 0) return;
        if (host === 'flush') flushSync(() => void panels.move(id, 'right'));
        else panels.move(id, 'right');
      },
    },
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
registerTestView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const boxOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!;
const slotOf = (container: HTMLElement, id: string): HTMLElement => boxOf(container, id).closest<HTMLElement>('[data-row-slot]')!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0));
const boxX = (container: HTMLElement, id: string): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(boxOf(container, id).style.transform)?.[1] ?? 0);
const SPAN = 406;
const order = (m: ReturnType<typeof mountRow>): string => m.latest().entries.map((p) => p.id).join(',');


const visualX = (container: HTMLElement, id: string): number => xOf(container, id) + boxX(container, id);

async function dragAndRelease(dx: number, mode: typeof host = 'move') {
  host = mode;
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's1');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(2000);
  await release(dx, 0);
  return { m, rest };
}

for (const mode of ['move', 'flush'] as const) {
  test(`${mode}: a hopped release keeps the panel where it was dropped on the first frame, then glides it to the new slot`, async () => {
    const { m, rest } = await dragAndRelease(213, mode);
    assert.equal(order(m), 'root,s2,s1,s3');
    await advanceFrames(FRAME_MS);
    assert.ok(Math.abs(visualX(m.container, 's1') - (rest + 213)) < 60, `first frame near the drop point, at ${visualX(m.container, 's1') - rest} from its old slot`);
    const seen: number[] = [];
    for (let frame = 0; frame < 120; frame += 1) {
      await advanceFrames(FRAME_MS);
      seen.push(visualX(m.container, 's1'));
    }
    assert.ok(seen.some((v) => v > rest + 213 + 20 && v < rest + SPAN - 20), 'it passes through the distance between the drop point and the new slot');
    assert.equal(visualX(m.container, 's1'), rest + SPAN);
    assert.equal(boxX(m.container, 's1'), 0);
    assert.equal(xOf(m.container, 's1'), rest + SPAN);
  });
}

test('Reduce Motion lands the dropped panel in its new slot at once', async () => {
  reduceMotion(true);
  const { m, rest } = await dragAndRelease(213);
  await advanceFrames(FRAME_MS);
  assert.equal(xOf(m.container, 's1'), rest + SPAN);
  assert.equal(boxX(m.container, 's1'), 0);
});

test('a release just under the hop point springs the box home in its own slot', async () => {
  const { m, rest } = await dragAndRelease(SPAN * 0.5 - 6);
  assert.equal(order(m), 'root,s1,s2,s3');
  await advanceFrames(FRAME_MS);
  assert.ok(Math.abs(boxX(m.container, 's1')) > 1, 'the box is still on its way, one frame after the release');
  await advanceFrames(2000);
  assert.equal(boxX(m.container, 's1'), 0);
  assert.equal(xOf(m.container, 's1'), rest);
});
