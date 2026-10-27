/**
 * The engine's reading of the motion settings it owns: layer, enterFrom and resize. One
 * differential per name through a mounted PanelRow, then literal rows for each precedence the catalog states. Entries
 * are built the way a creation path builds them: appendPanel's skeleton, then applyTemplate over a resolved layer.
 * Slot positions are read from the transform each slot carries right after a render, before any frame has run.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import type { PanelSettings, PanelWindow } from '../index.js';
import { enterDirectionOf } from '../PanelRow.js';
import { GAP, panelRowSlotMotion } from '../PanelRowSlot.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import type { WorkspaceHandle } from '../index.js';
import { bindingOf, type EngineOps } from '../workspaceCore.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, seededWorkspace, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const OWNED = ['layer', 'enterFrom', 'resize'];
const SPAN = 390 + GAP;

registerTestView('motion-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const resolve = (layer: PanelSettings = {}) => resolvePanelSettings({ template: layer }).value;
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'motion-view' }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolve({ overflow: 'park', ...layer }), 'create');
}
const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'motion-view' }, resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');

interface Props {
  closing?: ReadonlySet<string>;
  entering?: ReadonlySet<string>;
  exitRight?: ReadonlySet<string>;
  sides?: ReadonlyMap<string, 'left' | 'right'>;
}
const NONE: ReadonlySet<string> = new Set();
/**
 * A row holds its slots' moves until its workspace's restore has settled, so a slot that enters a row whose workspace never
 * settled starts at its rest. The enter and exit cases mount over a workspace that has.
 */
function settledWorkspace(entries: readonly PanelWindow[]): WorkspaceHandle {
  const workspace = seededWorkspace(entries, { rootId: ROOT });
  const binding = bindingOf(workspace);
  binding.attach({});
  binding.publish({ entries, held: new Set(), settled: true, create: () => {}, lateRegister: () => {}, ops: {} as EngineOps });
  assert.equal(workspace.panels.getSnapshot().status, 'ready', 'the workspace did not settle, so every slot would start at its rest');
  return workspace;
}
const row = (entries: PanelWindow[], p: Props = {}, workspace?: WorkspaceHandle): React.ReactElement =>
  withHost(
    React.createElement(StaticRow, {
      ...(workspace !== undefined ? { workspace } : {}),
      entries,
      rootId: ROOT,
      closingIds: p.closing ?? NONE,
      enteringViaAnchorIds: p.entering ?? NONE,
      exitRightIds: p.exitRight ?? NONE,
      enterSideById: p.sides ?? new Map(),
    }),
  );
const slotOf = (container: HTMLElement, id: string): HTMLElement | null => container.querySelector(`[data-slot="${id}"]`)?.closest<HTMLElement>('[data-row-slot]') ?? null;
const axis = (slot: HTMLElement, name: 'X' | 'Y'): number => {
  const match = new RegExp(`translate${name}\\((-?[\\d.]+)px\\)`).exec(slot.style.transform);
  return match === null ? 0 : Number(match[1]);
};
const xOf = (container: HTMLElement, id: string): number => axis(slotOf(container, id)!, 'X');

afterEach(() => cleanup());

/** B enters at index 1 of [root, A, B] with `b`'s settings and the given marks; returns its x right after the render. */
function enterX(b: PanelSettings, p: Props = {}, over: Partial<PanelWindow> = {}): number {
  const base = [rootEntry(), made('a')];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, {}, workspace));
  mounted.rerender(row([...base, made('b', b, over)], p, workspace));
  const x = xOf(mounted.container, 'b');
  mounted.unmount();
  return x;
}
// B rests at 2 * 406 = 812 in [root, A, B]; entering from the right starts one span beyond, from the left one span before.
const REST = 2 * SPAN;

