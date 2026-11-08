/**
 * A stepping row draws whole panels in its slot grid and nothing beside it (phone 390, gap 16, container 1000: window 968, two slots,
 * a margin of 86 each side). No slot is ever hidden: a panel wholly inside the grid is drawn whole, one crossing the grid's edge is cut
 * there by the strip's clip, and the margins stay empty. Reach (inert) follows the row's numbers, never a measured box. jsdom has no
 * layout, so nothing here reads a box.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf } from './support/strip.js';
import { moverOf } from '../slotMover.js';
import { act } from 'react';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { SLIDE_DURATION_SEC } from '../rowConstants.js';
import { mountRow, panelsOf } from './support/scroll-row.js';
import { gridEdgesOf, slotCutAt, type RowNumbers } from '../rowNumbers.js';

/** Long enough for a default-slide glide to land, with a few frames to spare. */
const GLIDE_DONE_MS = SLIDE_DURATION_SEC * 1000 + 100;
const GAP = 16;

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

/** Which drawn entries of `n` lie wholly outside the slot grid at offset `at`: the row's reach rule, restated from its numbers. */
const outOfReach = (n: RowNumbers, at: number): boolean[] => n.ids.map((_, k) => slotCutAt(n, k, at, GAP).away);

/**
 * The cut at the grid's edges: on the strip's fixed parent, so the same at every offset, counted from where the strip starts after the left
 * group, and held open one gap past each edge with no group beside it, where a panel's glow shows and no panel rests.
 */
const windowClip = (n: RowNumbers): string => {
  const { lo, hi } = gridEdgesOf(n);
  const a = lo - n.leftInset - (n.leftInset === 0 && n.stuck.length === 0 ? GAP : 0);
  const b = hi - n.leftInset + (n.rightInset === 0 && n.stuck.length === 0 ? GAP : 0);
  return `polygon(${a}px -100000px, ${b}px -100000px, ${b}px 100000px, ${a}px 100000px)`;
};

const mounted = (count = 5, container = 1000) => {
  const m = mountRow(panelsOf(count), container, { tuning: { rowGesture: 'step' } });
  const slots = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  const layout = (): void => m.rerender(container);
  layout();
  const numbers = (): RowNumbers => m.latest().rowNumbers;
  return {
    m,
    slots,
    layout,
    numbers,
    strip: () => m.container.querySelector<HTMLElement>('[data-row-strip]')!,
    window: () => m.container.querySelector<HTMLElement>('[data-row-window]')!,
    shown: () => slots().map((el) => el.style.visibility),
    cuts: () => slots().map((el) => el.style.clipPath),
    inert: () => slots().map((el) => el.hasAttribute('inert')),
  };
};

test('golden at the first stop: two whole panels in the grid, none hidden, and the panels past the grid are inert', () => {
  const t = mounted();
  assert.equal(t.numbers().rowMarginLeft, 86, 'positive control: the margin is half the 172 leftover');
  assert.deepEqual(t.shown(), ['', '', '', '', '', '']);
  assert.deepEqual(t.inert(), [false, false, true, true, true, true]);
  assert.equal(t.window().style.clipPath, windowClip(t.numbers()), 'the strip is cut one gap past the grid, 70 to 898, by its fixed parent');
  assert.equal(t.strip().style.clipPath, '', 'the strip itself carries no cut');
  assert.deepEqual(t.cuts(), ['', '', '', '', '', ''], 'no hold: a slot carries no cut of its own');
});

test('at every stop no slot is hidden, the strip is cut at the grid edges and inert follows the numbers', () => {
  const t = mounted();
  const stops = t.numbers().stops;
  assert.deepEqual(stops, [0, 406, 812, 1218, 1624], 'positive control: five stops on the one-phone grid');
  for (const stop of stops) {
    setRowOffset(t.m.container, stop);
    t.layout();
    assert.deepEqual(t.shown(), t.slots().map(() => ''), `every slot draws at stop ${stop}`);
    assert.equal(t.window().style.clipPath, windowClip(t.numbers()), `the grid's edges at stop ${stop}`);
    const away = outOfReach(t.numbers(), stop);
    assert.equal(away.filter((a) => !a).length, 2, `control: stop ${stop} shows two whole panels`);
    assert.deepEqual(t.inert(), away, `inert follows reach at stop ${stop}`);
  }
});

