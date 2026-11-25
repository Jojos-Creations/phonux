/**
 * The engine's reading of the scroll settings it owns: sticky, stickyRank, tuning.minScrollSlots, scrollOnOpen, scrollOnMove, tuning.rowGesture
 * and tuning.initialScroll. One differential per name through the real hook and Workspace: the same scenario under
 * two values must give different outputs. The literal rows are in row-scroll-mount.test.ts and row-gesture.test.ts.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { advanceUntilRowRests, emblaWindowIn, rowBoxOf, rowGlideTargetOf, rowOffsetOf, stubSlotBoxes } from './support/strip.js';
import { act } from 'react';
import type { PanelSettings, WorkspaceTuning } from '../index.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { emblaOf } from '../emblaRow.js';
import { made, mountRow, panelsOf, rootEntry, row } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const OWNED = ['sticky', 'stickyRank', 'tuning.minScrollSlots', 'scrollOnOpen', 'scrollOnMove', 'tuning.rowGesture', 'tuning.fastScroll', 'tuning.initialScroll'];

/** Where panel b is drawn in a row of root, b, c and d at 1000 px: in the strip, or in the group beside it when sticky. */
function drawnAt(sticky: PanelSettings['sticky']): 'sticky' | 'strip' | 'missing' {
  const m = mountRow(row(rootEntry(), made('b', { sticky }), made('c'), made('d')), 1000);
  const slot = m.container.querySelector<HTMLElement>('[data-row-id="b"]');
  const where = slot === null ? 'missing' : slot.closest('[data-row-sticky]') === null ? 'strip' : 'sticky';
  cleanup();
  return where;
}

test('differential sticky: a sticky panel is drawn in its own group beside the strip, and off draws it in the strip', () => {
  const outcomes = new Map([
    ['off', drawnAt('off')],
    ['start', drawnAt('start')],
  ]);
  assert.deepEqual([...outcomes.values()], ['strip', 'sticky']);
  differential('sticky', (run) => {
    run('off', () => outcomes.get('off'));
    run('start', () => outcomes.get('start'));
  });
});

/** The sticky panels of root, b and c at 1000 px (two slots: one sticky and one for the row), b and c both asked for the start. */
function stickyIds(rankOfC: number, minScrollSlots?: number): string[] {
  const m = mountRow(row(rootEntry(), made('b', { sticky: 'start' }), made('c', { sticky: 'start', stickyRank: rankOfC })), 1000, minScrollSlots === undefined ? {} : { tuning: { minScrollSlots } });
  const ids = m.latest().rowNumbers.held.map((h) => h.id);
  cleanup();
  return ids;
}

test('differential stickyRank: of two sticky panels with room for one, the higher rank stays sticky', () => {
  const outcomes = new Map([
    [0, stickyIds(0)],
    [3, stickyIds(3)],
  ]);
  assert.deepEqual([...outcomes.values()], [['b'], ['c']]);
  differential('stickyRank', (run) => {
    run(0, () => outcomes.get(0)!.join());
    run(3, () => outcomes.get(3)!.join());
  });
});

test('differential tuning.minScrollSlots: a larger minimum gives the sticky panels back to the row', () => {
  const outcomes = new Map([
    [1, stickyIds(0, 1).length],
    [2, stickyIds(0, 2).length],
  ]);
  assert.deepEqual([...outcomes.values()], [1, 0]);
  differential('tuning.minScrollSlots', (run) => {
    run(1, () => outcomes.get(1));
    run(2, () => outcomes.get(2));
  });
});

/** Where scrollTo('c') with no align leaves the row, under `scrollOnOpen`. */
async function openedAt(scrollOnOpen: PanelSettings['scrollOnOpen']): Promise<number> {
  const m = mountRow(panelsOf(5, { scrollOnOpen }), 1000);
  stubSlotBoxes(m.container, 16);
  act(() => void m.latest().scrollTo('s3'));
  await advanceUntilRowRests(m.container);
  const at = rowOffsetOf(m.container);
  cleanup();
  return at;
}

test('differential scrollOnOpen: into-view and start put the same panel at different scroll positions', async () => {
  const outcomes = new Map([
    ['into-view', await openedAt('into-view')],
    ['start', await openedAt('start')],
  ]);
  assert.deepEqual([...outcomes.values()], [812, 1218]);
  differential('scrollOnOpen', (run) => {
    run('into-view', () => outcomes.get('into-view'));
    run('start', () => outcomes.get('start'));
  });
});

/** Where the row rests after panel s1, in view, becomes two slots wide, under `scrollOnMove`. */
async function movedTo(scrollOnMove: PanelSettings['scrollOnMove']): Promise<number> {
  const m = mountRow(panelsOf(5, { scrollOnMove }), 1000);
  stubSlotBoxes(m.container, 16);
  act(() => m.latest().setSlots('s1', 2));
  await advanceUntilRowRests(m.container);
  const at = rowOffsetOf(m.container);
  cleanup();
  return at;
}

