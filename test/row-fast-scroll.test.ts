/**
 * Fast row input: steps asked while a glide runs add to its target and the row keeps moving into one quicker glide, never
 * faster than the floor; under 'jump' a move of more than a window fades past everything between. The virtual frame clock
 * steps 16 ms a frame; jsdom has no Web Animations API, so the frame loop draws the strip inline.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowScrollerFor } from '../rowScroller.js';
import { FAST_SCROLL_FLOOR_SEC, stepGlide } from '../rowFastScroll.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';

const made: HTMLElement[] = [];
afterEach(() => {
  for (const el of made.splice(0)) el.remove();
  cleanup();
});

function row(): { el: HTMLElement; strip: HTMLElement } {
  const el = document.createElement('div');
  const strip = document.createElement('div');
  strip.setAttribute('data-row-strip', '');
  el.appendChild(strip);
  document.body.appendChild(el);
  made.push(el);
  return { el, strip };
}

const SLIDE = 0.6;
const ask = (el: HTMLElement, to: number, mode: 'coalesce' | 'jump' = 'coalesce'): boolean =>
  stepGlide(rowScrollerFor(el), to, { mode, durationSec: SLIDE, ease: [0.4, 0, 0.2, 1], instant: false, windowWidth: 968 });

test('a lone step glides the whole slide', async () => {
  const { el } = row();
  ask(el, 406);
  await advanceFrames(SLIDE * 1000 - 50);
  assert.ok(rowScrollerFor(el).glideTarget() === 406, 'still gliding short of the slide');
  await advanceFrames(100);
  assert.equal(rowScrollerFor(el).scrollLeft(), 406);
});

test('a second step mid-glide adds to the target, keeps the row moving, and lands at the floor, well before a second slide', async () => {
  const { el } = row();
  const scroller = rowScrollerFor(el);
  ask(el, 406);
  await advanceFrames(160);
  const before = scroller.scrollLeft();
  await advanceFrames(16);
  const speed = scroller.scrollLeft() - before;
  assert.ok(speed > 0, 'control: the first glide is moving');
  ask(el, 812);
  assert.equal(scroller.glideTarget(), 812);
  const asked = scroller.scrollLeft();
  await advanceFrames(16);
  assert.ok(scroller.scrollLeft() - asked >= speed * 0.8, `the retarget keeps its speed: ${scroller.scrollLeft() - asked} px against ${speed}`);
  let last = scroller.scrollLeft();
  for (let ms = 16; ms < 220; ms += 16) {
    await advanceFrames(16);
    assert.ok(scroller.scrollLeft() >= last, 'the row never turns back on the way');
    last = scroller.scrollLeft();
  }
  await advanceFrames(80);
  assert.equal(scroller.scrollLeft(), 812, 'landed after about the floor, not a second whole slide');
});

test('however fast the steps come, a glide is never shorter than the floor', async () => {
  const { el } = row();
  const scroller = rowScrollerFor(el);
  ask(el, 406);
  await advanceFrames(16);
  ask(el, 812);
  await advanceFrames(16);
  ask(el, 1218);
  await advanceFrames(FAST_SCROLL_FLOOR_SEC * 1000 - 48);
  assert.notEqual(scroller.scrollLeft(), 1218, 'still gliding inside the floor');
  await advanceFrames(80);
  assert.equal(scroller.scrollLeft(), 1218);
});

test("under 'jump' a move of more than a window fades out, moves unseen at the midpoint, and fades back in", async () => {
  const { el, strip } = row();
  const scroller = rowScrollerFor(el);
  ask(el, 2030, 'jump');
  const seen = new Set<number>();
  let darkest = 1;
  for (let ms = 0; ms < SLIDE * 1000 + 50; ms += 16) {
    await advanceFrames(16);
    seen.add(scroller.scrollLeft());
    const opacity = strip.style.opacity === '' ? 1 : Number(strip.style.opacity);
    darkest = Math.min(darkest, opacity);
    if (scroller.scrollLeft() !== 0 && scroller.scrollLeft() !== 2030) assert.fail(`drew a position between: ${scroller.scrollLeft()}`);
    if (opacity > 0.5 && ms > SLIDE * 400 && ms < SLIDE * 600) assert.fail(`visible at the move: ${opacity} at ${ms} ms`);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 2030]);
  assert.ok(darkest < 0.1, `faded out: ${darkest}`);
  assert.equal(strip.style.opacity, '', 'drawn fully again at rest');
});

test("under 'jump' a move within a window still glides", async () => {
  const { el, strip } = row();
  const scroller = rowScrollerFor(el);
  ask(el, 812, 'jump');
  await advanceFrames(SLIDE * 500);
  assert.ok(scroller.scrollLeft() > 0 && scroller.scrollLeft() < 812, `between at mid-slide: ${scroller.scrollLeft()}`);
  assert.equal(strip.style.opacity, '');
});
