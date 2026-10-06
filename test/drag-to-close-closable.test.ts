/**
 * DragToClose against the slot it sits in: the close rule and the direction lock, the snap-back spring and the exit
 * seconds read from the slot's tuning (the library defaults outside a row), an onClose that may be absent, and a
 * closability that is read again at the release and when the exit animation ends. The gesture runs through
 * motion's real drag machinery on the virtual frame clock, so a frame count is a time.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { DRAG_CLOSE, DragToClose, LIBRARY_TUNING_DEFAULTS, resolvePanelSettings } from '../index.js';
import type { ReorderHandle } from '../index.js';
import { shouldCloseOnRelease } from '../dragToClose.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning, type SlotTuning } from '../panelTuning.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';

afterEach(() => cleanup());

const DEFAULT_SLOT = resolvePanelSettings().value;
const slotValue = (closable: boolean, tuning: Partial<SlotTuning>): PanelSlotValue => ({
  collapsible: true,
  closable,
  draggable: true,
  placeable: true,
  resizable: true,
  formFactors: DEFAULT_SLOT.formFactors,
  neighborWidths: { left: [], right: [] },
  pinned: false,
  tuning: { ...slotTuning(LIBRARY_TUNING_DEFAULTS, undefined), ...tuning },
});

type Rule = { distanceFraction: number; minDistancePx: number; flickVelocity: number; flickMinDistancePx: number; cancelVelocity: number };

interface Setup {
  onClose?: () => void;
  reorder?: ReorderHandle;
  /** Omitted: no slot above the box, as outside a row. */
  slot?: { closable?: boolean; tuning?: Partial<SlotTuning> };
}
const boxUi = (setup: Setup): React.ReactElement => {
  const box = React.createElement(
    'div',
    { 'data-scroller': '', style: { overflowY: 'auto' } },
    React.createElement(DragToClose, {
      onClose: setup.onClose,
      reorder: setup.reorder,
      children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
    }),
  );
  return setup.slot === undefined ? box : React.createElement(PanelSlotContext.Provider, { value: slotValue(setup.slot.closable ?? true, setup.slot.tuning ?? {}), children: box });
};
function mountBox(setup: Setup) {
  const mounted = mount(boxUi(setup));
  const part = (selector: string): HTMLElement => {
    const el = mounted.container.querySelector<HTMLElement>(selector);
    assert.ok(el, `${selector} rendered`);
    return el;
  };
  return {
    mounted,
    box: part('[data-drag-to-close]'),
    handle: part('[data-handle]'),
    scroller: part('[data-scroller]'),
    update: (next: Setup) => mounted.rerender(boxUi(next)),
  };
}
const axis = (el: HTMLElement, name: 'X' | 'Y'): number => {
  const match = new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};
const frames = (n: number): Promise<void> => advanceFrames(n * 16);

// ---------------------------------------------------------------------------
// The close rule
// ---------------------------------------------------------------------------

test('DRAG_CLOSE still carries the five release numbers, the exit seconds and the spring the app pins', () => {
  assert.deepEqual([DRAG_CLOSE.distanceFraction, DRAG_CLOSE.minDistancePx, DRAG_CLOSE.flickVelocity, DRAG_CLOSE.flickMinDistancePx, DRAG_CLOSE.cancelVelocity], [0.25, 80, 700, 40, -300]);
  assert.equal(DRAG_CLOSE.exitSeconds, 0.18);
  assert.deepEqual({ ...DRAG_CLOSE.snapBack }, { type: 'spring', stiffness: 520, damping: 42 });
});

