/**
 * RowScroller: the one owner of a row's offset, drawn as the strip's transform. Glides run on the scaffold's virtual frame
 * clock (16 ms a frame, so 0.4 s is 25 frames and 0.8 s is 50). jsdom fires no scroll event for a write, so a test
 * dispatches the one a browser would fire.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf } from './support/strip.js';
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
    setRowOffset(el, 0);
    assert.equal(rowScrollerFor(el).glideTo(812, { durationSec: seconds, instant: false, ease: 'cubic-out' }), true);
    await advanceFrames((frames - 1) * 16);
    assert.ok(rowOffsetOf(el) < 812, `${seconds}s: still on the way one frame early`);
    assert.ok(rowOffsetOf(el) > 0, `${seconds}s: and moving`);
    await advanceFrames(16);
    assert.equal(rowOffsetOf(el), 812, `${seconds}s: arrived on the matching frame`);
    assert.equal(rowScrollerFor(el).glideTarget(), null);
  }
});

test('an instant glide moves at once', () => {
  const el = container();
  rowScrollerFor(el).glideTo(500, { durationSec: 0.4, instant: true, ease: 'cubic-out' });
  assert.equal(rowOffsetOf(el), 500);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
});

test('a glide stops at pointer-down in the container and stays where it was', async () => {
  const el = container();
  rowScrollerFor(el).glideTo(812, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  await advanceFrames(160);
  const at = rowOffsetOf(el);
  assert.ok(at > 0 && at < 812);
  el.dispatchEvent(new Event('pointerdown'));
  await advanceFrames(400);
  assert.equal(rowOffsetOf(el), at);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
});

test('a browser scroll of the container stops the glide, moves the offset by as much, and gives the container its scroll back', async () => {
  const el = container();
  rowScrollerFor(el).glideTo(812, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  await advanceFrames(64);
  const at = rowOffsetOf(el);
  assert.ok(at > 0 && at < 812, `control: mid-glide at ${at}`);
  el.scrollLeft = 30;
  scrolled(el);
  assert.equal(el.scrollLeft, 0);
  assert.equal(rowScrollerFor(el).glideTarget(), null);
  await advanceFrames(400);
  assert.ok(Math.abs(rowOffsetOf(el) - (at + 30)) < 1, `rests 30 past ${at}, at ${rowOffsetOf(el)}`);
});

test('a second glideTo retargets from the current value', async () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  scroller.glideTo(1000, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  await advanceFrames(160);
  const mid = rowOffsetOf(el);
  scroller.glideTo(0, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  assert.equal(scroller.glideTarget(), 0);
  await advanceFrames(16);
  assert.ok(rowOffsetOf(el) < mid && rowOffsetOf(el) > 0, 'it heads back from where it was, not from 1000');
  await advanceFrames(400);
  assert.equal(rowOffsetOf(el), 0);
});

test('while a claim is held glideTo returns false and claim() returns null; after release both work', () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  const claim = scroller.claim();
  assert.ok(claim !== null);
  assert.equal(scroller.claim(), null);
  assert.equal(scroller.glideTo(100, { durationSec: 0, instant: true, ease: 'cubic-out' }), false);
  assert.equal(rowOffsetOf(el), 0);
  claim.release();
  assert.equal(scroller.glideTo(100, { durationSec: 0, instant: true, ease: 'cubic-out' }), true);
  const again = scroller.claim();
  assert.ok(again !== null);
  again.release();
});

test('a claim is bounded by setMaxScroll and never by the DOM, and applies nothing before the first setMaxScroll', () => {
  const el = container();
  Object.defineProperty(el, 'scrollWidth', { value: 99999, configurable: true });
  const claim = rowScrollerFor(el).claim()!;
  assert.equal(claim.write(5000), 0, 'uninformed: nothing applied');
  assert.equal(rowOffsetOf(el), 0);
  claim.setMaxScroll(3482);
  assert.equal(claim.write(5000), 3482);
  assert.equal(rowOffsetOf(el), 3482);
  assert.equal(claim.write(-10), -3482, 'the delta back to the floor');
  claim.release();
});

test("a claim holder's writes are the scroller's own: a glide started after the release runs from them", async () => {
  const el = container();
  const scroller = rowScrollerFor(el);
  const claim = scroller.claim()!;
  claim.setMaxScroll(2000);
  claim.write(700);
  scrolled(el);
  claim.release();
  scroller.glideTo(1500, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  scrolled(el);
  assert.equal(scroller.glideTarget(), 1500);
  await advanceFrames(400);
  assert.equal(rowOffsetOf(el), 1500);
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
  rowScrollerFor(ref.current!).glideTo(812, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  await advanceFrames(160);
  assert.ok(rowOffsetOf(ref.current!) > 0);
  mounted.rerender(at(false));
  assert.equal(rowOffsetOf(ref.current!), 0);
  assert.equal(rowScrollerFor(ref.current!).glideTarget(), null);
  await advanceFrames(400);
  assert.equal(rowOffsetOf(ref.current!), 0, 'the glide did not resume');
});

const stripXOf = (el: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(el.querySelector<HTMLElement>('[data-row-strip]')!.style.transform)?.[1] ?? 0);

function rowWithStrip(): HTMLDivElement {
  const el = container();
  const strip = document.createElement('div');
  strip.setAttribute('data-row-strip', '');
  el.appendChild(strip);
  return el;
}

test('a bump right pushes the strip left by up to its distance and springs back to rest without moving the offset', async () => {
  const el = rowWithStrip();
  setRowOffset(el, 300);
  rowScrollerFor(el).bump('right', { distancePx: 36, durationSec: 0.4, holdMs: 0 });
  let least = 0;
  for (let k = 0; k < 25; k += 1) {
    await advanceFrames(16);
    least = Math.min(least, stripXOf(el) + 300);
    assert.equal(rowOffsetOf(el), 300);
  }
  assert.ok(least < -30 && least >= -36, `pushed ${least}`);
  await advanceFrames(32);
  assert.equal(stripXOf(el), -300, 'back at rest');
});

test('a bump left pushes the strip right and holds there while asks keep coming, then springs back once they stop', async () => {
  const el = rowWithStrip();
  const scroller = rowScrollerFor(el);
  scroller.bump('left', { distancePx: 36, durationSec: 0.4, holdMs: 150 });
  await advanceFrames(80);
  scroller.bump('left', { distancePx: 36, durationSec: 0.4, holdMs: 150 });
  await advanceFrames(128);
  assert.equal(stripXOf(el), 36, 'held at the full push');
  scroller.keepBump('left', 150);
  await advanceFrames(128);
  assert.equal(stripXOf(el), 36, 'kept held by input that is not a step');
  scroller.keepBump('right', 150);
  await advanceFrames(64);
  assert.ok(stripXOf(el) < 36, 'input the other way does not hold it: it springs back');
  await advanceFrames(320);
  assert.equal(stripXOf(el), 0, 'back at rest, with no second bump');
});

test('a bump asked while a glide is in flight waits for it to land', async () => {
  const el = rowWithStrip();
  const scroller = rowScrollerFor(el);
  scroller.glideTo(400, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  scroller.bump('right', { distancePx: 36, durationSec: 0.4, holdMs: 0 });
  await advanceFrames(400);
  assert.equal(rowOffsetOf(el), 400);
  await advanceFrames(80);
  assert.ok(stripXOf(el) < -400, 'the bump plays after the glide lands');
});
