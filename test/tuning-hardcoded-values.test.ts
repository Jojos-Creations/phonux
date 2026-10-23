/**
 * The values that were once literals in the gesture, scroll and close code and are now tuning leaves: each one's
 * default is what the code did before, and overriding it changes what a user sees.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { cubicBezier } from 'motion/react';
import { act } from 'react';
import { DragToClose, LIBRARY_TUNING_DEFAULTS, OVERLAY_Z, ROW_LAYER_Z } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { SlideTuning } from '../index.js';
import { panelRowSlotMotion } from '../PanelRowSlot.js';
import { PanelSlotContext, type PanelSlotValue } from '../panelSlotContext.js';
import { slotTuning, type SlotTuning } from '../panelTuning.js';
import { rowScrollerFor } from '../rowScroller.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { drag } from './support/drag-gesture.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

const DEFAULT_SLOT = resolvePanelSettings().value;
const slotValue = (tuning: Partial<SlotTuning>): PanelSlotValue => ({
  collapsible: true,
  closable: true,
  movable: true,
  resizable: true,
  maxSlots: DEFAULT_SLOT.maxSlots,
  neighborWidths: { left: [], right: [] },
  pinned: false,
  tuning: { ...slotTuning(LIBRARY_TUNING_DEFAULTS), ...tuning },
});

function mountBox(tuning: Partial<SlotTuning> | null, onClose: () => void = () => undefined) {
  const box = React.createElement(DragToClose, {
    onClose,
    children: (handle) => React.createElement('div', { 'data-handle': '', onPointerDown: handle.onPointerDown }, 'grab'),
  });
  const mounted = mount(tuning === null ? box : React.createElement(PanelSlotContext.Provider, { value: slotValue(tuning), children: box }));
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

async function glidePositions(ease: SlideTuning['glideEase']): Promise<number[]> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.scrollLeft = 0;
  rowScrollerFor(el).glideTo(1600, { durationSec: 1.6, instant: false, ease });
  const seen: number[] = [];
  let elapsed = 0;
  for (const frames of [25, 25, 25]) {
    await advanceFrames(frames * 16);
    elapsed += frames;
    seen.push(el.scrollLeft);
  }
  assert.equal(elapsed, 75);
  el.remove();
  return seen;
}

test("glideEase: 'cubic-out' is the curve the row always glided along, 1 - (1 - t)^3, measured at a quarter, a half and three quarters", async () => {
  assert.equal(LIBRARY_TUNING_DEFAULTS.slide.glideEase, 'cubic-out');
  const [a, b, c] = await glidePositions('cubic-out');
  assert.ok(Math.abs(a! - 1600 * 0.578125) < 0.5, `t = 0.25 gave ${a}`);
  assert.ok(Math.abs(b! - 1600 * 0.875) < 0.5, `t = 0.5 gave ${b}`);
  assert.ok(Math.abs(c! - 1600 * 0.984375) < 0.5, `t = 0.75 gave ${c}`);
});

test("glideEase: 'linear' and a bezier tuple glide along their own curves, apart from slide.ease", async () => {
  const [a, b] = await glidePositions('linear');
  assert.ok(Math.abs(a! - 400) < 0.5 && Math.abs(b! - 800) < 0.5, `linear gave ${a}, ${b}`);
  const [curved] = await glidePositions([0.2, 0, 0, 1]);
  assert.ok(curved! > 400 && Math.abs(curved! - 1600 * 0.578125) > 20, `the slide curve gave ${curved}, which is neither linear nor cubic-out`);
  assert.ok(Math.abs(curved! - 1600 * cubicBezier(0.2, 0, 0, 1)(0.25)) < 0.5, `a quarter of the way along [0.2, 0, 0, 1] is Motion's value for it, not ${curved}`);
  const [skewed] = await glidePositions([0, 0.2, 1, 0]);
  assert.ok(Math.abs(skewed! - 1600 * cubicBezier(0, 0.2, 1, 0)(0.25)) < 0.5, `[0, 0.2, 1, 0] keeps its four numbers in order, got ${skewed}`);
});

test('ROW_LAYER_Z: base 1, raised 2, dragged 3, frozen, and every overlay sits above them', () => {
  assert.deepEqual({ ...ROW_LAYER_Z }, { BASE: 1, RAISED: 2, DRAGGED: 3 });
  assert.ok(Object.isFrozen(ROW_LAYER_Z));
  assert.ok(Math.min(...Object.values(OVERLAY_Z)) > ROW_LAYER_Z.DRAGGED);
});


// The row's own glides (a step, a scrollTo and the settle after a resize) take the workspace's glideEase.
const SLOW = (glideEase: SlideTuning['glideEase']): { slide: Partial<SlideTuning> } => ({ slide: { durationSec: 1.6, glideEase } });

/** How far a glide has gone, as a fraction, a quarter of its duration after it started. */
async function quarterOfGlide(start: (m: ReturnType<typeof mountRow>) => void, glideEase: SlideTuning['glideEase']): Promise<number> {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step', ...SLOW(glideEase) } });
  const from = m.container.scrollLeft;
  act(() => start(m));
  const target = m.scroller.glideTarget();
  assert.notEqual(target, null, 'control: a glide is under way');
  await advanceFrames(25 * 16);
  const fraction = (m.container.scrollLeft - from) / (target! - from);
  cleanup();
  return fraction;
}

for (const [name, start] of [
  ['a wheel step', (m: ReturnType<typeof mountRow>) => void m.container.dispatchEvent(new WheelEvent('wheel', { deltaX: 50, cancelable: true, bubbles: true }))],
  ['scrollTo', (m: ReturnType<typeof mountRow>) => void m.latest().scrollTo('s3')],
] as const) {
  test(`glideEase: ${name} glides along the workspace's leaf`, async () => {
    const linear = await quarterOfGlide(start, 'linear');
    const cubic = await quarterOfGlide(start, 'cubic-out');
    assert.ok(Math.abs(linear - 0.25) < 0.08, `linear covered ${linear}`);
    assert.ok(cubic > 0.5, `cubic-out covered ${cubic}`);
  });
}

test('glideEase: the settle after a resize that moves the stops glides along the workspace leaf', async () => {
  const settle = async (glideEase: SlideTuning['glideEase']): Promise<number> => {
    const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step', ...SLOW(glideEase) } });
    m.scroller.glideTo(1624, { durationSec: 0, instant: true, ease: 'linear' });
    m.rerender(1500);
    const target = m.scroller.glideTarget();
    assert.equal(target, 1218, 'control: the row is brought to the new last stop');
    await advanceFrames(25 * 16);
    const fraction = (1624 - m.container.scrollLeft) / (1624 - 1218);
    cleanup();
    return fraction;
  };
  const linear = await settle('linear');
  const cubic = await settle('cubic-out');
  assert.ok(Math.abs(linear - 0.25) < 0.08, `linear covered ${linear}`);
  assert.ok(cubic > 0.5, `cubic-out covered ${cubic}`);
});
