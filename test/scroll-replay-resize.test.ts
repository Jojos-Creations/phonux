/**
 * A scroll asked for while a resize holds the row is kept and runs once the claim releases and its settle has moved the row. The
 * settle is stood in for by replayDeferred(): the Workspace calls it after its own glide. A drag's claim still drops the scroll.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelWindow } from '../index.js';
import { rowScrollerFor } from '../rowScroller.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

const sixPanels = (): PanelWindow[] => row(rootEntry(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id, { scrollOnOpen: 'start' })));
const settle = (): Promise<void> => advanceFrames(900);

/** Where a scrollTo of `id` alone leaves the row, from the rest it starts at. */
async function restingAt(id: string): Promise<number> {
  const m = mountRow(sixPanels(), 1000);
  act(() => void m.latest().scrollTo(id));
  await settle();
  const at = m.container.scrollLeft;
  cleanup();
  return at;
}

test('a scroll asked for while a resize holds the row is kept, and runs once the claim releases and the settle is done', async () => {
  const expected = await restingAt('c');
  const m: MountedRow = mountRow(sixPanels(), 1000);
  const scroller = rowScrollerFor(m.container);
  const claim = scroller.claim({ replayScroll: true })!;
  let recorded = false;
  act(() => {
    recorded = m.latest().scrollTo('c');
  });
  assert.equal(recorded, true, 'a scroll kept for the resize is accepted');
  await settle();
  assert.equal(m.container.scrollLeft, 0, 'nothing moves while the resize holds the row');
  claim.release();
  scroller.replayDeferred();
  await settle();
  assert.equal(m.container.scrollLeft, expected, 'the kept scroll runs at the release');
  assert.deepEqual(m.notes.map((n) => n.code), [], 'a kept scroll is not reported as dropped');
});

test('two scrolls asked for during a resize hold replay only the last', async () => {
  const expected = await restingAt('b');
  const first = await restingAt('c');
  assert.notEqual(expected, first, 'the two targets differ, so replaying the first would be seen');
  const m = mountRow(sixPanels(), 1000);
  const scroller = rowScrollerFor(m.container);
  const claim = scroller.claim({ replayScroll: true })!;
  act(() => {
    m.latest().scrollTo('c');
    m.latest().scrollTo('b');
  });
  claim.release();
  scroller.replayDeferred();
  await settle();
  assert.equal(m.container.scrollLeft, expected, 'only the last kept scroll runs');
});

test('with no scroll asked for during a resize hold, the release replays nothing', async () => {
  const m = mountRow(sixPanels(), 1000);
  const scroller = rowScrollerFor(m.container);
  const glides = mock.method(scroller, 'glideTo');
  const claim = scroller.claim({ replayScroll: true })!;
  claim.release();
  scroller.replayDeferred();
  await settle();
  assert.equal(glides.mock.callCount(), 0, 'nothing is glided to');
  assert.equal(m.container.scrollLeft, 0);
});

test('a drag that holds the row still drops a scroll: only a resize claim keeps one', async () => {
  const m = mountRow(sixPanels(), 1000);
  const claim = rowScrollerFor(m.container).claim()!;
  let recorded = true;
  act(() => {
    recorded = m.latest().scrollTo('c');
  });
  assert.equal(recorded, false);
  assert.deepEqual(m.notes.map((n) => n.code), ['scroll-dropped-during-drag']);
  claim.release();
});
