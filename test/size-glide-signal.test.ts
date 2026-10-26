/**
 * `usePanelSizeGlide()` reports a panel box's size glide from its start until it lands, and `PanelSizeBox`'s `reveal` lays the
 * content out once at the glide's larger size, clipped by the eased box, so a grow resizes it at its start and a shrink at its end.
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

const boxed = (width: number, height: number, reveal?: boolean, wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui): React.ReactElement =>
  withHost(wrap(React.createElement(PanelSizeBox, { width, height, ...(reveal === undefined ? {} : { reveal }), children: React.createElement(Probe) })));
const last = (): PanelSizeGlide | null => seen.at(-1) ?? null;
const revealOf = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>('[data-panel-size-reveal]');
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
  const reduced = (width: number, height: number) => boxed(width, height, undefined, (ui) => React.createElement(MotionConfig, { reducedMotion: 'always' }, ui));
  const m = mount(reduced(390, 700));
  m.rerender(reduced(780, 500));
  await advanceFrames(16);
  assert.ok(seen.every((g) => g === null));
});

test('reveal: a grow lays the content out at the end size at its start, and the eased box clips it', async () => {
  const m = mount(boxed(390, 700, true));
  const box = boxOf(m.container);
  const inner = revealOf(m.container)!;
  assert.equal(box.style.overflow, 'clip');
  assert.deepEqual([inner.style.width, inner.style.height], ['100%', '100%'], 'at rest the content fills the box');
  m.rerender(boxed(780, 500, true));
  assert.deepEqual([inner.style.width, inner.style.height], ['780px', '700px'], 'the larger of each side, from the first frame');
  await advanceFrames(300);
  assert.ok(Number.parseFloat(box.style.width) < 780, 'control: the box itself is still easing');
  assert.deepEqual([inner.style.width, inner.style.height], ['780px', '700px'], 'the content is not resized mid-glide');
  await advanceFrames(1000);
  assert.deepEqual([inner.style.width, inner.style.height], ['100%', '100%'], 'landed: it fills the box again');
});

test('reveal: a shrink keeps the content at its start size until the glide ends', async () => {
  const m = mount(boxed(780, 700, true));
  const inner = revealOf(m.container)!;
  m.rerender(boxed(390, 700, true));
  assert.equal(inner.style.width, '780px');
  await advanceFrames(300);
  assert.equal(inner.style.width, '780px');
  await advanceFrames(1000);
  assert.equal(inner.style.width, '100%');
});

test('without reveal the content is not wrapped and the box does not clip', () => {
  const m = mount(boxed(390, 700));
  assert.equal(revealOf(m.container), null);
  assert.equal(boxOf(m.container).style.overflow, '');
});
