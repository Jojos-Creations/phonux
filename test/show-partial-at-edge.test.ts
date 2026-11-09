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

const FOUR_FIT = 1700;

const mountedFourFit = () => mounted(6, FOUR_FIT);

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

