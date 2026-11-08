/**
 * The slot grid a stepping row draws: the window holds N whole slots, centered, and at every stop only whole panels are drawn in
 * them; nothing is drawn in the margins beside the grid. A left-held panel sits in slot 0, the strip's first panel one gap after it,
 * and every stop moves the strip one slot. Pure numbers over several windows, phones and gaps, then the same model on a mounted row.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { setRowOffset } from './support/strip.js';
import { made, mountRow, panelsOf, rootEntry, row } from './support/scroll-row.js';
import type { PanelWindow } from '../index.js';
import { computeRowNumbers, drawsWhole, gridEdgesOf, maxScrollOf, slotCutAt, slotSpanAt, snapToStop, stripWindowAt, type RowNumbers } from '../rowNumbers.js';

afterEach(cleanup);

const WINDOWS = [1000, 1500, 2000];
const PHONES = [371, 380, 390];
const GAPS = [16, 20, 24];
const COUNT = 6;

const scrollEntries = (hold: 'left' | 'off'): PanelWindow[] => row(rootEntry(), ...Array.from({ length: COUNT }, (_, k) => made(`s${k + 1}`, k === 0 && hold === 'left' ? { edgeHold: 'left' } : {})));

const numbersOf = (hold: 'left' | 'off', containerWidth: number, phoneWidth: number, gap: number): RowNumbers =>
  computeRowNumbers({ entries: scrollEntries(hold), phoneWidth, containerWidth, gap, wholePanels: true });

/** The grid's slot count and its centering, from the owner's model, restated independently of rowNumbers. */
function gridOf(containerWidth: number, phoneWidth: number, gap: number): { slots: number; centering: number; window: number } {
  const window = containerWidth - 2 * gap;
  const slots = Math.floor((window + gap) / (phoneWidth + gap));
  return { slots, centering: (window + gap - slots * (phoneWidth + gap)) / 2, window };
}

/** The first drawn entry of `n` that lies wholly inside its strip window at scroll `at`; `stopSpans.first` counts a reached, cut neighbour too. */
function firstWholeAt(n: RowNumbers, at: number, gap: number): number {
  const k = n.ids.findIndex((_, j) => slotSpanAt(n, j, at).left >= stripWindowAt(n, at, gap).lo - 0.5);
  assert.ok(k >= 0, `a whole panel at ${at}`);
  return k;
}

/** Each case's name, for assertion messages. */
const label = (hold: string, w: number, p: number, g: number, at?: number): string => `${hold} window ${w} phone ${p} gap ${g}${at === undefined ? '' : ` at ${at}`}`;

test('positive control: every case overflows and steps, with at least two slots and a margin inside the window', () => {
  let cases = 0;
  for (const w of WINDOWS)
    for (const p of PHONES)
      for (const g of GAPS) {
        const n = numbersOf('off', w, p, g);
        const grid = gridOf(w, p, g);
        assert.ok(n.stops.length >= 2, `${label('off', w, p, g)}: steps, ${n.stops.length} stops`);
        assert.ok(grid.slots >= 2 && grid.slots < COUNT + 1, `${label('off', w, p, g)}: ${grid.slots} slots of ${COUNT + 1} panels`);
        assert.equal(n.rowMarginLeft, grid.centering, `${label('off', w, p, g)}: the margin is half the leftover`);
        assert.equal(n.endPad, grid.centering);
        assert.deepEqual(gridEdgesOf(n), { lo: grid.centering, hi: grid.window - grid.centering });
        cases += 1;
      }
  assert.equal(cases, 27);
});

test('(a) at every stop every drawn panel lies wholly inside the slot grid, and (b) every panel wholly inside it is drawn, not cut or away', () => {
  let checked = 0;
  for (const hold of ['off', 'left'] as const)
    for (const w of WINDOWS)
      for (const p of PHONES)
        for (const g of GAPS) {
          const n = numbersOf(hold, w, p, g);
          const grid = gridEdgesOf(n);
          for (const at of n.stops) {
            const { lo, hi } = stripWindowAt(n, at, g);
            let inside = 0;
            for (const k of n.ids.keys()) {
              const cut = slotCutAt(n, k, at, g);
              const span = slotSpanAt(n, k, at);
              const whole = span.left >= lo - 0.5 && span.right <= hi + 0.5;
              if (whole) {
                inside += 1;
                assert.deepEqual(cut, { left: 0, right: 0, away: false }, `(b) ${label(hold, w, p, g, at)}: ${n.ids[k]} is whole and drawn`);
                assert.ok(span.left >= grid.lo - 0.5 && span.right <= grid.hi + 0.5, `(a) ${label(hold, w, p, g, at)}: ${n.ids[k]} is inside the grid`);
              } else {
                // Not whole: nothing of it is drawn at rest, so it is wholly outside, never partly cut.
                assert.equal(cut.away, true, `(a) ${label(hold, w, p, g, at)}: ${n.ids[k]} is not whole, so it is wholly away (cut ${cut.left}/${cut.right})`);
              }
              assert.equal(drawsWhole(n, k, at), whole, `${label(hold, w, p, g, at)}: drawsWhole agrees for ${n.ids[k]}`);
            }
            assert.ok(inside >= 1, `${label(hold, w, p, g, at)}: a stop shows at least one whole panel`);
            checked += 1;
          }
        }
  assert.ok(checked >= 54, `checked ${checked} stops`);
});

