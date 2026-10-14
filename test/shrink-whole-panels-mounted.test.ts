/**
 * tuning.shrinkOutOfView on a mounted stepping row (phone 390, gap 16, container 1800: window 1768, four slots) holding
 * History and panels of 2, 4, 1 and 3 slots: what each step draws, where it scrolls, and that the panels on the screen move as one.
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
import { computeRowNumbers } from '../rowNumbers.js';
import { slotDriver } from '../PanelRowSlot.js';
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

test("'visible' at launch: the panel after the group fills the free slot and the strip rests on the first stop", async () => {
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

test('reversing at a stop is one move: the glide is aimed at the previous stop at once and ends there with no second move after it', async () => {
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

test('a panel marked as being resized holds the row and every other panel at its width: a step during the drag is ignored', async () => {
  const m = await opened('visible');
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

/** Every slot's filter against the stop the row is logically on: shown panels carry none, the rest are dimmed to nothing and inert. */
function fadeProblems(m: ReturnType<typeof mountRow>): string[] {
  const n = m.latest().rowNumbers;
  const span = n.stopSpans[n.atStop]!;
  return slots(m.container).flatMap((el, k) => {
    const shown = k >= span.first && k < span.end;
    const dimmed = el.style.filter === 'opacity(0)' && el.hasAttribute('inert');
    return shown === !dimmed ? [] : [`slot ${k} is ${shown ? 'shown but dimmed' : 'hidden but drawn'} at stop ${n.atStop}`];
  });
}
const rowOf = (slotsOf: readonly number[], width: number) =>
  mountRow(row(rootEntry(), ...slotsOf.map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64 }, { view: 'resizing-view' }))), width, { tuning: { rowGesture: 'step', shrinkOutOfView: 'visible' } });

for (const [slotsOf, width] of [[[2, 1, 2, 1, 2, 1], 844], [[1, 3, 1, 3, 1, 3], 844], [[1, 2, 4, 1, 3], 1280], [[2, 4, 1, 3], 1800]] as const) {
  test(`'visible' dims exactly what the logical stop hides at every rest, forward and back, where stops share a scroll position (${slotsOf.join(',')} at ${width})`, async () => {
    const m = rowOf(slotsOf, width);
    await advanceFrames(100);
    scrolled(m);
    mock.timers.enable({ apis: ['setTimeout'] });
    assert.deepEqual(fadeProblems(m), [], 'at launch');
    const walk: Array<'right' | 'left'> = [...slotsOf.map(() => 'right' as const), ...slotsOf.map(() => 'left' as const)];
    for (const [i, direction] of walk.entries()) {
      await step(m, direction);
      assert.deepEqual(fadeProblems(m), [], `step ${i + 1} ${direction}`);
    }
  });
}

test("a panel shrunk by setSlots while held dims the panel it cut off the moment the hold is released", async () => {
  const m = await opened('visible');
  const id = m.latest().entries.find((p) => p.id === 's1')!.id;
  const dimmedRight = (): boolean[] => {
    const n = m.latest().rowNumbers;
    const span = n.stopSpans[n.atStop]!;
    return slots(m.container).map((el, k) => (k >= span.first && k < span.end ? el.style.filter === '' : el.style.filter === 'opacity(0)'));
  };
  act(() => resizeSetters.get('s1')!(true));
  act(() => m.latest().setSlots(id, 1));
  assert.deepEqual(dimmedRight(), dimmedRight().map(() => true), 'while held: every panel past the shown ones is dimmed and the shown ones are not');
  act(() => resizeSetters.get('s1')!(false));
  scrolled(m);
  assert.deepEqual(dimmedRight(), dimmedRight().map(() => true), 'after the release too');
});

test('a panel marked as resizing holds the row: it does not settle onto a stop until the mark is cleared, then it does', async () => {
  const m = await opened('off');
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
  const m = await opened('visible');
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

test("'visible' still cross-fades mid-glide: the 'hidden' no-fade rule is its own", async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  m.wheel({ deltaX: 50 });
  await advanceFrames(8);
  scrolled(m);
  const partial = filtersOf(m.container).filter((f) => /opacity\(0\.\d+\)/.test(f));
  assert.ok(partial.length > 0, `a panel is part way faded mid-glide: ${filtersOf(m.container).join(' | ')}`);
});

test('a step right at the last stop moves nothing: the strip is padded to hold the stop, so neither the scroll nor the drawing changes', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const stops = m.latest().rowNumbers.stops.length;
  for (let k = 0; k < stops + 1; k++) await step(m, 'right');
  const last = m.latest().rowNumbers.stops.at(-1)!;
  assert.equal(m.container.scrollLeft, last);
  assert.equal(m.latest().rowNumbers.atStop, stops - 1);
  const drawn = widthsOf(m.container);
  await step(m, 'right');
  assert.equal(m.container.scrollLeft, last);
  assert.deepEqual(widthsOf(m.container), drawn);
});

