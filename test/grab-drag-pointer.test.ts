/**
 * A grab-handle drag follows the pointer up and down, can opt out of close-on-release, reports the pointer to the app
 * (onDragMove, onDragEnd) and lifts its slot above the row's others until it settles. Run through dnd-kit's pointer sensor
 * and motion's springs on the virtual frame clock; the box's drawn offset is read from its transform, since jsdom has no layout.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, usePanelDragProps } from '../index.js';
import type { GrabDragEnd, GrabDragMove } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, flick, release } from './support/drag-gesture.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

afterEach(() => cleanup());

type Options = Partial<React.ComponentProps<typeof DragToClose>>;

function mountBox(options: Options = {}) {
  const mounted = mount(
    React.createElement(DragToClose, {
      ...options,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]');
  assert.ok(handle, 'the handle rendered');
  const box = handle.closest<HTMLElement>('[data-drag-to-close]');
  assert.ok(box, 'the handle sits in a drag box');
  return { handle, box };
}
const translateY = (el: HTMLElement): number => {
  const match = /translateY\((-?[\d.e+-]+)px\)/.exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

test('the box follows the pointer down and up, and springs home on release', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: 50, steps: 5, hold: 4, keepDown: true });
  assert.ok(translateY(box) > 40, `down: the box followed the pointer, at ${translateY(box)} px`);
  await release(0, 50);
  await advanceFrames(2000);
  assert.ok(Math.abs(translateY(box)) < 1, 'a short drag down springs home');
  await drag(handle, { dx: 0, dy: -120, steps: 6, hold: 4, keepDown: true });
  assert.ok(translateY(box) < -110, `up: the box followed the pointer, at ${translateY(box)} px`);
  await release(0, -120);
  await advanceFrames(2000);
  assert.ok(Math.abs(translateY(box)) < 1, 'a drag up springs home');
});

test('the pointer can cross from below the press to above it in one drag', async () => {
  const { handle, box } = mountBox();
  await drag(handle, { dx: 0, dy: 90, steps: 6, hold: 2, keepDown: true });
  assert.ok(translateY(box) > 80);
  await act(async () => {
    document.dispatchEvent(Object.assign(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 100 - 70, buttons: 1 }), { pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  });
  await advanceFrames(100);
  assert.ok(translateY(box) < -60, `the box went above its rest with the pointer, at ${translateY(box)} px`);
  await release(0, -70);
  await advanceFrames(2000);
});

test('with closeOnRelease off a release anywhere springs back and closes nothing; the same drags close by default', async () => {
  const closes: number[] = [];
  const kept = mountBox({ onClose: () => closes.push(1), closeOnRelease: false });
  await drag(kept.handle, { dx: 0, dy: 300, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'a long release at rest closes nothing');
  assert.ok(Math.abs(translateY(kept.box)) < 1, 'and the box is back at rest');
  await flick(kept.handle, { dy: 200, moves: 3, gapMs: 10 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'a fast flick closes nothing');
  await drag(kept.handle, { dx: 0, dy: -200, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'a release above closes nothing');
  assert.ok(Math.abs(translateY(kept.box)) < 1, 'the box is back at rest after each');
  cleanup();

  const controlCloses: number[] = [];
  const control = mountBox({ onClose: () => controlCloses.push(2) });
  await drag(control.handle, { dx: 0, dy: 300, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(controlCloses, [2], 'the identical drag closes when closeOnRelease is left at its default');
});

test('with closeOnRelease explicitly true the drag-down close rule is the one it always was', async () => {
  const closes: number[] = [];
  const { handle } = mountBox({ onClose: () => closes.push(1), closeOnRelease: true });
  await drag(handle, { dx: 0, dy: 60, steps: 3, hold: 8 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], '60 px at rest is under the 80 px minimum');
  await drag(handle, { dx: 0, dy: -300, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [], 'a long drag up never closes');
  await drag(handle, { dx: 0, dy: 200, steps: 5, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(closes, [1], 'a long drag down closes');
});

test('onDragMove reports the pointer on every move of the drag, and onDragEnd where it let go', async () => {
  const moves: GrabDragMove[] = [];
  const ends: GrabDragEnd[] = [];
  const { handle } = mountBox({ onDragMove: (m) => void moves.push(m), onDragEnd: (e) => void ends.push(e), closeOnRelease: false });
  await drag(handle, { dx: 30, dy: -100, steps: 5, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(
    moves,
    [1, 2, 3, 4, 5].map((k) => ({ x: 6 * k, y: -20 * k, clientX: 100 + 6 * k, clientY: 100 - 20 * k })),
    'one report per pointer move, each the offset from the press and the viewport position of that move',
  );
  assert.deepEqual(ends, [{ offsetX: 30, offsetY: -100, clientX: 130, clientY: 0 }], 'one report at release, matching the last move');
});

test('onDragEnd arrives before the sideways report and before the close; a press that never became a drag reports nothing', async () => {
  const order: string[] = [];
  const moves: GrabDragMove[] = [];
  const { handle } = mountBox({
    onClose: () => order.push('close'),
    reorder: { onDragEnd: () => void order.push('reorder') },
    onDragMove: (m) => void moves.push(m),
    onDragEnd: () => void order.push('end'),
  });
  await drag(handle, { dx: 2, dy: 2, steps: 1, hold: 1 });
  await advanceFrames(500);
  assert.deepEqual([order, moves], [[], []], 'a 2 px slip is a click, not a drag');
  await drag(handle, { dx: 120, dy: 0, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(order, ['end', 'reorder'], 'a sideways drag reports its pointer first');
  order.length = 0;
  await drag(handle, { dx: 0, dy: 300, steps: 6, hold: 4 });
  await advanceFrames(2000);
  assert.deepEqual(order, ['end', 'close'], 'a drag down reports its pointer before the close');
});

test('a press that moved just under the direction lock reports neither a move nor a release', async () => {
  const seen: string[] = [];
  const { handle } = mountBox({ onDragMove: () => void seen.push('move'), onDragEnd: () => void seen.push('end') });
  await drag(handle, { dx: 7.995, dy: 0, steps: 1, hold: 2 });
  await advanceFrames(500);
  assert.deepEqual(seen, [], 'the sensor may start under 8 px, but the gesture has not started');
});

test('a cancelled gesture reports no release', async () => {
  const ends: GrabDragEnd[] = [];
  const { handle } = mountBox({ onDragEnd: (e) => void ends.push(e) });
  await drag(handle, { dx: 0, dy: 80, steps: 4, hold: 2, keepDown: true });
  await act(async () => {
    const event = new MouseEvent('pointercancel', { bubbles: true, cancelable: true, clientX: 100, clientY: 180, button: 0 });
    for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'touch', isPrimary: true })) Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
  });
  await advanceFrames(2000);
  assert.deepEqual(ends, []);
});

// In a row: the slot is its own stacking context, so the lift is on the slot's z.
function GrabView({ id }: { id: string }): React.ReactElement {
  const { onClose } = usePanelDragProps();
  return React.createElement(DragToClose, {
    ...(onClose === undefined ? {} : { onClose }),
    closeOnRelease: !optOut.on,
    children: (handle) => React.createElement('div', { 'data-grab': id, onPointerDown: handle.onPointerDown }, id),
  });
}
const optOut = { on: false };
registerTestView('scroll-row-view', ({ panel }) => React.createElement(GrabView, { id: panel.id }));

const grabOf = (m: MountedRow, id: string): HTMLElement => {
  const grab = m.container.querySelector<HTMLElement>(`[data-grab="${id}"]`);
  assert.ok(grab, `${id} rendered`);
  return grab;
};
const slotOf = (m: MountedRow, id: string): HTMLElement => {
  const slot = grabOf(m, id).closest<HTMLElement>('[data-row-slot]');
  assert.ok(slot, `${id} sits in a slot`);
  return slot;
};
const zOf = (m: MountedRow, id: string): string => slotOf(m, id).style.zIndex;

test('a dragged slot is drawn above its neighbours while it is held, vertically as well as sideways, and returns to its layer after it settles', async () => {
  optOut.on = true;
  const m = mountRow(panelsOf(3), 3000);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's2'), '1', 'at rest a panel is on the base layer');
  await drag(grabOf(m, 's2'), { dx: 0, dy: -120, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(200);
  assert.equal(zOf(m, 's2'), '3', 'dragged up: above the row');
  assert.equal(zOf(m, 's1'), '1', 'a neighbour keeps its layer');
  assert.equal(zOf(m, 's3'), '1');
  await release(0, -120);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's2'), '1', 'back on the base layer once the spring home ends');
  await drag(grabOf(m, 's2'), { dx: 0, dy: 120, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(200);
  assert.equal(zOf(m, 's2'), '3', 'dragged down: above the row');
  await release(0, 120);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's2'), '1');
});

test('a raised panel dragged keeps at least the dragged layer, and an opted-out release closes nothing in a row while the default still does', async () => {
  optOut.on = true;
  const m = mountRow(row(rootEntry(), made('s1'), made('s2', { layer: 'raised' })), 3000);
  await advanceFrames(2000);
  assert.equal(zOf(m, 's2'), '2');
  await drag(grabOf(m, 's2'), { dx: 0, dy: 300, steps: 6, hold: 4, keepDown: true });
  await advanceFrames(200);
  assert.equal(zOf(m, 's2'), '3');
  await release(0, 300);
  await advanceFrames(3000);
  assert.deepEqual(m.live(), ['s1', 's2'], 'opted out: nothing closed');
  assert.equal(zOf(m, 's2'), '2', 'and the raised layer is back');

  optOut.on = false;
  m.rerender(3001);
  await advanceFrames(100);
  await drag(grabOf(m, 's2'), { dx: 0, dy: 300, steps: 6, hold: 4 });
  await advanceFrames(3000);
  assert.deepEqual(m.live(), ['s1'], 'default: the same drag closes it');
});
