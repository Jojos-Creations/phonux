/**
 * Every entrance and exit style a panel may take: the cascade from the panel's own `enterFrom` and `exitTo` to the
 * workspace's `tuning.defaultEnterFrom` and `tuning.defaultExitTo`, the slot values each style starts from and leaves to,
 * and the width an `expand` grows and a `shrink` collapses, read from the slot's own style through a mounted PanelRow.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { PANEL_TRANSITION } from '../index.js';
import type { PanelSettings, PanelWindow, WorkspaceHandle, WorkspaceTuning } from '../index.js';
import { enterDirectionOf, exitStyleOf } from '../PanelRow.js';
import { GAP, panelRowSlotMotion, slotDriver } from '../PanelRowSlot.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { bindingOf, type EngineOps } from '../workspaceCore.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, seededWorkspace, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const OWNED = ['exitTo', 'tuning.defaultEnterFrom', 'tuning.defaultExitTo'];
const WIDTH = 390;
const SPAN = WIDTH + GAP;
const NONE: ReadonlySet<string> = new Set();

registerTestView('style-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const resolve = (layer: PanelSettings = {}) => resolvePanelSettings({ template: layer }).value;
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'style-view' }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolve({ overflow: 'park', ...layer }), 'create');
}
const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createHistoryPanel(ROOT), view: 'style-view' }, resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');

/** A row holds its slots' moves until its workspace's restore has settled, so every case here mounts over one that has. */
function settledWorkspace(entries: readonly PanelWindow[], tuning: WorkspaceTuning = {}): WorkspaceHandle {
  const workspace = seededWorkspace(entries, { rootId: ROOT, tuning });
  bindingOf(workspace).attach({});
  bindingOf(workspace).publish({ entries, held: new Set(), settled: true, create: () => {}, lateRegister: () => {}, ops: {} as EngineOps });
  assert.equal(workspace.panels.getSnapshot().status, 'ready', 'the workspace did not settle, so every slot would start at its rest');
  return workspace;
}
const row = (entries: PanelWindow[], workspace: WorkspaceHandle, reduced = false): React.ReactElement => {
  const ui = React.createElement(StaticRow, { workspace, entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, exitRightIds: NONE, enterSideById: new Map() });
  return withHost(reduced ? React.createElement(MotionConfig, { reducedMotion: 'always' }, ui) : ui);
};
const slotOf = (container: HTMLElement, id: string): HTMLElement | null => container.querySelector(`[data-slot="${id}"]`)?.parentElement ?? null;
const axis = (slot: HTMLElement, name: 'X' | 'Y'): number => {
  const match = new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};
const widthOf = (slot: HTMLElement): number => Number.parseFloat(slot.style.width);

/** Records every width animation a slot starts, and still runs it. */
function recordResizes(): { calls: { from: number; to: number; transition: unknown }[]; restore: () => void } {
  const calls: { from: number; to: number; transition: unknown }[] = [];
  const original = slotDriver.resize;
  slotDriver.resize = (from, to, transition, draw, done) => {
    calls.push({ from, to, transition });
    return original(from, to, transition, draw, done);
  };
  return { calls, restore: () => void (slotDriver.resize = original) };
}

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
  for (const style of ['top', 'bottom', 'fade', 'expand'] as const) {
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
  for (const style of ['left', 'right', 'top', 'bottom', 'fade', 'shrink'] as const) {
    assert.equal(exitStyleOf(style, 'auto', true, false), style, `an explicit ${style} governs a close`);
    assert.equal(exitStyleOf(style, 'auto', false, true), style, `and a park`);
    assert.equal(exitStyleOf('auto', style, false, false), style, `a workspace ${style} applies to a panel at auto`);
  }
  assert.equal(exitStyleOf('fade', 'shrink', false, false), 'fade', "the panel's own value wins over the workspace's");
  assert.equal(exitStyleOf('auto', 'auto', true, true), 'down', 'both auto: a close drops down');
  assert.equal(exitStyleOf('auto', 'auto', false, true), 'right', 'both auto: a park leaves by its mark');
  assert.equal(exitStyleOf('auto', 'auto', false, false), 'left', 'both auto: else the left');
});

