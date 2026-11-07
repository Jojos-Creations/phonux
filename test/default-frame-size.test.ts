/**
 * Every panel in a row animates its size in the row's one box, the default frame included: one box around the header, the grab bar
 * and the phone frame, laid out once at its new size and scaled from the size it had to the size it has, on the clock the slot's own slide runs on.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { Panel, PanelFrame, PanelSizeBox, createWorkspace, definePanel } from '../index.js';
import type { PanelHandle, PanelTemplate, WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { frameClock } from './support/jsdom-globals.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';
import { slotTransform } from './support/strip.js';

const open: WorkspaceHandle[] = [];

afterEach(() => {
  mock.timers.reset();
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

const bareTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({ id, settings: { title: id.toUpperCase(), multiple: true }, view: ({ panel }) => React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id), ...over });

const rootTemplate = (): PanelTemplate =>
  definePanel({ id: 'root', view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, React.createElement('i', { 'data-slot': 'root' })) }) });

async function rig(templates: PanelTemplate[], add: string[], o: { width?: number; wrap?: (tree: React.ReactElement) => React.ReactElement } = {}): Promise<{ ws: WorkspaceHandle; m: ResizableWorkspace; handles: PanelHandle[] }> {
  const ws = createWorkspace({ mount: false, root: rootTemplate(), templates, newId: stableIds() });
  open.push(ws);
  const handles = add.map((id) => ws.addPanel(id, { id: `${id}-1` }));
  const m = mountWorkspace(ws, { width: o.width ?? 1280, ...(o.wrap !== undefined ? { wrap: o.wrap } : {}) });
  await flush();
  await act(async () => undefined);
  await advanceFrames(400);
  return { ws, m, handles };
}

const slotOf = (m: ResizableWorkspace, id: string): HTMLElement => m.container.querySelector(`[data-body="${id}"]`)!.closest<HTMLElement>('[data-row-slot]')!;
const boxOf = (m: ResizableWorkspace, id: string): HTMLElement => slotOf(m, id).querySelector<HTMLElement>('[data-panel-size-box]')!;
/** The width the box is drawn at, in px: its laid-out width times the glide's scale. */
const widthOf = (el: HTMLElement): number => Number.parseFloat(el.style.width) * Number(/scale\((-?[\d.e-]+)/.exec(el.style.transform)?.[1] ?? 1);

test('a bare view is drawn inside one size box that holds the header, the grab bar and the phone frame', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  const slot = slotOf(r.m, 'bare');
  assert.equal(slot.querySelectorAll('[data-panel-size-box]').length, 1, 'one box in the slot');
  assert.equal(slot.querySelectorAll('[data-panel-size-plain]').length, 1, "the frame's own box is a plain div inside it");
  const box = boxOf(r.m, 'bare');
  for (const part of ['[data-panel-chrome-part="header"]', '[data-panel-grab-bar]', '[data-phone-frame]']) assert.ok(box.querySelector(part), `${part} is inside the box, so it eases with the box`);
  assert.equal(box.style.transform, '', 'at rest the box is drawn at its own size, unscaled');
  assert.equal(box.style.transformOrigin, '', 'and leaves its origin alone');
});

test('a self-framed view that draws a bare Panel is drawn in the row\'s one size box all the same', async () => {
  const own = definePanel({ id: 'own', settings: { title: 'Own' }, view: () => React.createElement(Panel, { title: 'Own', children: React.createElement(PanelFrame, null, React.createElement('p', { 'data-body': 'own' })) }) });
  const r = await rig([own], ['own']);
  assert.equal(slotOf(r.m, 'own').querySelectorAll('[data-panel-size-box]').length, 1);
  assert.equal(slotOf(r.m, 'own').querySelectorAll('[data-panel-size-plain]').length, 0);
});

test('a bare Panel glides on a resize, with no PanelSizeBox of its own', async () => {
  const own = definePanel({ id: 'own', settings: { title: 'Own', multiple: true }, view: () => React.createElement(Panel, { title: 'Own', children: React.createElement(PanelFrame, null, React.createElement('p', { 'data-body': 'own' })) }) });
  const r = await rig([own], ['own']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'own');
  await act(async () => void r.handles[0]!.setSlots(2));
  const wide = 2 * 390 + 16;
  const seen: number[] = [];
  for (let frame = 0; frame < 40; frame++) {
    await advanceFrames(16);
    seen.push(widthOf(box));
  }
  assert.ok(seen.some((w) => w > 390 + 0.05 * (wide - 390) && w < wide - 0.05 * (wide - 390)), `eased widths, not a snap: ${seen.slice(0, 6).map((w) => w.toFixed(0)).join(', ')}`);
  await advanceFrames(800);
  assert.equal(box.style.width, `${wide}px`);
});

