/**
 * What brings a hidden panel back under `tuning.maxLivePanels`, with the app's settings: capacityReturn 'manual' and
 * revealOnScroll 'never'. Only a History click or the host's own show does; scrolling, closing, widening and undoing
 * do not. Each gesture test has a control that runs the same input under revealOnScroll 'edges', where it does reveal,
 * so a pass cannot come from a gesture that never acted.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { capRig, liveRightOfRoot } from './support/cap-rig.js';
import type { CapRig, CapRigOptions } from './support/cap-rig.js';

let timersOn = false;
/** Tears down the mounted rows and the mock clock, so a test can mount a second row for its control. */
function fresh(): void {
  mock.timers.reset();
  timersOn = false;
  cleanup();
}
afterEach(fresh);

/** Eight panels and N = 5 in a 1280 px window: three hidden, five live, the strip wider than the window. */
const BASE = 'root w1* w2* w3* w4 w5 w6 w7 w8';
const rigOf = (over: CapRigOptions = {}): Promise<CapRig> => capRig({ count: 9, initial: 8, cap: 5, ...over });

const wheel = (r: CapRig, init: WheelEventInit): void => void act(() => void r.m.container.dispatchEvent(new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init })));
const key = (name: string): void => void act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })));

/** Runs each input a quiet gap apart (a fresh gesture) and with the glide it starts finished, so each lands as its own step. */
async function steps(inputs: readonly (() => void)[]): Promise<void> {
  if (!timersOn) mock.timers.enable({ apis: ['setTimeout'] });
  timersOn = true;
  for (const input of inputs) {
    input();
    act(() => mock.timers.tick(160));
    await advanceFrames(500);
  }
}

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------

test('scrolling: wheel steps move the strip end to end and reveal nothing, where revealOnScroll edges reveals the panel at the window edge', async () => {
  const r = await rigOf();
  const right = (): void => wheel(r, { deltaX: 100 });
  const left = (): void => wheel(r, { deltaX: -100 });
  await steps([right, right, right, right, right, right]);
  assert.ok(r.m.container.scrollLeft > 0, 'the strip scrolled');
  await steps([left, left, left, left, left, left, left, left]);
  assert.equal(r.m.container.scrollLeft, 0);
  assert.equal(r.row(), BASE, 'the same five panels are live and the three hidden ones are where they were');
  fresh();

  const control = await rigOf({ reveal: 'edges' });
  const back = (): void => wheel(control, { deltaX: -100 });
  await steps([() => wheel(control, { deltaX: 100 }), () => wheel(control, { deltaX: 100 }), back]);
  // 812 is a one-phone grid rest that does not center, so w4 is cut by the window's left edge there and counts as in view:
  // the step back reveals w3 and parks the oldest live panel, w4, at once.
  assert.equal(control.row(), 'root w1* w2* w3 w4* w5 w6 w7 w8', 'control: one phone width back from 812 lands on 406 and reveals w3, since w4 is cut by the window edge at 812');
  await steps([back]);
  await advanceFrames(300);
  assert.equal(control.m.container.scrollLeft, 0, 'control: the next step back reaches the first stop');
  assert.equal(control.row(), 'root w1* w2* w3 w4* w5 w6 w7 w8', 'control: the revealed row stays as it is');
});

test('scrolling: Shift+wheel steps reveal nothing, where revealOnScroll edges reveals the panel at the window edge', async () => {
  const r = await rigOf();
  const shiftRight = (): void => wheel(r, { deltaY: 100, shiftKey: true });
  const shiftLeft = (): void => wheel(r, { deltaY: -100, shiftKey: true });
  await steps([shiftRight, shiftRight, shiftRight, shiftLeft, shiftLeft, shiftLeft, shiftLeft]);
  assert.equal(r.row(), BASE);
  fresh();

  const control = await rigOf({ reveal: 'edges' });
  await steps([() => wheel(control, { deltaY: 100, shiftKey: true }), () => wheel(control, { deltaY: 100, shiftKey: true }), () => wheel(control, { deltaY: -100, shiftKey: true }), () => wheel(control, { deltaY: -100, shiftKey: true })]);
  assert.equal(control.row(), 'root w1* w2* w3 w4* w5 w6 w7 w8');
});