test('entrances: top and bottom start one row height off at the rest, fade and expand start faded at the rest', () => {
  const top = enterStart({ enterFrom: 'top' });
  const bottom = enterStart({ enterFrom: 'bottom' });
  assert.equal(top.x, REST);
  assert.ok(top.y < 0 && top.opacity === '0', `top starts above (y ${top.y})`);
  assert.equal(bottom.x, REST);
  assert.equal(bottom.y, -top.y, 'bottom starts as far below');
  for (const style of ['fade', 'expand'] as const) {
    const start = enterStart({ enterFrom: style });
    assert.deepEqual([start.x, start.y, start.opacity], [REST, 0, '0'], `${style} starts faded at its rest`);
  }
  assert.equal(enterStart({ enterFrom: 'fade' }).width, WIDTH, 'a fade keeps its width');
  assert.deepEqual(panelRowSlotMotion(REST, WIDTH, 700, 'top', 'left').animate, { x: REST, y: 0, opacity: 1 }, 'a vertical entrance comes to rest at y 0');
  assert.equal(panelRowSlotMotion(REST, WIDTH, 700, 'expand', 'shrink').transition, PANEL_TRANSITION, 'every style takes the shared slide transition');
});

test('exits: top and bottom slide out one row height from the rest, fade and shrink fade at the rest on the slide timing, and auto keeps the close timing', () => {
  const at = (exit: 'top' | 'bottom' | 'fade' | 'shrink' | 'down') => panelRowSlotMotion(REST, WIDTH, 700, 'right', exit).exit;
  assert.deepEqual(at('top'), { x: REST, y: -700, opacity: 0 });
  assert.deepEqual(at('bottom'), { x: REST, y: 700, opacity: 0 });
  assert.deepEqual(at('fade'), { x: REST, opacity: 0 });
  assert.deepEqual(at('shrink'), { x: REST, opacity: 0 });
  assert.deepEqual((at('down') as { transition?: unknown }).transition, { duration: 0.18, ease: 'easeIn' }, 'the auto close keeps its own timing');
});

test('expand: the width starts at 0, clipped, and eases to the full width at its rest on the slide duration and easing', async () => {
  const rec = recordResizes();
  try {
    const { slot, mounted } = entering({ enterFrom: 'expand' });
    assert.equal(slot.style.width, '0px', 'drawn at 0 before the first paint');
    assert.equal(slot.style.overflow, 'hidden', 'the content is clipped, never squashed');
    assert.equal(axis(slot, 'X'), REST, 'at its rest from the start');
    assert.deepEqual(rec.calls.map((c) => [c.from, c.to]), [[0, WIDTH]]);
    assert.equal(rec.calls[0]!.transition, PANEL_TRANSITION, 'the default slide: 0.6 s, in-out');
    assert.deepEqual(PANEL_TRANSITION, { duration: 0.6, ease: [0.4, 0, 0.2, 1] });
    await advanceFrames(250);
    const mid = widthOf(slot);
    assert.ok(mid > 0 && mid < WIDTH, `mid-expand the width is between (${mid})`);
    await advanceFrames(600);
    assert.equal(slot.style.width, `${WIDTH}px`, 'it lands at the full width');
    assert.equal(slot.style.overflow, '', 'and the clip is gone');
    mounted.unmount();
    const tuned = entering({ enterFrom: 'expand' }, { slide: { durationSec: 0.3, ease: [0.2, 0, 0, 1] } });
    assert.deepEqual(rec.calls[1]!.transition, { duration: 0.3, ease: [0.2, 0, 0, 1] }, "the workspace's slide tuning, not a second copy");
    tuned.mounted.unmount();
  } finally {
    rec.restore();
  }
});

test('expand: the neighbours to its right slide apart on the same clock, never jumping and never covering the growing slot', async () => {
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
    assert.ok(cx >= REST + widthOf(b) - 0.5, `frame ${frame}: c (${cx}) never covers b's right edge (${REST + widthOf(b)})`);
  }
  assert.ok(seen.size > 10, `c moved through ${seen.size} positions, a slide and not a jump`);
  assert.equal(axis(c, 'X'), REST + SPAN, 'c lands one span further on');
  mounted.unmount();
});

test('shrink: a leaving slot eases its width from full to 0 at its rest while the neighbours close up', async () => {
  const rec = recordResizes();
  try {
    const base = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' }), made('c')];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, workspace));
    mounted.rerender(row([rootEntry(), made('a'), made('c')], workspace));
    assert.deepEqual(rec.calls.map((c) => [c.from, c.to]), [[WIDTH, 0]]);
    assert.equal(rec.calls[0]!.transition, PANEL_TRANSITION);
    await advanceFrames(250);
    const b = slotOf(mounted.container, 'b')!;
    const c = slotOf(mounted.container, 'c')!;
    assert.ok(widthOf(b) > 0 && widthOf(b) < WIDTH, `mid-shrink (${widthOf(b)})`);
    assert.equal(axis(b, 'X'), REST, 'it shrinks at its rest');
    assert.ok(axis(c, 'X') > REST && axis(c, 'X') < REST + SPAN, 'c is closing up');
    assert.ok(axis(c, 'X') >= REST + widthOf(b) - 0.5, 'and never covers it');
    mounted.unmount();
  } finally {
    rec.restore();
  }
});

