/**
 * The row's one stacking rule under a fast scroll: however many panels are in flight on one edge and whichever way the last
 * step went, a slot entering or leaving tucks under its inner neighbor, and the z-index rises toward the row's middle.
 * Steps are rerenders of a static row inside the slide, the shape a swap-scroll's queued steps take on the slots.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import type { PanelWindow, WorkspaceHandle } from '../index.js';
import { ROW_LAYER_Z } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { centerRank, OPEN_Z, slotZ } from '../rowSlotZ.js';
import { bindingOf, type EngineOps } from '../workspaceCore.js';
import { advanceFrames, cleanup, mount, seededWorkspace, withHost, StaticRow } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
registerTestView('stack-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const made = (id: string): PanelWindow =>
  applyTemplate(appendPanel([], { url: `https://${id}.example`, title: id, view: 'stack-view' }, id, ROOT)[0]!, resolvePanelSettings({ template: { overflow: 'park' } }).value, 'create');
const rootEntry = (): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'stack-view' }, resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');

function settledWorkspace(entries: readonly PanelWindow[], over: { tuning?: { defaultEnterFrom: 'expand' } } = {}): WorkspaceHandle {
  const workspace = seededWorkspace(entries, { rootId: ROOT, ...over });
  const binding = bindingOf(workspace);
  binding.attach({});
  binding.publish({ entries, held: new Set(), settled: true, create: () => {}, lateRegister: () => {}, ops: {} as EngineOps });
  assert.equal(workspace.panels.getSnapshot().status, 'ready');
  return workspace;
}
const NONE: ReadonlySet<string> = new Set();
/** The row with `ids` present; `sides` marks the side each named entry reveals from, and `exitRight` the ids that park right. */
const row = (workspace: WorkspaceHandle, ids: readonly string[], sides: ReadonlyMap<string, 'left' | 'right'> = new Map(), exitRight: ReadonlySet<string> = NONE): React.ReactElement =>
  withHost(React.createElement(StaticRow, { workspace, entries: ids.map((id) => (id === ROOT ? rootEntry() : made(id))), rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, exitRightIds: exitRight, enterSideById: sides }));
const zOf = (container: HTMLElement, id: string): number => {
  const slot = container.querySelector(`[data-slot="${id}"]`)?.closest<HTMLElement>('[data-row-slot]');
  assert.ok(slot, `slot ${id} is mounted`);
  return Number(slot.style.zIndex);
};
const right = (...ids: string[]): ReadonlyMap<string, 'right'> => new Map(ids.map((id) => [id, 'right' as const]));
const left = (...ids: string[]): ReadonlyMap<string, 'left'> => new Map(ids.map((id) => [id, 'left' as const]));

afterEach(() => cleanup());

test('centerRank and slotZ: ranks peak at the middle, a moving slot sits one level under its rank, and the tiers never meet', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => centerRank(i, 6)), [0, 1, 2, 2, 1, 0]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => centerRank(i, 5)), [0, 1, 2, 1, 0]);
  assert.equal(centerRank(0, 1), 0);
  assert.equal(centerRank(7, 3), 0, 'an index outside the row is an edge');
  assert.equal(slotZ(ROW_LAYER_Z.BASE, 0, false), 1);
  assert.equal(slotZ(ROW_LAYER_Z.BASE, 2, false), 5);
  assert.equal(slotZ(ROW_LAYER_Z.BASE, 2, true), 4, 'between its own rank and the next one out');
  assert.equal(slotZ(ROW_LAYER_Z.BASE, 0, true), 0, 'an edge entry of the base tier is under the whole row');
  assert.equal(slotZ(ROW_LAYER_Z.RAISED, 0, true), 99, 'and of the raised tier still over every base slot');
  assert.ok(slotZ(ROW_LAYER_Z.BASE, 31, false) < slotZ(ROW_LAYER_Z.RAISED, 0, true));
  assert.equal(OPEN_Z, 0);
});

/** Each pair's first id must be drawn under its second: strict, so a tie fails. */
const assertUnder = (container: HTMLElement, pairs: readonly (readonly [string, string])[]): void => {
  for (const [under, over] of pairs) assert.ok(zOf(container, under) < zOf(container, over), `${under} (z ${zOf(container, under)}) is under ${over} (z ${zOf(container, over)})`);
};