test('(c) a left-held panel occupies slot 0 inside the margin, and the first strip panel is exactly one gap to its right', () => {
  for (const w of WINDOWS)
    for (const p of PHONES)
      for (const g of GAPS) {
        const n = numbersOf('left', w, p, g);
        const grid = gridOf(w, p, g);
        assert.equal(n.held.length, 1, `${label('left', w, p, g)}: held`);
        const h = n.held[0]!;
        assert.equal(h.side, 'left');
        // The held panel's left edge is the grid's left edge (rowMarginLeft + its offset, as PanelRow places it).
        assert.equal(n.rowMarginLeft + h.offset, grid.centering, `${label('left', w, p, g)}: slot 0 starts at the margin`);
        assert.equal(n.leftInset, p + g, 'the group is one phone and one gap');
        for (const at of n.stops) {
          const first = firstWholeAt(n, at, g);
          const span = slotSpanAt(n, first, at);
          const cut = slotCutAt(n, first, at, g);
          assert.deepEqual(cut, { left: 0, right: 0, away: false }, `${label('left', w, p, g, at)}: the first shown panel is whole`);
          assert.equal(span.left, grid.centering + p + g, `${label('left', w, p, g, at)}: the next panel is one gap after the held one, no margin and no partial panel between`);
        }
        assert.equal(stripWindowAt(n, 0, g).lo, grid.centering + p + g);
      }
});

test('(d) the stops move one slot each, from 0 to the flush end, where the last panel fills the last slot', () => {
  for (const hold of ['off', 'left'] as const)
    for (const w of WINDOWS)
      for (const p of PHONES)
        for (const g of GAPS) {
          const n = numbersOf(hold, w, p, g);
          assert.equal(n.stops[0], 0, `${label(hold, w, p, g)}: the first stop is 0`);
          for (let k = 1; k < n.stops.length; k++) assert.equal(n.stops[k]! - n.stops[k - 1]!, p + g, `${label(hold, w, p, g)}: stop ${k} is one slot on`);
          const end = n.stops[n.stops.length - 1]!;
          assert.equal(end, maxScrollOf(n), `${label(hold, w, p, g)}: the last stop is the row's end`);
          const last = n.ids.length - 1;
          assert.equal(slotSpanAt(n, last, end).right, gridEdgesOf(n).hi, `${label(hold, w, p, g)}: the last panel is flush with the grid's right edge`);
          // Every panel is shown whole at some stop, and a snap to it lands on such a stop.
          for (const k of n.ids.keys()) {
            const stop = snapToStop(n, k, 0);
            assert.ok(n.stops.includes(stop) && drawsWhole(n, k, stop), `${label(hold, w, p, g)}: snapToStop lands ${n.ids[k]} whole at ${stop}`);
          }
        }
});

