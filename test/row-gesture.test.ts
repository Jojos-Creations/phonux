/**
 * The step gesture on a scrolling row: one stepTarget per phone width of wheel travel, the arrow keys, the claim and the
 * revealOnScroll rule. The quiet timer is a setTimeout and the burst lock reads performance.now, so wheel cases run under mock
 * timers and `tick` moves the virtual frame clock with them; glides run on that clock (16 ms a frame). Rows are eleven panels at 1000 (two panels fit the window, so the last stop shows the last
 * two), or a 430 px window that shows one phone panel at a time (window 398, a stop at every panel start). Expected
 * positions come from computeRowNumbers on the test's own row.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf } from './support/strip.js';
import { act } from 'react';
import type { PanelWindow } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { frameClock } from './support/jsdom-globals.js';
import { computeRowNumbers, maxScrollOf, type RowNumbers } from '../rowNumbers.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { made, mountRow, panelsOf, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

/** Long enough for a default-slide glide to land, with a few frames to spare. */
const GLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;

const eleven = (): PanelWindow[] => panelsOf(10);

/** Pins the gesture to 'step' whatever the helper's default; these tests are about the step gesture. */
const stepRow = (entries: PanelWindow[], width: number, over: Parameters<typeof mountRow>[2] = {}): MountedRow =>
  mountRow(entries, width, { ...over, tuning: { ...over.tuning, rowGesture: 'step' } });

/** The row's numbers, computed from its entries rather than read back from the mounted row. */
const numbersOf = (m: MountedRow, width: number): RowNumbers =>
  computeRowNumbers({ entries: m.latest().entries, phoneWidth: 390, containerWidth: width, gap: m.latest().tuning.rowGap, wholePanels: true });
const stopsOf = (m: MountedRow, width: number): number[] => [...numbersOf(m, width).stops];

/** Moves the quiet timer and the frame clock together: the burst lock reads performance.now, the quiet timer is a setTimeout. */
const tick = (ms: number): void =>
  void act(() => {
    mock.timers.tick(ms);
    frameClock.skip(ms);
  });

test('a wheel burst of 30 events scrolls exactly one stop, and its later events do not cancel the glide it started', async () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 0; n < 30; n += 1) m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), stops[1]);
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(rowOffsetOf(m.container), stops[1]);
});

test('a step waits 30 ms after the last one, however far the wheel has travelled; later events do not extend the lock', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), stops[1]);
  tick(10);
  m.wheel({ deltaX: 500 });
  assert.equal(m.scroller.glideTarget(), stops[1], 'a phone width of travel inside the lock does not step');
  tick(19);
  m.wheel({ deltaX: 1 });
  assert.equal(m.scroller.glideTarget(), stops[1], 'one ms short of the lock, the events in between did not extend it');
  tick(1);
  m.wheel({ deltaX: 1 });
  assert.equal(m.scroller.glideTarget(), stops[2], 'the lock is over and the travel is held: the next step, from the in-flight target');
  tick(60);
  m.wheel({ deltaX: -20 });
  assert.equal(m.scroller.glideTarget(), stops[1], 'a reversal steps back even when smaller');
});

test('the first event of a gesture steps; every further phone width (390 + the 16 gap) of travel in that direction steps again', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), stops[1]);
  tick(30);
  m.wheel({ deltaX: 405 });
  assert.equal(m.scroller.glideTarget(), stops[1], '405 px is one short of a phone width');
  tick(30);
  m.wheel({ deltaX: 1 });
  assert.equal(m.scroller.glideTarget(), stops[2], '406 px');
});

test('a page-mode wheel (deltaMode 2) travels one phone width per event; line mode counts 16 px a line', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 1, deltaMode: 2 });
  assert.equal(m.scroller.glideTarget(), stops[1]);
  tick(30);
  m.wheel({ deltaX: 1, deltaMode: 2 });
  assert.equal(m.scroller.glideTarget(), stops[2], 'a page is a phone width of travel');
  tick(30);
  m.wheel({ deltaX: 25, deltaMode: 1 });
  assert.equal(m.scroller.glideTarget(), stops[2], '25 lines are 400 px: short of a phone width');
  tick(30);
  m.wheel({ deltaX: 1, deltaMode: 1 });
  assert.equal(m.scroller.glideTarget(), stops[3], '26 lines are 416 px');
});

