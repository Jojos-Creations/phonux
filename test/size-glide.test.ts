/**
 * The chrome the library draws stays true while a `SizeBox` eases its scale: a corner is a quarter circle of the theme radius, the
 * edge is 1 px, per axis. The box writes its scale as custom properties for the frame, the header pill and the grab bar to read,
 * and removes them at rest. Real layout (the drawn radii and edges on every frame, at three widths and two CPU rates) is
 * test/size-glide-chromium.test.ts; the numbers here come from resolving the CSS the library writes.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { MotionConfig } from 'motion/react';
import { HostProvider, Panel, PanelFrame, createWorkspace, definePanel, usePanelResizing } from '../index.js';
import type { PanelHandle, PanelTemplate, WorkspaceHandle } from '../index.js';
import { createFakeHost } from '../fakeHost.js';
import { SizeBox } from '../PanelRowSlot.js';
import { DefaultFrame } from '../defaultFrame.js';
import { GLIDE_ON, GLIDE_X, GLIDE_Y, glideCorner, glideEdge, writeGlide } from '../sizeGlide.js';
import { advanceFrames, cleanup, mount } from './support/mount-harness.js';
import { frameClock } from './support/jsdom-globals.js';
import { stableIds } from './support/frame-fixtures.js';
import { flush, mountWorkspace, type ResizableWorkspace } from './support/workspace-row.js';
import { radii, shadows } from './support/glide-css.js';

const open: WorkspaceHandle[] = [];

afterEach(() => {
  mock.timers.reset();
  cleanup();
  for (const ws of open.splice(0)) act(() => ws.dispose());
});

const COLOR = '#123456';
const vars = (x: number, y: number): Record<string, number> => ({ [GLIDE_X]: x, [GLIDE_Y]: y, [GLIDE_ON]: 1 });

test('at rest the corner is the theme radius on both axes and the edge is the one 1 px ring, because every variable falls back to 1 and 0', () => {
  assert.deepEqual(radii(glideCorner(24)), [24, 24]);
  const [ring, ...bands] = shadows(glideEdge(COLOR));
  assert.deepEqual(ring, { x: 0, y: 0, spread: 1 });
  assert.equal(bands.length, 4);
  for (const band of bands) assert.deepEqual(band, { x: 0, y: 0, spread: 0 }, 'a band with no offset draws nothing');
});

test('while the box is scaled the corner is drawn the theme radius on each axis, whatever the two scales', () => {
  for (const [x, y] of [[0.5, 1], [1.6, 1], [0.66, 2], [3, 0.4]] as const) {
    const [rx, ry] = radii(glideCorner(24), vars(x, y));
    assert.ok(Math.abs(rx * x - 24) < 1e-9, `x ${x}: drawn ${rx * x}`);
    assert.ok(Math.abs(ry * y - 24) < 1e-9, `y ${y}: drawn ${ry * y}`);
  }
});

test('while the box is scaled the edge is four bands, each drawn 1 px on its own axis, and the ring is gone', () => {
  for (const [x, y] of [[0.5, 1], [1.6, 1], [0.66, 2], [3, 0.4]] as const) {
    const [ring, left, right, top, bottom] = shadows(glideEdge(COLOR), vars(x, y));
    assert.equal(ring!.spread, 0, 'no ring, or the bands would sit on top of it');
    assert.ok(Math.abs(left!.x * x - 1) < 1e-9 && Math.abs(right!.x * x + 1) < 1e-9, `left and right bands at x ${x}`);
    assert.ok(Math.abs(top!.y * y - 1) < 1e-9 && Math.abs(bottom!.y * y + 1) < 1e-9, `top and bottom bands at y ${y}`);
    for (const band of [left!, right!]) assert.equal(band.y, 0);
    for (const band of [top!, bottom!]) assert.equal(band.x, 0);
  }
});

/** The rules emotion inserted into the document for `element`, mounted so that its insertion effects run; one string per rule. */
const rulesOf = (element: React.ReactElement): string[] => {
  mount(React.createElement(HostProvider, { host: createFakeHost(), children: element }));
  return [...document.querySelectorAll('style')].flatMap((el) => [...((el as HTMLStyleElement).sheet?.cssRules ?? [])].map((rule) => rule.cssText));
};

