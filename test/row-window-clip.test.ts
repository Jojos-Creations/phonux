/**
 * The cut at the slot grid's edges is on the strip's fixed parent, so it is counted from where that parent starts: after the left
 * group. A row held only at the left runs on to the window's edge, where its slots cut themselves; with a right hold too it ends at
 * the grid's edge. A row with nothing to cut carries no clip.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { cleanup } from './support/mount-harness.js';
import { made, mountRow, panelsOf, rootEntry, row } from './support/scroll-row.js';
import { gridEdgesOf } from '../rowNumbers.js';
import { ROW_GAP } from '../rowConstants.js';

afterEach(() => cleanup());

const polygon = (lo: number, hi: number): string => `polygon(${lo}px -100000px, ${hi}px -100000px, ${hi}px 100000px, ${lo}px 100000px)`;
const windowOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('[data-row-window]')!;

test('a left hold: the cut starts after the left group and runs on to the window edge', () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d')), 1000);
  const n = m.latest().rowNumbers;
  assert.ok(n.leftInset > 0 && n.rightInset === 0, 'control: only a left group');
  assert.equal(windowOf(m.container).style.clipPath, polygon(gridEdgesOf(n).lo - n.leftInset, n.windowWidth + ROW_GAP - n.leftInset));
});

test('a left and a right hold: the cut is the grid, counted from where the strip starts', () => {
  const m = mountRow(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d', { edgeHold: 'right' })), 1400);
  const n = m.latest().rowNumbers;
  assert.ok(n.leftInset > 0 && n.rightInset > 0, 'control: both groups');
  const { lo, hi } = gridEdgesOf(n);
  assert.equal(windowOf(m.container).style.clipPath, polygon(lo - n.leftInset, hi - n.leftInset));
});

test('a row that fits has nothing to cut and no clip', () => {
  const m = mountRow(panelsOf(1), 1400);
  assert.equal(m.latest().rowNumbers.stops.length, 0, 'control: no stops');
  assert.equal(windowOf(m.container).style.clipPath, '');
});