test('scrolling: arrow keys step the strip and reveal nothing, where revealOnScroll edges reveals the panel at the window edge', async () => {
  const r = await rigOf();
  await steps([() => key('ArrowRight'), () => key('ArrowRight'), () => key('ArrowRight'), () => key('ArrowLeft'), () => key('ArrowLeft'), () => key('ArrowLeft'), () => key('ArrowLeft')]);
  assert.equal(r.row(), BASE);
  fresh();

  const control = await rigOf({ reveal: 'edges' });
  await steps([() => key('ArrowRight'), () => key('ArrowRight'), () => key('ArrowLeft'), () => key('ArrowLeft')]);
  assert.equal(control.row(), 'root w1* w2* w3 w4* w5 w6 w7 w8');
});

test('scrolling: in a row whose strip fits the window a wheel step swaps nothing, where revealOnScroll edges swaps a hidden panel in', async () => {
  const r = await capRig({ count: 5, cap: 2, width: 1920 });
  assert.ok(r.provided().rowNumbers.stripWidth < r.provided().rowNumbers.windowWidth, 'the strip fits, so a step cannot scroll and used to swap');
  const inputs = [() => wheel(r, { deltaX: -100 }), () => wheel(r, { deltaX: -100 }), () => key('ArrowLeft'), () => wheel(r, { deltaX: 100 }), () => wheel(r, { deltaX: 100 }), () => key('ArrowRight')];
  for (const input of inputs) {
    await steps([input]);
    assert.equal(r.row(), 'root w1* w2* w3* w4 w5', 'after each step, so a swap one step makes cannot be undone by another');
  }
  fresh();

  const control = await capRig({ count: 5, cap: 2, width: 1920, reveal: 'edges' });
  await steps([() => wheel(control, { deltaX: -100 })]);
  assert.equal(control.row(), 'root w1* w2* w3 w4 w5*', 'control: the step brings w3 in and takes the far end out, N staying 2');
});

test('scrolling: a native scroll, as a touch swipe makes, reveals nothing', async () => {
  const r = await rigOf();
  for (const scrollLeft of [300, 900, 1218, 400, 0]) {
    act(() => {
      r.m.container.scrollLeft = scrollLeft;
      r.m.container.dispatchEvent(new Event('scroll'));
    });
    await advanceFrames(100);
  }
  assert.equal(r.row(), BASE);
});