test('reduced motion: an expand lands at its full width at once and a shrink at 0, as a slide lands at once', async () => {
  const rec = recordResizes();
  try {
    const { slot, mounted } = entering({ enterFrom: 'expand' }, {}, true);
    assert.equal(slot.style.width, `${WIDTH}px`);
    assert.equal(slot.style.overflow, '');
    assert.deepEqual(rec.calls, [], 'no width animation starts');
    mounted.unmount();
    const base = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' })];
    const workspace = settledWorkspace(base);
    const leaving = mount(row(base, workspace, true));
    leaving.rerender(row([rootEntry(), made('a')], workspace, true));
    const gone = slotOf(leaving.container, 'b');
    if (gone !== null) assert.equal(gone.style.width, '0px', 'a shrink under reduced motion is at 0 at once');
    assert.deepEqual(rec.calls, []);
    leaving.unmount();
    const slide = entering({ enterFrom: 'left' }, {}, true);
    await advanceFrames(32);
    assert.equal(axis(slide.slot, 'X'), REST, 'control: a slide under the same setting has landed');
    slide.mounted.unmount();
  } finally {
    rec.restore();
  }
});

test('interrupted: a park mid-expand holds its drawn width, a re-priced row eases on from the width on screen, and a return mid-shrink grows back', async () => {
  const rec = recordResizes();
  try {
    const base = [rootEntry(), made('a')];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, workspace));
    const b = made('b', { enterFrom: 'expand' });
    mounted.rerender(row([...base, b], workspace));
    await advanceFrames(200);
    const slot = slotOf(mounted.container, 'b')!;
    const drawn = widthOf(slot);
    assert.ok(drawn > 0 && drawn < WIDTH, `mid-expand (${drawn})`);
    mounted.rerender(row([...base, { ...b, slots: 2 }], workspace));
    assert.deepEqual(rec.calls.map((c) => [c.from, c.to]).at(-1), [drawn, 2 * WIDTH + GAP], 'a re-priced width eases on from the width on screen');
    await advanceFrames(100);
    const before = widthOf(slot);
    mounted.rerender(row(base, workspace));
    await advanceFrames(100);
    assert.equal(widthOf(slot), before, 'a park mid-expand holds the width it was drawn at');
    assert.equal(rec.calls.length, 2, 'and starts no width animation');
    mounted.unmount();

    const shrinking = [rootEntry(), made('a'), made('b', { exitTo: 'shrink' })];
    const back = settledWorkspace(shrinking);
    const again = mount(row(shrinking, back));
    again.rerender(row(shrinking.slice(0, 2), back));
    await advanceFrames(200);
    const leavingSlot = slotOf(again.container, 'b')!;
    const narrow = widthOf(leavingSlot);
    assert.ok(narrow > 0 && narrow < WIDTH, `mid-shrink (${narrow})`);
    again.rerender(row(shrinking, back));
    assert.deepEqual(rec.calls.map((c) => [c.from, c.to]).at(-1), [narrow, WIDTH], 'a return mid-shrink grows back from where it is');
    await advanceFrames(800);
    assert.equal(leavingSlot.style.width, `${WIDTH}px`);
    again.unmount();
  } finally {
    rec.restore();
  }
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

/** The width animations a slot starts as B leaves [root, A, B] with `b`'s settings under the workspace's `tuning`, read in the commit. */
function exitResizes(b: PanelSettings, tuning: WorkspaceTuning = {}): number[][] {
  const rec = recordResizes();
  try {
    const base = [rootEntry(), made('a'), made('b', b)];
    const workspace = settledWorkspace(base, tuning);
    const mounted = mount(row(base, workspace));
    mounted.rerender(row([rootEntry(), made('a')], workspace));
    mounted.unmount();
    return rec.calls.map((c) => [c.from, c.to]);
  } finally {
    rec.restore();
  }
}

test('differential exitTo: the resolved setting decides whether a leaving slot shrinks', () => {
  differential('exitTo', (run) => {
    for (const value of ['left', 'shrink'] as const) run(value, () => exitResizes({ exitTo: value }));
  });
});

test("differential tuning.defaultEnterFrom: the workspace's default decides how a panel at auto enters", () => {
  differential('tuning.defaultEnterFrom', (run) => {
    for (const value of ['auto', 'top'] as const) run(value, () => enterStart({}, { defaultEnterFrom: value }));
  });
});

test("differential tuning.defaultExitTo: the workspace's default decides how a panel at auto leaves", () => {
  differential('tuning.defaultExitTo', (run) => {
    for (const value of ['auto', 'shrink'] as const) run(value, () => exitResizes({}, { defaultExitTo: value }));
  });
});

test('every name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
