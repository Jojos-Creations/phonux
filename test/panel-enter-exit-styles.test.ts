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

test("a workspace that sets neither default expands its panels in and shrinks them out; 'auto' still slides and drops", () => {
  const tuning = createWorkspace({ mount: false }).tuning;
  assert.deepEqual([tuning.defaultEnterFrom, tuning.defaultExitTo], ['expand', 'shrink']);
  assert.deepEqual([enterDirectionOf('auto', false, undefined, false, () => 'right', tuning.defaultEnterFrom), exitStyleOf('auto', tuning.defaultExitTo, true, false)], ['expand', 'shrink']);
  assert.deepEqual([enterDirectionOf('auto', false, undefined, false, () => 'right', 'auto'), exitStyleOf('auto', 'auto', true, false)], ['right', 'down'], "control: the workspace's 'auto' keeps the sideways entrance and the downward close");
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

