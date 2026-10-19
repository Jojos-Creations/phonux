/**
 * A stepping row shows the neighbour of a stop cut by the window edge at its own size (phone 390, gap 16, container 1000: window 968,
 * two panels fit). jsdom has no layout, so each element's rectangle is set from the row's own numbers.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

/** Long enough for a default-slide glide to land, with a few frames to spare. */
const GLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const mounted = () => {
  const m = mountRow(panelsOf(5), 1000, { tuning: { rowGesture: 'step' } });
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

test('golden at the first stop: every panel is opaque, the cut-off neighbour is reachable and panels the window never reaches are not', () => {
  const off = mounted();
  assert.deepEqual(off.filters(), ['', '', '', '', '', '']);
  assert.deepEqual(off.inert(), [false, false, false, true, true, true]);
});

test('a drag that holds the row leaves reach alone, and it catches up after the release', () => {
  const t = mounted();
  const before = t.inert();
  const claim = t.m.scroller.claim();
  assert.ok(claim, 'the scroller gave its claim');
  claim.setMaxScroll(1624);
  claim.write(406);
  t.layout();
  assert.deepEqual(t.inert(), before, 'positive control: the row moved, reach did not');
  claim.release();
  t.layout();
  assert.deepEqual(t.inert(), [false, false, false, false, true, true]);
});

test('Off: a step moves one stop and the panel just past the window stays drawn in full width', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  t.m.wheel({ deltaX: 50 });
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(t.m.container.scrollLeft, 406);
  t.layout();
  assert.deepEqual(t.filters(), ['', '', '', '', '', '']);
  assert.deepEqual(t.inert(), [false, false, false, false, true, true], 'panels cut by either edge are not inert; one the window never reaches is');
  assert.equal(t.slots()[3]!.getBoundingClientRect().width, 390, 'full size, not shrunk');
});

test('Off: focusing the cut-off neighbour makes the browser scroll, and the row settles back onto a stop', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  t.m.container.scrollLeft = 150;
  const inside = document.createElement('button');
  t.slots()[2]!.appendChild(inside);
  inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await advanceFrames(GLIDE_DONE_MS);
  assert.ok(t.m.latest().rowNumbers.stops.includes(t.m.container.scrollLeft), `rests on a stop, not ${t.m.container.scrollLeft}`);
});

test('a panel the window cuts to less than a gap is hidden, and one showing a full gap is drawn', () => {
  const t = mounted();
  const shown = (): string[] => t.slots().map((el) => el.style.visibility);
  assert.deepEqual(shown(), ['', '', '', '', '', ''], 'positive control: at the first stop the cut-off neighbour shows 86 px and is drawn');
  // The first panel's right edge sits at 492 - scroll, so these leave 15 px and then 16 px of it in the window.
  t.m.container.scrollLeft = 477;
  t.layout();
  assert.equal(shown()[0], 'hidden', 'a 15 px peek is a sliver');
  assert.equal(t.inert()[0], false, 'still reachable: hidden is drawing only');
  t.m.container.scrollLeft = 476;
  t.layout();
  assert.equal(shown()[0], '', 'a 16 px peek is drawn');
  assert.equal(shown()[1], '');
});