test('scrolling: a panel dragged against the right edge scrolls the strip, moves to the end, and reveals nothing', async () => {
  const r = await capRig({ count: 8, cap: 5, width: 1000, grab: true });
  Object.defineProperty(r.m.container, 'clientWidth', { value: 1000, configurable: true });
  r.m.container.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 700, width: 1000, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  await advanceFrames(2000);
  const grab = r.m.container.querySelector<HTMLElement>('[data-grab="w4"]')!;
  const event = (type: string, x: number): Event => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 100, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
    for (const [name, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(e, name, { value });
    return e;
  };
  await act(async () => void grab.dispatchEvent(event('pointerdown', 960)));
  await act(async () => void document.dispatchEvent(event('pointermove', 1000)));
  await advanceFrames(3000);
  assert.ok(r.m.container.scrollLeft > 0, 'the held edge scrolled the strip');
  await act(async () => void document.dispatchEvent(event('pointerup', 1000)));
  await advanceFrames(3000);
  assert.deepEqual([r.parked(), r.unpinnedLive().length], [['w1', 'w2', 'w3'], 5], 'still the three that were hidden, and five live');
});

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

test('window: widening and narrowing return nothing and park nothing', async () => {
  const r = await rigOf();
  const rows: string[] = [];
  for (const width of [600, 1920, 3000, 800, 1280]) {
    r.m.setWidth(width);
    await r.settle();
    rows.push(r.row());
  }
  assert.deepEqual(rows, Array(5).fill(BASE));
});

// ---------------------------------------------------------------------------
// Closing and undoing
// ---------------------------------------------------------------------------

test('close: closing a live panel returns no hidden panel under capacityReturn manual, where auto returns the most recently parked', async () => {
  const r = await rigOf();
  r.turn(() => r.h.w6!.close());
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w7 w8', 'a slot is free and stays free');
  cleanup();

  const auto = await rigOf({ returns: 'auto' });
  auto.turn(() => auto.h.w6!.close());
  await auto.settle();
  assert.equal(auto.row(), 'root w1* w2* w3 w4 w5 w7 w8', 'as before the cap: w3, parked last, takes the slot');
});

test('close: closing a hidden panel removes it, returns nothing, and leaves it closable', async () => {
  const r = await rigOf();
  const result = r.turn(() => r.h.w1!.close());
  assert.equal(result.ok, true, 'a hidden unpinned panel can still be closed');
  await r.settle();
  assert.equal(r.row(), 'root w2* w3* w4 w5 w6 w7 w8');
  assert.equal(r.ws.panels.get('w1')!.getState().status, 'closed');
  assert.equal(r.unpinnedLive().length, 5);
});

test('close: undoing a close restores the panel to its place and parks exactly one other when the slot has been filled', async () => {
  const r = await rigOf();
  r.turn(() => r.h.w6!.close());
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w7 w8');
  r.turn(() => r.m.latest().undoClose());
  await r.settle();
  assert.equal(r.row(), BASE, 'the slot was still free, so w6 returns to its place and parks nobody');

  r.turn(() => r.h.w6!.close());
  await r.settle();
  r.add('w9');
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3* w4 w5 w7 w8 w9', 'the open filled the slot');
  r.turn(() => r.m.latest().undoClose());
  await r.settle();
  assert.equal(r.unpinnedLive().length, 5);
  assert.equal(r.row(), 'root w1* w2* w3* w4* w5 w6 w7 w8 w9', 'w6 is back between w5 and w7, and the oldest live panel parked: w4, the leftmost of those tied');
});

// ---------------------------------------------------------------------------
// A saved workspace
// ---------------------------------------------------------------------------

test('restore: a saved workspace with more live panels than N arrives with the extra ones parked', async () => {
  const store = memoryWorkspaceStorage();
  const saver = await capRig({ count: 8, width: 4000, workspace: { storage: store }, tuning: { saveQuietMs: 5 } });
  assert.equal(saver.row(), 'root w1 w2 w3 w4 w5 w6 w7 w8', 'saved with every panel live');
  // Opening saves nothing, so the file exists only once something changes; a title leaves the row alone.
  saver.turn(() => saver.h.w1!.configure({ title: 'Saved' }));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual((await store.load())?.panels.map((p) => p.live), Array(8).fill(true), 'the file holds the eight, each live');
  cleanup();

  const r = await capRig({ count: 8, cap: 5, width: 1280, workspace: { storage: store }, record: true });
  await r.settle();
  assert.equal(r.row(), BASE);
  assert.equal(r.commits.find((row) => row !== 'root'), BASE, 'the row that first holds the restored panels already has the extra ones parked');
  assert.deepEqual(r.commits.filter((row) => liveRightOfRoot(row) > 5), [], 'no committed row held a sixth live panel');
});

// ---------------------------------------------------------------------------
// Going to a panel
// ---------------------------------------------------------------------------

test('scrollTo: a live panel scrolls into view, and a hidden one is refused and stays hidden', async () => {
  const r = await rigOf();
  const live = r.turn(() => r.h.w8!.scrollTo());
  assert.equal(live.ok, true);
  await r.settle();
  assert.ok(r.m.container.scrollLeft > 0, 'the strip moved to w8');
  const hidden = r.turn(() => r.h.w2!.scrollTo());
  assert.equal(hidden.ok, false);
  assert.equal(hidden.ok === false && hidden.code, 'not-live');
  await r.settle();
  assert.equal(r.row(), BASE);
});

test('show: the host showing a hidden panel brings it back and parks exactly one other, the oldest', async () => {
  const r = await rigOf();
  const result = r.turn(() => r.h.w2!.show());
  assert.equal(result.ok, true);
  await r.settle();
  assert.equal(r.row(), 'root w1* w2 w3* w4* w5 w6 w7 w8');
});

test('History click: clicking a hidden panel brings it back and parks exactly one other, and a second click does the same again', async () => {
  const r = await rigOf();
  await r.settle();
  r.turn(() => r.m.latest().activate(r.entry('w3').id));
  await r.settle();
  assert.equal(r.row(), 'root w1* w2* w3 w4* w5 w6 w7 w8', 'N stays five: w4, the leftmost of the tied live panels, parks');
  r.turn(() => r.m.latest().activate(r.entry('w1').id));
  await r.settle();
  assert.equal(r.row(), 'root w1 w2* w3 w4* w5* w6 w7 w8', 'w3 was touched after the rest, so w5, the leftmost of the others, parks');
  assert.equal(r.unpinnedLive().length, 5);
});

test('History click: clicking a panel that is already live changes nothing', async () => {
  const r = await rigOf();
  r.turn(() => r.m.latest().activate(r.entry('w5').id));
  await r.settle();
  assert.equal(r.row(), BASE);
});