test('enterFrom: left and right constants beat the engine mark and the anchor formula', () => {
  const rightMark = { sides: new Map([['b', 'right' as const]]) };
  const leftMark = { sides: new Map([['b', 'left' as const]]) };
  assert.equal(enterX({ enterFrom: 'left' }, rightMark), REST - SPAN, 'left beats a right mark');
  assert.equal(enterX({ enterFrom: 'right' }, leftMark), REST + SPAN, 'right beats a left mark');
  const viaAnchor = { entering: new Set(['b']) };
  const anchoredLeft = { anchor: { panel: ROOT, position: 'left' as const, priority: 0 } };
  assert.equal(enterX({ enterFrom: 'right' }, viaAnchor, anchoredLeft), REST + SPAN, 'right beats the anchor formula, which reads the root as left');
  assert.equal(enterX({ enterFrom: 'left' }, viaAnchor, { anchor: { panel: 'b', position: 'right', priority: 0 } }), REST - SPAN, 'left beats a formula that finds no anchor entry');
  assert.equal(enterX({ enterFrom: 'left' }), REST - SPAN, 'and with no mark at all');
});

test("enterFrom auto keeps today's precedence: a mark first, then the anchor formula for an entry entering via an anchor, then the right", () => {
  assert.equal(enterX({}), REST + SPAN, 'nothing: the right');
  assert.equal(enterX({}, { entering: new Set(['b']) }), REST - SPAN, 'entering via the root, which sits at index 0: the formula says left');
  assert.equal(enterX({}, { entering: new Set(['b']), sides: new Map([['b', 'right']]) }), REST + SPAN, 'a mark beats the formula');
  assert.equal(enterX({}, { sides: new Map([['b', 'left']]) }), REST - SPAN, 'a mark alone');
});

test('enterFrom anchor equals the legacy anchoredEnter true: the same slot start in a PanelRow mount, with and without a mark', () => {
  const legacy = (id: string): PanelWindow => ({
    id, url: `https://${id}.example`, title: id, live: true, view: 'motion-view', collapsible: true, listed: true,
    anchor: { panel: ROOT, position: 'right', priority: 5 }, anchoredEnter: true,
  });
  const mountLegacy = (p: Props): number => {
    const base = [rootEntry(), made('a')];
    const workspace = settledWorkspace(base);
    const mounted = mount(row(base, {}, workspace));
    mounted.rerender(row([...base, legacy('b')], p, workspace));
    const x = xOf(mounted.container, 'b');
    mounted.unmount();
    return x;
  };
  assert.equal(enterX({ enterFrom: 'anchor' }), mountLegacy({}));
  assert.equal(enterX({ enterFrom: 'anchor' }), REST - SPAN, 'both read the root at index 0 as left');
  assert.equal(enterX({ enterFrom: 'anchor' }, { sides: new Map([['b', 'right']]) }), mountLegacy({ sides: new Map([['b', 'right']]) }), 'a mark beats the formula for both');
  assert.equal(enterX({ enterFrom: 'anchor' }), enterX({}, { entering: new Set(['b']) }), 'and anchor is auto-entering-via-anchor made permanent');
});

test('enterDirectionOf is a pure function of the setting, the 0.1.0 flag, the mark, the entry route and the formula', () => {
  const formula = (side: 'left' | 'right') => () => side;
  assert.equal(enterDirectionOf('left', false, 'right', true, formula('right')), 'left');
  assert.equal(enterDirectionOf('right', true, 'left', true, formula('left')), 'right');
  assert.equal(enterDirectionOf('auto', false, undefined, false, formula('left')), 'right');
  assert.equal(enterDirectionOf('auto', true, undefined, false, formula('left')), 'left', 'the legacy flag alone');
  assert.equal(enterDirectionOf('auto', false, 'right', true, formula('left')), 'right');
  assert.equal(enterDirectionOf('anchor', false, undefined, false, formula('left')), 'left');
});

/** The slot's transform after `b` is removed from [root, a, b] with the given marks and a few frames of its exit. */
async function exitOf(b: PanelSettings, p: Props = {}): Promise<{ x: number; y: number; opacity: string }> {
  const base = [rootEntry(), made('a'), made('b', b)];
  const workspace = settledWorkspace(base);
  const mounted = mount(row(base, p, workspace));
  mounted.rerender(row([rootEntry(), made('a')], p, workspace));
  await advanceFrames(100);
  const slot = slotOf(mounted.container, 'b');
  assert.ok(slot, 'the slot is still mounted mid-exit');
  const out = { x: axis(slot, 'X'), y: axis(slot, 'Y'), opacity: slot.style.opacity };
  mounted.unmount();
  return out;
}

