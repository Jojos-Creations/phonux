/**
 * Off shows the neighbour of a stop cut by the window edge at its own size (phone 390, gap 16, container 1000: window 968,
 * two panels fit). jsdom has no layout, so each element's rectangle is set from the row's own numbers.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

type Mode = 'off' | 'visible' | 'hidden';
const mounted = (mode: Mode) => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step', shrinkOutOfView: mode } });
  const slots = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });
  m.container.getBoundingClientRect = () => rect(0, 1000);
  const layout = (): void => {
    const scroll = m.container.scrollLeft;
    slots().forEach((el, k) => {
      el.getBoundingClientRect = () => rect(16 + 86 + 406 * k - scroll, 390);
    });
    act(() => void m.container.dispatchEvent(new Event('scroll')));
  };
  layout();
  return { m, slots, layout, filters: () => slots().map((el) => el.style.filter), inert: () => slots().map((el) => el.hasAttribute('inert')) };
};

test('golden at the first stop: Off draws every panel opaque, Hide fades the rest out, Shrink is its own stepping row', () => {
  const off = mounted('off');
  assert.deepEqual(off.filters(), ['', '', '', '', '', '']);
  assert.deepEqual(off.inert(), [false, false, false, true, true, true], 'the cut-off neighbour is reachable, panels the window never reaches are not');
  const hidden = mounted('hidden');
  assert.deepEqual(hidden.filters(), ['', '', 'opacity(0)', 'opacity(0)', 'opacity(0)', 'opacity(0)']);
  assert.deepEqual(hidden.inert(), [false, false, true, true, true, true]);
  const visible = mounted('visible');
  assert.equal(visible.m.latest().rowNumbers.showPartial, false);
});

test('Off: a step moves one stop and the panel just past the window stays drawn in full width', async () => {
  const t = mounted('off');
  mock.timers.enable({ apis: ['setTimeout'] });
  t.m.wheel({ deltaX: 50 });
  await advanceFrames(600);
  assert.equal(t.m.container.scrollLeft, 406);
  t.layout();
  assert.deepEqual(t.filters(), ['', '', '', '', '', '']);
  assert.deepEqual(t.inert(), [false, false, false, false, true, true], 'panels cut by either edge are not inert; one the window never reaches is');
  assert.equal(t.slots()[3]!.getBoundingClientRect().width, 390, 'full size, not shrunk');
});

test('Off: focusing the cut-off neighbour makes the browser scroll, and the row settles back onto a stop', async () => {
  const t = mounted('off');
  mock.timers.enable({ apis: ['setTimeout'] });
  t.m.container.scrollLeft = 150;
  const inside = document.createElement('button');
  t.slots()[2]!.appendChild(inside);
  inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await advanceFrames(600);
  assert.ok(t.m.latest().rowNumbers.stops.includes(t.m.container.scrollLeft), `rests on a stop, not ${t.m.container.scrollLeft}`);
});
