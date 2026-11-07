/**
 * Every entrance and exit style a panel may take: the cascade from the panel's own `enterFrom` and `exitTo` to the
 * workspace's `tuning.defaultEnterFrom` and `tuning.defaultExitTo`, the slot values each style starts from and leaves to,
 * and the scale an `expand` grows about its center and a `shrink` takes about its center (a close) or the edge it parks toward, read from the slot's own style through a mounted PanelRow.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { frameClock } from './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { PANEL_TRANSITION, createWorkspace } from '../index.js';
import type { PanelSettings, PanelWindow, WorkspaceHandle, WorkspaceTuning } from '../index.js';
import { enterDirectionOf, exitStyleOf } from '../PanelRow.js';
import { GAP, panelRowSlotMotion, slotDriver } from '../PanelRowSlot.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { bindingOf, type EngineOps } from '../workspaceCore.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, seededWorkspace, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';
import { slotTransform } from './support/strip.js';

const ROOT = 'root';
const OWNED = ['exitTo', 'tuning.defaultEnterFrom', 'tuning.defaultExitTo'];
const WIDTH = 390;
const SPAN = WIDTH + GAP;
const NONE: ReadonlySet<string> = new Set();

registerTestView('style-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));
/** While on, every commit that renders this view moves the clock on, as a slow commit on a busy main thread does. */
const slowCommits = { on: false };
function SlowView({ panel }: { panel: { id: string; title?: string | undefined } }): React.ReactElement {
  React.useLayoutEffect(() => {
    if (slowCommits.on) frameClock.skip(80);
  });
  return React.createElement('i', { 'data-slot': panel.id }, panel.title);
}
registerTestView('slow-view', SlowView);

const resolve = (layer: PanelSettings = {}) => resolvePanelSettings({ template: layer }).value;
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'style-view' }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolve({ overflow: 'park', ...layer }), 'create');
}
const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'style-view' }, resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');

/** A row holds its slots' moves until its workspace's restore has settled, so every case here mounts over one that has. */
function settledWorkspace(entries: readonly PanelWindow[], tuning: WorkspaceTuning = {}): WorkspaceHandle {
  const workspace = seededWorkspace(entries, { rootId: ROOT, tuning });
  bindingOf(workspace).attach({});
  bindingOf(workspace).publish({ entries, held: new Set(), settled: true, create: () => {}, lateRegister: () => {}, ops: {} as EngineOps });
  assert.equal(workspace.panels.getSnapshot().status, 'ready', 'the workspace did not settle, so every slot would start at its rest');
  return workspace;
}
const row = (entries: PanelWindow[], workspace: WorkspaceHandle, reduced = false, enterSideById: ReadonlyMap<string, 'left' | 'right'> = new Map()): React.ReactElement => {
  const ui = React.createElement(StaticRow, { workspace, entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, exitRightIds: NONE, enterSideById });
  return withHost(reduced ? React.createElement(MotionConfig, { reducedMotion: 'always' }, ui) : ui);
};
const slotOf = (container: HTMLElement, id: string): HTMLElement | null => container.querySelector(`[data-slot="${id}"]`)?.closest<HTMLElement>('[data-row-slot]') ?? null;
const axis = (slot: HTMLElement, name: 'X' | 'Y'): number => {
  const match = new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(slotTransform(slot));
  return match === null ? 0 : Number(match[1]);
};
const widthOf = (slot: HTMLElement): number => Number.parseFloat(slot.style.width);
const scaleOf = (slot: HTMLElement): number => {
  const match = /scale\((-?[\d.]+)\)/.exec(slotTransform(slot));
  return match === null ? 1 : Number(match[1]);
};

afterEach(() => cleanup());

// B rests at index 2 of [root, A, B].
const REST = 2 * SPAN;