test('the frame and the header pill draw their edge as a shadow that takes no layout, and keep the 1 px they used to hold as padding', () => {
  const rules = rulesOf(React.createElement(Panel, { title: 'T', children: React.createElement(PanelFrame, null, 'body') }));
  const frame = rules.find((rule) => /padding: 1px;/.test(rule) && /box-shadow/.test(rule))!;
  const pill = rules.find((rule) => /bottom: calc\(100% \+ 24px\)/.test(rule))!;
  assert.ok(frame && pill, 'both rules were found');
  for (const [name, rule] of [['frame', frame], ['pill', pill]] as const) {
    assert.match(rule, /box-shadow: inset 0 0 0 calc\(1px \* \(1 - var\(--phonux-size-glide, 0\)\)\)/, `${name} draws the ring`);
    assert.doesNotMatch(rule, /[\s;{]border(-width|-color|-style)?:/, `${name} has no border, which would be rounded to device pixels and re-lay out the content`);
    assert.match(rule, /border-radius: calc\([\d.]+px \/ var\(--phonux-size-x, 1\)\)\/calc\([\d.]+px \/ var\(--phonux-size-y, 1\)\)/, `${name} reads the scale for its corners`);
  }
  assert.match(pill, /padding-left: 13px; padding-right: 13px; padding-top: 1px; padding-bottom: 1px/, "the pill keeps its text 12 px from the frame's content and 1 px for the edge");
});

const sized = (width: number, height: number | '100%'): React.ReactElement => React.createElement(SizeBox, { width, height, children: React.createElement('i') });
const props = (el: HTMLElement): [string, string, string] => [el.style.getPropertyValue(GLIDE_X), el.style.getPropertyValue(GLIDE_Y), el.style.getPropertyValue(GLIDE_ON)];
const scaleOf = (el: HTMLElement): [number, number] => {
  const m = /scale\(([-\d.e]+), ([-\d.e]+)\)/.exec(el.style.transform);
  return m === null ? [1, 1] : [Number(m[1]), Number(m[2])];
};

test('the box writes the scale it is drawn at as custom properties on every frame of the glide, and removes all three when it ends', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const mounted = mount(sized(390, 700));
  const box = mounted.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  assert.deepEqual(props(box), ['', '', ''], 'at rest nothing is set');
  mounted.rerender(sized(796, 700));
  let sampled = 0;
  for (let frame = 0; frame < 60; frame++) {
    const [x, y] = scaleOf(box);
    if (x !== 1 || y !== 1) {
      sampled++;
      assert.deepEqual(props(box), [String(x), String(y), '1'], `frame ${frame}: the properties are the transform's own scale`);
    }
    await advanceFrames(16);
  }
  assert.ok(sampled > 5, 'the glide had frames');
  assert.equal(box.style.transform, '');
  assert.deepEqual(props(box), ['', '', ''], 'and at the end nothing is left');
});

test('a box that snaps, or sits below another box, never sets the properties', async () => {
  const reduced = mount(React.createElement(MotionConfig, { reducedMotion: 'always' }, sized(390, 700)));
  reduced.rerender(React.createElement(MotionConfig, { reducedMotion: 'always' }, sized(796, 700)));
  assert.deepEqual(props(reduced.container.querySelector<HTMLElement>('[data-panel-size-box]')!), ['', '', ''], 'Reduce Motion');
  cleanup();
  const nested = mount(React.createElement(SizeBox, { width: 390, height: 700, children: sized(390, 700) }));
  nested.rerender(React.createElement(SizeBox, { width: 390, height: 700, children: sized(796, 700) }));
  const plain = nested.container.querySelector<HTMLElement>('[data-panel-size-plain]')!;
  assert.deepEqual(props(plain), ['', '', ''], 'a box inside a box is a plain div');
});

