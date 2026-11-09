/**
 * useRowFrameBand: the band follows the frames while they move without resizing anything it observes, as the row's top margin
 * does when it glides after a resize.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { frameClock } from './support/jsdom-globals.js';
import * as React from 'react';
import { cleanup, mount } from './support/mount-harness.js';
import { useRowFrameBand, type RowFrameBand } from '../index.js';
import { ROW_STRIP_ATTRIBUTE } from '../rowDom.js';
import { EMBLA_WINDOW_ATTRIBUTE } from '../emblaRow.js';

class SilentObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
const originalObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = SilentObserver;

afterEach(() => {
  cleanup();
});

test.after(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalObserver;
});

const rect = (top: number, bottom: number): DOMRect => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

function rig(frames: string = ROW_STRIP_ATTRIBUTE): { reports: RowFrameBand[]; stripAt: { top: number } } {
  const reports: RowFrameBand[] = [];
  const stripAt = { top: 300 };
  function Page(): React.ReactElement {
    const page = React.useRef<HTMLDivElement>(null);
    const scroller = React.useRef<HTMLDivElement>(null);
    useRowFrameBand(page, scroller, (band) => reports.push(band));
    const setPage = (el: HTMLDivElement | null): void => {
      page.current = el;
      if (el) el.getBoundingClientRect = () => rect(0, 1000);
    };
    const setStrip = (el: HTMLDivElement | null): void => {
      if (el) el.getBoundingClientRect = () => rect(stripAt.top, stripAt.top + 500);
    };
    return React.createElement('div', { ref: setPage }, React.createElement('div', { ref: scroller }, React.createElement('div', { [frames]: '', ref: setStrip })));
  }
  mount(React.createElement(Page));
  return { reports, stripAt };
}

const last = (reports: RowFrameBand[]): string => {
  const band = reports.at(-1);
  return band === undefined ? 'none' : `${band.above} ${band.below}`;
};

test('a frame move with no resize, as a margin glide, still reaches the band on the next paint', () => {
  const { reports, stripAt } = rig();
  assert.equal(last(reports), '300 200');
  stripAt.top = 250;
  frameClock.step(1);
  assert.equal(last(reports), '250 250');
});

test('a window resize follows a glide that starts after the settle wait', () => {
  const { reports, stripAt } = rig();
  frameClock.step(120);
  window.dispatchEvent(new Event('resize'));
  frameClock.step(15);
  stripAt.top = 260;
  frameClock.step(1);
  assert.equal(last(reports), '260 240');
});

test('the band stops following once the frames hold still, and reports each place once', () => {
  const { reports, stripAt } = rig();
  frameClock.step(120);
  assert.equal(frameClock.pendingCount(), 0);
  assert.equal(reports.length, 1);
  stripAt.top = 280;
  frameClock.step(5);
  assert.equal(last(reports), '300 200');
});

test('on an Embla row, which draws no strip, the band is the Embla window and follows a window resize', () => {
  const { reports, stripAt } = rig(EMBLA_WINDOW_ATTRIBUTE);
  assert.equal(last(reports), '300 200');
  frameClock.step(120);
  window.dispatchEvent(new Event('resize'));
  stripAt.top = 260;
  frameClock.step(1);
  assert.equal(last(reports), '260 240');
});