/** B enters [root, A] with `b`'s settings under the workspace's `tuning`; its slot right after the render. */
function entering(b: PanelSettings, tuning: WorkspaceTuning = {}, reduced = false): { slot: HTMLElement; mounted: ReturnType<typeof mount> } {
  const base = [rootEntry(), made('a')];
  const workspace = settledWorkspace(base, tuning);
  const mounted = mount(row(base, workspace, reduced));
  mounted.rerender(row([...base, made('b', b)], workspace, reduced));
  const slot = slotOf(mounted.container, 'b');
  assert.ok(slot, 'b mounted');
  return { slot, mounted };
}
const enterStart = (b: PanelSettings, tuning: WorkspaceTuning = {}): { x: number; y: number; opacity: string; width: number } => {
  const { slot, mounted } = entering(b, tuning);
  const out = { x: axis(slot, 'X'), y: axis(slot, 'Y'), opacity: slot.style.opacity, width: widthOf(slot) };
  mounted.unmount();
  return out;
};

test('validation: enterFrom takes the four new entrances and exitTo the six exits, and both still refuse other words', () => {
  for (const value of ['top', 'bottom', 'fade', 'expand'] as const) assert.equal(resolve({ enterFrom: value }).enterFrom, value);
  for (const value of ['left', 'right', 'top', 'bottom', 'fade', 'shrink'] as const) assert.equal(resolve({ exitTo: value }).exitTo, value);
  for (const [key, value] of [['enterFrom', 'shrink'], ['enterFrom', 'sideways'], ['exitTo', 'expand'], ['exitTo', 'anchor'], ['exitTo', 'down']] as const) {
    assert.throws(() => resolvePanelSettings({ template: { [key]: value } as PanelSettings }), (e: Error) => e.message.includes(key), `${key} '${value}' is refused`);
  }
  assert.equal(resolve().exitTo, 'auto', 'the default is auto');
});

test('enterDirectionOf: the panel wins unless auto, the workspace default applies at auto, and the new styles beat every mark', () => {
  const formula = (side: 'left' | 'right') => () => side;
  assert.deepEqual(
    [enterDirectionOf('expand', false, 'left', true, formula('right')), enterDirectionOf('expand', false, undefined, true, formula('right')), enterDirectionOf('auto', false, 'left', false, formula('right'), 'expand'), enterDirectionOf('expand', false, undefined, false, formula('left'))],
    ['expand-left', 'expand-right', 'expand-left', 'expand'],
    'expand: a reveal grows out of the side it comes in from (its mark, else the formula), an open from its center',
  );
  for (const style of ['top', 'bottom', 'fade'] as const) {
    assert.equal(enterDirectionOf(style, false, 'left', true, formula('left')), style, `${style} beats a mark and the formula`);
    assert.equal(enterDirectionOf('auto', false, 'left', true, formula('left'), style), style, `a workspace ${style} beats a mark too`);
    assert.equal(enterDirectionOf('right', false, undefined, false, formula('left'), style), 'right', `the panel's own right wins over a workspace ${style}`);
    assert.equal(enterDirectionOf('auto', true, undefined, false, formula('left'), style), 'left', `the 0.1.0 anchoredEnter flag is the panel's own anchor and wins over a workspace ${style}`);
  }
  assert.equal(enterDirectionOf('auto', false, undefined, false, formula('left'), 'anchor'), 'left', 'a workspace anchor takes the formula');
  assert.equal(enterDirectionOf('auto', false, undefined, false, formula('left'), 'auto'), 'right', "both auto: today's right");
  assert.equal(enterDirectionOf('auto', false, 'left', false, formula('right')), 'left', "both auto: today's mark");
});

