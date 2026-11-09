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

