/**
 * RowScroller: the one writer of a container's scrollLeft. Glides run on the scaffold's virtual frame clock (16 ms a
 * frame, so 0.4 s is 25 frames and 0.8 s is 50). jsdom fires no scroll event for a write, so a test dispatches the
 * one a browser would fire, after each write it wants the scroller to see.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { Workspace } from '../index.js';
import { closestRowScroller, rowScrollerFor } from '../rowScroller.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(() => cleanup());

function container(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
const scrolled = (el: HTMLElement): void => void el.dispatchEvent(new Event('scroll'));

test('rowScrollerFor returns one object per element and a different one for another element', () => {
  const a = container();
  const b = container();
  const first = rowScrollerFor(a);
  const second = rowScrollerFor(a);
  assert.ok(first === second);
  assert.ok(first !== rowScrollerFor(b));
});

test('a glide to 812 with durationSec 0.4 ends after 25 frames and not before, and with 0.8 after 50', async () => {
  for (const [seconds, frames] of [[0.4, 25], [0.8, 50]] as const) {
    const el = container();
    el.scrollLeft = 0;
    assert.equal(rowScrollerFor(el).glideTo(812, { durationSec: seconds, instant: false }), true);
    await advanceFrames((frames - 1) * 16);
    assert.ok(el.scrollLeft < 812, `${seconds}s: still on the way one frame early`);
    assert.ok(el.scrollLeft > 0, `${seconds}s: and moving`);
    await advanceFrames(16);
    assert.equal(el.scrollLeft, 812, `${seconds}s: arrived on the matching frame`);
    assert.equal(rowScrollerFor(el).glideTarget(), null);
  }
});

test('an instant glide moves at once', () => {
  const el = container();
  rowScrollerFor(el).glideTo(500, { durationSec: 0.4, instant: true });
  assert.equal(el.scrollLeft, 500);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
});

test('a glide stops at pointer-down in the container and stays where it was', async () => {
  const el = container();
  rowScrollerFor(el).glideTo(812, { durationSec: 0.4, instant: false });
  await advanceFrames(160);
  const at = el.scrollLeft;
  assert.ok(at > 0 && at < 812);
  el.dispatchEvent(new Event('pointerdown'));
  await advanceFrames(400);
  assert.equal(el.scrollLeft, at);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
});

test("a glide's own writes are not foreign: the scroll event after each frame leaves it running, and a 1 px foreign change does too", async () => {
  const el = container();
  rowScrollerFor(el).glideTo(812, { durationSec: 0.4, instant: false });
  for (let frame = 0; frame < 5; frame += 1) {
    await advanceFrames(16);
    scrolled(el);
  }
  assert.equal(rowScrollerFor(el).glideTarget(), 812, 'its own writes did not stop it');
  el.scrollLeft += 1;
  scrolled(el);
  assert.equal(rowScrollerFor(el).glideTarget(), 812, '1 px is within the tolerance');
  await advanceFrames(400);
  assert.equal(el.scrollLeft, 812);
});

test('a 2 px foreign change stops the glide where the foreign write left it', async () => {
  const el = container();
  rowScrollerFor(el).glideTo(812, { durationSec: 0.4, instant: false });
  await advanceFrames(64);
  el.scrollLeft += 2;
  const at = el.scrollLeft;
  scrolled(el);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
  await advanceFrames(400);
  assert.equal(el.scrollLeft, at);
});

test('a second glideTo retargets from the current value', async () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  scroller.glideTo(1000, { durationSec: 0.4, instant: false });
  await advanceFrames(160);
  const mid = el.scrollLeft;
  scroller.glideTo(0, { durationSec: 0.4, instant: false });
  assert.equal(scroller.glideTarget(), 0);
  await advanceFrames(16);
  assert.ok(el.scrollLeft < mid && el.scrollLeft > 0, 'it heads back from where it was, not from 1000');
  await advanceFrames(400);
  assert.equal(el.scrollLeft, 0);
});

test('while a claim is held glideTo returns false and claim() returns null; after release both work', () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  const claim = scroller.claim();
  assert.ok(claim !== null);
  assert.equal(scroller.claim(), null);
  assert.equal(scroller.glideTo(100, { durationSec: 0, instant: true }), false);
  assert.equal(el.scrollLeft, 0);
  claim.release();
  assert.equal(scroller.glideTo(100, { durationSec: 0, instant: true }), true);
  const again = scroller.claim();
  assert.ok(again !== null);
  again.release();
});

test('a claim is bounded by setMaxScroll and never by the DOM, and applies nothing before the first setMaxScroll', () => {
  const el = container();
  Object.defineProperty(el, 'scrollWidth', { value: 99999, configurable: true });
  const claim = rowScrollerFor(el).claim()!;
  assert.equal(claim.write(5000), 0, 'uninformed: nothing applied');
  assert.equal(el.scrollLeft, 0);
  claim.setMaxScroll(3482);
  assert.equal(claim.write(5000), 3482);
  assert.equal(el.scrollLeft, 3482);
  assert.equal(claim.write(-10), -3482, 'the delta back to the floor');
  claim.release();
});

test("a claim holder's writes are the scroller's own: a glide started after the release does not mistake them for foreign scrolls", async () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  const claim = scroller.claim()!;
  claim.setMaxScroll(2000);
  claim.write(700);
  scrolled(el);
  claim.release();
  scroller.glideTo(1500, { durationSec: 0.4, instant: false });
  scrolled(el);
  assert.equal(scroller.glideTarget(), 1500, 'the last value written is the baseline the glide compares against');
  await advanceFrames(400);
  assert.equal(el.scrollLeft, 1500);
});

test('closestRowScroller finds the marked container from a deep descendant, null with no mark, and a container whose overflow-x is hidden', () => {
  const el = container();
  const deep = document.createElement('span');
  const mid = document.createElement('div');
  mid.appendChild(deep);
  el.appendChild(mid);
  assert.equal(closestRowScroller(deep), null);
  el.setAttribute('data-row-scroller', '');
  el.style.overflowX = 'hidden';
  assert.ok(closestRowScroller(deep) === el);
  assert.ok(closestRowScroller(el) === el, 'ancestor-or-self');
});

test('a mounted Workspace marks its scroll container data-row-scroller and no other element, whether rowScroll is true or false', () => {
  for (const rowScroll of [true, false]) {
    const ref = React.createRef<HTMLDivElement>();
    const rowRef = React.createRef<HTMLDivElement>();
    const mounted = mount(withHost(React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowScroll, children: React.createElement('i') })));
    const marked = mounted.container.querySelectorAll('[data-row-scroller]');
    assert.equal(marked.length, 1, `rowScroll ${rowScroll}`);
    assert.ok(marked[0] === ref.current);
    mounted.unmount();
  }
});

test('the Workspace reset of a row that stops scrolling stops a glide in flight and writes 0 through the scroller', async () => {
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const at = (rowScroll: boolean): React.ReactElement =>
    withHost(React.createElement(Workspace, { overflowContainerRef: ref, rowRef, containerWidth: 1000, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: 1, liveWidths: [], rowScroll, children: null }));
  const mounted = mount(at(true));
  rowScrollerFor(ref.current!).glideTo(812, { durationSec: 0.4, instant: false });
  await advanceFrames(160);
  assert.ok(ref.current!.scrollLeft > 0);
  mounted.rerender(at(false));
  assert.equal(ref.current!.scrollLeft, 0);
  assert.equal(rowScrollerFor(ref.current!).glideTarget(), null);
  await advanceFrames(400);
  assert.equal(ref.current!.scrollLeft, 0, 'the glide did not resume');
});