test("exitStyleOf: the panel wins unless auto, the workspace default applies at auto, and both auto keep today's park and close", () => {
  for (const style of ['left', 'right', 'top', 'bottom', 'fade'] as const) {
    assert.equal(exitStyleOf(style, 'auto', true, false), style, `an explicit ${style} governs a close`);
    assert.equal(exitStyleOf(style, 'auto', false, true), style, `and a park`);
    assert.equal(exitStyleOf('auto', style, false, false), style, `a workspace ${style} applies to a panel at auto`);
  }
  assert.deepEqual(
    [exitStyleOf('shrink', 'auto', true, true), exitStyleOf('shrink', 'auto', false, true), exitStyleOf('shrink', 'auto', false, false), exitStyleOf('auto', 'shrink', false, true)],
    ['shrink', 'shrink-right', 'shrink-left', 'shrink-right'],
    'shrink: a close shrinks into its center, a park toward the side it leaves by, from the panel or the workspace',
  );
  assert.equal(exitStyleOf('fade', 'shrink', false, false), 'fade', "the panel's own value wins over the workspace's");
  assert.equal(exitStyleOf('auto', 'auto', true, true), 'down', 'both auto: a close drops down');
  assert.equal(exitStyleOf('auto', 'auto', false, true), 'right', 'both auto: a park leaves by its mark');
  assert.equal(exitStyleOf('auto', 'auto', false, false), 'left', 'both auto: else the left');
});

test('entrances: top and bottom start one row height off at the rest, fade starts faded at the rest, expand at scale 0 where its neighbors part', () => {
  const top = enterStart({ enterFrom: 'top' });
  const bottom = enterStart({ enterFrom: 'bottom' });
  assert.equal(top.x, REST);
  assert.ok(top.y < 0 && top.opacity === '0', `top starts above (y ${top.y})`);
  assert.equal(bottom.x, REST);
  assert.equal(bottom.y, -top.y, 'bottom starts as far below');
  const fade = enterStart({ enterFrom: 'fade' });
  assert.deepEqual([fade.x, fade.y, fade.opacity], [REST, 0, '0'], 'fade starts faded at its rest');
  assert.equal(fade.width, WIDTH, 'a fade keeps its width');
  assert.deepEqual(panelRowSlotMotion(REST, WIDTH, 700, 'expand', 'left').initial, { x: REST - SPAN / 2, scale: 0, opacity: 0 }, 'expand starts on the point its neighbors part from');
  assert.deepEqual(panelRowSlotMotion(REST, WIDTH, 700, 'expand', 'left').animate, { x: REST, scale: 1, opacity: 1 });
  for (const side of ['expand-left', 'expand-right'] as const) {
    assert.deepEqual([panelRowSlotMotion(REST, WIDTH, 700, side, 'left').initial, panelRowSlotMotion(REST, WIDTH, 700, side, 'left').animate], [{ x: REST, scale: 0, opacity: 0 }, { x: REST, scale: 1, opacity: 1 }], `${side} grows at its rest, out of an edge`);
  }
  assert.deepEqual(panelRowSlotMotion(REST, WIDTH, 700, 'top', 'left').animate, { x: REST, y: 0, opacity: 1 }, 'a vertical entrance comes to rest at y 0');
  assert.equal(panelRowSlotMotion(REST, WIDTH, 700, 'expand', 'shrink').transition, PANEL_TRANSITION, 'every style takes the shared slide transition');
});

test('exits: top and bottom slide out one row height from the rest, fade fades at the rest and shrink scales to 0 on the slide timing, and auto keeps the close timing', () => {
  const at = (exit: 'top' | 'bottom' | 'fade' | 'shrink' | 'down') => panelRowSlotMotion(REST, WIDTH, 700, 'right', exit).exit;
  const at2 = (exit: 'shrink-left' | 'shrink-right') => panelRowSlotMotion(REST, WIDTH, 700, 'right', exit).exit;
  assert.deepEqual(at('top'), { x: REST, y: -700, opacity: 0 });
  assert.deepEqual(at('bottom'), { x: REST, y: 700, opacity: 0 });
  assert.deepEqual(at('fade'), { x: REST, opacity: 0 });
  assert.deepEqual(at('shrink'), { x: REST - SPAN / 2, scale: 0, opacity: 0 }, 'a close shrink keeps its center where the neighbors meet');
  assert.deepEqual([at2('shrink-left'), at2('shrink-right')], [{ x: REST, scale: 0, opacity: 0 }, { x: REST, scale: 0, opacity: 0 }], 'a park shrink stays at its rest, scaling into an edge');
  assert.deepEqual((at('down') as { transition?: unknown }).transition, { duration: 0.18, ease: 'easeIn' }, 'the auto close keeps its own timing');
});