test('shouldCloseOnRelease: each of the five numbers it reads moves its boundary at literal offsets, and no argument is DRAG_CLOSE', () => {
  const close = (offsetY: number, velocityY: number, height: number, rule?: Partial<Rule>): boolean => shouldCloseOnRelease({ offsetY, velocityY, height }, rule === undefined ? undefined : { ...DRAG_CLOSE, ...rule });
  // distanceFraction: 0.5 of a 700 px box is 350 px; the default quarter is 175.
  assert.equal(close(349, 0, 700, { distanceFraction: 0.5 }), false);
  assert.equal(close(350, 0, 700, { distanceFraction: 0.5 }), true);
  assert.equal(close(175, 0, 700), true);
  assert.equal(close(349, 0, 700), true, 'the default quarter has already closed at 349');
  // minDistancePx: on a 200 px box the fraction gives 50, so the minimum decides.
  assert.equal(close(100, 0, 200), true);
  assert.equal(close(100, 0, 200, { minDistancePx: 120 }), false);
  assert.equal(close(120, 0, 200, { minDistancePx: 120 }), true);
  // flickVelocity: a 50 px flick at 800 px/s closes by default and not when 1000 is asked.
  assert.equal(close(50, 800, 700), true);
  assert.equal(close(50, 800, 700, { flickVelocity: 1000 }), false);
  assert.equal(close(50, 1000, 700, { flickVelocity: 1000 }), true);
  // flickMinDistancePx: a 50 px flick at 900 px/s closes by default and not when 60 is asked.
  assert.equal(close(50, 900, 700), true);
  assert.equal(close(50, 900, 700, { flickMinDistancePx: 60 }), false);
  assert.equal(close(60, 900, 700, { flickMinDistancePx: 60 }), true);
  // cancelVelocity: released at -150 px/s past the distance closes by default and cancels at -100.
  assert.equal(close(400, -150, 700), true);
  assert.equal(close(400, -150, 700, { cancelVelocity: -100 }), false);
  assert.equal(close(400, -99, 700, { cancelVelocity: -100 }), true);
});

test('a DragToClose in a slot closes at the slot minimum, and one outside a row at the default', async () => {
  const closes: number[] = [];
  const slotted = mountBox({ onClose: () => closes.push(1), slot: { tuning: { dragToClose: { ...LIBRARY_TUNING_DEFAULTS.dragToClose, minDistancePx: 120 } } } });
  await drag(slotted.handle, { dx: 0, dy: 100 });
  await frames(40);
  assert.equal(closes.length, 0, 'a 100 px drag is short of the slot minimum of 120');
  await drag(slotted.handle, { dx: 0, dy: 140 });
  await frames(40);
  assert.equal(closes.length, 1, 'and 140 px is past it');
  slotted.mounted.unmount();
  const outside = mountBox({ onClose: () => closes.push(2) });
  await drag(outside.handle, { dx: 0, dy: 100 });
  await frames(40);
  assert.deepEqual(closes, [1, 2], 'outside a row 100 px closes at the default 80');
});

test('the direction lock: 10 px sideways locks horizontal at the default 8 and stays unlocked with a lock of 20', async () => {
  const ends: number[] = [];
  const reorder: ReorderHandle = { onDragEnd: (offsetX) => ends.push(offsetX) };
  const byDefault = mountBox({ reorder, onClose: () => undefined });
  await drag(byDefault.handle, { dx: 10, dy: 0, steps: 5 });
  await frames(30);
  assert.deepEqual(ends.map(Math.round), [10], 'locked horizontal: the reorder heard the offset');
  byDefault.mounted.unmount();
  ends.length = 0;
  const wide = mountBox({ reorder, onClose: () => undefined, slot: { tuning: { dragToClose: { ...LIBRARY_TUNING_DEFAULTS.dragToClose, directionLockPx: 20 } } } });
  await drag(wide.handle, { dx: 10, dy: 0, steps: 5 });
  await frames(30);
  assert.deepEqual(ends, [], 'still unlocked at 10 px: the reorder heard nothing');
});