test('writeGlide sets all three at a scale and removes all three at 1 by 1', () => {
  const el = document.createElement('div');
  writeGlide(el, 0.5, 2);
  assert.deepEqual(props(el), ['0.5', '2', '1']);
  writeGlide(el, 1, 1);
  assert.deepEqual(props(el), ['', '', '']);
});

const bareTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({ id, settings: { title: id.toUpperCase(), multiple: true }, view: ({ panel }) => React.createElement('p', { 'data-body': id, 'data-slot': panel.id }, panel.id), ...over });

const rootTemplate = (): PanelTemplate =>
  definePanel({ id: 'root', view: () => React.createElement(Panel, { title: 'History', children: React.createElement(PanelFrame, null, React.createElement('i', { 'data-slot': 'root' })) }) });

async function rig(templates: PanelTemplate[], add: string[]): Promise<{ ws: WorkspaceHandle; m: ResizableWorkspace; handles: PanelHandle[] }> {
  const ws = createWorkspace({ mount: false, root: rootTemplate(), templates, newId: stableIds() });
  open.push(ws);
  const handles = add.map((id) => ws.addPanel(id, { id: `${id}-1` }));
  const m = mountWorkspace(ws, { width: 1280 });
  await flush();
  await act(async () => undefined);
  await advanceFrames(400);
  return { ws, m, handles };
}

const boxOf = (m: ResizableWorkspace, id: string): HTMLElement => m.container.querySelector(`[data-body="${id}"]`)!.closest<HTMLElement>('[data-row-slot]')!.querySelector<HTMLElement>('[data-panel-size-box]')!;

const summary = (slots: number, size: { width: number; height: number | 'fill' }): never => ({ id: 'p', title: 'P', slots, size }) as never;
const framed = (panel: never): React.ReactElement => React.createElement(HostProvider, { host: createFakeHost(), children: React.createElement(DefaultFrame, { panel, children: React.createElement('i') }) });

test("a panel that fills the row's height is drawn at 100% and its box never scales on y, while it still eases on x, to two slots and on to a wider panel and back", async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const mounted = mount(framed(summary(1, { width: 390, height: 700 })));
  const box = mounted.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  assert.equal(box.style.height, '700px', 'a phone has a pixel height');
  const steps: Array<[string, never, string]> = [
    ['to two slots', summary(2, { width: 768, height: 'fill' }), '100%'],
    ['on to a wider panel', summary(3, { width: 1200, height: 'fill' }), '100%'],
    ['back to one slot', summary(1, { width: 390, height: 700 }), '700px'],
  ];
  for (const [name, panel, height] of steps) {
    mounted.rerender(framed(panel));
    assert.equal(box.style.height, height, `${name}: the box is ${height} high`);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      const [x, y] = scaleOf(box);
      xs.push(x);
      ys.push(y);
      await advanceFrames(16);
    }
    assert.ok(ys.every((y) => y === 1), `${name}: y is exactly 1 on every frame, not NaN or a ratio of a pixel height to a word (${[...new Set(ys)]})`);
    assert.ok(xs.some((x) => Math.abs(x - 1) > 0.05), `${name}: x still eases`);
    assert.deepEqual(props(box), ['', '', ''], `${name}: ends at rest`);
  }
});

