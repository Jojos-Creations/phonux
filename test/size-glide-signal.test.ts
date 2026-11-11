/**
 * `usePanelSizeGlide()` reports a panel box's size glide from its start until it lands, and the glide eases the box's real size, so its
 * content is laid out at the size it is drawn at: never scaled, never clipped.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { PanelSizeBox, usePanelSizeGlide, type PanelSizeGlide } from '../index.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';

afterEach(cleanup);

const seen: Array<PanelSizeGlide | null> = [];
function Probe(): React.ReactElement {
  const glide = usePanelSizeGlide();
  seen.push(glide);
  return React.createElement('i', { 'data-probe': '' });
}

const boxed = (width: number, height: number, wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui): React.ReactElement =>
  withHost(wrap(React.createElement(PanelSizeBox, { width, height, children: React.createElement(Probe) })));
const last = (): PanelSizeGlide | null => seen.at(-1) ?? null;
const boxOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('[data-panel-size-box]')!;

test('the signal is null at rest, holds from and to while the box glides, and is null again once it lands', async () => {
  seen.length = 0;
  const m = mount(boxed(390, 700));
  assert.equal(last(), null, 'at rest');
  m.rerender(boxed(780, 500));
  assert.deepEqual(last(), { from: { width: 390, height: 700 }, to: { width: 780, height: 500 } }, 'set in the commit that starts the glide');
  await advanceFrames(300);
  assert.notEqual(last(), null, 'still gliding partway through');
  await advanceFrames(1000);
  assert.equal(last(), null, 'landed');
});

test('a glide that lands mid-glide reports where it was drawn as its new start', async () => {
  seen.length = 0;
  const m = mount(boxed(390, 700));
  m.rerender(boxed(780, 700));
  await advanceFrames(300);
  m.rerender(boxed(390, 700));
  const glide = last();
  assert.ok(glide !== null && glide.from.width > 390 && glide.from.width < 780, `from the size on screen: ${glide?.from.width}`);
  assert.deepEqual(glide?.to, { width: 390, height: 700 });
});

test('under Reduce Motion the box snaps and the signal stays null', async () => {
  seen.length = 0;
  const reduced = (width: number, height: number) => boxed(width, height, (ui) => React.createElement(MotionConfig, { reducedMotion: 'always' }, ui));
  const m = mount(reduced(390, 700));
  m.rerender(reduced(780, 500));
  await advanceFrames(16);
  assert.ok(seen.every((g) => g === null));
});

test('a glide eases the box\'s real width and height from the old size to the new, never scaled or clipped', async () => {
  const m = mount(boxed(390, 700));
  const box = boxOf(m.container);
  const sizes: string[] = [];
  const observer = new MutationObserver(() => sizes.push(`${box.style.width} ${box.style.height}`));
  observer.observe(box, { attributes: true, attributeFilter: ['style'] });
  m.rerender(boxed(780, 350));
  assert.deepEqual([box.style.width, box.style.height], ['390px', '700px'], 'the first frame draws the old size');
  await advanceFrames(300);
  const w = Number.parseFloat(box.style.width);
  const h = Number.parseFloat(box.style.height);
  assert.ok(w > 390 && w < 780 && h > 350 && h < 700, `control: still easing: ${box.style.width} ${box.style.height}`);
  assert.deepEqual([box.style.transform, box.style.clipPath, box.querySelector('[data-probe]')?.parentElement], ['', '', box], 'the content sits in the box itself, unscaled and unclipped');
  await advanceFrames(1000);
  observer.disconnect();
  assert.deepEqual([box.style.width, box.style.height], ['780px', '350px'], 'landed on the new size');
  assert.ok(new Set(sizes).size > 10, `the size was written on each frame: ${new Set(sizes).size} sizes`);
});

test('with the height held, only the width eases', async () => {
  const m = mount(boxed(390, 700));
  const box = boxOf(m.container);
  m.rerender(boxed(780, 700));
  await advanceFrames(300);
  const w = Number.parseFloat(box.style.width);
  assert.ok(w > 390 && w < 780, `control: still easing: ${box.style.width}`);
  assert.equal(box.style.height, '700px');
});

test('the size glide fills backwards, so a start time ahead of the frame clock draws the old size and not the landing one', async () => {
  const seenOptions: KeyframeAnimationOptions[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const before = proto.animate;
  proto.animate = (_frames: unknown, options: KeyframeAnimationOptions) => {
    seenOptions.push(options);
    return { startTime: 0, cancel() {}, effect: null };
  };
  try {
    const m = mount(boxed(390, 700));
    m.rerender(boxed(800, 700));
    await advanceFrames(16);
    assert.equal(seenOptions.length, 1, 'the glide ran on a Web Animation');
    assert.equal(seenOptions[0]!.fill, 'backwards');
  } finally {
    proto.animate = before;
  }
});