/** The 4-slot panel's width at every rest while stepping right to the end, then left to the start: 1, 2, 3, 4, 3, 2, 1 each way, no size skipped. */
test('the 4-slot panel steps through every size at rest: 1, 2, 3, 4, 3, 2, 1 forward, and back the same way', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const seen = (): number => widthsOf(m.container)[2]!;
  const forward = [seen()];
  for (let k = 0; k < 7; k++) {
    await step(m, 'right');
    forward.push(seen());
  }
  assert.deepEqual(forward, [SLOT(1), SLOT(2), SLOT(3), SLOT(4), SLOT(3), SLOT(2), SLOT(1), SLOT(4)], 'the last stop does not show the panel, so it is back at its own size');
  const back = [seen()];
  for (let k = 0; k < 7; k++) {
    await step(m, 'left');
    back.push(seen());
  }
  assert.deepEqual(back, [...forward].reverse());
});

/** One trackpad swipe: deltas ramp up, peak and fade 16 ms apart, then the glide runs out and the gesture goes quiet. */
async function swipe(m: ReturnType<typeof mountRow>, direction: 'right' | 'left'): Promise<void> {
  for (const delta of [2, 4, 9, 18, 32, 50, 70, 88, 100, 104, 100, 92, 82, 72, 62, 52, 44, 36, 30, 24, 19, 15, 12, 9, 7, 5, 4, 3, 2, 1]) {
    m.wheel({ deltaX: direction === 'right' ? delta : -delta });
    mock.timers.tick?.(16);
  }
  await advanceFrames(600);
  scrolled(m);
  mock.timers.tick?.(1000);
}

test('one trackpad swipe is one step: the 4-slot panel comes in as 1, 2, 3, 4 slots and goes out as 3, 2, 1, one size per swipe', async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const seen = (): number => widthsOf(m.container)[2]!;
  const forward = [seen()];
  for (let k = 0; k < 7; k++) {
    await swipe(m, 'right');
    forward.push(seen());
  }
  assert.deepEqual(forward, [SLOT(1), SLOT(2), SLOT(3), SLOT(4), SLOT(3), SLOT(2), SLOT(1), SLOT(4)]);
  const back = [seen()];
  for (let k = 0; k < 7; k++) {
    await swipe(m, 'left');
    back.push(seen());
  }
  assert.deepEqual(back, [...forward].reverse());
});

test('one wheel step moves the row one stop, one slot: [2,2,2,2] takes every stop in turn and a step never skips one', async () => {
  const m = rowOf([2, 2, 2, 2], 1800);
  await advanceFrames(100);
  scrolled(m);
  mock.timers.enable({ apis: ['setTimeout'] });
  const at = (): number => m.latest().rowNumbers.atStop;
  const count = m.latest().rowNumbers.stops.length;
  assert.equal(count, 6, 'History, four 2-slot panels: 9 slots, a window of 4, six stops');
  for (let k = 1; k < count; k++) {
    await step(m, 'right');
    assert.equal(at(), k, `step ${k}`);
  }
  for (let k = count - 2; k >= 0; k--) {
    await step(m, 'left');
    assert.equal(at(), k, `step back to ${k}`);
  }
});

test("a step under Reduce Motion is one frame: the scroll and every width are final before a frame is advanced", async () => {
  const m = await opened('visible', (r) => React.createElement(MotionConfig, { reducedMotion: 'always' }, r));
  mock.timers.enable({ apis: ['setTimeout'] });
  const first = widthsOf(m.container);
  m.wheel({ deltaX: 50 });
  assert.equal(m.container.scrollLeft, m.latest().rowNumbers.stops[1], 'the scroll is at the next stop at once');
  assert.notDeepEqual(widthsOf(m.container), first);
  assert.equal(m.scroller.glideTarget(), null);
});

test("the glide of a step that lands a stop is the slide's own duration and ease, so the scroll and the slots are one curve", async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const calls: { durationSec: number; ease: unknown }[] = [];
  const glideTo = m.scroller.glideTo.bind(m.scroller);
  m.scroller.glideTo = (target, o) => {
    calls.push({ durationSec: o.durationSec, ease: o.ease });
    return glideTo(target, o);
  };
  const { slide } = m.latest().tuning;
  await step(m, 'right');
  assert.deepEqual(calls, [{ durationSec: slide.durationSec, ease: slide.ease }]);
  assert.notEqual(slide.ease, slide.glideEase, 'the control: the defaults differ, so this test sees the difference');
});

const FRAME_MS = 1000 / 60;
const SCREEN_X = (el: HTMLElement, left: number): number => Number.parseFloat(/translateX\(([-\d.e]+)px\)/.exec(el.style.transform)?.[1] ?? '0') - left;

/** A panel's slot in the window, by id. */
const slotOf = (m: ReturnType<typeof mountRow>, id: string): HTMLElement => m.container.querySelector<HTMLElement>(`[data-row-id="${id}"]`)!;

/**
 * Every step, frame by frame: the panels a step keeps at the same width all move by the same amount on the screen at every
 * frame (the first panel only shrinks or leaves and the last only grows or arrives, so these lie between them), whether the step
 * moves the scroll, the slots, or both: one curve, no panel passed by a neighbour. The widths themselves are the browser run's.
 */
