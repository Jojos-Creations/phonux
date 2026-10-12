/**
 * A released drag that reorders puts the box in its new slot at once, with Reduce Motion off: no slide, no spring from the old slot.
 * Mutants: dropping `hopped` in dragToClose.tsx leaves the box springing (the box-translate assertions fail); dropping `dragged`
 * in PanelRowSlot.tsx leaves the slot sliding (the slot assertions fail); always jumping fails 'springs home'.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { flushSync } from 'react-dom';
import { DragToClose, registerView, useHost, usePanelReorderSteps } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { FRAME_MS } from './support/jsdom-globals.js';
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
registerView('scroll-row-view', ({ panel }) => React.createElement(View, { id: panel.id }));

const boxOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-grab="${id}"]`)!.closest<HTMLElement>('[data-drag-to-close]')!;
const slotOf = (container: HTMLElement, id: string): HTMLElement => boxOf(container, id).parentElement!;
const xOf = (container: HTMLElement, id: string): number => Math.round(Number(/translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(container, id).style.transform)?.[1] ?? 0));
const boxX = (container: HTMLElement, id: string): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(boxOf(container, id).style.transform)?.[1] ?? 0);
const SPAN = 406;
const order = (m: ReturnType<typeof mountRow>): string => m.latest().entries.map((p) => p.id).join(',');

async function dragAndRelease(dx: number, mode: typeof host = 'move') {
  host = mode;
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's1');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(2000);
  assert.ok(Math.abs(boxX(m.container, 's1') - dx) < 1, 'the box follows the pointer');
  await release(dx, 0);
  return { m, rest };
}

for (const mode of ['move', 'flush'] as const) {
  test(`${mode}: a hopped release lands box and slot at the new rest on the first frames, with nothing sliding or springing`, async () => {
    const { m, rest } = await dragAndRelease(213, mode);
    assert.equal(order(m), 'root,s2,s1,s3');
    await advanceFrames(FRAME_MS);
    for (let frame = 0; frame < 3; frame += 1) {
      assert.equal(xOf(m.container, 's1'), rest + SPAN, `slot at its new rest, frame ${frame}`);
      assert.equal(boxX(m.container, 's1'), 0, `box at 0 in its new slot, frame ${frame}`);
      assert.equal(xOf(m.container, 's2'), rest, `crossed neighbour stays, frame ${frame}`);
      await advanceFrames(FRAME_MS);
    }
  });
}

test('a release just over the hop point jumps, just under it springs home', async () => {
  const over = await dragAndRelease(SPAN * 0.5 + 6);
  assert.equal(order(over.m), 'root,s2,s1,s3');
  assert.equal(boxX(over.m.container, 's1'), 0);
  cleanup();
  const { m, rest } = await dragAndRelease(SPAN * 0.5 - 6);
  assert.equal(order(m), 'root,s1,s2,s3');
  await advanceFrames(FRAME_MS);
  assert.ok(Math.abs(boxX(m.container, 's1')) > 1, 'the box is still on its way, one frame after the release');
  const seen: number[] = [];
  for (let frame = 0; frame < 120; frame += 1) {
    await advanceFrames(FRAME_MS);
    seen.push(Math.abs(boxX(m.container, 's1')));
  }
  assert.ok(seen.some((v) => v > 0.5), 'it takes more than one frame');
  assert.equal(seen[seen.length - 1], 0);
  assert.equal(xOf(m.container, 's1'), rest);
});

test('a host that refuses the move: the previewed hop jumps the box back to its old slot, with no spring', async () => {
  const { m, rest } = await dragAndRelease(213, 'refuse');
  await advanceFrames(FRAME_MS);
  assert.equal(order(m), 'root,s1,s2,s3');
  assert.equal(boxX(m.container, 's1'), 0);
  assert.equal(xOf(m.container, 's1'), rest);
  await advanceFrames(2000);
  assert.equal(xOf(m.container, 's2'), rest + SPAN, 'the neighbour is back too');
});

test('Reduce Motion lands the same way', async () => {
  reduceMotion(true);
  const { m, rest } = await dragAndRelease(213);
  await advanceFrames(FRAME_MS);
  assert.equal(xOf(m.container, 's1'), rest + SPAN);
  assert.equal(boxX(m.container, 's1'), 0);
});