test('a drag that holds the row leaves reach alone, and it catches up after the release', async () => {
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
  assert.deepEqual(t.inert(), outOfReach(t.numbers(), 406));
  assert.notDeepEqual(t.inert(), before, 'control: the move changed reach');
});

test('Off: a step moves one stop; the panel that left the grid and the one past it are inert, and every slot stays drawn at full width', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  t.m.wheel({ deltaX: 50 });
  await advanceFrames(GLIDE_DONE_MS);
  const at = rowOffsetOf(t.m.container);
  assert.equal(at, 406, 'the second stop is one phone width on');
  t.layout();
  assert.deepEqual(t.shown(), ['', '', '', '', '', '']);
  assert.deepEqual(t.inert(), [true, false, false, true, true, true]);
  assert.equal(t.slots()[3]!.style.width, '390px', 'full size, not shrunk');
});

test('Off: focusing a panel off a stop makes the browser scroll, and the row settles back onto a stop', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  setRowOffset(t.m.container, 150);
  const inside = document.createElement('button');
  t.slots()[2]!.appendChild(inside);
  inside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await advanceFrames(GLIDE_DONE_MS);
  assert.ok(t.m.latest().rowNumbers.stops.includes(rowOffsetOf(t.m.container)), `rests on a stop, not ${rowOffsetOf(t.m.container)}`);
});

test('off a stop, mid-glide, the panels crossing the grid edge are cut there by the strip, not hidden, and stay in reach', () => {
  const t = mounted();
  // At 477 the first panel's right edge is at 86 + 390 - 477 = -1: wholly past the grid, so out of reach; the second shows 15 px past the edge.
  setRowOffset(t.m.container, 477);
  t.layout();
  assert.deepEqual(t.shown(), ['', '', '', '', '', ''], 'nothing is hidden');
  assert.equal(t.window().style.clipPath, windowClip(t.numbers()), 'the cut stands still while the offset moves');
  assert.deepEqual(t.inert(), [true, false, false, false, true, true], 'the fourth panel, at 827, shows 55 px inside the grid: in reach');
  setRowOffset(t.m.container, 476);
  t.layout();
  assert.equal(t.inert()[0], true, 'a 0 px peek is out of reach');
  setRowOffset(t.m.container, 300);
  t.layout();
  assert.equal(t.inert()[0], false, 'at 300 the first panel shows 90 px inside the grid: in reach');
});

test('a slot that slides without a scroll, as after a close or in a drag preview, is never hidden and the strip cut does not move', async () => {
  const t = mounted();
  setRowOffset(t.m.container, 477);
  t.layout();
  const clip = t.window().style.clipPath;
  t.m.rerender(1000);
  moverOf(t.slots()[0]!)!.set({ x: 391, y: 0, scale: 1, opacity: 1 });
  await advanceFrames(GLIDE_DONE_MS);
  assert.equal(t.slots()[0]!.style.visibility, '', 'a slot fully in view is drawn');
  assert.equal(t.window().style.clipPath, clip, 'the grid cut is the strip\'s fixed parent, so a slot moving inside it is cut where it is drawn');
});

const FOUR_FIT = 1700;

const mountedFourFit = () => mounted(6, FOUR_FIT);