test('a held plateau of equal deltas steps once per phone width it travels, and mouse notches 200 ms apart each step', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let n = 0; n < 20; n += 1) {
    m.wheel({ deltaX: 100 });
    tick(16);
  }
  assert.equal(m.scroller.glideTarget(), stops[5], '2000 px: the first event steps, then four more as the travel after it crosses a phone width, each carrying its remainder');
  tick(200);
  m.wheel({ deltaX: 100 });
  tick(200);
  m.wheel({ deltaX: 100 });
  assert.equal(m.scroller.glideTarget(), stops[7], 'each notch after a quiet gap is a fresh gesture');
});

test('a swipe whose deltas fade away steps by its travel: 951 px after the first event is two more steps, however long its tail', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let delta = 120; delta >= 4; delta = Math.floor(delta * 0.9)) {
    m.wheel({ deltaX: delta });
    tick(16);
  }
  assert.equal(m.scroller.glideTarget(), stops[3]);
});

test('a swipe that fades inside one phone width of travel is one step', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  for (let delta = 40; delta >= 4; delta = Math.floor(delta * 0.9)) {
    m.wheel({ deltaX: delta });
    tick(16);
  }
  assert.equal(m.scroller.glideTarget(), stops[1]);
});

/** Feeds a whole trace of deltas (signed) one per `every` ms, as one wheel stream. */
const feed = (m: MountedRow, trace: readonly number[], every = 16, over: { deltaMode?: number } = {}): void => {
  for (const deltaX of trace) {
    m.wheel({ deltaX, ...over });
    tick(every);
  }
};
const RAMP = [2, 4, 9, 18, 32, 50, 70, 88, 100, 104, 100, 92, 82, 72, 62, 52, 44, 36, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 1];

test('a swipe whose deltas ramp up, peak and fade steps by its travel (1146 px after the first event), not once per rising event', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, RAMP);
  assert.equal(m.scroller.glideTarget(), stops[3]);
});

test('jitter in a swipe tail (14, 12, 13, 11) adds only its own px: under a phone width of travel it does not step again', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, [100, 80, 60, 40, 30, 33, 36, 32, 14, 12, 13, 11]);
  assert.equal(m.scroller.glideTarget(), stops[1], '361 px after the first event');
  feed(m, [12, 10, 11, 9, 10]);
  assert.equal(m.scroller.glideTarget(), stops[2], 'control: the same tail further on crosses 406 px and steps');
});

test('a second swipe that starts in the first one tail counts toward the same phone width of travel', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, [100, 70, 40, 20, 10, 20, 40, 80]);
  assert.equal(m.scroller.glideTarget(), stops[1], '280 px after the first event');
  feed(m, [100, 100]);
  assert.equal(m.scroller.glideTarget(), stops[2], '480 px');
});

test('a quantised tail (3, 2, 1, 1, 1, 2, 1) adds almost no travel and does not step again', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, [100, 70, 45, 28, 17, 10, 6, 4, 3, 2, 1, 1, 1, 2, 1, 1, 2, 1]);
  assert.equal(m.scroller.glideTarget(), stops[1]);
});

test('a swipe that reverses direction steps back', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, [100, 80, 60]);
  assert.equal(m.scroller.glideTarget(), stops[1]);
  feed(m, [-20, -40, -80]);
  assert.equal(m.scroller.glideTarget(), stops[0]);
});

test('a Firefox line-mode swipe (deltaMode 1, whole lines) of 336 px is one step', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  feed(m, [1, 1, 2, 3, 3, 3, 2, 2, 1, 1, 1, 1], 16, { deltaMode: 1 });
  assert.equal(m.scroller.glideTarget(), stops[1]);
});

test('after 150 ms without a wheel event the next one is a fresh gesture and steps', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 100 });
  tick(16);
  m.wheel({ deltaX: 40 });
  tick(100);
  m.wheel({ deltaX: 30 });
  assert.equal(m.scroller.glideTarget(), stops[1], 'a fading tail 116 ms in is still the same gesture');
  tick(150);
  m.wheel({ deltaX: 10 });
  assert.equal(m.scroller.glideTarget(), stops[2], 'the quiet ended it');
});

