/**
 * An edgeHold 'both' panel on literal rows (phone 390, gap 16, a 1000 container: a window of 968). Its side follows the scroll:
 * it holds at the left once the scroll has pushed it past the left edge, at the right once it is past the right edge, and it sits in
 * the strip between the two, moving with it. The stops and the range do not depend on the side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { computeRowNumbers, maxScrollOf, type RowNumbers } from '../rowNumbers.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const GAP = 16;
const PHONE = 390;
const WINDOW = 968;

registerTestView('both-view', ({ panel }) => createElement('i', { 'data-slot': panel.id }, panel.title));

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'both-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}
const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'both-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');

const numbersAt = (entries: PanelWindow[], scrollLeft: number, containerWidth = 1000, wholePanels = false): RowNumbers =>
  computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth, gap: GAP, wholePanels, scrollLeft });

/** Where each drawn panel is in the window at `scrollLeft`: a held one in its group, a strip one at its strip place less the scroll. */
function rectsAt(n: RowNumbers, scrollLeft: number): { rects: Map<string, { left: number; right: number }>; visibleLeft: number; visibleRight: number } {
  const rects = new Map<string, { left: number; right: number }>();
  for (const h of n.held) {
    const left = h.side === 'left' ? h.offset : n.windowWidth - n.rightInset + h.offset;
    rects.set(h.id, { left, right: left + h.width });
  }
  for (const [j, id] of n.ids.entries()) {
    const left = n.stripStart + n.leftOffsets[j]! - scrollLeft;
    rects.set(id, { left, right: left + n.widths[j]! });
  }
  return { rects, visibleLeft: n.leftInset, visibleRight: n.windowWidth - n.rightInset };
}

/** A row of six phone panels after History, with `e` as the 'both' panel: its place in the strip is 2030 px, the row's end is 2264. */
const sixWithBoth = (): PanelWindow[] => [scrollRoot(), made('a'), made('b'), made('c'), made('d'), made('e', { edgeHold: 'both' }), made('f'), made('g')];

test('both holds right at the start, is in the strip in the middle, and holds left at the end, following the scroll', () => {
  const entries = sixWithBoth();
  const held = (s: number) => numbersAt(entries, s).held.map((h) => [h.id, h.side]);
  assert.deepEqual(held(0), [['e', 'right']], 'at the start the panel is past the right edge, so it holds there');
  assert.deepEqual(held(1452), [['e', 'right']], 'still held right at the last scroll that leaves it past the right edge');
  assert.deepEqual(held(1453), [], 'one px further it is in the strip, fully in view');
  assert.ok(numbersAt(entries, 1453).ids.includes('e'));
  assert.deepEqual(held(2029), [], 'in the strip until its left edge reaches the window');
  assert.deepEqual(held(2030), [['e', 'left']], 'held left once its left edge is at the window edge');
  assert.deepEqual(held(2264), [['e', 'left']], 'and it stays held left to the end of the row');
});

test('the held side changes the group, not the range: the end is the same at every side', () => {
  const entries = sixWithBoth();
  const ends = [0, 1000, 1453, 2100, 2264].map((s) => maxScrollOf(numbersAt(entries, s)));
  assert.deepEqual(ends, [2264, 2264, 2264, 2264, 2264], 'the strip plus both groups is the same content length in each state');
  assert.equal(numbersAt(entries, 0).held[0]!.side, 'right');
});

test('the held panel is never lost off either side: at every scroll it is fully in the window', () => {
  const entries = sixWithBoth();
  for (let s = 0; s <= 2264; s += 1) {
    const n = numbersAt(entries, s);
    const { rects, visibleRight, visibleLeft } = rectsAt(n, s);
    const e = rects.get('e')!;
    assert.ok(e.left >= 0 && e.right <= WINDOW + 1e-9, `scroll ${s}: e is inside the window`);
    assert.ok(visibleRight - visibleLeft >= PHONE - 1e-9, `scroll ${s}: a phone of strip stays beside the held panel`);
  }
});

test('the strip panels slide under the held one continuously: a strip panel in view moves one px for each px of scroll, across the flips', () => {
  const entries = sixWithBoth();
  let before = rectsAt(numbersAt(entries, 0), 0);
  for (let s = 1; s <= 2264; s += 1) {
    const n = numbersAt(entries, s);
    const now = rectsAt(n, s);
    for (const [id, rect] of now.rects) {
      const prev = before.rects.get(id);
      if (prev === undefined || id === 'e') continue;
      // A panel is drawn in the strip on both sides of this px, and in view at both: the scroll moved it one px and nothing else.
      const inView = (r: { left: number; right: number }, l: number, rr: number) => r.right > l && r.left < rr;
      if (!inView(prev, before.visibleLeft, before.visibleRight) || !inView(rect, now.visibleLeft, now.visibleRight)) continue;
      assert.ok(Math.abs(rect.left - (prev.left - 1)) < 1e-9, `${id} at scroll ${s}: ${prev.left} -> ${rect.left}`);
    }
    before = now;
  }
});

test('the release still applies: a row whose strip fits the window with the panel out, or a window with no phone beside it, holds nothing', () => {
  const narrow = sixWithBoth();
  for (let s = 0; s <= 2264; s += 97) assert.deepEqual(numbersAt(narrow, s, 600).held, [], `a 568 window at scroll ${s}: no room beside the panel`);
  const fits = [scrollRoot(), made('a'), made('b', { edgeHold: 'both' })];
  assert.equal(numbersAt(fits, 0, 1300).rowScroll, true);
  assert.ok(maxScrollOf(numbersAt(fits, 0, 1300)) === 0, 'three panels fit a 1268 window: nothing to scroll');
  for (let s = 0; s <= 1300; s += 100) assert.deepEqual(numbersAt(fits, s, 1300).held, [], `a row that fits at scroll ${s} holds nothing`);
});

test('the grid of stops is the same at every side, and each stop lists the strip it draws at that scroll', () => {
  const entries = sixWithBoth();
  const base = numbersAt(entries, 0, 1000, true);
  assert.deepEqual(base.stops, [0, 406, 812, 1218, 1624, 2030, 2264], 'the one-phone grid, the last stop the end of the range');
  for (const [k, stop] of base.stops.entries()) {
    const at = numbersAt(entries, stop, 1000, true);
    assert.deepEqual(at.stops, base.stops, `the stops at scroll ${stop} are the same grid`);
    assert.deepEqual(at.ids, at.stopIds[k], `at scroll ${stop} the row's own ids are the ids its stop draws`);
    assert.deepEqual(base.stopLefts[k], at.leftOffsets.map((offset) => at.stripStart + offset), `the stop ${stop} draws its strip at the lefts of that scroll`);
  }
});

test('each panel that fits is fully in view at some stop, whichever side the held panel is on', () => {
  const entries = sixWithBoth();
  const n = numbersAt(entries, 0, 1000, true);
  for (const id of n.stopIds.flat()) {
    const seen = n.stops.some((stop) => {
      const { rects, visibleLeft, visibleRight } = rectsAt(numbersAt(entries, stop, 1000, true), stop);
      const r = rects.get(id)!;
      return r.left >= visibleLeft - 1e-9 && r.right <= visibleRight + 1e-9;
    });
    assert.ok(seen || id === 'e', `${id} is fully in view at some stop`);
  }
  const held = rectsAt(numbersAt(entries, 2264, 1000, true), 2264).rects.get('e')!;
  assert.equal(held.left, 0, 'the held panel at the end is at the left edge');
});
