/**
 * A mounted stepping row (phone 390, gap 16, container 1800: window 1768, four slots) holding History and panels of 2, 4, 1 and
 * 3 slots: a panel marked as being resized holds the row, and a step never changes the live set.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { usePanelDragging, usePanelResizing } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

const resizeSetters = new Map<string, (on: boolean) => void>();
registerTestView('resizing-view', ({ panel }) => {
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
const mountAt = (wrap?: (r: React.ReactElement) => React.ReactElement) =>
  mountRow(entries(), 1800, { tuning: { rowGesture: 'step' } }, wrap);
/** A row as it opens: the restore has settled and the first scroll has been made. */
async function opened(wrap?: (r: React.ReactElement) => React.ReactElement): Promise<ReturnType<typeof mountRow>> {
  const m = mountAt(wrap);
  await advanceFrames(100);
  scrolled(m);
  return m;
}

const slots = (container: HTMLElement): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('[data-row-slot]')];
const widthsOf = (container: HTMLElement): number[] => slots(container).map((el) => Number.parseFloat(el.style.width));
const scrolled = (m: ReturnType<typeof mountRow>): void => void act(() => void m.container.dispatchEvent(new Event('scroll')));

/** One wheel step in `direction`, run to the end of its glide, with the scroll event a browser would fire. */
async function step(m: ReturnType<typeof mountRow>, direction: 'right' | 'left'): Promise<void> {
  m.wheel({ deltaX: direction === 'right' ? 50 : -50 });
  await advanceFrames(600);
  scrolled(m);
  mock.timers.tick?.(1000);
}

test('a panel marked as being resized holds the row and every other panel at its width: a step during the drag is ignored', async () => {
  const m = await opened();
  mock.timers.enable({ apis: ['setTimeout'] });
  const before = widthsOf(m.container);
  const marked = (): string | null => m.container.querySelector('[data-slot="s1"]')!.getAttribute('data-dragging');
  act(() => resizeSetters.get('s1')!(true));
  assert.equal(marked(), 'true', 'the mark is also the panel\'s dragging state');
  await step(m, 'right');
  assert.deepEqual(widthsOf(m.container), before, 'a step during the drag redraws nothing');
  act(() => m.latest().setSlots(m.latest().entries.find((p) => p.id === 's1')!.id, 1));
  const during = widthsOf(m.container);
  assert.deepEqual(during.filter((_, k) => k !== 1), before.filter((_, k) => k !== 1), 'resizing one panel redraws no other');
  assert.notEqual(during[1], before[1], 'the resized panel itself is drawn at its new size');
  act(() => resizeSetters.get('s1')!(false));
  assert.equal(marked(), 'false');
  assert.notDeepEqual(widthsOf(m.container), before, 'the release lets the others draw their own widths');
});

test('a panel marked as resizing holds the row: it does not settle onto a stop until the mark is cleared, then it does', async () => {
  const m = await opened();
  mock.timers.enable({ apis: ['setTimeout'] });
  await step(m, 'right');
  const at = m.container.scrollLeft;
  const id = m.latest().entries.find((p) => p.id === 's1')!.id;
  act(() => resizeSetters.get('s1')!(true));
  act(() => m.latest().setSlots(id, 1));
  await advanceFrames(600);
  assert.equal(m.container.scrollLeft, at, 'the row did not move while the mark was set');
  act(() => resizeSetters.get('s1')!(false));
  await advanceFrames(600);
  scrolled(m);
  const stops = m.latest().rowNumbers.stops;
  assert.ok(stops.some((stop) => Math.abs(stop - m.container.scrollLeft) < 1), 'after the release it rests on a stop');
});

test('the hold at each of three stops: the others keep their widths through a resize and the row stays where it is', async () => {
  const m = await opened();
  mock.timers.enable({ apis: ['setTimeout'] });
  for (const stop of [0, 1, 2]) {
    if (stop > 0) await step(m, 'right');
    const widths = widthsOf(m.container);
    const left = m.container.scrollLeft;
    act(() => resizeSetters.get('s2')!(true));
    act(() => m.latest().setSlots('s2', stop + 1));
    await advanceFrames(600);
    assert.deepEqual(widthsOf(m.container).filter((_, k) => k !== 2), widths.filter((_, k) => k !== 2), `stop ${stop}: no other panel changed`);
    assert.equal(m.container.scrollLeft, left, `stop ${stop}: the row did not scroll`);
    act(() => resizeSetters.get('s2')!(false));
    await advanceFrames(600);
    scrolled(m);
  }
});

test('stepping across every stop with a cap set never changes the live set', async () => {
  const m = mountRow(
    row(rootEntry(), ...[2, 4, 1, 3, 1, 2].map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64, overflow: k < 2 ? 'scroll' : 'park' }, { view: 'resizing-view' }))),
    1800,
    { tuning: { rowGesture: 'step', maxLivePanels: 3 } },
  );
  await advanceFrames(100);
  scrolled(m);
  mock.timers.enable({ apis: ['setTimeout'] });
  const live = m.live();
  assert.equal(live.length, 5, `the cap parked one of the four parkable panels (${live.join(',')})`);
  const stops = m.latest().rowNumbers.stops.length;
  for (let k = 0; k < stops + 1; k++) {
    await step(m, 'right');
    assert.deepEqual(m.live(), live, `after step ${k + 1} right`);
  }
  for (let k = 0; k < stops + 1; k++) {
    await step(m, 'left');
    assert.deepEqual(m.live(), live, `after step ${k + 1} left`);
  }
});

test('a step off the end of a parking row wider than its window brings in the next parked panel', async () => {
  const m = mountRow(
    row(rootEntry(), ...[1, 2, 2, 1, 1].map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64, overflow: 'park' }, { view: 'resizing-view' }))),
    1800,
    { tuning: { rowGesture: 'step', maxLivePanels: 3 } },
  );
  await advanceFrames(100);
  scrolled(m);
  mock.timers.enable({ apis: ['setTimeout'] });
  const live = m.live();
  const before = live.join(',');
  const stops = m.latest().rowNumbers.stops.length;
  assert.ok(stops > 0, `the row overflows its window (${before})`);
  const seen = new Set(live);
  for (let k = 0; k < stops + 3; k++) {
    await step(m, 'left');
    for (const id of m.live()) seen.add(id);
  }
  for (let k = 0; k < 2 * (stops + 3); k++) {
    await step(m, 'right');
    for (const id of m.live()) seen.add(id);
  }
  assert.ok(seen.size > live.length, `a parked panel came in (${[...seen].join(',')} from ${before})`);
});
