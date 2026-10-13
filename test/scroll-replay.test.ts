/**
 * A scrollTo issued while a panel is being resized by hand: the mark's claim holds the row, so the request waits and runs
 * once, the moment the mark clears. Any other claim (an edge-scroll drag) still drops it with a note.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { registerView, usePanelResizing } from '../index.js';
import { rowScrollerFor } from '../rowScroller.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { made, mountRow, rootEntry, row } from './support/scroll-row.js';

const marks = new Map<string, (on: boolean) => void>();
registerView('replay-view', ({ panel }) => {
  const [, setResizing] = usePanelResizing();
  marks.set(panel.id, setResizing);
  return React.createElement('i', { 'data-slot': panel.id });
});

afterEach(() => {
  mock.timers.reset();
  marks.clear();
  cleanup();
});

const mounted = async () => {
  const m = mountRow(row(rootEntry(), ...[1, 2, 3, 4, 5, 6].map((k) => made(`s${k}`, { scrollOnOpen: 'start' }, { view: 'replay-view' }))), 844, { tuning: { rowGesture: 'free' } });
  await advanceFrames(100);
  act(() => void m.container.dispatchEvent(new Event('scroll')));
  return m;
};
const settle = (): Promise<void> => advanceFrames(900);

test('a scrollTo issued in the same tick as the mark clearing is run once the mark has cleared', async () => {
  const m = await mounted();
  act(() => marks.get('s1')!(true));
  assert.equal(rowScrollerFor(m.container).claimHeld(), true, 'positive control: the mark holds the row');
  act(() => {
    marks.get('s1')!(false);
    assert.equal(m.latest().scrollTo('s5'), true, 'the request is kept');
  });
  await settle();
  assert.ok(m.container.scrollLeft > 1200, `the row went to the fifth panel: ${m.container.scrollLeft}`);
  assert.deepEqual(m.notes, [], 'nothing was dropped');
});

test('of several scrollTo calls while the mark holds the row only the last runs', async () => {
  const m = await mounted();
  act(() => marks.get('s1')!(true));
  act(() => {
    m.latest().scrollTo('s6');
    m.latest().scrollTo('s3');
  });
  assert.equal(m.container.scrollLeft, 0, 'nothing moves while the mark holds the row');
  act(() => marks.get('s1')!(false));
  await settle();
  const target = m.container.scrollLeft;
  const other = await (async () => {
    cleanup();
    const n = await mounted();
    act(() => void n.latest().scrollTo('s3'));
    await settle();
    return n.container.scrollLeft;
  })();
  assert.equal(target, other, 'the row ends where a lone scrollTo to the third panel puts it');
});

test('with no scrollTo issued while the mark holds the row, none is run when it clears', async () => {
  const m = await mounted();
  act(() => marks.get('s1')!(true));
  act(() => marks.get('s1')!(false));
  await settle();
  assert.equal(m.container.scrollLeft, 0);
  assert.deepEqual(m.notes, []);
});

test('a claim taken without replay still drops a scrollTo with the note', async () => {
  const m = await mounted();
  const claim = rowScrollerFor(m.container).claim()!;
  let kept = true;
  act(() => {
    kept = m.latest().scrollTo('s5');
  });
  claim.release();
  await settle();
  assert.equal(kept, false);
  assert.equal(m.container.scrollLeft, 0, 'and it is not run later');
  assert.deepEqual(m.notes.map((n) => n.code), ['scroll-dropped-during-drag']);
});
