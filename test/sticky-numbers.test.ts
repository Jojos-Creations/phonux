/**
 * computeRowNumbers for sticky panels, on literal rows (phone 390, gap 16), written from their sums. A container of W px has a
 * window of W - 32, and a slot is 406 px of pitch: 1280, 1920, 2240, 2560 and 3440 hold 3, 4, 5, 6 and 8 slots.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, rowSegmentsOf, snapToStop, type RowNumbers, type RowSegment } from '../rowNumbers.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const GAP = 16;
const PITCH = 406;

registerTestView('sticky-view', ({ panel }) => createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'sticky-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}
const scrollRoot = (layer: PanelSettings = {}): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'sticky-view' }, resolvePanelSettings({ template: { title: 'History', ...layer } }, { root: true }).value, 'create');

const numbers = (entries: PanelWindow[], containerWidth = 1000, o: { wholePanels?: boolean; minScrollSlots?: number } = {}): RowNumbers =>
  computeRowNumbers({ entries, phoneWidth: 390, containerWidth, gap: GAP, wholePanels: o.wholePanels ?? false, ...(o.minScrollSlots === undefined ? {} : { minScrollSlots: o.minScrollSlots }) });
const segments = (n: RowNumbers): readonly RowSegment[] => rowSegmentsOf(n, PITCH, GAP);
const shape = (n: RowNumbers): ReadonlyArray<readonly [string, number]> => segments(n).map((s) => [s.kind, s.slots]);

/** `count` plain panels named p<from> upward. */
const plain = (count: number, from = 1): PanelWindow[] => Array.from({ length: count }, (_, k) => made(`p${k + from}`));

// ---------------------------------------------------------------------------
// The slot arithmetic, per window width
// ---------------------------------------------------------------------------

/** The widths under test and the slots each holds. */
const WIDTHS: ReadonlyArray<readonly [width: number, slots: number]> = [
  [1280, 3],
  [1920, 4],
  [2240, 5],
  [2560, 6],
  [3440, 8],
];

for (const [width, slots] of WIDTHS) {
  const room = width - 2 * GAP;

  test(`${width} px (${slots} slots): a row with no sticky panel is one scrolling row of ${slots}`, () => {
    const n = numbers([scrollRoot(), ...plain(14)], width);
    assert.deepEqual(n.held, []);
    assert.equal(n.stripWindow, room);
    assert.deepEqual(shape(n), [['scroll', slots]]);
  });

  test(`${width} px (${slots} slots): [sticky | row of ${slots - 1}] takes one slot at the start and leaves the rest scrolling`, () => {
    const n = numbers([scrollRoot({ sticky: 'start' }), ...plain(14)], width);
    assert.deepEqual(n.held, [{ id: ROOT, side: 'left', width: 390, offset: 0 }]);
    assert.equal(n.leftInset, PITCH);
    assert.equal(n.rightInset, 0);
    assert.equal(n.stripWindow, room - PITCH);
    assert.equal(n.ids.includes(ROOT), false, 'the sticky panel is not in the strip');
    assert.deepEqual(shape(n), [['sticky', 1], ['scroll', slots - 1]]);
  });

  test(`${width} px (${slots} slots): [sticky | row of ${slots - 2} | sticky] keeps one slot at each end`, () => {
    const n = numbers([scrollRoot({ sticky: 'start' }), ...plain(13), made('last', { sticky: 'end' })], width);
    assert.deepEqual(n.held.map((h) => [h.id, h.side, h.offset]), [[ROOT, 'left', 0], ['last', 'right', GAP]]);
    assert.deepEqual([n.leftInset, n.rightInset], [PITCH, PITCH]);
    assert.equal(n.stripWindow, room - 2 * PITCH);
    assert.deepEqual(shape(n), [['sticky', 1], ['scroll', slots - 2], ['sticky', 1]]);
  });

  test(`${width} px (${slots} slots): [sticky | sticky | row of ${slots - 2}] stacks two at the start, in row order`, () => {
    const n = numbers([scrollRoot({ sticky: 'start' }), made('p1', { sticky: 'start' }), ...plain(12, 2)], width);
    assert.deepEqual(n.held.map((h) => [h.id, h.side, h.offset]), [[ROOT, 'left', 0], ['p1', 'left', PITCH]]);
    assert.equal(n.leftInset, 2 * PITCH);
    assert.equal(n.stripWindow, room - 2 * PITCH);
    assert.deepEqual(shape(n), [['sticky', 1], ['sticky', 1], ['scroll', slots - 2]]);
  });

  test(`${width} px (${slots} slots): every slot sticky with minScrollSlots 0 leaves no scrolling row`, () => {
    const entries = [scrollRoot({ sticky: 'start' }), ...Array.from({ length: slots - 1 }, (_, k) => made(`s${k}`, { sticky: k % 2 === 0 ? 'end' : 'start' }))];
    const n = numbers(entries, width, { minScrollSlots: 0 });
    assert.equal(n.held.length, slots, 'every panel is sticky');
    assert.deepEqual(n.ids, []);
    assert.equal(segments(n).filter((s) => s.kind === 'scroll').length, 0, 'a row with no panel and no room has no scroll segment');
    assert.equal(maxScrollOf(n), 0, 'nothing scrolls');
  });

  test(`${width} px (${slots} slots): with minScrollSlots 0 a panel that is not sticky still gets a one-slot row`, () => {
    const entries = [scrollRoot({ sticky: 'start' }), ...Array.from({ length: slots - 1 }, (_, k) => made(`s${k}`, { sticky: 'end' })), made('free')];
    const n = numbers(entries, width, { minScrollSlots: 0 });
    assert.equal(n.held.length, slots - 1, 'one slot goes back to the row, the last sticky panel with it');
    assert.deepEqual(n.ids, [`s${slots - 2}`, 'free'], 'the panel that gave up and the one that never was sticky share the one slot');
    assert.deepEqual(segments(n).filter((s) => s.kind === 'scroll').map((s) => s.slots), [1]);
  });

  test(`${width} px (${slots} slots): more sticky panels than fit give up the lowest rank first, so the row keeps its slot`, () => {
    const entries = [scrollRoot({ sticky: 'start', stickyRank: 5 }), ...Array.from({ length: slots }, (_, k) => made(`s${k}`, { sticky: 'start', stickyRank: k })), made('free')];
    const n = numbers(entries, width);
    assert.equal(n.held.length, slots - 1, 'the row keeps one slot of the window');
    assert.equal(n.held[0]!.id, ROOT, 'the highest rank is still sticky');
    const back = entries.map((e) => e.id).filter((id) => !n.held.some((h) => h.id === id));
    assert.equal(back.includes('s0'), true, 'rank 0 is the first to give up');
    assert.equal(back.includes('free'), true, 'a panel that was never sticky stays in the row');
  });
}