test('expand: a reveal from the left grows out of its left edge at its rest, and one from the right out of its right edge, tucked under its neighbor while it grows', async () => {
  for (const [side, origin] of [['left', /^0% 50%/], ['right', /^100% 50%/]] as const) {
    const base = [rootEntry(), made('a')];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, workspace));
    mounted.rerender(row([...base, made('b', { enterFrom: 'expand' })], workspace, false, new Map([['b', side]])));
    await advanceFrames(250);
    const b = slotOf(mounted.container, 'b')!;
    assert.ok(scaleOf(b) > 0 && scaleOf(b) < 1, `mid-expand (scale ${scaleOf(b)})`);
    assert.match(b.style.transformOrigin, origin, `from the ${side} it grows about that edge (${b.style.transformOrigin})`);
    assert.equal(axis(b, 'X'), REST, 'at its rest');
    const a = slotOf(mounted.container, 'a')!;
    assert.ok(Number(b.style.zIndex) < Number(a.style.zIndex), `under its neighbor while it grows from the ${side} (${b.style.zIndex} under ${a.style.zIndex})`);
    assert.equal(b.style.zIndex, '0', 'one under its rank at the edge of the base tier');
    await advanceFrames(600);
    assert.equal(b.style.zIndex, '1', 'and at its rank once grown');
    mounted.unmount();
  }
});

test('expand: a new open growing from its center is drawn beneath the neighbor sliding out of its slot, and back in line once grown', async () => {
  const base = [rootEntry(), made('a')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, workspace));
  mounted.rerender(row([...base, made('b', { enterFrom: 'expand' })], workspace));
  await advanceFrames(250);
  const b = slotOf(mounted.container, 'b')!;
  const a = slotOf(mounted.container, 'a')!;
  assert.ok(scaleOf(b) > 0 && scaleOf(b) < 1, `mid-expand (scale ${scaleOf(b)})`);
  assert.ok(Number(b.style.zIndex) < Number(a.style.zIndex), `beneath its neighbor while it grows (${b.style.zIndex} under ${a.style.zIndex})`);
  await advanceFrames(600);
  assert.equal(b.style.zIndex, '1', 'and at its rank once grown');
  mounted.unmount();
});

test('expand: the slot scales up from 0 about its center, at its full width, on the slide duration and easing', async () => {
  const { slot, mounted } = entering({ enterFrom: 'expand' });
  assert.equal(widthOf(slot), WIDTH, 'its box is at its full width from the start');
  assert.equal(slot.style.overflowX, '', 'and is never clipped');
  assert.deepEqual(PANEL_TRANSITION, { duration: 0.6, ease: [0.4, 0, 0.2, 1] });
  await advanceFrames(250);
  const mid = scaleOf(slot);
  assert.ok(mid > 0 && mid < 1, `mid-expand the scale is between (${mid})`);
  await advanceFrames(600);
  assert.equal(scaleOf(slot), 1, 'it lands at full size');
  assert.equal(axis(slot, 'X'), REST, 'at its rest');
  mounted.unmount();
  const tuned = entering({ enterFrom: 'expand' }, { slide: { durationSec: 0.3, ease: [0.2, 0, 0, 1] } });
  await advanceFrames(350);
  assert.equal(scaleOf(tuned.slot), 1, "the workspace's slide tuning sets the clock: a 0.3 s expand has landed");
  tuned.mounted.unmount();
});

