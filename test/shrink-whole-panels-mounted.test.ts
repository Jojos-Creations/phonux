/**
 * tuning.shrinkOutOfView on a mounted stepping row (phone 390, gap 16, container 1800: window 1768, four slots) holding
 * History and panels of 2, 4, 1 and 3 slots: what each step draws, where it scrolls, and that nothing else moves.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { registerView, usePanelDragging, usePanelResizing } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { differential } from './support/differential.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';

const resizeSetters = new Map<string, (on: boolean) => void>();
registerView('resizing-view', ({ panel }) => {
  const [, set] = usePanelResizing();
  resizeSetters.set(panel.id, set);
  return React.createElement('i', { 'data-slot': panel.id, 'data-dragging': String(usePanelDragging()) }, panel.title);
});

afterEach(() => {
  mock.timers.reset();
  resizeSetters.clear();
  cleanup();
});

const SLOTS = [2, 4, 1, 3];
const entries = () => row(rootEntry(), ...SLOTS.map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64 }, { view: 'resizing-view' })));
const mountAt = (shrinkOutOfView: 'off' | 'visible' | 'hidden', wrap?: (r: React.ReactElement) => React.ReactElement) =>
  mountRow(entries(), 1800, { tuning: { rowGesture: 'step', shrinkOutOfView } }, wrap);
/** A row as it opens: the restore has settled and the first scroll has been made. */
async function opened(shrinkOutOfView: 'off' | 'visible' | 'hidden', wrap?: (r: React.ReactElement) => React.ReactElement): Promise<ReturnType<typeof mountRow>> {
  const m = mountAt(shrinkOutOfView, wrap);
  await advanceFrames(100);
  scrolled(m);
  return m;
}

const slots = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-row-slot]')];
const widthsOf = (container: HTMLElement): number[] => slots(container).map((el) => Number.parseFloat(el.style.width));
const filtersOf = (container: HTMLElement): string[] => slots(container).map((el) => el.style.filter);
const scrolled = (m: ReturnType<typeof mountRow>): void => void act(() => void m.container.dispatchEvent(new Event('scroll')));
const SLOT = (n: number): number => n * 390 + (n - 1) * 16;

/** One wheel step in `direction`, run to the end of its glide, with the scroll event a browser would fire. */
async function step(m: ReturnType<typeof mountRow>, direction: 'right' | 'left'): Promise<void> {
  m.wheel({ deltaX: direction === 'right' ? 50 : -50 });
  await advanceFrames(600);
  scrolled(m);
  mock.timers.tick?.(1000);
}

test('differential tuning.shrinkOutOfView: the panel after the first group is drawn at the free slot, or at its own size', () => {
  differential('tuning.shrinkOutOfView', (run) => {
    for (const mode of ['off', 'visible'] as const) {
      run(mode, () => {
        const m = mountAt(mode);
        return widthsOf(m.container);
      });
      cleanup();
    }
  });
});

test("'visible' at launch leans forward: the panel after the group fills the free slot and the strip rests on the first stop", async () => {
  const m = await opened('visible');
  assert.deepEqual(widthsOf(m.container), [SLOT(1), SLOT(2), SLOT(1), SLOT(1), SLOT(3)], 'History, 2, then the 4-slot panel drawn at the 1 free slot');
  assert.equal(m.container.scrollLeft, m.latest().rowNumbers.stops[0], 'a first stop that is not 0 is where the row opens');
  assert.equal(m.latest().entries.find((p) => p.id === 's2')!.slots, 4, "the person's choice is untouched");
});

test("'visible' hides every panel past the shrunk neighbour at rest: dimmed to nothing and inert", async () => {
  const m = await opened('visible');
  const state = slots(m.container).map((el) => [el.style.filter, el.hasAttribute('inert')]);
  const shown = ['', false];
  const hidden = ['opacity(0)', true];
  assert.deepEqual(state, [shown, shown, shown, hidden, hidden], 'History, the 2-slot panel and the shrunk 4-slot panel are shown; the two after it are not');
});

