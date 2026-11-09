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
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
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

/** Feeds a whole trace of deltas (signed) one per `every` ms, as one wheel stream. */
const feed = (m: MountedRow, trace: readonly number[], every = 16, over: { deltaMode?: number } = {}): void => {
  for (const deltaX of trace) {
    m.wheel({ deltaX, ...over });
    tick(every);
  }
};
const RAMP = [2, 4, 9, 18, 32, 50, 70, 88, 100, 104, 100, 92, 82, 72, 62, 52, 44, 36, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 1];

/** A wheel event the browser stamped `at` ms on the page clock, handled whenever the clock stands at the call. */
const wheelStamped = (m: MountedRow, deltaX: number, at: number): void => {
  const event = new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true });
  Object.defineProperty(event, 'timeStamp', { value: at });
  act(() => void m.container.dispatchEvent(event));
};

/**
 * A page that stalls for 48 ms while a swipe streams in: the events queue and are handled together afterwards, so the time between
 * handlers says nothing about the time between the fingers' events. Event `k` is stamped `every * k` after the first; one that
 * falls inside the stall is handled when it ends.
 */
const STALL_FROM = 10;
const STALL_MS = 48;
function streamWithStall(m: MountedRow, trace: readonly number[], every: number): void {
  const origin = frameClock.now();
  trace.forEach((deltaX, k) => {
    const at = origin + every * k;
    const stallEnd = origin + every * STALL_FROM + STALL_MS;
    const handled = k >= STALL_FROM && at < stallEnd ? stallEnd : at;
    if (handled > frameClock.now()) tick(handled - frameClock.now());
    wheelStamped(m, deltaX, at);
  });
  assert.ok(frameClock.now() >= origin + every * STALL_FROM + STALL_MS, 'control: the page stalled');
}

test('an arrow a control only stops from bubbling never reaches the row', () => {
  const m = stepRow(eleven(), 1000);
  const control = document.body.appendChild(document.createElement('div'));
  control.addEventListener('keydown', (e) => e.stopPropagation());
  m.key('ArrowRight', {}, control);
  assert.equal(m.scroller.glideTarget(), null);
  control.remove();
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

// --- revealOnScroll ------------------------------------------------------------------------------------------

const narrow = 430;
const swipe = async (m: MountedRow, deltaX: number): Promise<void> => {
  m.wheel({ deltaX });
  await advanceFrames(GLIDE_DONE_MS);
  tick(400);
};

test('a History click (activate) brings a parked panel back under all three revealOnScroll values', () => {
  for (const policy of ['edges', 'any', 'never'] as const) {
    const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll: policy }, { live: false }), made('c')), narrow);
    act(() => m.latest().activate('b'));
    assert.ok(m.live().includes('b'), policy);
    cleanup();
  }
});