test('a phone-width window has no sticky panel, and the panel scrolls like any other', () => {
  const n = numbers([scrollRoot({ sticky: 'start' }), ...plain(3)], 390);
  assert.deepEqual(n.held, []);
  assert.equal(n.ids.includes(ROOT), true);
  assert.deepEqual([n.leftInset, n.rightInset], [0, 0]);
  const control = numbers([scrollRoot({ sticky: 'start' }), ...plain(3)], 1000);
  assert.equal(control.held.length, 1, 'control: the same row in two slots holds it, so the phone result was the rule and not the row');
});

test('a window of one slot has no sticky panel even when minScrollSlots is 0 and every panel is sticky', () => {
  const onlyRoot = (containerWidth: number): RowNumbers => numbers([scrollRoot({ sticky: 'start' })], containerWidth, { minScrollSlots: 0 });
  const one = onlyRoot(422);
  assert.equal(one.stripWindow, 422 - 2 * GAP, 'a 422 px container has a window of 390 px: one slot');
  assert.deepEqual(one.held, [], 'the slot is not sticky, though the minimum and the row both leave it free');
  assert.deepEqual([one.ids.includes(ROOT), one.leftInset, one.rightInset], [true, 0, 0], 'the panel is drawn in the scrolling row instead');
  const two = onlyRoot(2 * PITCH + 2 * GAP - GAP);
  assert.deepEqual(two.held.map((h) => h.id), [ROOT], 'control: at two slots the same row holds it, so the one-slot result was the rule');
});

// ---------------------------------------------------------------------------
// Rules that do not depend on the width
// ---------------------------------------------------------------------------

test("sticky off is the default: a row with no sticky, and one with 'off', have the same numbers and hold nothing", () => {
  const base = numbers([scrollRoot(), made('a'), made('b'), made('c')]);
  const off = numbers([scrollRoot(), made('a', { sticky: 'off' }), made('b'), made('c')]);
  assert.deepEqual(base.held, []);
  assert.deepEqual(off, base);
  assert.deepEqual([base.leftInset, base.rightInset], [0, 0]);
  assert.equal(base.stripWindow, base.windowWidth);
});

test('a sticky panel takes its slot whether or not the row would overflow', () => {
  // root, a and b fit the three slots of a 1300 container by themselves; a still leaves the row for the start group.
  const n = numbers([scrollRoot(), made('a', { sticky: 'start' }), made('b')], 1300);
  assert.deepEqual(n.held.map((h) => h.id), ['a']);
  assert.deepEqual(n.ids, ['root', 'b']);
  assert.equal(n.stripWindow, 1268 - PITCH);
  assert.equal(maxScrollOf(n), 0, 'two panels fit the two slots that are left');
});

test('a sticky panel in the middle of the row leaves it, and the rest close up', () => {
  const n = numbers([scrollRoot(), made('a'), made('m', { sticky: 'end' }), made('b'), made('c')], 1000);
  assert.deepEqual(n.held.map((h) => [h.id, h.side]), [['m', 'right']]);
  assert.deepEqual(n.ids, ['root', 'a', 'b', 'c']);
  assert.deepEqual(n.leftOffsets, [0, PITCH, 2 * PITCH, 3 * PITCH]);
});

