/**
 * The engine's reading of the scroll settings it owns: revealOnScroll, edgeHold, scrollOnOpen, scrollOnMove, tuning.rowGesture
 * and tuning.initialScroll. One differential per name through the real hook and Workspace: the same scenario under
 * two values must give different outputs. The literal rows are in row-scroll-mount.test.ts and row-gesture.test.ts.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelSettings, WorkspaceTuning } from '../index.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, panelsOf, rootEntry, row } from './support/scroll-row.js';

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const OWNED = ['revealOnScroll', 'edgeHold', 'scrollOnOpen', 'scrollOnMove', 'tuning.rowGesture', 'tuning.initialScroll'];

/** Whether the parked panel b sits live after one rightward swipe in a window that shows only the root (430 px). */
async function revealedUnder(revealOnScroll: 'edges' | 'any' | 'never'): Promise<boolean> {
  const m = mountRow(row(rootEntry(), made('b', { overflow: 'park', revealOnScroll }, { live: false }), made('c')), 430, { tuning: { rowGesture: 'step' } });
  m.wheel({ deltaX: 50 });
  await advanceFrames(500);
  const live = m.live().includes('b');
  cleanup();
  return live;
}

test('differential revealOnScroll: an engine-parked panel with a live panel beyond the window is reached under any and stepped past under edges', async () => {
  const outcomes = new Map([
    ['edges', await revealedUnder('edges')],
    ['any', await revealedUnder('any')],
  ]);
  differential('revealOnScroll', (run) => {
    run('edges', () => outcomes.get('edges'));
    run('any', () => outcomes.get('any'));
  });
});

/** Where panel b is drawn in a row of root, b, c and d at 1000 px: in the strip, held by its sticky host when held. */
function drawnAt(edgeHold: PanelSettings['edgeHold']): 'held' | 'strip' | 'missing' {
  const m = mountRow(row(rootEntry(), made('b', { edgeHold }), made('c'), made('d')), 1000);
  const slot = m.container.querySelector<HTMLElement>('[data-row-strip] [data-row-id="b"]');
  const where = slot === null ? 'missing' : slot.closest<HTMLElement>('[data-row-hold]')?.style.position === 'sticky' ? 'held' : 'strip';
  cleanup();
  return where;
}

test('differential edgeHold: a panel held at the left edge is pinned by its host in the strip, and off has no host', () => {
  const outcomes = new Map([
    ['off', drawnAt('off')],
    ['left', drawnAt('left')],
  ]);
  assert.deepEqual([...outcomes.values()], ['strip', 'held']);
  differential('edgeHold', (run) => {
    run('off', () => outcomes.get('off'));
    run('left', () => outcomes.get('left'));
  });
});

/** Where scrollTo('c') with no align leaves the row, under `scrollOnOpen`. */
async function openedAt(scrollOnOpen: PanelSettings['scrollOnOpen']): Promise<number> {
  const m = mountRow(panelsOf(5, { scrollOnOpen }), 1000);
  act(() => void m.latest().scrollTo('s3'));
  await advanceFrames(900);
  const at = m.container.scrollLeft;
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
  act(() => m.latest().setSlots('s1', 2));
  await advanceFrames(900);
  const at = m.container.scrollLeft;
  cleanup();
  return at;
}

test('differential scrollOnMove: a panel in view that grows past the window is followed under follow and left under none', async () => {
  const outcomes = new Map([
    ['follow', await movedTo('follow')],
    ['none', await movedTo('none')],
  ]);
  assert.deepEqual([...outcomes.values()], [609, 0]);
  differential('scrollOnMove', (run) => {
    run('follow', () => outcomes.get('follow'));
    run('none', () => outcomes.get('none'));
  });
});

/** The glide a wheel swipe starts under `rowGesture`. */
function swipeGlide(rowGesture: 'step' | 'off'): number | null {
  const m = mountRow(panelsOf(10), 1000, { tuning: { rowGesture } });
  m.wheel({ deltaX: 50 });
  const target = m.scroller.glideTarget();
  cleanup();
  return target;
}

test('differential tuning.rowGesture: step starts a glide on a swipe and off leaves the row still', () => {
  differential('tuning.rowGesture', (run) => {
    run('step', () => swipeGlide('step'));
    run('off', () => swipeGlide('off'));
  });
});

const initialOf = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']>): number => {
  const m = mountRow(panelsOf(10), 1000, { tuning: { initialScroll } });
  const at = m.container.scrollLeft;
  cleanup();
  return at;
};

test('differential tuning.initialScroll: start leaves the strip at 0 and end scrolls it to 3482', () => {
  differential('tuning.initialScroll', (run) => {
    run('start', () => initialOf('start'));
    run('end', () => initialOf('end'));
  });
});

test('differential coverage: the names the differentials above completed are exactly the five this entry owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
