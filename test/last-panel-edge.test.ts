/**
 * An overflowing stepping row centers its whole slots at both ends: the margin before the strip and the end pad after it are both
 * shift = ((window + 16) % 406) / 2, so the last stop puts the last panel's right edge shift short of the window's right edge.
 * Rows are phone 390 with gap 16; the expected stops are the numbers the row gets at each container width.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import type { PanelWindow } from '../index.js';
import { computeRowNumbers, maxScrollOf } from '../rowNumbers.js';
import { cleanup } from './support/mount-harness.js';
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

test('mounted at 2240: stepping to the last stop lands the scroll at maxScrollOf, the last panel centered, and the end element is the gap plus the shift', () => {
  const m = mountRow(rows['[root, 1, 1, 5-slot, 1]']!(), 2240, { tuning: { rowGesture: 'step' } });
  const n = m.latest().rowNumbers;
  const last = n.stops.at(-1)!;
  m.scroller.glideTo(last, { durationSec: 0, instant: true, ease: 'cubic-out' });
  assert.equal(m.container.scrollLeft, maxScrollOf(n), 'the scroll range ends at the new last stop');
  const end = n.widths.length - 1;
  assert.equal(n.endPad, 97, 'the end pad is the centering shift');
  assert.equal(maxScrollOf(n) + n.windowWidth - (n.rowMarginLeft + n.leftOffsets[end]! + n.widths[end]!), 97, 'the last panel sits the shift short of the window edge');
  assert.equal(m.container.querySelector<HTMLElement>('[data-row-end-pad]')!.style.flex, `0 0 ${GAP + 97}px`, 'the end space is the row gap plus the shift');
});