test('a PanelSizeBox below the row\'s box draws a plain div that fills it, so the two never ease the same size twice', async () => {
  const inner = definePanel({ id: 'inner', settings: { title: 'Inner' }, view: () => React.createElement(PanelSizeBox, { width: 100, height: 100, children: React.createElement('p', { 'data-body': 'inner' }) }) });
  const r = await rig([inner], ['inner']);
  const slot = slotOf(r.m, 'inner');
  assert.equal(slot.querySelectorAll('[data-panel-size-box]').length, 1, "the row's box only");
  const plain = [...slot.querySelectorAll<HTMLElement>('[data-panel-size-plain]')];
  assert.equal(plain.length, 2, "the frame's and the view's each draw a div");
  for (const div of plain) assert.deepEqual([div.style.width, div.style.height], ['100%', '100%'], 'each fills the box above it, so it eases with it');
});

test('the box is as wide as the frame at a phone, at two slots and at three slots, and as high as the phone or as the row for fill', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  const dims = (): [string, string] => [boxOf(r.m, 'bare').style.width, boxOf(r.m, 'bare').style.height];
  const frameStyle = (): [string, string] => {
    const frame = slotOf(r.m, 'bare').querySelector<HTMLElement>('[data-phone-frame]')!;
    return [getComputedStyle(frame).width, getComputedStyle(frame).height];
  };
  const [phoneWidth, phoneHeight] = dims();
  assert.equal(phoneWidth, '390px', 'a phone');
  assert.match(phoneHeight, /^\d+px$/, 'a phone is a fixed height');
  assert.deepEqual(frameStyle(), ['100%', '100%'], 'the frame fills the box, so it takes the size the box is drawn at on every frame');
  await act(async () => void r.handles[0]!.setSlots(2));
  await advanceFrames(800);
  assert.equal(dims()[0], slotOf(r.m, 'bare').style.width, 'two slots: the width of the slot');
  assert.deepEqual(frameStyle(), ['100%', '100%'], 'and the frame still fills it');
  assert.equal(dims()[1], phoneHeight, 'the height does not grow');
  await act(async () => void r.handles[0]!.setSlots(3));
  await advanceFrames(800);
  assert.equal(dims()[0], `${3 * 390 + 2 * 16}px`, 'three slots wide');
  assert.deepEqual(frameStyle(), ['100%', '100%'], 'three slots: the frame fills the box');
  assert.notEqual(dims()[0], '390px', 'which is its own width, not the phone');
  assert.match(dims()[1], /^(\d+px|100%)$/, "and as high as the phone, or as the row's own height for fill");
});

test('a resize lays the box out once at the new width and scales it from the old one over the slide', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'bare');
  assert.equal(box.style.width, '390px', 'at rest: a phone');
  await act(async () => void r.handles[0]!.setSlots(2));
  const wide = 2 * 390 + 16;
  assert.ok(Math.abs(widthOf(box) - 390) < 1, `drawn at the old width, ${widthOf(box)}`);
  const seen: number[] = [widthOf(box)];
  for (let frame = 0; frame < 40; frame++) {
    await advanceFrames(16);
    seen.push(widthOf(box));
    assert.equal(box.style.width, `${wide}px`, `laid out at the new width, never written again (frame ${frame})`);
  }
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k]! >= seen[k - 1]! - 1e-6, `the width only grows (frame ${k})`);
  assert.ok(seen.some((w) => w > 390 + 0.05 * (wide - 390) && w < wide - 0.05 * (wide - 390)), 'and passes through widths between');
  await advanceFrames(800);
  assert.equal(box.style.width, `${wide}px`, 'it ends at the new width');
});

test('a resize that lands while the box is on its way carries on from the size it is drawn at', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'bare');
  await act(async () => void r.handles[0]!.setSlots(2));
  await advanceFrames(100);
  const wide = 2 * 390 + 16;
  const drawn = widthOf(box);
  assert.ok(drawn > 390 && drawn < wide, `the box is part of the way (${drawn.toFixed(1)}px)`);
  await act(async () => void r.handles[0]!.setSlots(1));
  assert.ok(Math.abs(widthOf(box) - drawn) < 1.5, `from ${drawn.toFixed(1)}px, not from a size it never showed (${widthOf(box).toFixed(1)}px)`);
});

