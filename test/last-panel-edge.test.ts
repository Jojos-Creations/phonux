/**
 * A stepping row's last stop rests with the last whole run centered: the last panel's right edge sits endPad inside the window,
 * which is the tail's leftover on each side. Rows are phone 390 with gap 16; the expected margins, pads and stops are the numbers
 * the row gets at each container width.
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

// The margin, end pad and stops at each container width. The margin centers the first whole run and the end pad the last one; the
// stops are the one-phone grid up to the last stop, which is the strip width plus both pads less the window.
const expected: Record<string, Record<number, { rowMarginLeft: number; endPad: number; stops: number[] }>> = {
  '[root, 1, 1, 5-slot, 1]': {
    1300: { rowMarginLeft: 33, endPad: 439, stops: [0, 406, 812, 1218, 1624, 2030] },
    2046: { rowMarginLeft: 406, endPad: 812, stops: [0, 406, 812, 1218, 1624, 2030, 2436, 2842] },
    2240: { rowMarginLeft: 503, endPad: 909, stops: [0, 406, 812, 1218, 1624, 2030, 2436, 2842] },
  },
  '[root, 5-slot, 1]': {
    1300: { rowMarginLeft: 439, endPad: 439, stops: [0, 406, 812, 1218, 1624] },
    2046: { rowMarginLeft: 812, endPad: 812, stops: [0, 406, 812, 1218, 1624, 2030, 2436] },
    2240: { rowMarginLeft: 909, endPad: 909, stops: [0, 406, 812, 1218, 1624, 2030, 2436] },
  },
  '[root, 5-slot, 1, 1]': {
    1300: { rowMarginLeft: 439, endPad: 236, stops: [0, 406, 812, 1218, 1624, 1827] },
    2046: { rowMarginLeft: 812, endPad: 609, stops: [0, 406, 812, 1218, 1624, 2030, 2436, 2639] },
    2240: { rowMarginLeft: 909, endPad: 706, stops: [0, 406, 812, 1218, 1624, 2030, 2436, 2639] },
  },
};

for (const [name, entries] of Object.entries(rows)) {
  for (const width of [1300, 2046, 2240]) {
    test(`${name} at ${width}: the last panel's right edge is endPad inside the window at the last stop`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      const last = n.widths.length - 1;
      const lastRight = n.rowMarginLeft + n.leftOffsets[last]! + n.widths[last]!;
      assert.equal(n.endPad, expected[name]![width]!.endPad, 'the tail is centered by its leftover');
      assert.equal(maxScrollOf(n) + n.windowWidth - lastRight, n.endPad, 'the last stop leaves the tail its endPad on the right, as on the left of its run');
    });

    test(`${name} at ${width}: rowMarginLeft and the stops are the expected ones, the last stop being the new maxScroll`, () => {
      const n = computeRowNumbers({ entries: entries(), phoneWidth: PHONE, containerWidth: width, gap: GAP, wholePanels: true });
      const want = expected[name]![width]!;
      assert.equal(n.rowMarginLeft, want.rowMarginLeft, 'the first whole run is centered in the window');
      assert.deepEqual(n.stops, want.stops, 'every stop below the last is on the one-phone grid, and the last is the new maxScroll');
      assert.equal(n.stops.at(-1), maxScrollOf(n));
    });
  }
}

test('mounted at 2240: stepping to the last stop lands the scroll at maxScrollOf, and the end element is endPad plus one gap', () => {
  const m = mountRow(rows['[root, 1, 1, 5-slot, 1]']!(), 2240, { tuning: { rowGesture: 'step' } });
  const n = m.latest().rowNumbers;
  const last = n.stops.at(-1)!;
  m.scroller.glideTo(last, { durationSec: 0, instant: true, ease: 'cubic-out' });
  assert.equal(m.container.scrollLeft, maxScrollOf(n), 'the scroll range ends at the new last stop');
  const end = n.widths.length - 1;
  assert.equal(maxScrollOf(n) + n.windowWidth - (n.rowMarginLeft + n.leftOffsets[end]! + n.widths[end]!), n.endPad, 'the last panel sits endPad in from the window edge');
  assert.equal(m.container.querySelector<HTMLElement>('[data-row-end-pad]')!.style.flex, `0 0 ${n.endPad + GAP}px`, 'the end space is endPad plus the row gap');
});