/** A mounted stepping row at container 1000 (phone 390, gap 16: two slots, margin 86), 5 strip panels plus the root. */
const mounted = (entries = panelsOf(5)) => {
  const m = mountRow(entries, 1000, { tuning: { rowGesture: 'step' } });
  const slots = (): HTMLElement[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')];
  const strip = (): HTMLElement => m.container.querySelector<HTMLElement>('[data-row-strip]')!;
  return { m, slots, strip, numbers: () => m.latest().rowNumbers, layout: () => m.rerender(1000) };
};

test('a mounted row never hides a slot: every slot keeps visibility, the window is cut at the grid edges and inert follows the numbers', () => {
  const t = mounted();
  const n = t.numbers();
  assert.deepEqual(n.stops, [0, 406, 812, 1218, 1624], 'positive control: five stops on the one-phone grid');
  for (const at of n.stops) {
    setRowOffset(t.m.container, at);
    t.layout();
    assert.deepEqual(t.slots().map((el) => el.style.visibility), t.slots().map(() => ''), `no slot is hidden at ${at}`);
    assert.deepEqual(t.slots().map((el) => el.style.clipPath), t.slots().map(() => ''), `no hold: no slot carries its own cut at ${at}`);
    // The cut is on the window element, which never moves, so it is the same at every offset; the strip carries none.
    const window = t.m.container.querySelector<HTMLElement>('[data-row-window]')!;
    // One gap past the grid's edges, where a panel's glow shows: no panel rests there, since the next one starts a gap past the edge.
    assert.equal(window.style.clipPath, `polygon(${86 - 16}px -100000px, ${968 - 86 + 16}px -100000px, ${968 - 86 + 16}px 100000px, ${86 - 16}px 100000px)`, `the window is cut one gap past the grid at ${at}`);
    const shownLo = 86 - 16;
    const shownHi = 968 - 86 + 16;
    const resting = n.ids.map((_, k) => slotSpanAt(n, k, at)).filter((s) => s.right > shownLo && s.left < shownHi);
    assert.ok(resting.every((s) => s.left >= 86 && s.right <= 968 - 86), `no panel resting at ${at} reaches into the gap the cut holds open: ${JSON.stringify(resting)}`);
    assert.equal(t.strip().style.clipPath, '', `the strip carries no cut of its own at ${at}`);
    const away = n.ids.map((_, k) => slotCutAt(n, k, at, 16).away);
    assert.ok(away.some((a) => a) && away.some((a) => !a), `control: ${at} has slots on both sides of reach`);
    assert.deepEqual(t.slots().map((el) => el.hasAttribute('inert')), away, `inert follows the numbers at ${at}`);
  }
});

test('a mounted row with a left hold places the held panel at the margin, in slot 0, and cuts strip slots at the gap of the held group', () => {
  const t = mounted(row(rootEntry(), made('a', { edgeHold: 'left' }), made('b'), made('c'), made('d'), made('e')));
  const n = t.numbers();
  assert.equal(n.held.length, 1, 'positive control: a is held');
  assert.equal(n.rowMarginLeft, 86);
  const aId = n.held[0]!.id;
  const host = t.m.container.querySelector<HTMLElement>(`[data-row-strip] [data-row-id="${aId}"]`)!.closest<HTMLElement>('[data-row-hold]');
  assert.equal(host?.dataset.holdLeft, '86px', 'the held panel sits at the grid margin, slot 0');
  // One slot remains for the strip: the panel in it is whole and uncut; the ones past it are away.
  for (const at of n.stops) {
    setRowOffset(t.m.container, at);
    t.layout();
    const first = firstWholeAt(n, at, 16);
    const slotOf = (k: number): HTMLElement => t.slots().find((el) => el.dataset.rowId === n.ids[k])!;
    assert.equal(slotOf(first).style.clipPath, '', `the shown panel is uncut at ${at}`);
    assert.equal(slotOf(first).hasAttribute('inert'), false);
    assert.equal(slotSpanAt(n, first, at).left, 86 + 406, `the shown panel starts one gap after the held one at ${at}`);
  }
  // Off a stop, the panel sliding under the held group is cut at the group's gap, by the amount it has passed.
  setRowOffset(t.m.container, 100);
  t.layout();
  const under = t.slots().find((el) => el.dataset.rowId === n.ids[0])!;
  assert.equal(under.style.clipPath, 'inset(-100000px -400px -100000px 84px)', 'cut at the held panel, 100 px less the 16 px gap it fades across, and open on its other side');
  assert.equal(under.hasAttribute('inert'), false, 'still in reach');
  assert.match(under.style.maskImage, /^linear-gradient\(to right/, 'it fades out across the gap beside the held panel');
  setRowOffset(t.m.container, 0);
  t.layout();
  assert.equal(under.style.maskImage, '', 'on a stop nothing fades');
});

test('a claim holds reach still; the next pointer move on the row, one frame on, draws the reach of where the claim left the row', async () => {
  const t = mounted();
  const n = t.numbers();
  const inertNow = (): boolean[] => t.slots().map((el) => el.hasAttribute('inert'));
  const awayAt = (at: number): boolean[] => n.ids.map((_, k) => slotCutAt(n, k, at, 16).away);
  assert.deepEqual(inertNow(), awayAt(0), 'control: reach is drawn at the first stop');
  const claim = t.m.scroller.claim()!;
  claim.setMaxScroll(maxScrollOf(n));
  claim.write(812);
  await advanceFrames(64);
  assert.notDeepEqual(awayAt(812), awayAt(0), 'control: the reach differs between the two offsets');
  assert.deepEqual(inertNow(), awayAt(0), 'while the claim is held reach stays where it was');
  claim.release();
  t.m.container.dispatchEvent(new Event('pointermove'));
  await advanceFrames(64);
  assert.deepEqual(inertNow(), awayAt(812), 'after the pointer moves, reach is the numbers at the claimed offset');
});