test('a height that changes is eased on y by the same curve as the width, and a change that lands mid-glide carries on from the height on screen', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const mounted = mount(sized(390, 700));
  const box = mounted.container.querySelector<HTMLElement>('[data-panel-size-box]')!;
  mounted.rerender(sized(796, 350));
  const [x0, y0] = scaleOf(box);
  assert.ok(Math.abs(x0 - 390 / 796) < 1e-6 && Math.abs(y0 - 2) < 1e-6, `drawn at the old size: ${x0}, ${y0}`);
  let compared = 0;
  for (let frame = 0; frame < 60; frame++) {
    await advanceFrames(16);
    const [x, y] = scaleOf(box);
    if (x === 1 && y === 1) break;
    // Both axes are one share of the way from where they started to 1.
    const shareX = (x - x0) / (1 - x0);
    const shareY = (y - y0) / (1 - y0);
    assert.ok(Math.abs(shareX - shareY) < 1e-6, `frame ${frame}: x is ${shareX.toFixed(4)} of the way, y ${shareY.toFixed(4)}`);
    compared++;
  }
  assert.ok(compared > 5);
  await advanceFrames(800);
  // A commit that took 64 ms keeps the two axes on one curve too.
  mounted.rerender(sized(390, 700));
  const [jx0, jy0] = scaleOf(box);
  frameClock.skip(64);
  let jank = 0;
  for (let frame = 0; frame < 40; frame++) {
    await advanceFrames(16);
    const [x, y] = scaleOf(box);
    if (x === 1 && y === 1) break;
    assert.ok(Math.abs((x - jx0) / (1 - jx0) - (y - jy0) / (1 - jy0)) < 1e-6, `frame ${frame}: one curve after a late first frame`);
    jank++;
  }
  assert.ok(jank > 3);
  await advanceFrames(800);
  mounted.rerender(sized(796, 350));
  await advanceFrames(100);
  const drawnHeight = scaleOf(box)[1] * 350;
  mounted.rerender(sized(796, 700));
  assert.ok(Math.abs(scaleOf(box)[1] * 700 - drawnHeight) < 1.5, `from ${drawnHeight.toFixed(1)}px high, not from a height it never showed (${(scaleOf(box)[1] * 700).toFixed(1)}px)`);
});

type Grabber = { resizing: (on: boolean) => void; width: (px: number | null, pin?: 'start' | 'end') => void };
const grabbers = new Map<string, Grabber>();

/** What the app's grabber does: the view's own content asks the host to hold the panel at a width. */
function Grab({ id }: { id: string }): React.ReactElement {
  const [, resizing, width] = usePanelResizing();
  grabbers.set(id, { resizing, width });
  return React.createElement('p', { 'data-body': id }, id);
}

const grabTemplate = (id: string): PanelTemplate => definePanel({ id, settings: { title: id.toUpperCase(), multiple: true, slots: 2, maxSlots: 4 }, view: () => React.createElement(Grab, { id }) });

test('while a host holds a default-frame panel at a width, its box takes each width in the same frame; the same change after the hold eases', async () => {
  grabbers.clear();
  const r = await rig([grabTemplate('grab')], ['grab']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const box = boxOf(r.m, 'grab');
  const g = grabbers.get('grab')!;
  const rest = Number.parseFloat(box.style.width);
  await act(async () => g.resizing(true));
  for (const w of [rest + 40, rest + 90, rest + 150]) {
    await act(async () => g.width(w));
    await advanceFrames(20);
    assert.equal(Number.parseFloat(box.style.width), w, `the box takes ${w}`);
    assert.equal(box.style.transform, '', `at ${w}: held, so the box follows the host and does not ease`);
  }
  await act(async () => {
    g.width(null);
    g.resizing(false);
  });
  await advanceFrames(800);
  await act(async () => void r.handles[0]!.setSlots(1));
  assert.notEqual(box.style.transform, '', 'positive control: a resize after the hold eases');
});

test('the other panels keep the width they were drawn at while one is held, so none of their boxes eases', async () => {
  grabbers.clear();
  const r = await rig([bareTemplate('bare'), grabTemplate('grab')], ['bare', 'grab']);
  mock.timers.enable({ apis: ['setTimeout'] });
  const other = boxOf(r.m, 'bare');
  const before = other.style.width;
  const g = grabbers.get('grab')!;
  await act(async () => g.resizing(true));
  await act(async () => g.width(1000));
  await advanceFrames(100);
  assert.equal(other.style.width, before, 'the neighbour is as wide as it was');
  assert.equal(other.style.transform, '', 'and was not eased');
});