test('exit direction: auto follows exitRightIds, and closingIds exits down without sliding sideways', async () => {
  const right = new Set(['b']);
  assert.ok((await exitOf({}, {})).x < REST, 'no mark: left');
  assert.ok((await exitOf({}, { exitRight: right })).x > REST, 'an exit-right mark: right');
  const closing = await exitOf({}, { closing: right, exitRight: right });
  assert.ok(closing.y > 0, 'closingIds exits down whatever the exit-right mark says');
  assert.equal(closing.x, REST, 'and does not slide sideways');
});

test('layer: a raised slot has z-index 2 and a base slot 1, and a hand-built entry reads its own layer field', () => {
  const zOf = (b: PanelWindow): string => {
    const mounted = mount(row([rootEntry(), b]));
    const z = slotOf(mounted.container, b.id)!.style.zIndex;
    mounted.unmount();
    return z;
  };
  assert.equal(zOf(made('b', { layer: 'raised' })), '2');
  assert.equal(zOf(made('b', { layer: 'base' })), '1');
  assert.equal(zOf({ id: 'b', url: 'x', title: 'b', live: true, view: 'motion-view', collapsible: true, listed: true, layer: 'raised' }), '2');
  assert.equal(zOf({ id: 'b', url: 'x', title: 'b', live: true, view: 'motion-view', collapsible: true, listed: true }), '1');
});

test('a slot animates: three frames into its exit it is still sliding, and a new slot is still on its way after two frames', async () => {
  const base = [rootEntry(), made('a'), made('b')];
  const leavingWorkspace = settledWorkspace(base);
  const leaving = mount(row(base, {}, leavingWorkspace));
  leaving.rerender(row([rootEntry(), made('a')], {}, leavingWorkspace));
  await advanceFrames(48);
  assert.notEqual(slotOf(leaving.container, 'b'), null, 'the slot is still sliding out');
  leaving.unmount();
  const enteringWorkspace = settledWorkspace(base.slice(0, 2));
  const entering = mount(row(base.slice(0, 2), {}, enteringWorkspace));
  entering.rerender(row(base, {}, enteringWorkspace));
  await advanceFrames(32);
  assert.notEqual(xOf(entering.container, 'b'), REST);
  entering.unmount();
});

test('differential layer: the resolved layer decides the slot stacking', () => {
  differential('layer', (run) => {
    for (const value of ['base', 'raised'] as const) {
      run(value, () => {
        const mounted = mount(row([rootEntry(), made('b', { layer: value })]));
        const z = slotOf(mounted.container, 'b')!.style.zIndex;
        mounted.unmount();
        return z;
      });
    }
  });
});

test('differential enterFrom: the resolved setting decides which side a new slot starts from', () => {
  differential('enterFrom', (run) => {
    for (const value of ['left', 'right'] as const) run(value, () => enterX({ enterFrom: value }));
  });
});

test('differential resize: the resolved setting decides whether the row\'s size box reveals the content or reflows it', () => {
  differential('resize', (run) => {
    for (const value of ['reveal', 'reflow'] as const) {
      run(value, () => {
        const mounted = mount(row([rootEntry(), made('b', { resize: value })]));
        const revealed = slotOf(mounted.container, 'b')!.querySelector('[data-panel-size-reveal]') !== null;
        mounted.unmount();
        return revealed;
      });
    }
  });
});

test('panelRowSlotMotion: the default transition is the shared one by reference, and the close exit keeps its own timing', async () => {
  const { PANEL_TRANSITION } = await import('../index.js');
  const base = panelRowSlotMotion(0, 390, 700, 'right', 'left');
  assert.equal(base.transition, PANEL_TRANSITION, 'the default is the very object a host animates its own row with');
  const down = panelRowSlotMotion(406, 390, 700, 'right', 'down').exit as { transition?: { duration: number } };
  assert.equal(down.transition?.duration !== 0, true);
});

test('every motion name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
