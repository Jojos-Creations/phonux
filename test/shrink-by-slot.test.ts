/**
 * Shrinking out of view: a stepping row narrows its panels by whole slots as it scrolls away from them. The rule is checked
 * against a second implementation written here from the rule's wording (rectangles on screen, distance to the nearest panel
 * in view), then on literal rows with hand-worked numbers (phone 390, gap 16, container 1800), then mounted.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { registerView } from '../index.js';
import type { PanelSummary, PanelWindow } from '../index.js';
import { computeRowNumbers, type RowNumbers } from '../rowNumbers.js';
import { ALL_SLOTS, slotWidth } from '../rowConstants.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const PHONE = 390;
const GAP = 16;
const summaries = new Map<string, PanelSummary>();
registerView('shrink-view', ({ panel }) => {
  summaries.set(panel.id, panel);
  return React.createElement('i', { 'data-slot': panel.id }, panel.title);
});

type Mode = 'visible' | 'hidden';

/** A row of entries with these chosen slot counts; the first is the root. */
function entriesOf(slots: readonly number[]): PanelWindow[] {
  const [first, ...rest] = slots;
  const base = rootEntry();
  const root = { ...base, slots: first!, view: 'shrink-view', settings: { ...base.settings, maxSlots: first! } } as PanelWindow;
  return row(root, ...rest.map((n, k) => ({ ...made(`s${k + 1}`, { slots: n, maxSlots: Math.max(n, 1) }), view: 'shrink-view' }) as PanelWindow));
}
const numbers = (slots: readonly number[], container: number, mode: Mode | undefined, stop = 0, entries = entriesOf(slots)): RowNumbers =>
  computeRowNumbers({ entries, phoneWidth: PHONE, containerWidth: container, gap: GAP, wholePanels: true, ...(mode === undefined ? {} : { shrink: { mode, stop } }) });

/**
 * The same rule, written from its wording. Panels are rectangles; the stop's scroll position puts the container on the strip;
 * a panel is in view when it overlaps the container by more than 0 px; its steps are the distance in panels to the nearest
 * panel in view. Stops come from a greedy fill over the chosen widths.
 */
function reference(chosen: readonly number[], container: number, mode: Mode, stop: number): { drawn: number[]; stops: number[]; targets: number[] } {
  const window = container - 2 * GAP;
  const widthOf = (n: number): number => slotWidth(n, PHONE, GAP);
  const groups: { first: number; margin: number }[] = [];
  for (let first = 0; first < chosen.length; first++) {
    let used = widthOf(chosen[first]!);
    let end = first + 1;
    while (end < chosen.length && used + GAP + widthOf(chosen[end]!) <= window) used += GAP + widthOf(chosen[end++]!);
    groups.push({ first, margin: (window - used) / 2 });
    if (end === chosen.length) break;
  }
  const layout = (slotsNow: readonly number[]): number[] => {
    const lefts: number[] = [];
    let at = 0;
    for (const n of slotsNow) {
      lefts.push(at);
      at += widthOf(n) + GAP;
    }
    return lefts;
  };
  const chosenLefts = layout(chosen);
  const stopAt = (k: number, lefts: number[]): number => groups[0]!.margin + lefts[groups[k]!.first]! - groups[k]!.margin;
  const drawnAt = (s: number): number[] => {
    const scrollLeft = stopAt(s, chosenLefts);
    const inView = chosen.map((n, k) => {
      const left = GAP + groups[0]!.margin + chosenLefts[k]!;
      const right = left + widthOf(n);
      return Math.min(right, scrollLeft + container) - Math.max(left, scrollLeft) > 1e-9;
    });
    return chosen.map((n, k) => {
      if (inView[k]) return n;
      if (mode === 'hidden') return 1;
      const distance = Math.min(...inView.flatMap((v, j) => (v ? [Math.abs(j - k)] : [])));
      return Math.max(1, n - distance);
    });
  };
  const drawn = drawnAt(stop);
  const stops = groups.map((_, k) => stopAt(k, layout(drawnAt(stop))));
  const targets = groups.map((_, k) => stopAt(k, layout(drawnAt(k))));
  return { drawn, stops, targets };
}