test('under Reduce Motion the box takes its size in the same frame', async () => {
  const reduced = await rig([bareTemplate('bare')], ['bare'], { wrap: (tree) => React.createElement(MotionConfig, { reducedMotion: 'always' }, tree) });
  await act(async () => void reduced.handles[0]!.setSlots(2));
  assert.equal(boxOf(reduced.m, 'bare').style.width, `${2 * 390 + 16}px`, 'Reduce Motion');
});

test('a box that is mounted, or mounted again by the library frame, is not drawn from a size it never had', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  assert.equal(boxOf(r.m, 'bare').style.width, '390px', 'the first mount');
  await act(async () => void r.ws.addPanel('bare', { id: 'bare-2' }));
  await act(async () => undefined);
  const added = [...r.m.container.querySelectorAll<HTMLElement>('[data-panel-size-box]')].filter((box) => box.querySelector('[data-body]') !== null);
  assert.equal(added.length, 2);
  for (const box of added) assert.equal(box.style.width, '390px', 'a panel added after the first is framed at once, at its size');
});

test('a view that draws its Panel late releases the library frame, and its panel stays in the row\'s one box', async () => {
  let ready = false;
  const listeners = new Set<() => void>();
  const lazy = definePanel({
    id: 'lazy',
    settings: { title: 'Lazy' },
    view: () => {
      const on = React.useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => void listeners.delete(l);
        },
        () => ready,
      );
      return on ? React.createElement(Panel, { title: 'Own', children: React.createElement(PanelFrame, null, React.createElement('p', { 'data-body': 'lazy' })) }) : React.createElement('p', { 'data-body': 'lazy' }, 'lazy');
    },
  });
  const r = await rig([lazy], ['lazy']);
  assert.equal(slotOf(r.m, 'lazy').querySelectorAll('[data-panel-size-plain]').length, 1, "the library frame's box");
  ready = true;
  await act(async () => void listeners.forEach((l) => l()));
  await advanceFrames(400);
  assert.equal(slotOf(r.m, 'lazy').querySelectorAll('[data-panel-size-plain]').length, 0, 'the view is self-framed now');
  assert.equal(slotOf(r.m, 'lazy').querySelectorAll('[data-panel-size-box]').length, 1, "and still in the row's box");
});

test("a growing panel's box and its neighbour's slide run as one curve, the same share of the way at every frame, after a commit that took 64 ms", async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  await act(async () => void r.ws.addPanel('bare', { id: 'bare-2' }));
  await advanceFrames(800);
  mock.timers.enable({ apis: ['setTimeout'] });
  const first = r.m.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  const boxes = [...r.m.container.querySelectorAll<HTMLElement>('[data-panel-size-box]')];
  const grower = boxes.find((b) => b.closest('[data-row-slot]')!.querySelector('[data-body="bare"]') !== null)!;
  const next = boxes.find((b) => b !== grower && b.closest('[data-row-slot]')!.querySelector('[data-body]') !== null)!.closest<HTMLElement>('[data-row-slot]')!;
  assert.ok(first);
  const xOf = (el: HTMLElement): number => Number.parseFloat(/translateX\((-?[\d.]+)px\)/.exec(slotTransform(el))?.[1] ?? '0');
  const x0 = xOf(next);
  const wide = 2 * 390 + 16;
  await act(async () => void r.handles[0]!.setSlots(2));
  // The commit of a frame that is heavy to render: the first frame the browser draws comes well after it.
  frameClock.skip(64);
  const frames: Array<[number, number]> = [];
  for (let k = 0; k < 40; k++) {
    await advanceFrames(16);
    frames.push([(widthOf(grower) - 390) / (wide - 390), (xOf(next) - x0) / (wide - 390)]);
  }
  const moved = frames.filter(([box]) => box > 0.02 && box < 0.98);
  assert.ok(moved.length > 5, 'the glide has frames in between');
  for (const [box, slide] of moved) assert.ok(Math.abs(box - slide) < 0.02, `the box is ${box.toFixed(3)} of the way while the neighbour is ${slide.toFixed(3)}`);
});