test('differential scrollOnMove: a panel in view that grows past the window is followed under follow and left under none', async () => {
  const outcomes = new Map([
    ['follow', await movedTo('follow')],
    ['none', await movedTo('none')],
  ]);
  assert.deepEqual([...outcomes.values()], [406, 0]);
  differential('scrollOnMove', (run) => {
    run('follow', () => outcomes.get('follow'));
    run('none', () => outcomes.get('none'));
  });
});

/** The glide a wheel swipe starts under `rowGesture`. */
function swipeGlide(rowGesture: 'step' | 'off'): number | null {
  const m = mountRow(panelsOf(10), 1000, { tuning: { rowGesture } });
  stubSlotBoxes(m.container, 16);
  m.wheel({ deltaX: 50 });
  const target = rowGlideTargetOf(m.container);
  cleanup();
  return target;
}

test('differential tuning.rowGesture: step starts a glide on a swipe and off leaves the row still', () => {
  differential('tuning.rowGesture', (run) => {
    run('step', () => swipeGlide('step'));
    run('off', () => swipeGlide('off'));
  });
});

/** Under rowGesture 'off': what a wheel, a press that would start a drag, an arrow key and a scrollTo each do to the row. */
async function offKeeps(rowGesture: 'step' | 'off'): Promise<{ key: number; scrollTo: number; wheel: number | null; drag: boolean }> {
  const m = mountRow(panelsOf(10), 1000, { tuning: { rowGesture } });
  stubSlotBoxes(m.container, 16);
  m.key('ArrowRight');
  await advanceUntilRowRests(m.container);
  const key = rowOffsetOf(m.container);
  act(() => void m.latest().scrollTo('s9', 'start'));
  await advanceUntilRowRests(m.container);
  const scrollTo = rowOffsetOf(m.container);
  m.wheel({ deltaX: -50 });
  const glide = rowGlideTargetOf(m.container);
  const wheel = glide === null ? null : Math.round(glide);
  const win = emblaWindowIn(m.container)!;
  const embla = emblaOf(win)!;
  // Embla asks watchDrag at each press: a touch on the row's own surface starts a drag of the row unless the option refuses it.
  const watch = embla.internalEngine().options.watchDrag;
  const drag = (typeof watch === 'function' ? watch(embla, { type: 'touchstart', target: win } as never) : watch) === true;
  cleanup();
  return { key, scrollTo, wheel, drag };
}

test('tuning.rowGesture off stops the wheel and the drag of the row only: an arrow key and a scrollTo still move it', async () => {
  assert.deepEqual(await offKeeps('step'), { key: 406, scrollTo: 3654, wheel: 3248, drag: true }, 'control: under step each of them moves the row');
  assert.deepEqual(await offKeeps('off'), { key: 406, scrollTo: 3654, wheel: null, drag: false });
});

/**
 * Under `fastScroll`: whether the row faded on a move of more than a window (a scrollTo of s9 from the start: 3654 px in a 796 px
 * window), and where it came to rest. A wheel follows the person 1:1 on the Embla row, so the far move is a request, as a dot is.
 */
async function fadedUnder(fastScroll: 'coalesce' | 'jump'): Promise<{ faded: boolean; at: number }> {
  const m = mountRow(panelsOf(10), 1000, { tuning: { fastScroll } });
  stubSlotBoxes(m.container, 16);
  const strip = rowBoxOf(m.container)!;
  act(() => void m.latest().scrollTo('s9', 'start'));
  let darkest = 1;
  for (let ms = 0; ms < 1500; ms += 16) {
    await advanceFrames(16);
    darkest = Math.min(darkest, strip.style.opacity === '' ? 1 : Number(strip.style.opacity));
  }
  await advanceUntilRowRests(m.container);
  const at = rowOffsetOf(m.container);
  const after = strip.style.opacity;
  cleanup();
  assert.equal(after, '', 'the row is seen again once it rests');
  return { faded: darkest < 0.5, at };
}

test('differential tuning.fastScroll: coalesce glides the whole way and jump fades past a move of more than a window', async () => {
  const outcomes = new Map([
    ['coalesce', await fadedUnder('coalesce')],
    ['jump', await fadedUnder('jump')],
  ]);
  assert.deepEqual([...outcomes.values()], [{ faded: false, at: 3654 }, { faded: true, at: 3654 }]);
  differential('tuning.fastScroll', (run) => {
    run('coalesce', () => outcomes.get('coalesce')!.faded);
    run('jump', () => outcomes.get('jump')!.faded);
  });
});

const initialOf = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']>): number => {
  const m = mountRow(panelsOf(10), 1000, { tuning: { initialScroll } });
  stubSlotBoxes(m.container, 16);
  const at = rowOffsetOf(m.container);
  cleanup();
  return at;
};

test('differential tuning.initialScroll: start leaves the strip at 0 and end scrolls it to 3654', () => {
  const outcomes = new Map([
    ['start', initialOf('start')],
    ['end', initialOf('end')],
  ]);
  assert.deepEqual([...outcomes.values()], [0, 3654]);
  differential('tuning.initialScroll', (run) => {
    run('start', () => outcomes.get('start'));
    run('end', () => outcomes.get('end'));
  });
});

test('differential coverage: the names the differentials above completed are exactly the six this entry owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