for (const [slotsOf, width] of [[[1, 1, 2, 1, 1, 3, 1, 1], 1800], [[1, 1, 2, 1, 1, 3, 1, 1], 1280]] as const) {
  test(`across every step the panels kept at one width move as one at every frame, to within a pixel (${slotsOf.join(',')} at ${width})`, async () => {
    const m = rowOf(slotsOf, width);
    await advanceFrames(100);
    scrolled(m);
    mock.timers.enable({ apis: ['setTimeout'] });
    const stops = m.latest().rowNumbers.stops.length;
    const kinds = new Set<string>();
    let compared = 0;
    let crossed = 0;
    for (let k = 0; k + 1 < stops; k++) {
      const n = m.latest().rowNumbers;
      const spanA = n.stopSpans[k]!;
      const spanB = n.stopSpans[k + 1]!;
      const next = computeRowNumbers({ entries: m.latest().entries, phoneWidth: 390, containerWidth: width, gap: 16, wholePanels: true, shrink: 'visible', atFirst: n.stopFirsts[k + 1]! });
      const kept = n.ids.filter((_, p) => p >= Math.max(spanA.first, spanB.first) && p < Math.min(spanA.end, spanB.end) && n.drawnWidths[p] === next.drawnWidths[p]);
      const origin = kept.map((id) => SCREEN_X(slotOf(m, id), m.container.scrollLeft));
      const everyone = n.ids.filter((_, p) => p >= Math.min(spanA.first, spanB.first) && p < Math.max(spanA.end, spanB.end));
      const x0 = everyone.map((id) => SCREEN_X(slotOf(m, id), 0));
      const scroll0 = m.container.scrollLeft;
      const samples: { x: number[]; scroll: number }[] = [];
      m.wheel({ deltaX: 50 });
      const worst: number[] = [];
      for (let frame = 0; frame < 60; frame++) {
        await advanceFrames(FRAME_MS);
        scrolled(m);
        samples.push({ x: everyone.map((id) => SCREEN_X(slotOf(m, id), 0)), scroll: m.container.scrollLeft });
        const moved = kept.map((id, i) => SCREEN_X(slotOf(m, id), m.container.scrollLeft) - origin[i]!);
        if (moved.length > 1) worst.push(Math.max(...moved) - Math.min(...moved));
      }
      compared += worst.length > 0 ? 1 : 0;
      mock.timers.tick?.(1000);
      // A slot that moves while the scroll moves is on the scroll's curve: the same share of its way at every frame.
      const last = samples[samples.length - 1]!;
      for (const [i, id] of everyone.entries()) {
        const dx = last.x[i]! - x0[i]!;
        const dScroll = last.scroll - scroll0;
        if (Math.abs(dx) < 2 || Math.abs(dScroll) < 2) continue;
        crossed += 1;
        for (const [f, sample] of samples.entries()) {
          const slotShare = (sample.x[i]! - x0[i]!) / dx;
          const scrollShare = (sample.scroll - scroll0) / dScroll;
          assert.ok(Math.abs(slotShare - scrollShare) < 0.01, `step ${k + 1} frame ${f}: ${id} is ${slotShare.toFixed(3)} of the way while the scroll is ${scrollShare.toFixed(3)}`);
        }
      }
      assert.ok(Math.max(0, ...worst) <= 1, `step ${k + 1}: the kept panels drift apart by ${Math.max(...worst).toFixed(2)}px`);
      kinds.add(`${spanA.first < spanB.first ? 'first leaves' : 'first shrinks'}/${spanA.end < spanB.end ? 'last arrives' : 'last grows'}`);
    }
    assert.ok(compared >= 1, 'some step had two or more panels to compare');
    assert.ok(crossed >= 1, 'some step moved a slot and the scroll together');
    assert.equal(kinds.size >= 3, true, `the kinds of step walked: ${[...kinds].join(', ')}`);
  });
}

test("a slot whose rest moves starts its slide in the layout phase, beside the layout animation of its size box", async () => {
  const m = await opened('visible');
  mock.timers.enable({ apis: ['setTimeout'] });
  const started: HTMLElement[] = [];
  const startPending = slotDriver.startPending;
  slotDriver.startPending = (el) => {
    started.push(el);
    startPending(el);
  };
  try {
    await step(m, 'right');
    await step(m, 'right');
  } finally {
    slotDriver.startPending = startPending;
  }
  assert.ok(started.length > 0, 'a step that moves a slot starts it at once');
  assert.ok(started.every((el) => el.hasAttribute('data-row-slot')));
});

test('stepping across every stop with a cap set never changes the live set', async () => {
  const m = mountRow(
    row(rootEntry(), ...[2, 4, 1, 3, 1, 2].map((n, k) => made(`s${k + 1}`, { slots: n, maxSlots: 64, overflow: k < 2 ? 'scroll' : 'park' }, { view: 'resizing-view' }))),
    1800,
    { tuning: { rowGesture: 'step', shrinkOutOfView: 'visible', maxLivePanels: 3 } },
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