test('a wheel that stops leaves the row where its last step put it', async () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 100 });
  tick(30);
  m.wheel({ deltaX: 40 });
  tick(30);
  m.wheel({ deltaX: 400 });
  tick(1000);
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(rowOffsetOf(m.container), stops[2]);
});

test('Shift+deltaY acts as horizontal and a plain deltaY does not; the row cancels the sideways wheels it takes and leaves the vertical one', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  const plain = m.wheel({ deltaY: 100 });
  assert.equal(plain.defaultPrevented, false);
  assert.equal(m.scroller.glideTarget(), null);
  const shifted = m.wheel({ deltaY: 100, shiftKey: true });
  assert.equal(shifted.defaultPrevented, true);
  assert.equal(m.scroller.glideTarget(), stops[1]);
  const horizontal = m.wheel({ deltaX: -100 });
  assert.equal(horizontal.defaultPrevented, true);
  assert.equal(m.scroller.glideTarget(), stops[0], 'a horizontal wheel steps and is cancelled');
});

test('ten ArrowRight repeats advance ten stops from the in-flight target', () => {
  const m = stepRow(panelsOf(13), 1000);
  const stops = stopsOf(m, 1000);
  const seen: (number | null)[] = [];
  for (let n = 0; n < 10; n += 1) {
    m.key('ArrowRight');
    seen.push(m.scroller.glideTarget());
  }
  assert.deepEqual(seen, stops.slice(1, 11));
  m.key('ArrowLeft');
  assert.equal(m.scroller.glideTarget(), stops[9]);
});

test('the last step clamps to the strip end', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  setRowOffset(m.container, stops[stops.length - 2]!);
  m.key('ArrowRight');
  // The last stop is the farthest legal scroll, so the clamp and the stop agree.
  assert.equal(m.scroller.glideTarget(), maxScrollOf(numbersOf(m, 1000)));
  assert.equal(m.scroller.glideTarget(), stops[stops.length - 1]);
});

test('at the strip end an arrow and a swipe do nothing', () => {
  const m = stepRow(eleven(), 1000);
  setRowOffset(m.container, maxScrollOf(numbersOf(m, 1000)));
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), null);
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), null);
});

test('arrows skip INPUT, TEXTAREA, SELECT and contentEditable targets and any modifier, and still step with a button focused', () => {
  const m = stepRow(eleven(), 1000);
  const stepped = (): boolean => {
    const at = m.scroller.glideTarget();
    m.scroller.stop();
    return at !== null;
  };
  for (const tag of ['input', 'textarea', 'select']) {
    const el = document.body.appendChild(document.createElement(tag));
    m.key('ArrowRight', {}, el);
    assert.equal(stepped(), false, tag);
    el.remove();
  }
  const editable = document.body.appendChild(document.createElement('div'));
  editable.setAttribute('contenteditable', 'true');
  m.key('ArrowRight', {}, editable);
  assert.equal(stepped(), false, 'contentEditable');
  const plainDiv = document.body.appendChild(document.createElement('div'));
  m.key('ArrowRight', {}, plainDiv);
  assert.equal(stepped(), true, 'control: the same press without contenteditable steps');
  for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    m.key('ArrowRight', init);
    assert.equal(stepped(), false, JSON.stringify(init));
  }
  const button = document.body.appendChild(document.createElement('button'));
  button.focus();
  m.key('ArrowRight', {}, button);
  assert.equal(stepped(), true, 'a focused button');
});

test('an arrow a control already handled does not also step the row', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  const control = document.body.appendChild(document.createElement('div'));
  control.addEventListener('keydown', (e) => e.preventDefault());
  m.key('ArrowRight', {}, control);
  assert.equal(m.scroller.glideTarget(), null, 'the control used the key');
  control.remove();
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), stops[1], 'control: an unhandled press steps');
});