test('expand: the neighbors to its right slide apart on the same clock, and the growing slot keeps its center where they part', async () => {
  const base = [rootEntry(), made('a'), made('c')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, workspace));
  assert.equal(axis(slotOf(mounted.container, 'c')!, 'X'), REST, 'control: c rests at index 2');
  mounted.rerender(row([rootEntry(), made('a'), made('b', { enterFrom: 'expand' }), made('c')], workspace));
  const b = slotOf(mounted.container, 'b')!;
  const c = slotOf(mounted.container, 'c')!;
  assert.equal(axis(c, 'X'), REST, 'c has not jumped to its new rest');
  const seen = new Set<number>();
  for (let frame = 0; frame < 45; frame += 1) {
    await advanceFrames(16);
    const cx = axis(c, 'X');
    seen.add(Math.round(cx));
    const center = axis(b, 'X') + WIDTH / 2;
    const half = (scaleOf(b) * WIDTH) / 2;
    assert.ok(Math.abs(center - (REST - GAP + cx) / 2) < 1, `frame ${frame}: b's center (${center}) is midway between a and c`);
    assert.ok(center + half <= cx + 0.5, `frame ${frame}: c (${cx}) never covers b's right edge (${center + half})`);
  }
  assert.ok(seen.size > 10, `c moved through ${seen.size} positions, a slide and not a jump`);
  assert.equal(axis(c, 'X'), REST + SPAN, 'c lands one span further on');
  mounted.unmount();
});

test('expand: the growing slot starts in the same commit as the neighbors parting for it, so the two never run a frame apart', () => {
  const started: HTMLElement[] = [];
  const original = slotDriver.glide;
  slotDriver.glide = (el, ...rest) => {
    started.push(el);
    original(el, ...rest);
  };
  try {
    const base = [rootEntry(), made('a'), made('c')];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, workspace));
    started.length = 0;
    mounted.rerender(row([rootEntry(), made('a'), made('b', { enterFrom: 'expand' }), made('c')], workspace));
    const b = slotOf(mounted.container, 'b')!;
    const c = slotOf(mounted.container, 'c')!;
    assert.ok(started.includes(c), 'control: c starts its slide in the commit');
    assert.ok(started.includes(b), 'b starts its expand in the same commit, on the same clock');
    mounted.unmount();
  } finally {
    slotDriver.glide = original;
  }
});

test('shrink: a slot parked to the left scales to 0 about its left edge, which stays put, drawn over the neighbor closing up, and keeps its width', async () => {
  const base = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' }), made('c')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, workspace));
  mounted.rerender(row([rootEntry(), made('a'), made('c')], workspace));
  await advanceFrames(250);
  const b = slotOf(mounted.container, 'b')!;
  const c = slotOf(mounted.container, 'c')!;
  assert.ok(scaleOf(b) > 0 && scaleOf(b) < 1, `mid-shrink (scale ${scaleOf(b)})`);
  assert.equal(widthOf(b), WIDTH, 'its box keeps its full width');
  assert.equal(b.style.overflowX, '', 'and is never clipped');
  assert.match(b.style.transformOrigin, /^0% 50%/, `it scales about its left edge (${b.style.transformOrigin})`);
  assert.ok(axis(c, 'X') > REST && axis(c, 'X') < REST + SPAN, 'c is closing up');
  assert.equal(axis(b, 'X'), REST, 'b stays at its rest, so its left edge stays where it was');
  assert.ok(Number(b.style.zIndex) > Number(c.style.zIndex), `b is drawn over c (${b.style.zIndex} over ${c.style.zIndex})`);
  mounted.unmount();
});

