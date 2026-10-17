/**
 * A stepping row's last stop rests with the last panel one gap inside the window, and endPad is 0. Rows are phone 390 with gap 16;
 * the expected margins and stops are the numbers the row gets at each container width.
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

// The margin and stops at each container width. The stops are the one-phone grid up to the new last stop.
const expected: Record<string, Record<number, { rowMarginLeft: number; stops: number[] }>> = {
  '[root, 1, 1, 5-slot, 1]': {
    1300: { rowMarginLeft: 33, stops: [0, 406, 812, 1218, 1591] },
    2046: { rowMarginLeft: 406, stops: [0, 406, 812, 1218, 1624, 2030] },
    2240: { rowMarginLeft: 503, stops: [0, 406, 812, 1218, 1624, 1933] },
  },
  '[root, 5-slot, 1]': {
    1300: { rowMarginLeft: 439, stops: [0, 406, 812, 1185] },
    2046: { rowMarginLeft: 812, stops: [0, 406, 812, 1218, 1624] },
    2240: { rowMarginLeft: 909, stops: [0, 406, 812, 1218, 1527] },
  },
  '[root, 5-slot, 1, 1]': {
    1300: { rowMarginLeft: 439, stops: [0, 406, 812, 1218, 1591] },
    2046: { rowMarginLeft: 812, stops: [0, 406, 812, 1218, 1624, 2030] },
    2240: { rowMarginLeft: 909, stops: [0, 406, 812, 1218, 1624, 1933] },
  },
};

for (const [name, entries] of Object.entries(rows)) {
  for (const width of [1300, 2046, 2240]) {
    test(`${name} at ${width}: endPad is 0 and the last panel's right edge is one gap inside the window at the last stop`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      const last = n.widths.length - 1;
      const lastRight = n.rowMarginLeft + n.leftOffsets[last]! + n.widths[last]!;
      assert.equal(n.endPad, 0, 'the end pad is 0');
      assert.equal(maxScrollOf(n) + n.windowWidth - lastRight, 0, 'the last stop puts the last panel edge at the window edge, one gap in from the container');
    });

    test(`${name} at ${width}: rowMarginLeft and the stops are the expected ones, the last stop being the new maxScroll`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      const want = expected[name]![width]!;
      assert.equal(n.rowMarginLeft, want.rowMarginLeft, 'rowMarginLeft is unchanged');
      assert.deepEqual(n.stops, want.stops, 'every stop below the last is on the one-phone grid, and the last is the new maxScroll');
      assert.equal(n.stops.at(-1), maxScrollOf(n));
    });
  }
}

test('mounted at 2240: stepping to the last stop lands the scroll at maxScrollOf, and the end element is one gap wide', () => {
  const m = mountRow(rows['[root, 1, 1, 5-slot, 1]']!(), 2240, { tuning: { rowGesture: 'step' } });
  const n = m.latest().rowNumbers;
  const last = n.stops.at(-1)!;
  m.scroller.glideTo(last, { durationSec: 0, instant: true, ease: 'cubic-out' });
  assert.equal(m.container.scrollLeft, maxScrollOf(n), 'the scroll range ends at the new last stop');
  const end = n.widths.length - 1;
  assert.equal(maxScrollOf(n) + n.windowWidth - (n.rowMarginLeft + n.leftOffsets[end]! + n.widths[end]!), 0, 'the last panel sits one gap in from the window edge');
  assert.equal(m.container.querySelector<HTMLElement>('[data-row-end-pad]')!.style.flex, `0 0 ${GAP}px`, 'the end space is the row gap wide');
});
