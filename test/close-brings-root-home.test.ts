/**
 * A stepping row of the root and five phones overflows a 2060 px window by one phone, so its last stop shows the five phones with the
 * root scrolled off. Closing either of the last two leaves a row that fits: it rests at 0, and the row glides there on the slots' own
 * in-out curve while the close plays, instead of being clamped by the browser in one jump when the closing panel's slot goes.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { maxScrollOf } from '../rowNumbers.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { mountRow, panelsOf } from './support/scroll-row.js';

afterEach(() => cleanup());

const WIDTH = 2060;
const GAP = 16;
const DURATION_SEC = 1.6;

function scrolledToEnd(reduced = false) {
  const wrap = (row: React.ReactElement): React.ReactElement => (reduced ? React.createElement(MotionConfig, { reducedMotion: 'always' }, row) : row);
  const m = mountRow(panelsOf(5), WIDTH, { tuning: { rowGesture: 'step', slide: { durationSec: DURATION_SEC } }, wireClosing: true }, wrap);
  const end = m.latest().rowNumbers.stops.at(-1)!;
  assert.ok(end > 0, 'control: the six columns overflow the window');
  m.scroller.glideTo(end, { durationSec: 0, instant: true, ease: 'linear' });
  return { m, end };
}

for (const id of ['s5', 's4']) {
  test(`closing ${id} glides the row home to 0 along the slide's in-out curve`, async () => {
    const { m, end } = scrolledToEnd();
    act(() => void m.latest().close(id));
    const n = m.latest().rowNumbers;
    assert.deepEqual(n.stepStops, [], 'control: the row left fits the window');
    assert.equal(m.scroller.glideTarget(), 0, 'the row glides to its one rest');
    assert.equal(m.container.scrollLeft, end, 'nothing has moved in the commit of the close');
    await advanceFrames(DURATION_SEC * 250);
    const quarter = (end - m.container.scrollLeft) / end;
    // The slide's [0.4, 0, 0.2, 1] covers under a fifth at a quarter of its time; cubic-out would cover over half.
    assert.ok(quarter > 0 && quarter < 0.25, `a quarter of the way in the glide covered ${quarter}`);
    await advanceFrames(DURATION_SEC * 1000);
    assert.equal(m.container.scrollLeft, 0);
    assert.equal(m.scroller.glideTarget(), null);
  });
}

test('the end element keeps the scroll range of the commit that closes, and gives it back once the row is home', async () => {
  const { m, end } = scrolledToEnd();
  const pad = m.container.querySelector<HTMLElement>('[data-row-end-pad]')!;
  assert.equal(pad.style.minWidth, '', 'control: no hold before the close');
  act(() => void m.latest().close('s5'));
  const n = m.latest().rowNumbers;
  // A row that fits ends left of 0, so the hold is measured from that end, not from `maxScrollOf`'s floor.
  const rowEnd = n.stripStart + n.stripWidth + n.rightInset + n.endPad - n.windowWidth;
  assert.ok(rowEnd < maxScrollOf(n), 'control: the row left ends short of the window');
  assert.equal(pad.style.minWidth, `${n.endPad + GAP + end - rowEnd + n.rowMarginLeft}px`, 'the old range, plus the margin still to glide in');
  await advanceFrames(DURATION_SEC * 1000 + 100);
  assert.equal(pad.style.minWidth, '', 'the hold is gone once the glide has landed');
});

test('with reduced motion the row is home at once and holds nothing', () => {
  const { m } = scrolledToEnd(true);
  act(() => void m.latest().close('s5'));
  assert.equal(m.container.scrollLeft, 0);
  assert.equal(m.container.querySelector<HTMLElement>('[data-row-end-pad]')!.style.minWidth, '');
});
