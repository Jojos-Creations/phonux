/**
 * An overflowing stepping row centers its whole slots at both ends: the margin before the strip and the end pad after it are both
 * shift = ((window + 16) % 406) / 2, so the last stop puts the last panel's right edge shift short of the window's right edge.
 * Rows are phone 390 with gap 16; the expected stops are the numbers the row gets at each container width.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceUntilRowRests, emblaWindowIn, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { act } from 'react';
import type { PanelWindow } from '../index.js';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const GAP = 16;
const PHONE = 390;

const rows: Record<string, () => PanelWindow[]> = {
  '[root, 1, 1, 5-slot, 1]': () => row(rootEntry(), made('a'), made('b'), made('c', { slots: 5 }), made('d')),
  '[root, 5-slot, 1]': () => row(rootEntry(), made('c', { slots: 5 }), made('d')),
  '[root, 5-slot, 1, 1]': () => row(rootEntry(), made('c', { slots: 5 }), made('d'), made('e')),
};

// The stops at each container width: the one-phone grid from 0 to maxScroll = shift + strip width + shift - window, where
// shift = ((window + 16) % 406) / 2 (33 at 1300, 0 at 2046, 97 at 2240). The slot-sized strips put that end on the grid.
const SHIFT: Record<number, number> = { 1300: 33, 2046: 0, 2240: 97 };
const expected: Record<string, number[]> = {
  '[root, 1, 1, 5-slot, 1]': [0, 406, 812, 1218, 1624],
  '[root, 5-slot, 1]': [0, 406, 812],
  '[root, 5-slot, 1, 1]': [0, 406, 812, 1218],
};

for (const [name, entries] of Object.entries(rows)) {
  for (const width of [1300, 2046, 2240]) {
    test(`${name} at ${width}: the last panel's right edge is the centering shift short of the window's right edge at the last stop`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      const last = n.widths.length - 1;
      const lastRight = n.rowMarginLeft + n.leftOffsets[last]! + n.widths[last]!;
      assert.equal(n.endPad, SHIFT[width], 'the end pad is the centering shift');
      assert.equal(maxScrollOf(n) + n.windowWidth - lastRight, SHIFT[width], 'the last stop centers the last panels');
    });

    test(`${name} at ${width}: rowMarginLeft is the centering shift and the stops are the expected ones, the last stop being the new maxScroll`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      assert.equal(n.rowMarginLeft, SHIFT[width], 'an overflowing row starts after the centering shift');
      assert.deepEqual(n.stops, expected[name]!, 'every stop is on the one-phone grid, and the last is the new maxScroll');
      assert.equal(n.stops.at(-1), maxScrollOf(n));
    });
  }
}

test('mounted at 2240 on the Embla row: the window is the whole slots that fit, centered by the shift, and its end puts the last panel flush with the window', async () => {
  const m = mountRow(rows['[root, 1, 1, 5-slot, 1]']!(), 2240, { tuning: { rowGesture: 'step' } });
  await advanceFrames(500);
  // Lays the Embla row out, so its window, its slots and its position read what a browser draws.
  stubSlotBoxes(m.container, 0);
  await advanceFrames(500);
  const n = m.latest().rowNumbers;
  assert.equal(n.endPad, 97, 'the end pad is the centering shift');
  const win = emblaWindowIn(m.container)!.getBoundingClientRect();
  assert.equal(win.width, 5 * (PHONE + GAP) - GAP, 'the window shows five whole slots');
  assert.equal((n.windowWidth - win.width) / 2, SHIFT[2240], 'what is left of the row area is the centering shift on each side');
  assert.equal(rowOffsetOf(m.container), 0, 'control: the row starts at its first stop');
  act(() => void m.latest().scrollTo('d'));
  await advanceUntilRowRests(m.container);
  assert.equal(rowOffsetOf(m.container), maxScrollOf(n), 'bringing the last panel in rests the row at the last stop');
  assert.equal(n.stops.at(-1), maxScrollOf(n));
  const slots = [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  assert.equal(slots.length, 5, 'control: one slot per panel');
  const lastRight = slots.at(-1)!.getBoundingClientRect().right;
  assert.equal(win.right - lastRight, 0, 'the last panel sits flush with the window, so the shift short of the row area');
});