test('a panel as wide as the window is never sticky: a three-slot panel in a two-slot window scrolls', () => {
  const n = numbers([scrollRoot(), made('wide', { sticky: 'start', slots: 3, maxSlots: 3 }), made('b')], 1000);
  assert.deepEqual(n.held, [], 'it is cut to the window, which leaves no slot for the row');
  assert.deepEqual(n.ids, ['root', 'wide', 'b']);
});

test('a two-slot sticky panel takes two slots of the window', () => {
  const n = numbers([scrollRoot(), made('two', { sticky: 'start', slots: 2, maxSlots: 2 }), ...plain(6)], 1920);
  assert.deepEqual(n.held.map((h) => [h.id, h.width]), [['two', 796]]);
  assert.equal(n.leftInset, 812);
  assert.deepEqual(shape(n), [['sticky', 2], ['scroll', 2]]);
});

test('a window of three slots holds two sticky panels beside a slot of row, and gives the lower rank back when a third arrives', () => {
  const two = numbers([scrollRoot({ sticky: 'start' }), made('a', { sticky: 'end' }), ...plain(4)], 1280);
  assert.equal(two.held.length, 2);
  const three = numbers([scrollRoot({ sticky: 'start' }), made('a', { sticky: 'end' }), made('b', { sticky: 'end', stickyRank: 1 }), ...plain(4)], 1280);
  assert.deepEqual(three.held.map((h) => h.id), [ROOT, 'b'], 'a, the later of the two at rank 0, went back to the row');
  assert.equal(three.ids.includes('a'), true);
});

test('minScrollSlots reserves slots for the row: raising it gives sticky panels back, and the default of one keeps one slot', () => {
  const entries = [scrollRoot({ sticky: 'start' }), made('a', { sticky: 'end' }), ...plain(4)];
  assert.equal(numbers(entries, 1280, { minScrollSlots: 1 }).held.length, 2, 'three slots: two sticky and one left');
  assert.equal(numbers(entries, 1280, { minScrollSlots: 2 }).held.length, 1, 'two left to the row leaves one sticky slot');
  assert.equal(numbers(entries, 1280, { minScrollSlots: 3 }).held.length, 0, 'three left to the row leaves none');
  assert.equal(numbers(entries, 1280).held.length, 2, 'control: left out, it is the default of 1');
});

test('an unmeasured window has no sticky panel, and a row with no sticky panel ignores minScrollSlots', () => {
  assert.deepEqual(numbers([scrollRoot({ sticky: 'start' }), ...plain(3)], 0).held, []);
  const row = [scrollRoot(), ...plain(5)];
  assert.deepEqual(numbers(row, 1000, { minScrollSlots: 0 }), numbers(row, 1000, { minScrollSlots: 7 }));
});

test('a left and a right sticky panel together take both groups', () => {
  const n = numbers([scrollRoot(), made('a', { sticky: 'start' }), made('b'), made('c'), made('d', { sticky: 'end' })], 1400);
  assert.deepEqual(n.held.map((h) => [h.id, h.side, h.offset]), [['a', 'left', 0], ['d', 'right', GAP]]);
  assert.deepEqual([n.leftInset, n.rightInset], [PITCH, PITCH]);
  assert.equal(n.ids.join(), 'root,b,c');
});

test('a sticky panel reserves its width in reservedWidths, so the capacity is priced beside it', () => {
  const n = numbers([scrollRoot(), made('a', { sticky: 'start' }), made('b'), made('c'), made('d')]);
  assert.equal(n.ids.length, 4);
  assert.equal(n.reservedWidths.length, 5, 'four strip panels and the sticky one');
});

test('the whole-panel grid of a row with a sticky panel is measured in the strip window, and its last stop centers the strip end in it', () => {
  const n = numbers([scrollRoot(), made('a', { sticky: 'start' }), made('b'), made('c'), made('d')], 1000, { wholePanels: true });
  assert.deepEqual(n.stops, [0, PITCH, 2 * PITCH, maxScrollOf(n)], 'the grid, in the 562 between the sticky panel and the window edge');
  assert.equal(n.stops.at(-1), 1218, 'the 1608 strip with ((562 + 16) mod 406) / 2 = 86 at each end, in the 562 window: 86 + 1608 + 86 - 562');
  assert.equal(snapToStop(n, 2, 500), 812, 'of the stops that draw strip panel c whole, the one nearest the target');
});

test('the deprecated edgeHold on a layer reads as sticky: left is start, right is end, off is off', () => {
  const read = (edgeHold: 'off' | 'left' | 'right'): ReadonlyArray<readonly [string, string]> =>
    numbers([scrollRoot(), made('a', { edgeHold }), made('b'), made('c')], 1000).held.map((h) => [h.id, h.side]);
  assert.deepEqual(read('left'), [['a', 'left']]);
  assert.deepEqual(read('right'), [['a', 'right']]);
  assert.deepEqual(read('off'), []);
});

test('negative control: the same row with sticky removed holds nothing, so the held counts above could have been zero', () => {
  const entries = (sticky: boolean): PanelWindow[] => [scrollRoot(), made('a', sticky ? { sticky: 'start' } : {}), ...plain(3)];
  assert.equal(numbers(entries(true), 1920).held.length, 1);
  assert.equal(numbers(entries(false), 1920).held.length, 0);
});
