/**
 * Below a `PanelSizeBox` the panel and its frame fill it ('100%' on both axes), so one eased size on the box is the size they
 * all draw; outside one they keep their own pixel size. The box eases its real inline width and height, with no transform, and
 * snaps under Reduce Motion.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { Panel, PanelFrame, PanelSizeBox, createWorkspace, definePanel } from '../index.js';
import { useFrameClaim } from '../panelFrameClaim.js';
import { advanceFrames, cleanup, mount, withHost } from './support/mount-harness.js';
import { flush, mountWorkspace } from './support/workspace-row.js';

afterEach(cleanup);

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 700;

const panelWithFrame = (frameSize?: { width: number; height: number }): React.ReactElement =>
  React.createElement(Panel, { title: 'P', children: React.createElement(PanelFrame, { ...(frameSize === undefined ? {} : { size: frameSize }), children: 'x' }) });

const boxed = (width: number, height: number, frameSize?: { width: number; height: number }, wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui): React.ReactElement =>
  withHost(wrap(React.createElement(PanelSizeBox, { width, height, children: panelWithFrame(frameSize) })));

const frameOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('[data-phone-frame]')!;
const boxOf = (container: HTMLElement): HTMLElement => container.querySelector<HTMLElement>('[data-panel-size-box]')!;

test('below a size box the Panel and the PanelFrame draw 100% of it on both axes', () => {
  const m = mount(boxed(500, 600));
  const box = boxOf(m.container);
  assert.equal(box.style.width, '500px');
  assert.equal(box.style.height, '600px');
  const panel = box.firstElementChild as HTMLElement;
  const frame = frameOf(m.container);
  assert.equal(getComputedStyle(panel).width, '100%', 'Panel width');
  assert.equal(getComputedStyle(panel).height, '100%', 'Panel height');
  assert.equal(getComputedStyle(frame).width, '100%', 'PanelFrame width');
  assert.equal(getComputedStyle(frame).height, '100%', 'PanelFrame height');
});

test('a size passed to the PanelFrame below a size box does not override the fill', () => {
  const m = mount(boxed(500, 600, { width: 200, height: 100 }));
  const frame = frameOf(m.container);
  assert.equal(getComputedStyle(frame).width, '100%');
  assert.equal(getComputedStyle(frame).height, '100%');
});

test('outside a size box the Panel and the PanelFrame keep their pixel size', () => {
  const m = mount(withHost(panelWithFrame()));
  const frame = frameOf(m.container);
  assert.equal(boxOf(m.container), null, 'nothing wraps the panel');
  const panel = m.container.firstElementChild as HTMLElement;
  assert.equal(getComputedStyle(panel).width, `${PHONE_WIDTH}px`, 'Panel width');
  assert.equal(getComputedStyle(frame).width, `${PHONE_WIDTH}px`, 'PanelFrame width');
  assert.equal(getComputedStyle(frame).height, `${PHONE_HEIGHT}px`, 'PanelFrame height');
  assert.equal(getComputedStyle(panel).height, '', 'the Panel sets no height of its own');
});

test('outside a size box a size passed to the PanelFrame is drawn in pixels', () => {
  const m = mount(withHost(panelWithFrame({ width: 200, height: 100 })));
  const frame = frameOf(m.container);
  assert.equal(getComputedStyle(frame).width, '200px');
  assert.equal(getComputedStyle(frame).height, '100px');
});

test('in a mounted row the size box has the slot\'s pixels and the Panel and PanelFrame under it fill it', async () => {
  const claiming = (): React.ReactElement => {
    useFrameClaim('frame');
    return React.createElement(PanelSizeBox, null, panelWithFrame());
  };
  const view = definePanel({ id: 'sized', view: claiming, settings: { slots: 2 } });
  const root = definePanel({ id: 'root', view: () => {
      useFrameClaim('frame');
      return null;
    },
    settings: {} });
  const ws = createWorkspace({ mount: false, root, templates: [view] });
  ws.addPanel('sized');
  const m = mountWorkspace(ws, { width: 4000 });
  await flush();
  const box = boxOf(m.container);
  assert.equal(box.style.width, `${2 * PHONE_WIDTH + 16}px`);
  const panel = box.firstElementChild as HTMLElement;
  const frame = frameOf(box);
  assert.equal(getComputedStyle(panel).width, '100%');
  assert.equal(getComputedStyle(frame).width, '100%');
  assert.equal(getComputedStyle(frame).height, '100%');
});

/** What a test needs to know about the box at one moment: its inline sizes and anything that would scale it. */
const drawnBox = (el: HTMLElement): { width: number; height: number; transform: string; css: string } => ({
  width: Number.parseFloat(el.style.width),
  height: Number.parseFloat(el.style.height),
  transform: el.style.transform,
  css: el.getAttribute('style') ?? '',
});

test('a resize eases the box\'s own inline width and height over the frames, with no transform and no size variables', async () => {
  const m = mount(boxed(390, 700));
  const box = boxOf(m.container);
  assert.deepEqual([drawnBox(box).width, drawnBox(box).height], [390, 700], 'at rest');
  m.rerender(boxed(780, 500));
  assert.ok(boxOf(m.container) === box, 'the same node, resized in place');
  const seen = [drawnBox(box)];
  for (let frame = 0; frame < 40; frame += 1) {
    await advanceFrames(16);
    seen.push(drawnBox(box));
  }
  assert.deepEqual([seen[0]!.width, seen[0]!.height], [390, 700], 'it starts from the size on screen, not the new one');
  for (let k = 1; k < seen.length; k += 1) {
    assert.ok(seen[k]!.width >= seen[k - 1]!.width - 1e-6, `the width only grows (frame ${k})`);
    assert.ok(seen[k]!.height <= seen[k - 1]!.height + 1e-6, `the height only shrinks (frame ${k})`);
  }
  assert.ok(seen.some((s) => s.width > 400 && s.width < 770 && s.height > 510 && s.height < 690), 'and passes through sizes between');
  assert.deepEqual([seen.at(-1)!.width, seen.at(-1)!.height], [780, 500], 'it ends at the new size');
  for (const s of seen) {
    assert.equal(s.transform, '', 'no transform is ever set');
    assert.doesNotMatch(s.css, /scale|--phonux-size/);
  }
});

test('under Reduce Motion the box takes its new size in the same commit', async () => {
  const reduced = (width: number, height: number) => boxed(width, height, undefined, (ui) => React.createElement(MotionConfig, { reducedMotion: 'always' }, ui));
  const m = mount(reduced(390, 700));
  const box = boxOf(m.container);
  m.rerender(reduced(780, 500));
  assert.deepEqual([drawnBox(box).width, drawnBox(box).height], [780, 500], 'snapped');
  assert.equal(box.style.transform, '');
  await advanceFrames(16);
  assert.deepEqual([drawnBox(box).width, drawnBox(box).height], [780, 500], 'and stays there');
});

test('control: without Reduce Motion the same resize has not arrived in the commit that asks for it', () => {
  const m = mount(boxed(390, 700));
  const box = boxOf(m.container);
  m.rerender(boxed(780, 500));
  assert.deepEqual([drawnBox(box).width, drawnBox(box).height], [390, 700]);
});