test('an arrow a control only stops from bubbling never reaches the row', () => {
  const m = stepRow(eleven(), 1000);
  const control = document.body.appendChild(document.createElement('div'));
  control.addEventListener('keydown', (e) => e.stopPropagation());
  m.key('ArrowRight', {}, control);
  assert.equal(m.scroller.glideTarget(), null);
  control.remove();
});

test('the row shares the column\'s guard: a widget that uses the arrows, an open dialog, a keyboard drag and an IME composition each keep the key from the row', () => {
  const m = stepRow(eleven(), 1000);
  const stepped = (target?: EventTarget, init: KeyboardEventInit = {}): boolean => {
    m.key('ArrowRight', init, target);
    const at = m.scroller.glideTarget();
    m.scroller.stop();
    return at !== null;
  };
  const slider = document.body.appendChild(document.createElement('div'));
  slider.setAttribute('role', 'slider');
  assert.equal(stepped(slider), false, 'a slider');
  slider.remove();
  const carried = document.body.appendChild(document.createElement('div'));
  carried.setAttribute('aria-pressed', 'true');
  carried.setAttribute('aria-roledescription', 'draggable');
  assert.equal(stepped(carried), false, 'a panel a keyboard drag carries');
  carried.remove();
  const dialog = document.body.appendChild(document.createElement('div'));
  dialog.setAttribute('aria-modal', 'true');
  assert.equal(stepped(), false, 'a modal dialog is open');
  dialog.remove();
  assert.equal(stepped(undefined, { isComposing: true }), false, 'an IME is composing');
  assert.equal(stepped(), true, 'control: a bare press steps');
});

test('a held arrow key keeps stepping the row: the repeat decision stays the column\'s', () => {
  const m = stepRow(eleven(), 1000);
  m.key('ArrowRight', { repeat: true });
  assert.notEqual(m.scroller.glideTarget(), null);
});

test('an arrow does not step a row inside an inert ancestor, and steps again once it is not', () => {
  const m = stepRow(eleven(), 1000);
  const stops = stopsOf(m, 1000);
  const host = m.container.parentElement!;
  host.setAttribute('inert', '');
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), null, 'an inert row stays put');
  host.removeAttribute('inert');
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), stops[1]);
});

test('a glide the gesture started stops at pointer-down in the container', () => {
  const m = stepRow(eleven(), 1000);
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), stopsOf(m, 1000)[1]);
  act(() => void m.container.dispatchEvent(new Event('pointerdown', { bubbles: true })));
  assert.equal(m.scroller.glideTarget(), null);
});

/** Counts the container's wheel and the window's keydown listeners added while `render` mounts. */
function listenersFor(rowGesture: 'step' | 'off'): number {
  const proto = (window as unknown as { EventTarget: typeof EventTarget }).EventTarget.prototype;
  const spy = mock.method(proto, 'addEventListener');
  try {
    mountRow(eleven(), 1000, { tuning: { rowGesture } });
    return spy.mock.calls.filter((c) => {
      const target = c.this as unknown;
      const type = c.arguments[0];
      return (type === 'wheel' && target instanceof HTMLElement && target.hasAttribute('data-row-scroller')) || (type === 'keydown' && target === window && c.arguments[2] !== true);
    }).length;
  } finally {
    spy.mock.restore();
  }
}

test('off installs no gesture listener; step installs two', () => {
  assert.equal(listenersFor('step'), 2, 'positive control');
  cleanup();
  assert.equal(listenersFor('off'), 0);
});

test('the gesture does nothing while a claim is held, and steps again after the release', () => {
  const m = stepRow(eleven(), 1000);
  const claim = m.scroller.claim()!;
  claim.setMaxScroll(maxScrollOf(numbersOf(m, 1000)));
  for (let n = 0; n < 3; n += 1) m.key('ArrowRight');
  m.wheel({ deltaX: 50 });
  assert.equal(m.scroller.glideTarget(), null);
  assert.equal(rowOffsetOf(m.container), 0);
  claim.release();
  m.key('ArrowRight');
  assert.equal(m.scroller.glideTarget(), stopsOf(m, 1000)[1]);
});