test('shrink: the leaving slot and the neighbors closing up over it start at one startTime, however long the commit runs', async () => {
  // jsdom has no Web Animations API: a stand-in records each animation's element and the startTime the row gives it.
  const started: { el: Element; startTime: number | null }[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const had = Object.hasOwn(proto, 'animate');
  const original = proto.animate;
  proto.animate = function (this: Element) {
    const record = { el: this, startTime: null as number | null };
    started.push(record);
    return {
      timeline: document.timeline,
      cancel() {},
      set startTime(value: number | null) {
        record.startTime = value;
      },
      get startTime() {
        return record.startTime;
      },
    };
  };
  try {
    const c0 = made('c', {}, { view: 'slow-view' });
    const base = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' }), c0];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, workspace));
    started.length = 0;
    // The commit that removes b runs long between b's exit starting and c's slide starting.
    slowCommits.on = true;
    try {
      mounted.rerender(row([rootEntry(), made('a'), c0], workspace));
    } finally {
      slowCommits.on = false;
    }
    const b = slotOf(mounted.container, 'b')!;
    const c = slotOf(mounted.container, 'c')!;
    const of = (el: Element): number | null | undefined => started.find((s) => s.el === el)?.startTime;
    assert.ok(typeof of(c) === 'number', 'control: c slides on an animation with a startTime');
    assert.equal(of(b), of(c), 'b shrinks on the same startTime');
    assert.ok(started.every((s) => s.startTime === of(c)), `every animation the commit started shares it (${started.length})`);
    mounted.unmount();
  } finally {
    if (had) proto.animate = original;
    else delete proto.animate;
  }
});

test('reduced motion: an expand lands at full size at once and a shrink at scale 0, as a slide lands at once', async () => {
  const { slot, mounted } = entering({ enterFrom: 'expand' }, {}, true);
  await advanceFrames(32);
  assert.equal(scaleOf(slot), 1);
  assert.equal(axis(slot, 'X'), REST);
  mounted.unmount();
  const base = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' })];
  const workspace = settledWorkspace(base);
  const leaving = mount(row(base, workspace, true));
  leaving.rerender(row([rootEntry(), made('a')], workspace, true));
  await advanceFrames(32);
  const gone = slotOf(leaving.container, 'b');
  if (gone !== null) assert.equal(scaleOf(gone), 0, 'a shrink under reduced motion is at scale 0 at once');
  leaving.unmount();
  const slide = entering({ enterFrom: 'left' }, {}, true);
  await advanceFrames(32);
  assert.equal(axis(slide.slot, 'X'), REST, 'control: a slide under the same setting has landed');
  slide.mounted.unmount();
});

test('interrupted: a park mid-expand leaves from where it is, a re-priced row sets the width at once, and a return mid-shrink scales back up', async () => {
  const base = [rootEntry(), made('a')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, workspace));
  const b = made('b', { enterFrom: 'expand' });
  mounted.rerender(row([...base, b], workspace));
  await advanceFrames(200);
  const slot = slotOf(mounted.container, 'b')!;
  const grown = scaleOf(slot);
  assert.ok(grown > 0 && grown < 1, `mid-expand (scale ${grown})`);
  mounted.rerender(row([...base, { ...b, slots: 2 }], workspace));
  assert.equal(widthOf(slot), 2 * WIDTH + GAP, 'a re-priced width is the slot box at once; the scale carries on');
  await advanceFrames(100);
  const before = scaleOf(slot);
  assert.ok(before > grown, `still growing (scale ${before})`);
  mounted.rerender(row(base, workspace));
  await advanceFrames(100);
  assert.ok(Number(slot.style.opacity) < 1 && axis(slot, 'X') < REST, `a park mid-expand leaves from where it is (x ${axis(slot, 'X')}, opacity ${slot.style.opacity})`);
  mounted.unmount();

  const shrinking = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' })];
  const back = settledWorkspace(shrinking);
  const again = mount(row(shrinking, back));
  again.rerender(row(shrinking.slice(0, 2), back));
  await advanceFrames(200);
  const leavingSlot = slotOf(again.container, 'b')!;
  const small = scaleOf(leavingSlot);
  assert.ok(small > 0 && small < 1, `mid-shrink (scale ${small})`);
  again.rerender(row(shrinking, back));
  await advanceFrames(100);
  assert.ok(scaleOf(leavingSlot) > small && scaleOf(leavingSlot) < 1, `a return mid-shrink grows back from where it is (scale ${scaleOf(leavingSlot)})`);
  await advanceFrames(800);
  assert.equal(scaleOf(leavingSlot), 1);
  assert.equal(leavingSlot.style.width, `${WIDTH}px`);
  again.unmount();
});