/** The distance from rest `after` frames after a short release, on `axisName`, under the slot's spring. */
async function springBack(snapBack: { stiffness: number; damping: number } | undefined, axisName: 'X' | 'Y', after: number): Promise<number> {
  const reorder: ReorderHandle = { onDragEnd: () => undefined };
  const setup: Setup =
    snapBack === undefined ? { reorder, onClose: () => undefined } : { reorder, onClose: () => undefined, slot: { tuning: { dragToClose: { ...LIBRARY_TUNING_DEFAULTS.dragToClose, snapBack } } } };
  const { box, handle, mounted } = mountBox(setup);
  await drag(handle, axisName === 'Y' ? { dx: 0, dy: 60 } : { dx: 60, dy: 0 });
  await frames(after);
  const out = axis(box, axisName);
  mounted.unmount();
  return out;
}

test('the snap-back spring: the slot values drive it, the default is 520 and 42, and a stiffer or softer one is faster or slower', async () => {
  for (const name of ['Y', 'X'] as const) {
    const byDefault = await springBack(undefined, name, 3);
    const explicit = await springBack({ stiffness: 520, damping: 42 }, name, 3);
    const soft = await springBack({ stiffness: 50, damping: 5 }, name, 3);
    const stiff = await springBack({ stiffness: 2000, damping: 89 }, name, 3);
    assert.equal(byDefault, explicit, `${name}: the default is the 520 and 42 spring`);
    assert.ok(soft > byDefault, `${name}: the soft spring (${soft}) is still further out than the default (${byDefault})`);
    assert.ok(stiff < byDefault, `${name}: the stiff spring (${stiff}) is nearer rest than the default (${byDefault})`);
    assert.ok(byDefault > 0 && byDefault < 60, `${name}: the default is mid-flight at ${byDefault}`);
  }
});

/** Frames from the release until onClose runs. */
async function framesToClose(closeExitSeconds: number | undefined): Promise<number> {
  let closedAt = -1;
  let elapsed = 0;
  const setup: Setup = { onClose: () => (closedAt = elapsed) };
  if (closeExitSeconds !== undefined) setup.slot = { tuning: { slide: { ...LIBRARY_TUNING_DEFAULTS.slide, closeExitSeconds } } };
  const { handle, mounted } = mountBox(setup);
  await drag(handle, { dx: 0, dy: 300 });
  for (; elapsed < 80 && closedAt < 0; ) {
    elapsed += 1;
    await frames(1);
  }
  mounted.unmount();
  assert.ok(closedAt >= 0, 'the box closed');
  return closedAt;
}

test("the exit seconds: DragToClose's own exit takes the slot's closeExitSeconds, 0.18 s by default", async () => {
  const byDefault = await framesToClose(undefined);
  const slow = await framesToClose(0.3);
  assert.ok(byDefault >= 11 && byDefault <= 15, `0.18 s is 11 to 15 frames of 16 ms, saw ${byDefault}`);
  assert.ok(slow >= 19 && slow <= 24, `0.3 s is 19 to 24 frames, saw ${slow}`);
  assert.equal(await framesToClose(0.18), byDefault, 'an explicit 0.18 is the default');
});

// ---------------------------------------------------------------------------
// onClose is optional, and closability is read again
// ---------------------------------------------------------------------------

test('with reorder and no onClose a downward release past the close distance snaps back and throws nothing', async () => {
  const ends: number[] = [];
  const { box, handle, scroller } = mountBox({ reorder: { onDragEnd: (offsetX) => ends.push(offsetX) } });
  await drag(handle, { dx: 0, dy: 300 });
  let deepest = 0;
  for (let i = 0; i < 60; i += 1) {
    await frames(1);
    deepest = Math.max(deepest, axis(box, 'Y'));
  }
  assert.ok(deepest <= 301, `no exit started: the box never passed where the pointer let go (deepest ${deepest})`);
  assert.ok(Math.abs(axis(box, 'Y')) < 1, `the box is back at rest (${axis(box, 'Y')})`);
  assert.equal(scroller.style.overflowY, 'auto', 'and the scroll parent is unlocked');
  assert.deepEqual(ends, [], 'a vertical drag is no reorder');
});