test('the gesture shows no hidden panel while a claim is held', () => {
  const m = stepRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: 'any' }, { live: false }), made('c')), 430);
  mock.timers.enable({ apis: ['setTimeout'] });
  const claim = m.scroller.claim()!;
  m.wheel({ deltaX: 50 });
  assert.equal(m.live().includes('b'), false);
  claim.release();
  tick(400);
  m.wheel({ deltaX: 50 });
  assert.equal(m.live().includes('b'), true, 'control: the same swipe after the release shows it');
});

// --- revealOnScroll ------------------------------------------------------------------------------------------

const narrow = 430;
const swipe = async (m: MountedRow, deltaX: number): Promise<void> => {
  m.wheel({ deltaX });
  await advanceFrames(GLIDE_DONE_MS);
  tick(400);
};

test('a held panel after the last panel in view is reached only once no live panel lies between the window and it', async () => {
  for (const policy of ['edges', 'any', 'never'] as const) {
    const m = stepRow(row(rootEntry(), made('c')), narrow, { workspaceDefaults: { startVisibility: 'parked', overflow: 'park', revealOnScroll: policy } });
    mock.timers.enable({ apis: ['setTimeout'] });
    act(() => m.latest().create({ view: 'scroll-row-view' }));
    const heldId = m.latest().entries[m.latest().entries.length - 1]!.id;
    await advanceFrames(GLIDE_DONE_MS);
    const stops = stopsOf(m, narrow);
    assert.equal(rowOffsetOf(m.container), 0, `${policy}: a hidden create scrolls nothing`);
    assert.deepEqual(m.live(), ['c']);
    await swipe(m, 50);
    assert.equal(rowOffsetOf(m.container), stops[1], `${policy}: c lies between the window and the held panel, so the swipe steps to it`);
    assert.ok(!m.live().includes(heldId), policy);
    await swipe(m, 50);
    if (policy === 'never') {
      assert.ok(!m.live().includes(heldId), 'never: skipped');
    } else {
      assert.ok(m.live().includes(heldId), `${policy}: a held panel is revealed from the strip end`);
    }
    mock.timers.reset();
    cleanup();
  }
});

test('a swipe toward a held panel past three live panels steps over each and reveals it only from the last stop', async () => {
  const m = stepRow(row(rootEntry(), made('l1'), made('l2'), made('l3')), narrow, { workspaceDefaults: { startVisibility: 'parked', overflow: 'park' } });
  mock.timers.enable({ apis: ['setTimeout'] });
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  const heldId = m.latest().entries[m.latest().entries.length - 1]!.id;
  const stops = stopsOf(m, narrow);
  const reached: number[] = [];
  for (let n = 0; n < 3; n += 1) {
    await swipe(m, 50);
    reached.push(rowOffsetOf(m.container));
    assert.ok(!m.live().includes(heldId), `step ${n}: not skipped to`);
  }
  assert.deepEqual(reached, stops.slice(1));
  await swipe(m, 50);
  assert.ok(m.live().includes(heldId));
});

test('an engine-parked panel between the live ones: edges and never step past it, any reaches it, in both directions', async () => {
  for (const [policy, reached] of [['edges', false], ['any', true], ['never', false]] as const) {
    for (const direction of ['right', 'left'] as const) {
      const m = stepRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: policy }, { live: false }), made('c')), narrow);
      mock.timers.enable({ apis: ['setTimeout'] });
      const stops = stopsOf(m, narrow);
      if (direction === 'left') setRowOffset(m.container, stops[1]!);
      await swipe(m, direction === 'right' ? 50 : -50);
      assert.equal(m.live().includes('b'), reached, `${policy} ${direction}`);
      if (!reached) assert.equal(rowOffsetOf(m.container), direction === 'right' ? stops[1] : 0, `${policy} ${direction}: it stepped instead`);
      mock.timers.reset();
      cleanup();
    }
  }
});

test('a History click (activate) brings a parked panel back under all three revealOnScroll values', () => {
  for (const policy of ['edges', 'any', 'never'] as const) {
    const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: policy }, { live: false }), made('c')), narrow);
    act(() => m.latest().activate('b'));
    assert.ok(m.live().includes('b'), policy);
    cleanup();
  }
});