const CONTAINERS = [828, 844, 1280, 1800, 1830];
const ROWS = [
  [1, 2, 4, 1, 3],
  [2, 2, 2, 2],
  [1, 1, 1, 1, 1, 1],
  [3, 1, 2, 4, 1, 2, 3],
  [ALL_SLOTS, 1, ALL_SLOTS, 2],
  [4, 4, 4, 4],
  [2, 3, 1, 3, 2, 1],
];

test('the rule equals a second implementation of it, for every stop of every row in both modes', () => {
  let compared = 0;
  for (const container of CONTAINERS) {
    for (const slots of ROWS) {
      for (const mode of ['visible', 'hidden'] as const) {
        const base = numbers(slots, container, mode, 0);
        const chosen = numbers(slots, container, undefined).drawnSlots as number[];
        for (let stop = 0; stop < base.stops.length; stop++) {
          const n = numbers(slots, container, mode, stop);
          const want = reference(chosen, container, mode, stop);
          const where = `${slots.join(',')} at ${container}, ${mode}, stop ${stop}`;
          assert.deepEqual(n.drawnSlots, want.drawn, `drawn slots: ${where}`);
          assert.deepEqual(n.stopTargets.map(Math.round), want.targets.map(Math.round), `stop targets: ${where}`);
          assert.deepEqual(n.stops.map(Math.round), want.stops.map(Math.round), `stops: ${where}`);
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 100, `positive control: ${compared} stops compared`);
});

test('worked row: slots 1, 2, 4, 1, 3 at 1800 has four stops whatever is shrunk, with margins 283, 486, 80 and 80', () => {
  const off = numbers([1, 2, 4, 1, 3], 1800, undefined);
  assert.deepEqual(off.stops, [0, 203, 1421, 3045]);
  assert.equal(off.rowMarginLeft, 283);
  assert.equal(off.endPad, 80);
  assert.deepEqual(off.stopSpans, [{ first: 0, end: 2 }, { first: 1, end: 2 }, { first: 2, end: 3 }, { first: 3, end: 5 }]);
  for (const mode of ['visible', 'hidden'] as const) {
    for (let stop = 0; stop < 4; stop++) {
      const n = numbers([1, 2, 4, 1, 3], 1800, mode, stop);
      assert.equal(n.stops.length, 4, `${mode} at stop ${stop}: the number of stops does not change`);
      assert.deepEqual(n.stopSpans, off.stopSpans, `${mode} at stop ${stop}: the groups do not change`);
      assert.equal(n.rowMarginLeft, off.rowMarginLeft, `${mode} at stop ${stop}: the first margin does not move`);
      assert.equal(n.endPad, off.endPad);
    }
  }
});

test('worked row, visible: steps count panels, and a neighbour peeking into a margin is not outside', () => {
  const at = (stop: number): (number | undefined)[] => [...numbers([1, 2, 4, 1, 3], 1800, 'visible', stop).drawnSlots];
  // The 4 slot panel shows 283 px at stop 0 and 1: it is in view, so it keeps its four slots.
  assert.deepEqual(at(0), [1, 2, 4, 1, 1], 'stop 0: panel 4 is one panel out, panel 5 two');
  assert.deepEqual(at(1), [1, 2, 4, 1, 1]);
  assert.deepEqual(at(2), [1, 2, 4, 1, 2], 'stop 2: the 2 slot panel peeks 80 px and keeps its slots; panel 5 is one panel out');
  assert.deepEqual(at(3), [1, 1, 4, 1, 3], 'stop 3: panel 2 is one panel out of view, panel 1 two');
  assert.deepEqual(numbers([1, 2, 4, 1, 3], 1800, 'visible', 3).stopTargets.map(Math.round), [0, 203, 1421, 2639], 'stop 3 rests 406 px earlier than the chosen layout puts it, because panel 2 is a slot narrower there');
});

test('worked row, hidden: a panel in view keeps its slots, one out of view is one slot, and a peeker never drops', () => {
  const at = (stop: number): (number | undefined)[] => [...numbers([1, 2, 4, 1, 3], 1800, 'hidden', stop).drawnSlots];
  assert.deepEqual(at(0), [1, 2, 4, 1, 1]);
  assert.deepEqual(at(1), [1, 2, 4, 1, 1]);
  assert.deepEqual(at(2), [1, 2, 4, 1, 1], 'stop 2: panel 2 peeks and keeps both slots, panel 5 is out of view');
  assert.deepEqual(at(3), [1, 1, 4, 1, 3]);
});

test('a margin of 0 shows no neighbour and a margin of 1 px shows one', () => {
  // Four 2 slot panels: 796 wide, so a window of 796 holds one with margin 0.
  const flush = numbers([2, 2, 2, 2], 828, 'visible', 1);
  assert.equal(flush.windowWidth, 796);
  assert.deepEqual(flush.drawnSlots, [1, 2, 1, 1], 'neighbours sit on the container edge and show nothing');
  const peeking = numbers([2, 2, 2, 2], 830, 'visible', 1);
  assert.deepEqual(peeking.drawnSlots, [2, 2, 2, 1], 'one pixel of margin shows both neighbours, so they keep their slots');
});

test('a panel stored as every slot that fits narrows at once: the cap comes before the steps', () => {
  const n = numbers([ALL_SLOTS, 1, ALL_SLOTS, 2], 1800, 'visible', 0);
  assert.equal(n.drawnSlots[0], 4, 'chosen is capped at the 4 that fit, and it is in view');
  assert.equal(n.drawnSlots[2], 3, 'one panel out: 4 - 1, not 63 capped to 4');
  const fiveOfFour = numbers([6, 1, 1, 6], 1800, 'visible', 0);
  assert.deepEqual(fiveOfFour.drawnSlots, [4, 1, 1, 2], 'a 6 slot panel at fit 4 is 4 in view and 4 - 2 two panels out of view');
});

test('the rule never lowers a panel below one slot and never touches an entry that carries no slots', () => {
  const hand = row(...[rootEntry(), ...['a', 'b', 'c', 'd'].map((id) => made(id))].map((p) => ({ ...p, slots: undefined }) as PanelWindow));
  const n = numbers([], 828, 'visible', 1, hand);
  assert.ok(n.drawnSlots.every((s) => s === undefined), 'hand-built entries have no slots to shrink');
  assert.ok(numbers([3, 3, 3, 3, 3, 3], 828, 'visible', 3).drawnSlots.every((s) => s === undefined || s >= 1));
});

test('a row whose strip fits the window has no stops and no shrink', () => {
  const n = numbers([1, 1], 1800, 'visible');
  assert.equal(n.shrinkStop, -1);
  assert.deepEqual(n.stopTargets, n.stops);
});

test('a parked panel is not in the row, so it adds no step', () => {
  const entries = entriesOf([1, 2, 4, 1, 3]);
  const parked = entries.map((p) => (p.id === 's3' ? { ...p, live: false } : p));
  const withParked = numbers([], 1800, 'visible', 0, parked);
  const without = numbers([1, 2, 4, 3], 1800, 'visible', 0);
  assert.deepEqual(withParked.drawnSlots, without.drawnSlots);
});

// ---------------------------------------------------------------------------
// Mounted
// ---------------------------------------------------------------------------

const tick = (ms: number): void => void act(() => mock.timers.tick(ms));
const drawn = (): number[] => [...summaries.values()].sort((a, b) => a.id.localeCompare(b.id)).map((s) => s.drawnSlots ?? 0);
const mountShrink = (mode: 'off' | Mode, slots: readonly number[] = [1, 2, 4, 1, 3]): MountedRow => {
  const m = mountRow(entriesOf(slots), 1800, { tuning: { rowGesture: 'step', shrinkOutOfView: mode } });
  mock.timers.enable({ apis: ['setTimeout'] });
  return m;
};
const stepRight = async (m: MountedRow): Promise<void> => {
  m.wheel({ deltaX: 50 });
  tick(200);
  await advanceFrames(900);
};

test('mounted: off is the default and draws every panel at its slots', () => {
  mountRow(entriesOf([1, 2, 4, 1, 3]), 1800, { tuning: { rowGesture: 'step' } });
  assert.deepEqual(drawn(), [1, 2, 4, 1, 3]);
});

test('mounted: stepping away narrows the panels left behind and the glide ends at the final layout', async () => {
  const m = mountShrink('visible');
  const root = (): string[] => [...m.container.querySelectorAll<HTMLElement>('[data-row-slot]')].map((el) => el.style.width);
  assert.deepEqual(drawn(), [1, 2, 4, 1, 1], 'at the first stop');
  await stepRight(m);
  assert.equal(m.scroller.scrollLeft(), m.latest().rowNumbers.stops[1]);
  await stepRight(m);
  assert.deepEqual(drawn(), [1, 2, 4, 1, 2], 'at the third stop the last panel is one panel out');
  assert.equal(m.scroller.scrollLeft(), m.latest().rowNumbers.stops[2]);
  assert.equal(m.scroller.scrollLeft(), 1421);
  m.wheel({ deltaX: 50 });
  tick(200);
  await advanceFrames(900);
  assert.deepEqual(drawn(), [1, 1, 4, 1, 3], 'at the last stop panel 2 is a slot narrower');
  assert.equal(m.scroller.scrollLeft(), m.latest().rowNumbers.stopTargets[3], 'the glide ended where the stop lies in the layout drawn there');
  assert.notEqual(m.scroller.scrollLeft(), 3045, 'not where the stop lay in the layout drawn before the step');
  assert.deepEqual(root().map(Number.parseFloat), [390, 390, 1608, 390, 1202]);
});

test('mounted: the choice is never rewritten, and scrolling back restores every panel', async () => {
  const m = mountShrink('visible');
  await stepRight(m);
  await stepRight(m);
  await stepRight(m);
  assert.deepEqual(m.latest().entries.map((p) => p.slots), [1, 2, 4, 1, 3], 'the entries still carry the chosen slots');
  m.key('ArrowLeft');
  tick(200);
  await advanceFrames(900);
  m.key('ArrowLeft');
  tick(200);
  await advanceFrames(900);
  m.key('ArrowLeft');
  tick(200);
  await advanceFrames(900);
  assert.deepEqual(drawn(), [1, 2, 4, 1, 1], 'back at the first stop, the same sizes as the first time');
  assert.deepEqual(m.latest().entries.map((p) => p.slots), [1, 2, 4, 1, 3]);
});

test('mounted: every frame of a glide already shows the sizes of the stop it is heading for', async () => {
  const m = mountShrink('visible');
  await stepRight(m);
  await stepRight(m);
  const seen = new Set<string>();
  m.wheel({ deltaX: 50 });
  tick(200);
  for (let frame = 0; frame < 20; frame++) {
    await advanceFrames(32);
    seen.add(drawn().join(','));
  }
  assert.deepEqual([...seen], ['1,1,4,1,3'], 'one set of sizes from the first frame to the last, none in between');
});

test('mounted: hidden narrows a panel only once none of it shows', async () => {
  const m = mountShrink('hidden');
  assert.deepEqual(drawn(), [1, 2, 4, 1, 1]);
  await stepRight(m);
  await stepRight(m);
  assert.deepEqual(drawn(), [1, 2, 4, 1, 1], 'panel 2 peeks into the margin at the third stop and keeps both slots');
  await stepRight(m);
  assert.deepEqual(drawn(), [1, 1, 4, 1, 3]);
});

test('mounted: a free row does not shrink, whatever the setting', () => {
  mountRow(entriesOf([1, 2, 4, 1, 3]), 1800, { tuning: { rowGesture: 'free', shrinkOutOfView: 'visible' } });
  assert.deepEqual(drawn(), [1, 2, 4, 1, 3]);
});

differential('tuning.shrinkOutOfView', (run) => {
  for (const mode of ['off', 'visible'] as const) {
    run(mode, () => {
      summaries.clear();
      const m = mountRow(entriesOf([1, 2, 4, 1, 3]), 1800, { tuning: { rowGesture: 'step', shrinkOutOfView: mode } });
      const out = drawn();
      m.rerender(1800);
      cleanup();
      return out;
    });
  }
});

test('the differentials this file owns are the one setting it adds', () => {
  assert.deepEqual(differentialsCovered().filter((name) => name === 'tuning.shrinkOutOfView'), ['tuning.shrinkOutOfView']);
});

test('the tuning leaf accepts off, visible and hidden and refuses anything else', async () => {
  const { resolveWorkspaceTuning } = await import('../panelTuning.js');
  for (const ok of ['off', 'visible', 'hidden'] as const) assert.equal(resolveWorkspaceTuning({ shrinkOutOfView: ok }).shrinkOutOfView, ok);
  for (const bad of ['on', true, 1, null]) assert.equal(resolveWorkspaceTuning({ shrinkOutOfView: bad } as never).shrinkOutOfView, 'off', `${String(bad)} keeps the default`);
});
