/**
 * The library's default frame animates its size like a `PanelSizeBox` view does: one box around the header, the grab bar and
 * the phone frame, eased from the size it had to the size it has, on the clock the slot's own slide runs on.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { Panel, PanelFrame, PanelSizeBox, createWorkspace, definePanel } from '../index.js';
import type { PanelHandle, PanelTemplate, WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { frameClock } from './support/jsdom-globals.js';
import { SizeBox } from '../PanelRowSlot.js';
import { PanelHiddenContext } from '../panelSlotContext.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';

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
/** The x scale the box is drawn at: 1 at rest. */
const scaleOf = (el: HTMLElement): number => (el.style.transform === '' ? 1 : Number.parseFloat(/scale\(([\d.]+)/.exec(el.style.transform)![1]!));

test('a bare view is drawn inside one size box that holds the header, the grab bar and the phone frame', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  const slot = slotOf(r.m, 'bare');
  assert.equal(slot.querySelectorAll('[data-panel-size-box]').length, 1, 'one box in the slot');
  assert.equal(slot.querySelectorAll('[data-panel-size-plain]').length, 0, 'and no second one inside it');
  const box = boxOf(r.m, 'bare');
  for (const part of ['[data-panel-chrome-part="header"]', '[data-panel-grab-bar]', '[data-phone-frame]']) assert.ok(box.querySelector(part), `${part} is inside the box, so it is drawn at the box's scale`);
  assert.match(box.style.transformOrigin, /^0(px)? 0(px)?$/, 'the scale grows from the left edge, where the slot puts the panel');
});

test('a self-framed view is not wrapped in a box of the library', async () => {
  const own = definePanel({ id: 'own', settings: { title: 'Own' }, view: () => React.createElement(Panel, { title: 'Own', children: React.createElement(PanelFrame, null, React.createElement('p', { 'data-body': 'own' })) }) });
  const r = await rig([own], ['own']);
  assert.equal(slotOf(r.m, 'own').querySelectorAll('[data-panel-size-box]').length, 0);
});

test('a PanelSizeBox below the default frame draws a plain div, so the two never multiply their scales', async () => {
  const inner = definePanel({ id: 'inner', settings: { title: 'Inner' }, view: () => React.createElement(PanelSizeBox, { width: 100, height: 100, children: React.createElement('p', { 'data-body': 'inner' }) }) });
  const r = await rig([inner], ['inner']);
  const slot = slotOf(r.m, 'inner');
  assert.equal(slot.querySelectorAll('[data-panel-size-box]').length, 1, "the frame's box only");
  assert.equal(slot.querySelectorAll('[data-panel-size-plain]').length, 1, "and the view's draws a div");
  assert.equal(slot.querySelector<HTMLElement>('[data-panel-size-plain]')!.style.width, '100px');
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
  assert.deepEqual(frameStyle(), [phoneWidth, phoneHeight], 'the frame fills the box at rest');
  await act(async () => void r.handles[0]!.setSlots(2));
  await advanceFrames(800);
  assert.equal(dims()[0], slotOf(r.m, 'bare').style.width, 'two slots: the width of the slot');
  assert.equal(dims()[0], frameStyle()[0], 'and of the frame');
  assert.equal(dims()[1], phoneHeight, 'the height does not grow');
  await act(async () => void r.handles[0]!.setSlots(3));
  await advanceFrames(800);
  assert.equal(dims()[0], `${3 * 390 + 2 * 16}px`, 'three slots wide');
  assert.equal(dims()[0], frameStyle()[0], 'three slots: the frame is as wide as the box');
  assert.notEqual(dims()[0], '390px', 'which is its own width, not the phone');
  assert.match(dims()[1], /^(\d+px|100%)$/, "and as high as the phone, or as the row's own height for fill");
});

test('a resize draws the box at the old size and eases it to the new one over the slide, with the content laid out at the new size at once', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'bare');
  assert.equal(box.style.transform, '', 'at rest: no transform');
  await act(async () => void r.handles[0]!.setSlots(2));
  const wide = 2 * 390 + 16;
  assert.equal(box.style.width, `${wide}px`, 'the new size lands at once');
  assert.ok(Math.abs(scaleOf(box) - 390 / wide) < 0.01, `drawn at the old width, ${scaleOf(box)}`);
  const seen: number[] = [scaleOf(box)];
  for (let frame = 0; frame < 40; frame++) {
    await advanceFrames(16);
    seen.push(scaleOf(box));
  }
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k]! >= seen[k - 1]! - 1e-6, `the scale only grows (frame ${k})`);
  assert.ok(seen.some((s) => s > 390 / wide + 0.05 && s < 0.95), 'and passes through sizes between');
  await advanceFrames(800);
  assert.equal(box.style.transform, '', 'it ends at 1 and leaves the transform off');
});