test('stepping 0, 1, 0 forward and back leaves the same scroll and the same widths as the first visit', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const first = { widths: widthsOf(m.container), left: m.container.scrollLeft };
  await step(m, 'right');
  const second = { widths: widthsOf(m.container), left: m.container.scrollLeft };
  assert.notDeepEqual(second.widths, first.widths);
  assert.deepEqual(second.widths, [SLOT(1), SLOT(2), SLOT(2), SLOT(1), SLOT(3)], 'stop 1: the 2-slot panel, then the 4-slot panel at the 2 free slots');
  await step(m, 'left');
  assert.deepEqual({ widths: widthsOf(m.container), left: m.container.scrollLeft }, first);
});

test('reversing at a stop is one move: the glide is already aimed at the other lean\'s position and the old neighbour is back at its own size', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  await step(m, 'right');
  await step(m, 'right');
  const before = widthsOf(m.container);
  m.wheel({ deltaX: -50 });
  const target = m.scroller.glideTarget();
  assert.notEqual(target, null, 'one glide is under way');
  await advanceFrames(600);
  scrolled(m);
  assert.equal(m.container.scrollLeft, target, 'it ended where it was aimed, with no second move after it');
  assert.notDeepEqual(widthsOf(m.container), before);
  assert.equal(m.scroller.glideTarget(), null);
});

test('a reversal under Reduce Motion is a single-frame swap: the position and the widths change in the step itself', async () => {
  const m = await opened('visible', (r) => React.createElement(MotionConfig, { reducedMotion: 'always' }, r));
  mock.timers.enable({ apis: ['setTimeout'] });
  await step(m, 'right');
  const after = m.container.scrollLeft;
  m.wheel({ deltaX: -50 });
  assert.notEqual(m.container.scrollLeft, after, 'the scroll moved at once, with no frames advanced');
  assert.equal(m.scroller.glideTarget(), null);
});

test('stepping never parks or returns a panel: the live set is the same at every stop in both leans', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const live = m.live();
  for (const direction of ['right', 'right', 'left', 'left', 'right'] as const) {
    await step(m, direction);
    assert.deepEqual(m.live(), live, `after a step ${direction}`);
  }
});

test("'hidden' draws no panel part way mid-glide and nothing is resized, across a reversal", async () => {
  const m = await opened('hidden');
  mock.timers.enable({ apis: ['setTimeout'] });
  const chosen = widthsOf(m.container);
  assert.deepEqual(chosen, [SLOT(1), SLOT(2), SLOT(4), SLOT(1), SLOT(3)]);
  const stops = m.latest().rowNumbers.stops;
  for (const target of [stops[1]!, (stops[0]! + stops[1]!) / 2, stops[0]! + 1, stops[2]! - 1]) {
    m.scroller.glideTo(target, { durationSec: 0, instant: true, ease: 'cubic-out' });
    scrolled(m);
    for (const f of filtersOf(m.container)) assert.ok(f === '' || f === 'opacity(0)', `a partly faded panel at ${target}: ${f}`);
    assert.deepEqual(widthsOf(m.container), chosen);
  }
});

test('a panel marked as being resized holds every other panel at the width it had until the mark is cleared', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const before = widthsOf(m.container);
  const marked = (): string | null => m.container.querySelector('[data-slot="s1"]')!.getAttribute('data-dragging');
  act(() => resizeSetters.get('s1')!(true));
  assert.equal(marked(), 'true', 'the mark is also the panel\'s dragging state');
  await step(m, 'right');
  assert.deepEqual(widthsOf(m.container), before, 'a step during the drag redraws nothing');
  act(() => resizeSetters.get('s1')!(false));
  assert.equal(marked(), 'false');
  assert.deepEqual(widthsOf(m.container), [SLOT(1), SLOT(2), SLOT(2), SLOT(1), SLOT(3)], 'the release lets the stop it is on draw its own widths');
});
