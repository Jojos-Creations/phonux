/**
 * A stepping row keeps the neighbor of a stop cut by the window edge at its own size but does not draw it at rest (phone 390, gap 16,
 * container 1000: window 968, two panels fit). jsdom has no layout, so each element's rectangle is set from the row's own numbers.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { moverOf } from '../slotMover.js';
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
  // The row measures its slots once per render and follows every move from its numbers, so a new layout takes a render.
  const layout = (): void => {
    stubSlotBoxes(m.container, 16);
    m.rerender(1000);
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
  assert.equal(rowOffsetOf(t.m.container), 406, 'the second stop is one phone width on');
  t.layout();
  assert.deepEqual(t.filters(), ['', '', '', '', '', '']);
  assert.deepEqual(t.inert(), [false, false, false, false, true, true], 'panels cut by either edge are not inert; one the window never reaches is');
  assert.equal(t.slots()[3]!.getBoundingClientRect().width, 390, 'full size, not shrunk');
});

test('Off: focusing the cut-off neighbour makes the browser scroll, and the row settles back onto a stop', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  setRowOffset(t.m.container, 150);
  const inside = document.createElement('button');
  t.slots()[2]!.appendChild(inside);
  inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await advanceFrames(GLIDE_DONE_MS);
  assert.ok(t.m.latest().rowNumbers.stops.includes(rowOffsetOf(t.m.container)), `rests on a stop, not ${rowOffsetOf(t.m.container)}`);
});

test('a panel the window cuts to less than a gap is hidden, and one showing a full gap is drawn', () => {
  const t = mounted();
  const shown = (): string[] => t.slots().map((el) => el.style.visibility);
  assert.deepEqual(shown(), ['', '', 'hidden', '', '', ''], 'positive control: at the first stop the cut-off neighbour shows 172 px, more than a gap, and is still not drawn');
  // The first panel's right edge sits at 492 - scroll, so these leave 15 px and then 16 px of it in the window.
  setRowOffset(t.m.container, 477);
  t.layout();
  assert.equal(shown()[0], 'hidden', 'a 15 px peek is a sliver');
  assert.equal(t.inert()[0], false, 'still reachable: hidden is drawing only');
  setRowOffset(t.m.container, 476);
  t.layout();
  assert.equal(shown()[0], '', 'a 16 px peek is drawn');
  assert.equal(shown()[1], '');
});

test('a hidden sliver that slides into view without a scroll, as after a close, is drawn again', async () => {
  const t = mounted();
  setRowOffset(t.m.container, 477);
  t.layout();
  assert.equal(t.slots()[0]!.style.visibility, 'hidden', 'positive control: a 15 px peek starts hidden');
  // A render starts the follow-through; the slot then slides fully into the window with no move of the row.
  t.m.rerender(1000);
  moverOf(t.slots()[0]!)!.set({ x: 391, y: 0, scale: 1, opacity: 1 });
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(t.slots()[0]!.style.visibility, '', 'a slot fully in view is drawn');
});

test('a hidden sliver that a held drag slides into view is drawn while the drag still holds the row', async () => {
  const t = mounted();
  setRowOffset(t.m.container, 477);
  t.layout();
  assert.equal(t.slots()[0]!.style.visibility, 'hidden', 'positive control: a 15 px peek starts hidden');
  await advanceFrames(GLIDE_DONE_MS);
  const claim = t.m.scroller.claim();
  assert.ok(claim, 'the scroller gave its claim');
  // The drag's preview moves the slot with no move of the row and no Workspace render; only the pointer moves on the row.
  moverOf(t.slots()[0]!)!.set({ x: 391, y: 0, scale: 1, opacity: 1 });
  act(() => void t.slots()[0]!.dispatchEvent(new Event('pointermove', { bubbles: true })));
  await advanceFrames(100);
  assert.equal(t.slots()[0]!.style.visibility, '', 'a slot fully in view is drawn during the drag');
  claim.release();
});

const FOUR_FIT = 1700;

const mountedFourFit = () => {
  const m = mountRow(panelsOf(6), FOUR_FIT, { tuning: { rowGesture: 'step' } });
  const slots = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  const rect = (left: number, width: number): DOMRect => ({ left, right: left + width, top: 0, bottom: 700, width, height: 700, x: left, y: 0, toJSON: () => ({}) });
  m.container.getBoundingClientRect = () => rect(0, FOUR_FIT);
  const layout = (): void => {
    stubSlotBoxes(m.container, 16);
    m.rerender(FOUR_FIT);
  };
  layout();
  return { m, slots, layout, shown: () => slots().map((el) => el.style.visibility) };
};

test('when four phone slots fit, the fifth is cut by the window edge and is not drawn, though 60 px of it shows', () => {
  const t = mountedFourFit();
  assert.deepEqual(t.m.latest().rowNumbers.stops.slice(0, 3), [0, 406, 812], 'positive control: the row steps one phone width, with the 30 centering shift before the strip');
  assert.deepEqual(t.shown().slice(0, 6), ['', '', '', '', 'hidden', ''], 'the four whole slots draw, the cut fifth does not');
  assert.equal(t.slots()[4]!.hasAttribute('inert'), false, 'hidden is drawing only: the cut slot stays reachable');
});

test('a slot that slides out of the window while the row glides keeps drawing until the row rests', async () => {
  const t = mountedFourFit();
  mock.timers.enable({ apis: ['setTimeout'] });
  setRowOffset(t.m.container, 200);
  t.layout();
  assert.equal(t.shown()[0], '', 'the first slot is cut at its left edge off a stop and still draws');
  setRowOffset(t.m.container, 406);
  t.layout();
  assert.equal(t.shown()[5], 'hidden', 'the sixth slot is the cut neighbour at the second stop and does not draw');
  assert.deepEqual(t.shown().slice(1, 5), ['', '', '', ''], 'the four whole slots draw');
});

test('a panel wider than a phone may show partly at rest', () => {
  const t = mountedFourFit();
  const wide = t.slots()[4]!;
  wide.getBoundingClientRect = () => ({ left: 1640, right: 2436, top: 0, bottom: 700, width: 796, height: 700, x: 1640, y: 0, toJSON: () => ({}) });
  t.m.rerender(FOUR_FIT);
  assert.equal(wide.style.visibility, '', 'a two-slot panel cut by the edge is drawn');
});

test('a slot sliding in after a close stays drawn mid-slide and is hidden once the slide has landed', async () => {
  const t = mountedFourFit();
  const slot = (id: string): HTMLElement => t.slots().find((el) => el.dataset.rowId === id)!;
  assert.equal(slot('s4').style.visibility, 'hidden', 'positive control: the fifth slot is the cut neighbour at rest');
  act(() => t.m.latest().close('s1'));
  // A close slides the slots with no move of the row: s4 is on its way from 1640 to 1234, inside the window.
  mock.timers.enable({ apis: ['setTimeout'] });
  await advanceFrames(SLIDE_DURATION_SEC * 500);
  const mid = slot('s4').getBoundingClientRect();
  assert.ok(mid.left < 1640 && mid.left > 1234, `control: s4 is mid-slide at ${mid.left}`);
  assert.equal(slot('s4').style.visibility, '', 'a slot sliding into view is drawn while the slide runs');
  await advanceFrames(GLIDE_DONE_MS);
  t.layout();
  assert.equal(slot('s4').style.visibility, '', 'a whole slot draws at rest');
  assert.equal(slot('s5').style.visibility, 'hidden', 'the cut neighbour is hidden once the slide has landed');
});