test('a resize that lands while the box is on its way carries on from the size it is drawn at', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'bare');
  await act(async () => void r.handles[0]!.setSlots(2));
  await advanceFrames(100);
  const wide = 2 * 390 + 16;
  const drawn = scaleOf(box) * wide;
  await act(async () => void r.handles[0]!.setSlots(1));
  assert.ok(Math.abs(scaleOf(box) * 390 - drawn) < 1.5, `from ${drawn.toFixed(1)}px, not from a size it never showed (${(scaleOf(box) * 390).toFixed(1)}px)`);
});

test('under Reduce Motion, and for a panel that is not animated, the box takes its size in the same frame', async () => {
  const reduced = await rig([bareTemplate('bare')], ['bare'], { wrap: (tree) => React.createElement(MotionConfig, { reducedMotion: 'always' }, tree) });
  await act(async () => void reduced.handles[0]!.setSlots(2));
  assert.equal(boxOf(reduced.m, 'bare').style.transform, '', 'Reduce Motion');
  cleanup();
  const still = await rig([bareTemplate('bare', { settings: { title: 'BARE', multiple: true, animated: false } })], ['bare']);
  await act(async () => void still.handles[0]!.setSlots(2));
  assert.equal(boxOf(still.m, 'bare').style.transform, '', 'animated: false');
});

test('a box that is mounted, or mounted again by the library frame, is not drawn from a size it never had', async () => {
  const r = await rig([bareTemplate('bare')], ['bare']);
  assert.equal(boxOf(r.m, 'bare').style.transform, '', 'the first mount');
  await act(async () => void r.ws.addPanel('bare', { id: 'bare-2' }));
  await act(async () => undefined);
  const added = r.m.container.querySelectorAll<HTMLElement>('[data-panel-size-box]');
  assert.equal(added.length, 2);
  for (const box of added) assert.equal(box.style.transform, '', 'a panel added after the first is framed at once, at its size');
});

test('a view that draws its Panel late releases the library box with the frame, so no size box is left', async () => {
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
  assert.equal(slotOf(r.m, 'lazy').querySelectorAll('[data-panel-size-box]').length, 1);
  ready = true;
  await act(async () => void listeners.forEach((l) => l()));
  await advanceFrames(400);
  assert.equal(slotOf(r.m, 'lazy').querySelectorAll('[data-panel-size-box]').length, 0, 'the view is self-framed now');
});

test('a box in a parked panel takes its size at once, so the panel that returns is not eased from the one it left', async () => {
  const at = (hidden: boolean, width: number): React.ReactElement => React.createElement(PanelHiddenContext.Provider, { value: hidden }, React.createElement(SizeBox, { width, height: 700, children: React.createElement('i') }));
  const mounted = mount(at(true, 390));
  mounted.rerender(at(true, 796));
  const box = mounted.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  assert.equal(box.style.transform, '', 'resized while parked');
  mounted.rerender(at(false, 796));
  assert.equal(box.style.transform, '', 'and shown again');
  mounted.rerender(at(false, 390));
  assert.notEqual(box.style.transform, '', 'positive control: the same resize while shown eases');
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
  const xOf = (el: HTMLElement): number => Number.parseFloat(/translateX\((-?[\d.]+)px\)/.exec(el.style.transform)?.[1] ?? '0');
  const x0 = xOf(next);
  const wide = 2 * 390 + 16;
  await act(async () => void r.handles[0]!.setSlots(2));
  // The commit of a frame that is heavy to render: the first frame the browser draws comes well after it.
  frameClock.skip(64);
  const frames: Array<[number, number]> = [];
  for (let k = 0; k < 40; k++) {
    await advanceFrames(16);
    frames.push([(scaleOf(grower) * wide - 390) / (wide - 390), (xOf(next) - x0) / (wide - 390)]);
  }
  const moved = frames.filter(([box]) => box > 0.02 && box < 0.98);
  assert.ok(moved.length > 5, 'the glide has frames in between');
  for (const [box, slide] of moved) assert.ok(Math.abs(box - slide) < 0.02, `the box is ${box.toFixed(3)} of the way while the neighbour is ${slide.toFixed(3)}`);
});