test('with onClose the same release closes as before: after the exit, once', async () => {
  const closes: number[] = [];
  const { handle } = mountBox({ onClose: () => closes.push(1), reorder: { onDragEnd: () => undefined } });
  await drag(handle, { dx: 0, dy: 300 });
  assert.equal(closes.length, 0, 'not at the release');
  await frames(40);
  assert.equal(closes.length, 1);
});

test('closable false at the release starts no exit: the box never passes where the pointer let go, and onClose is not called', async () => {
  const closes: number[] = [];
  const { box, handle, scroller } = mountBox({ onClose: () => closes.push(1), slot: { closable: false } });
  await drag(handle, { dx: 0, dy: 300 });
  let deepest = 0;
  for (let i = 0; i < 40; i += 1) {
    await frames(1);
    deepest = Math.max(deepest, axis(box, 'Y'));
  }
  assert.ok(deepest <= 301, `the box stayed at or above 300 (deepest ${deepest})`);
  assert.ok(Math.abs(axis(box, 'Y')) < 1, 'and came back to rest');
  assert.equal(closes.length, 0);
  assert.equal(scroller.style.overflowY, 'auto');
});

/** After the first release the box heads for the bottom; `stopAt` frames in, closability turns false. */
async function lockDuringExit(stopAt: number | 'immediately'): Promise<{ closes: number; deepest: number; rest: number; locked: string; again: number; lockedAgain: string }> {
  const closes: number[] = [];
  const setup: Setup = { onClose: () => closes.push(1), slot: { closable: true } };
  const { box, handle, scroller, update } = mountBox(setup);
  await drag(handle, { dx: 0, dy: 300 });
  const at = stopAt === 'immediately' ? 1 : stopAt;
  let deepest = 0;
  for (let i = 0; i < 70; i += 1) {
    if (i === at) update({ ...setup, slot: { closable: false } });
    await frames(1);
    deepest = Math.max(deepest, axis(box, 'Y'));
  }
  const rest = axis(box, 'Y');
  const locked = scroller.style.overflowY;
  await drag(handle, { dx: 0, dy: 30, keepDown: true });
  const again = axis(box, 'Y');
  const lockedAgain = scroller.style.overflowY;
  await release(0, 30);
  return { closes: closes.length, deepest, rest, locked, again, lockedAgain };
}

test('closable turning false just after the release: the exit runs out, then the box returns to rest, the scroll parent unlocks, a new press drags again and onClose is not called', async () => {
  const out = await lockDuringExit('immediately');
  assert.ok(out.deepest > 600, `the box went down first (${out.deepest})`);
  assert.equal(out.closes, 0);
  assert.ok(Math.abs(out.rest) < 1, `and came back (${out.rest})`);
  assert.equal(out.locked, 'auto');
  assert.ok(out.again > 20, `a following press on the handle drags the box again (${out.again})`);
  assert.equal(out.lockedAgain, 'hidden');
});

test('closable turning false on the last frame of the exit still stops the close: the end-of-exit re-check', async () => {
  const control: number[] = [];
  const open = mountBox({ onClose: () => control.push(1), slot: { closable: true } });
  await drag(open.handle, { dx: 0, dy: 300 });
  let lastFrame = 0;
  for (; control.length === 0 && lastFrame < 60; lastFrame += 1) await frames(1);
  assert.equal(control.length, 1, 'control: with closable true the box closes');
  assert.ok(lastFrame > 3, `and not at once (${lastFrame})`);
  open.mounted.unmount();
  const out = await lockDuringExit(lastFrame - 2);
  assert.equal(out.closes, 0, `closability turned false at frame ${lastFrame - 2} of a ${lastFrame} frame exit`);
  assert.ok(Math.abs(out.rest) < 1, `the box returned to rest (${out.rest})`);
  assert.equal(out.locked, 'auto');
  assert.ok(out.again > 20);
});