test("a workspace that sets neither default expands its panels in and shrinks them out; 'auto' still slides and drops", () => {
  const tuning = createWorkspace({ mount: false }).tuning;
  assert.deepEqual([tuning.defaultEnterFrom, tuning.defaultExitTo], ['expand', 'shrink']);
  assert.deepEqual([enterDirectionOf('auto', false, undefined, false, () => 'right', tuning.defaultEnterFrom), exitStyleOf('auto', tuning.defaultExitTo, true, false)], ['expand', 'shrink']);
  assert.deepEqual([enterDirectionOf('auto', false, undefined, false, () => 'right', 'auto'), exitStyleOf('auto', 'auto', true, false)], ['right', 'down'], "control: the workspace's 'auto' keeps the sideways entrance and the downward close");
});

test('an entrance in progress keeps its style when the setting changes under it', async () => {
  const base = [rootEntry(), made('a')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, workspace));
  mounted.rerender(row([...base, made('b', { enterFrom: 'top' })], workspace));
  await advanceFrames(150);
  const slot = slotOf(mounted.container, 'b')!;
  const early = axis(slot, 'Y');
  assert.ok(early < 0, `control: on its way down from the top (y ${early})`);
  mounted.rerender(row([...base, made('b', { enterFrom: 'right' })], workspace));
  await advanceFrames(150);
  assert.ok(axis(slot, 'Y') > early, `it carries on downward (y ${axis(slot, 'Y')})`);
  assert.equal(axis(slot, 'X'), REST, 'and never slides in from the right');
  await advanceFrames(600);
  assert.deepEqual([axis(slot, 'X'), axis(slot, 'Y')], [REST, 0]);
  mounted.unmount();
});

/** B's scale part way through leaving [root, A, B] with `b`'s settings under the workspace's `tuning`. */
async function exitScale(b: PanelSettings, tuning: WorkspaceTuning = {}): Promise<number> {
  const base = [rootEntry(), made('a'), made('b', b)];
  const workspace = settledWorkspace(base, tuning);
  const mounted = mount(row(base, workspace));
  mounted.rerender(row([rootEntry(), made('a')], workspace));
  await advanceFrames(250);
  const slot = slotOf(mounted.container, 'b');
  const scale = slot === null ? Number.NaN : Math.round(scaleOf(slot) * 10) / 10;
  mounted.unmount();
  return scale;
}

test('differential exitTo: the resolved setting decides whether a leaving slot shrinks', async () => {
  const scales = { left: await exitScale({ exitTo: 'left' }), shrink: await exitScale({ exitTo: 'shrink' }) };
  differential('exitTo', (run) => {
    for (const value of ['left', 'shrink'] as const) run(value, () => scales[value]);
  });
});

test("differential tuning.defaultEnterFrom: the workspace's default decides how a panel at auto enters", () => {
  differential('tuning.defaultEnterFrom', (run) => {
    for (const value of ['auto', 'top'] as const) run(value, () => enterStart({}, { defaultEnterFrom: value }));
  });
});

test("differential tuning.defaultExitTo: the workspace's default decides how a panel at auto leaves", async () => {
  const scales = { auto: await exitScale({}, { defaultExitTo: 'auto' }), shrink: await exitScale({}, { defaultExitTo: 'shrink' }) };
  differential('tuning.defaultExitTo', (run) => {
    for (const value of ['auto', 'shrink'] as const) run(value, () => scales[value]);
  });
});

test('every name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
