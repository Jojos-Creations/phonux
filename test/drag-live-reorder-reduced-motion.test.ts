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

test('a neighbour snaps aside on the frame after the hop point, snaps back when the pointer returns, and the drop moves nobody', async () => {
  reduceMotion(true);
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  const rest = xOf(m.container, 's2');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(32);
  assert.equal(xOf(m.container, 's2'), rest - SPAN, 'no slide: it is already there two frames later');
  assert.equal(slotOf(m.container, 's1').style.zIndex, '3');
  await act(async () => {
    const event = new MouseEvent('pointermove', { bubbles: true, clientX: 130, clientY: 100, buttons: 1 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(32);
  assert.equal(xOf(m.container, 's2'), rest, 'and back at once when the pointer is');
  await act(async () => {
    const event = new MouseEvent('pointermove', { bubbles: true, clientX: 100 + 213, clientY: 100, buttons: 1 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(32);
  await release(213, 0);
  await advanceFrames(16);
  assert.equal(m.latest().entries.map((p) => p.id).join(','), 'root,s2,s1,s3');
  assert.equal(xOf(m.container, 's2'), rest - SPAN, 'the drop moves nobody');
  assert.equal(xOf(m.container, 's1'), rest, 'the dragged slot is at its new rest on the next frame, not sliding to it');
  await advanceFrames(100);
  assert.equal(slotOf(m.container, 's1').style.zIndex, '1');
});

async function dropOnto(m: ReturnType<typeof mountRow>): Promise<void> {
  await advanceFrames(2000);
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(32);
  await release(213, 0);
}

test('under StrictMode the drop still lands the dragged slot at its new rest in the commit that moves it', async () => {
  reduceMotion(true);
  const m = mountRow(panelsOf(3), 3000, {}, (row) => React.createElement(React.StrictMode, null, row));
  const rest = xOf(m.container, 's1');
  await dropOnto(m);
  assert.equal(m.latest().entries.map((p) => p.id).join(','), 'root,s2,s1,s3');
  assert.equal(xOf(m.container, 's1'), rest + SPAN, 'at the new rest in the commit that moves it, not a frame later');
  assert.equal(xOf(m.container, 's2'), rest, 'the crossed neighbour stays where it moved to');
});

test('the app\'s MotionConfig alone also snaps the neighbour, with the system preference off', async () => {
  reduceMotion(false);
  const m = mountRow(panelsOf(3), 3000, {}, (row) => React.createElement(MotionConfig, { reducedMotion: 'always' }, row));
  await advanceFrames(2000);
  const rest = xOf(m.container, 's2');
  await drag(m.container.querySelector<HTMLElement>('[data-grab="s1"]')!, { dx: 213, dy: 0, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(32);
  assert.equal(xOf(m.container, 's2'), rest - SPAN);
  await release(213, 0);
  await advanceFrames(100);
});

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