test('when four phone slots fit, the fifth is wholly past the grid: drawn in the strip, cut by the grid edge, and out of reach', () => {
  const t = mountedFourFit();
  const n = t.numbers();
  assert.deepEqual(n.stops.slice(0, 3), [0, 406, 812], 'positive control: the row steps one phone width, with the 30 centering shift before the strip');
  assert.deepEqual(gridEdgesOf(n), { lo: 30, hi: 1638 }, 'the grid: four slots in the 1668 window');
  assert.deepEqual(t.shown().slice(0, 7), ['', '', '', '', '', '', ''], 'no slot is hidden');
  assert.equal(t.window().style.clipPath, windowClip(n));
  assert.deepEqual(t.inert(), [false, false, false, false, true, true, true], 'the fifth panel starts at 1654, past the grid: out of reach');
});

test('a slot that leaves the grid while the row glides keeps drawing; its reach follows the numbers at each offset', async () => {
  const t = mountedFourFit();
  mock.timers.enable({ apis: ['setTimeout'] });
  setRowOffset(t.m.container, 200);
  t.layout();
  assert.equal(t.shown()[0], '', 'the first slot is cut at its left edge off a stop and still draws');
  assert.equal(t.inert()[0], false, 'it still shows 220 px inside the grid');
  setRowOffset(t.m.container, 406);
  t.layout();
  assert.deepEqual(t.shown(), ['', '', '', '', '', '', ''], 'every slot draws at the second stop');
  assert.deepEqual(t.inert(), [true, false, false, false, false, true, true], 'the first panel has left the grid; the sixth is past it');
});

test('a panel wider than a phone is cut by the grid edge like any other, never hidden, and stays in reach while part of it shows', () => {
  const t = mounted(6, FOUR_FIT);
  const wide = t.slots()[4]!;
  // The fifth panel starts at 1654, 16 px past the grid's right edge at 1638: a two-slot panel there shows nothing yet.
  assert.equal(wide.style.visibility, '');
  assert.equal(wide.style.clipPath, '', 'the cut is the strip\'s, not the slot\'s');
  setRowOffset(t.m.container, 100);
  t.layout();
  assert.equal(t.inert()[4], false, 'at 100 the fifth panel shows 84 px inside the grid');
});

test('a slot sliding in after a close is drawn throughout, and reach follows the new numbers once the row has settled', async () => {
  const t = mountedFourFit();
  const slot = (id: string): HTMLElement => t.slots().find((el) => el.dataset.rowId === id)!;
  assert.equal(slot('s4').hasAttribute('inert'), true, 'positive control: the fifth panel is past the grid at rest');
  act(() => t.m.latest().close('s1'));
  mock.timers.enable({ apis: ['setTimeout'] });
  await advanceFrames(SLIDE_DURATION_SEC * 500);
  assert.equal(slot('s4').style.visibility, '', 'a slot sliding into the grid is drawn while the slide runs');
  await advanceFrames(GLIDE_DONE_MS);
  t.layout();
  assert.equal(slot('s4').style.visibility, '', 'a whole slot draws at rest');
  assert.equal(slot('s4').hasAttribute('inert'), false, 's4 is in the fourth slot now');
  assert.equal(slot('s5').hasAttribute('inert'), true, 's5 is past the grid');
});

test('a glide writes the grid cut no more than the commit that set it: nothing is rewritten from the strip each frame', async () => {
  const t = mounted();
  mock.timers.enable({ apis: ['setTimeout'] });
  const writes: string[] = [];
  const observer = new MutationObserver((records) => writes.push(...records.map((r) => `${r.target === t.window() ? 'window' : 'strip'}:${r.attributeName}`)));
  observer.observe(t.window(), { attributes: true, attributeFilter: ['style'] });
  const before = t.window().style.clipPath;
  t.m.wheel({ deltaX: 50 });
  await advanceFrames(GLIDE_DONE_MS);
  observer.disconnect();
  assert.equal(rowOffsetOf(t.m.container), 406, 'control: the row glided a stop');
  assert.deepEqual(writes, [], 'the window element was not written during the glide');
  assert.equal(t.window().style.clipPath, before);
  assert.notEqual(before, '', 'control: there is a cut to rewrite');
});