test('two fast steps the same way: both leaving slots are under the slots after them, both entering slots under the slots before them', async () => {
  const start = [ROOT, 'a', 'b', 'c', 'd', 'e'];
  const workspace = settledWorkspace(start.map((id) => (id === ROOT ? rootEntry() : made(id))));
  const m = mount(row(workspace, start));
  // At rest the z-index peaks at the middle: ranks 0 1 2 2 1 0 over root a b c d e, the root in the raised tier.
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => zOf(m.container, id)), [3, 5, 5, 3, 1]);
  assert.equal(zOf(m.container, ROOT), ROW_LAYER_Z.RAISED);
  // Step 1: a parks left, f reveals from the right.
  m.rerender(row(workspace, [ROOT, 'b', 'c', 'd', 'e', 'f'], right('f')));
  await advanceFrames(32);
  assertUnder(m.container, [['a', 'b'], ['f', 'e'], ['e', 'd']]);
  // Step 2, inside step 1's slide: b parks left and g reveals from the right while a and f are still in flight.
  m.rerender(row(workspace, [ROOT, 'c', 'd', 'e', 'f', 'g'], right('g')));
  await advanceFrames(32);
  assertUnder(m.container, [['a', 'b'], ['b', 'c'], ['g', 'f'], ['f', 'e'], ['e', 'd']]);
  // The two leaving slots keep their places in the drawn order [root a b c d e f g], so they never tie: a one under rank 1, b one under rank 2.
  assert.equal(zOf(m.container, 'a'), slotZ(ROW_LAYER_Z.BASE, 1, true));
  assert.equal(zOf(m.container, 'b'), slotZ(ROW_LAYER_Z.BASE, 2, true));
  assert.equal(zOf(m.container, 'g'), 0, 'the newest entry is under the whole row');
  assert.equal(zOf(m.container, 'f'), slotZ(ROW_LAYER_Z.BASE, 1, true), 'the earlier entry, now one step in, is still entering so it sits one under rank 1');
  // Once the motion ends every slot rests at its rank.
  await advanceFrames(1200);
  assert.deepEqual(['c', 'd', 'e', 'f', 'g'].map((id) => zOf(m.container, id)), [3, 5, 5, 3, 1]);
  m.unmount();
});

test('a reversal mid-flight: the slot that was entering leaves under its neighbor, and the one that was leaving returns under its neighbor', async () => {
  const start = [ROOT, 'a', 'b', 'c', 'd', 'e'];
  const workspace = settledWorkspace(start.map((id) => (id === ROOT ? rootEntry() : made(id))));
  const m = mount(row(workspace, start));
  m.rerender(row(workspace, [ROOT, 'b', 'c', 'd', 'e', 'f'], right('f')));
  await advanceFrames(32);
  // Back the other way before step 1 has landed: f parks right, a reveals from the left again.
  m.rerender(row(workspace, start, left('a'), new Set(['f'])));
  await advanceFrames(32);
  assertUnder(m.container, [['f', 'e'], ['a', 'b'], ['e', 'd']]);
  assert.equal(zOf(m.container, 'f'), 0, 'the slot that was entering now leaves from the edge, under the whole row');
  m.unmount();
});

test('two fast parks by the right edge: the first to leave is under the second, which is under the slot now at the end', async () => {
  const start = [ROOT, 'a', 'b', 'c', 'd', 'e'];
  const workspace = settledWorkspace(start.map((id) => (id === ROOT ? rootEntry() : made(id))));
  const m = mount(row(workspace, start));
  m.rerender(row(workspace, [ROOT, 'a', 'b', 'c', 'd'], new Map(), new Set(['e'])));
  await advanceFrames(32);
  m.rerender(row(workspace, [ROOT, 'a', 'b', 'c'], new Map(), new Set(['d'])));
  await advanceFrames(32);
  // e was born after d, so the DOM order alone would draw it over d: only the rank keeps the outer one under.
  assertUnder(m.container, [['e', 'd'], ['d', 'c']]);
  await advanceFrames(1200);
  assert.equal(m.container.querySelector('[data-slot="e"]'), null, 'the exit has ended');
  assert.deepEqual(['a', 'b', 'c'].map((id) => zOf(m.container, id)), [3, 3, 1], 'ranks are over the slots left once the leavers are gone');
  m.unmount();
});

test('a new open grows under the whole row, and a dragged slot is over all of it', async () => {
  const start = [ROOT, 'a', 'b', 'c'];
  const workspace = settledWorkspace(start.map((id) => (id === ROOT ? rootEntry() : made(id))), { tuning: { defaultEnterFrom: 'expand' } });
  const m = mount(row(workspace, start));
  m.rerender(row(workspace, [ROOT, 'a', 'n', 'b', 'c']));
  await advanceFrames(32);
  assert.equal(zOf(m.container, 'n'), OPEN_Z);
  for (const id of ['a', 'b', 'c']) assert.ok(zOf(m.container, id) > OPEN_Z, `${id} is over the open`);
  assert.ok(ROW_LAYER_Z.DRAGGED > zOf(m.container, ROOT));
  m.unmount();
});
