/**
 * The values that were once literals in the gesture, scroll and close code and are now tuning leaves: each one's
 * default is what the code did before, and overriding it changes what a user sees.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, LIBRARY_TUNING_DEFAULTS, OVERLAY_Z, ROW_LAYER_Z } from '../index.js';
import { ALL_SLOTS } from '../rowConstants.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { SlideTuning } from '../index.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { PanelSlotContext, PanelVerticalDragContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning, type SlotTuning } from '../panelTuning.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';

afterEach(() => cleanup());

const DEFAULT_SLOT = resolvePanelSettings().value;
const slotValue = (tuning: Partial<SlotTuning>): PanelSlotValue => ({
  collapsible: true,
  closable: true,
  movable: true,
  resizable: true,
  maxSlots: DEFAULT_SLOT.maxSlots,
  neighborWidths: { left: [], right: [] },
  tuning: { ...slotTuning(LIBRARY_TUNING_DEFAULTS), ...tuning },
});

function mountBox(tuning: Partial<SlotTuning> | null, onClose: () => void = () => undefined) {
  const box = React.createElement(DragToClose, {
    onClose,
    children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
  });
  const mounted = mount(tuning === null ? box : React.createElement(PanelSlotContext.Provider, { value: slotValue(tuning), children: React.createElement(PanelVerticalDragContext.Provider, { value: true, children: box }) }));
  const handle = mounted.container.querySelector<HTMLElement>('[data-handle]')!;
  return { handle, box: handle.closest<HTMLElement>('[data-drag-to-close]')! };
}
const translateY = (el: HTMLElement): number => {
  const match = /translateY\((-?[\d.e+-]+)px\)/.exec(el.style.transform);
  return match === null ? 0 : Number(match[1]);
};

// A pointer event at a chosen browser timestamp, the way a release judges its speed.
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', y: number, at: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 100, clientY: 100 + y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true, timeStamp: at })) Object.defineProperty(event, key, { value });
  return event;
}

/** Presses, then moves to each `[ms after the press, y]` and lifts `liftAfter` ms after the last move; true when the box closed. */
async function closesAfter(tuning: Partial<SlotTuning> | null, moves: ReadonlyArray<readonly [number, number]>, liftAfter: number): Promise<boolean> {
  const closes: number[] = [];
  const { handle } = mountBox(tuning, () => closes.push(1));
  await act(async () => void handle.dispatchEvent(pointer('pointerdown', 0, performance.now())));
  await new Promise((resolve) => setTimeout(resolve, 5));
  await advanceFrames(13 * 16);
  const start = performance.now();
  await act(async () => {
    for (const [ms, y] of moves) document.dispatchEvent(pointer('pointermove', y, start + ms));
  });
  const last = moves[moves.length - 1]!;
  await act(async () => void document.dispatchEvent(pointer('pointerup', last[1], start + last[0] + liftAfter)));
  await advanceFrames(2000);
  return closes.length > 0;
}

const FLICK: ReadonlyArray<readonly [number, number]> = [
  [10, 20],
  [20, 40],
  [30, 60],
];
test('a DragToClose judges its release by the library constants: rested after 50 ms, a 100 ms velocity window', async () => {
  assert.equal(await closesAfter(null, FLICK, 10), true, 'control: lifted 10 ms after the last move it is a flick');
  cleanup();
  assert.equal(await closesAfter(null, FLICK, 80), false, 'rested after the default 50 ms');
  cleanup();
  const fastThenSlow: ReadonlyArray<readonly [number, number]> = [[0, 0], [16, 50], [116, 55], [216, 60]];
  assert.equal(await closesAfter(null, fastThenSlow, 10), false, 'the default 100 ms window has dropped the fast move');
  cleanup();
  assert.equal(await closesAfter(null, [[0, 0], [16, 50], [60, 55], [100, 60]], 10), true, 'control: inside the window the fast move still counts');
});

test('closeExitEase: a drag close leaves along the leaf, so a quarter of the way through a linear exit is further than an ease-in one', async () => {
  const slow = (closeExitEase: SlideTuning['closeExitEase']): Partial<SlotTuning> => ({ slide: { ...LIBRARY_TUNING_DEFAULTS.slide, closeExitSeconds: 0.8, closeExitEase } });
  const quarter = async (closeExitEase: SlideTuning['closeExitEase']): Promise<number> => {
    const { handle, box } = mountBox(slow(closeExitEase));
    await drag(handle, { dx: 0, dy: 300, steps: 5, hold: 8 });
    await advanceFrames(12 * 16);
    const y = translateY(box);
    cleanup();
    return y;
  };
  const easeIn = await quarter('easeIn');
  const linear = await quarter('linear');
  assert.ok(linear > 0 && easeIn > 0, `control: both exits are under way (${linear}, ${easeIn})`);
  assert.ok(linear - easeIn > 40, `linear ${linear} is well past ease-in ${easeIn} at a quarter of the exit`);
});

test('closeExitEase: a button close takes the same leaf as a drag close, and the default is easeIn', () => {
  const exitOf = (slide: SlideTuning) => (panelRowSlotMotion(0, 390, 700, 'right', 'down', 16, slide).exit as { transition: { duration: number; ease: unknown } }).transition;
  assert.deepEqual(exitOf(LIBRARY_TUNING_DEFAULTS.slide), { duration: 0.18, ease: 'easeIn' });
  assert.equal(exitOf({ ...LIBRARY_TUNING_DEFAULTS.slide, closeExitEase: 'linear' }).ease, 'linear');
  assert.deepEqual(exitOf({ ...LIBRARY_TUNING_DEFAULTS.slide, closeExitEase: [0.4, 0, 1, 1] }).ease, [0.4, 0, 1, 1]);
});

test('ROW_LAYER_Z: base 1, raised 100, dragged 200, frozen, the base tier at its deepest rank stays under raised, and every overlay sits above them', () => {
  assert.deepEqual({ ...ROW_LAYER_Z }, { BASE: 1, RAISED: 100, DRAGGED: 200 });
  assert.ok(ROW_LAYER_Z.BASE + 2 * Math.floor(ALL_SLOTS / 2) < ROW_LAYER_Z.RAISED - 1);
  assert.ok(ROW_LAYER_Z.RAISED + 2 * Math.floor(ALL_SLOTS / 2) < ROW_LAYER_Z.DRAGGED);
  assert.ok(Object.isFrozen(ROW_LAYER_Z));
  assert.ok(Math.min(...Object.values(OVERLAY_Z)) > ROW_LAYER_Z.DRAGGED);
});


