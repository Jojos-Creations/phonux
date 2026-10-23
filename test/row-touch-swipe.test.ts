/**
 * A finger drag on a stepping row takes the same steps a wheel does: a horizontal drag steps once per phone width of
 * travel and its glide lands on a stop, a vertical drag leaves the row where it is. Touch events are plain Events with a
 * `touches` list here, since jsdom has no Touch constructor; the mock timers and frame clock are the wheel tests' own.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { computeRowNumbers, type RowNumbers } from '../rowNumbers.js';
import { mountRow, panelsOf, type MountedRow } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

/** Long enough for a default-slide glide to land, with a few frames to spare. */
const GLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;

const stepRow = (width: number): MountedRow =>
  mountRow(panelsOf(10), width, { tuning: { rowGesture: 'step' } } as Parameters<typeof mountRow>[2]);

const stopsOf = (m: MountedRow, width: number): number[] => {
  const numbers: RowNumbers = computeRowNumbers({ entries: m.latest().entries, phoneWidth: 390, containerWidth: width, gap: m.latest().tuning.rowGap, wholePanels: true });
  return [...numbers.stops];
};

/** A touch event whose `touches` list holds one point, as a browser's finger event does. */
const touchEvent = (type: string, x: number, y: number): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] });
  return event;
};

/** Drags one finger from (x0, y0) to (x1, y1) in `steps` moves. */
const drag = (m: MountedRow, [x0, y0]: [number, number], [x1, y1]: [number, number], steps: number): void => {
  act(() => void m.container.dispatchEvent(touchEvent('touchstart', x0, y0)));
  for (let n = 1; n <= steps; n += 1) {
    const x = x0 + ((x1 - x0) * n) / steps;
    const y = y0 + ((y1 - y0) * n) / steps;
    act(() => void m.container.dispatchEvent(touchEvent('touchmove', x, y)));
  }
  act(() => void m.container.dispatchEvent(touchEvent('touchend', x1, y1)));
};

test('a finger dragged left steps the row right once, and its glide lands on the stop', async () => {
  const m = stepRow(1000);
  const stops = stopsOf(m, 1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  drag(m, [700, 300], [300, 300], 40);
  assert.equal(m.scroller.glideTarget(), stops[1]);
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(m.container.scrollLeft, stops[1]);
});

test('a finger dragged up leaves the row where it is', async () => {
  const m = stepRow(1000);
  mock.timers.enable({ apis: ['setTimeout'] });
  drag(m, [500, 600], [500, 100], 40);
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(m.container.scrollLeft, 0);
});
