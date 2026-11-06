/**
 * The row's one view driver: a move of the centering, a reversal and a hold flip arriving while a glide is in flight leave what is
 * on screen where it is at that instant, and the glide still lands where the row was going. Glides run on the scaffold's virtual
 * frame clock (16 ms a frame). Where the strip's `animate` is stubbed the compositor path is read instead of the frame loop.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { rowScrollerFor, type RowScroller } from '../rowScroller.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel } from '../panelWindow.js';
import type { PanelSettings, PanelWindow } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';

afterEach(() => cleanup());

const GLIDE = { durationSec: 0.4, instant: false, ease: 'cubic-out' } as const;

function row(): { el: HTMLDivElement; strip: HTMLElement; scroller: RowScroller } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const strip = document.createElement('div');
  strip.setAttribute('data-row-strip', '');
  el.appendChild(strip);
  return { el, strip, scroller: rowScrollerFor(el) };
}
const drawn = (strip: HTMLElement): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(strip.style.transform)?.[1] ?? 0);

test('a re-centering asked mid-glide leaves the strip where it is drawn at that instant, then lands the row where it was going', async () => {
  const { strip, scroller } = row();
  scroller.reorigin(100, { durationSec: 0, instant: true, ease: 'cubic-out' });
  scroller.glideTo(800, GLIDE);
  await advanceFrames(160);
  const before = scroller.stripX();
  scroller.reorigin(60, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  assert.equal(scroller.stripX(), before, 'nothing moved at the call');
  assert.equal(scroller.glideTarget(), 800, 'the row is still going to 800');
  await advanceFrames(600);
  assert.equal(scroller.scrollLeft(), 800);
  assert.equal(scroller.glideTarget(), null);
  assert.equal(drawn(strip), 60 - 800, 'drawn at the new centering less the scroll');
});

test('a re-centering of a row at rest moves every panel to the new centering and keeps the scroll', async () => {
  const { strip, scroller } = row();
  scroller.reorigin(100, { durationSec: 0, instant: true, ease: 'cubic-out' });
  scroller.glideTo(400, { ...GLIDE, instant: true });
  scroller.reorigin(40, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  assert.equal(drawn(strip), 100 - 400, 'not a frame of it has moved yet');
  await advanceFrames(240);
  const mid = drawn(strip);
  assert.ok(mid < 100 - 400 && mid > 40 - 400, `moving toward the new centering: ${mid}`);
  await advanceFrames(400);
  assert.equal(scroller.scrollLeft(), 400);
  assert.equal(drawn(strip), 40 - 400);
});

test('an instant re-centering keeps the scroll, as the margin did, and the first one only places the row', () => {
  const { strip, scroller } = row();
  scroller.reorigin(100, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  assert.equal(scroller.scrollLeft(), 0, 'the first centering is where the row is drawn from');
  assert.equal(drawn(strip), 100);
  scroller.glideTo(300, { ...GLIDE, instant: true });
  scroller.reorigin(70, { durationSec: 0, instant: true, ease: 'cubic-out' });
  assert.equal(scroller.scrollLeft(), 300);
  assert.equal(drawn(strip), 70 - 300);
});

test('a reversal mid-glide takes over from where the strip is drawn, never jumps, and lands on the new target', async () => {
  const { strip, scroller } = row();
  scroller.glideTo(800, GLIDE);
  await advanceFrames(160);
  const at = drawn(strip);
  assert.ok(at < 0 && at > -800);
  scroller.glideTo(0, { ...GLIDE, carry: true });
  assert.equal(scroller.stripX(), at, 'no jump at the call');
  let least = scroller.scrollLeft();
  for (let k = 0; k < 40; k += 1) {
    await advanceFrames(16);
    least = Math.min(least, scroller.scrollLeft());
  }
  assert.ok(least >= -1e-9, 'it does not overshoot the target');
  assert.equal(scroller.scrollLeft(), 0);
  assert.equal(drawn(strip), 0);
});

test('a hold flip does not move the row: the numbers give the same centering, so nothing asks the driver to re-center', () => {
  const made = (id: string, layer: PanelSettings): PanelWindow => {
    const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'row-driver-view' }, id, 'root')[0]!;
    return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
  };
  let flips = 0;
  for (const container of [900, 1000, 1100, 1300, 1500, 1700]) {
    const input = (hold: boolean) => ({ entries: [0, 1, 2, 3, 4, 5].map((k) => made(`p${k}`, k === 0 && hold ? { edgeHold: 'left' as const } : {})), phoneWidth: 390, containerWidth: container, gap: 16, wholePanels: true });
    const off = computeRowNumbers(input(false));
    const on = computeRowNumbers(input(true));
    if (on.held.length === 0) continue;
    flips += 1;
    assert.equal(on.rowMarginLeft, off.rowMarginLeft, `container ${container}`);
  }
  assert.ok(flips >= 3, `only ${flips} containers held`);
});

test('where the strip has the Web Animations API the compositor path starts from the drawn position and ends on the rest', async () => {
  const { strip, scroller } = row();
  const runs: Keyframe[][] = [];
  strip.animate = ((frames: Keyframe[]) => {
    runs.push(frames);
    return { cancel() {} } as unknown as Animation;
  }) as unknown as HTMLElement['animate'];
  scroller.reorigin(100, { durationSec: 0, instant: true, ease: 'cubic-out' });
  scroller.glideTo(500, { ...GLIDE, instant: true });
  const start = drawn(strip);
  scroller.reorigin(20, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  const frames = runs.at(-1)!;
  const x = (f: Keyframe): number => Number(/translateX\((-?[\d.e+-]+)px\)/.exec(String(f.transform))?.[1]);
  assert.equal(x(frames[0]!), start, 'the first keyframe is where the strip is drawn');
  assert.equal(x(frames.at(-1)!), 20 - 500, 'the last is the new rest');
  assert.equal(drawn(strip), 20 - 500, 'under the animation, the rest it lands on');
});

test('scrollLeft holds still and no scroll is under way while only the centering travels', async () => {
  const { scroller } = row();
  scroller.reorigin(100, { durationSec: 0, instant: true, ease: 'cubic-out' });
  scroller.glideTo(300, { ...GLIDE, instant: true });
  scroller.reorigin(0, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
  for (let k = 0; k < 12; k += 1) {
    await advanceFrames(16);
    assert.ok(Math.abs(scroller.scrollLeft() - 300) < 1e-6, `frame ${k}: ${scroller.scrollLeft()}`);
    assert.equal(scroller.glideTarget(), null, `frame ${k}`);
  }
});

test('a jump of the scroll, or a claim, mid re-centering leaves the centering travelling to its landing', async () => {
  for (const how of ['jump', 'claim'] as const) {
    const { strip, scroller } = row();
    scroller.reorigin(100, { durationSec: 0, instant: true, ease: 'cubic-out' });
    scroller.glideTo(300, { ...GLIDE, instant: true });
    scroller.reorigin(0, { durationSec: 0.4, instant: false, ease: 'cubic-out' });
    await advanceFrames(160);
    const mid = drawn(strip);
    if (how === 'jump') scroller.glideTo(200, { ...GLIDE, instant: true });
    else scroller.claim()?.release();
    assert.equal(scroller.scrollLeft(), how === 'jump' ? 200 : 300, how);
    if (how === 'claim') assert.equal(drawn(strip), mid, 'a claim moves nothing on screen');
    await advanceFrames(600);
    assert.equal(drawn(strip), -(how === 'jump' ? 200 : 300), `${how}: the centering reached zero`);
  }
});
