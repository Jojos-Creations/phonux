/**
 * `WorkspacePanel`: one grid of the workspace's tiles, its tile counts and their overrides, and the pure model under them.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { WorkspacePanel, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate, WorkspacePanelProps } from '../index.js';
import { DEFAULT_WORKSPACE_TILE_COUNTS, workspaceTileColumns } from '../workspacePanelModel.js';
import { cleanup } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const h = React.createElement;

/**
 * A workspace whose only view is a WorkspacePanel (unlisted, so it does not tile itself), with the titled panels `titles`
 * added. Returns the workspace and each panel's handle by its template id.
 */
function workspaceWith(props: WorkspacePanelProps, titles: Record<string, string>) {
  const view = definePanel({ id: 'workspace', view: () => h(WorkspacePanel, props), settings: { listed: false } });
  const templates: PanelTemplate[] = [view];
  for (const [id, title] of Object.entries(titles)) templates.push(markerTemplate(id, { settings: { title } }));
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'Root' } }), templates });
  ws.addPanel(view);
  const handles: Record<string, ReturnType<typeof ws.addPanel>> = {};
  for (const id of Object.keys(titles)) handles[id] = ws.addPanel(id);
  return { ws, handles };
}

const tileIds = (container: HTMLElement): string[] => [...container.querySelectorAll<HTMLElement>('[data-workspace-tile]')].map((t) => t.dataset.workspaceTile ?? '');

test("the workspace's live and parked panels render as one grid, with no headings and no search field", () => {
  const { ws, handles } = workspaceWith({}, { viewing: 'Viewing', hidden: 'Hidden' });
  const m = mountWorkspace(ws);
  act(() => {
    handles.hidden?.hide();
  });
  assert.deepEqual(tileIds(m.container).sort(), ['hidden', 'viewing']);
  assert.equal(m.container.querySelectorAll('[data-workspace-tiles]').length, 1);
  assert.equal(m.container.querySelector('[data-workspace-group]'), null);
  assert.equal(m.container.querySelector('input'), null);
  m.unmount();
});

test('tile counts default to 5, 4 and 3, and a developer can override them', () => {
  assert.deepEqual(DEFAULT_WORKSPACE_TILE_COUNTS, { small: 5, medium: 4, large: 3 });
  assert.equal(workspaceTileColumns('small', undefined), 5);
  assert.equal(workspaceTileColumns('medium', undefined), 4);
  assert.equal(workspaceTileColumns('large', undefined), 3);
  assert.equal(workspaceTileColumns('medium', { medium: 6 }), 6, 'an override replaces only its size');
  assert.equal(workspaceTileColumns('medium', { small: 2 }), 4, 'other sizes keep their default');
  assert.throws(() => workspaceTileColumns('small', { small: 0 }), RangeError);
  assert.throws(() => workspaceTileColumns('large', { large: 2.5 }), RangeError);
});

test('the rendered grid carries the default count for the medium tile size', () => {
  const { ws } = workspaceWith({}, { one: 'One' });
  const m = mountWorkspace(ws);
  assert.equal(m.container.querySelector<HTMLElement>('[data-workspace-tiles]')?.dataset.columns, '4');
  m.unmount();
});

test('the rendered grid honours a tile size and an override', () => {
  const { ws } = workspaceWith({ tileSize: 'large', tileCounts: { large: 2 } }, { one: 'One' });
  const m = mountWorkspace(ws);
  assert.equal(m.container.querySelector<HTMLElement>('[data-workspace-tiles]')?.dataset.columns, '2');
  m.unmount();
});

test("a panel's state carries its own width in slots, and a resize publishes a new snapshot", () => {
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'Root' } }), templates: [markerTemplate('fold', { settings: { title: 'Fold', maxSlots: 2 } })] });
  const fold = ws.addPanel('fold');
  const m = mountWorkspace(ws);
  assert.equal(fold.getState().slots, 1);
  const before = ws.panels.getSnapshot().version;
  act(() => {
    fold.setSlots(2);
  });
  assert.equal(fold.getState().slots, 2);
  assert.ok(ws.panels.getSnapshot().version > before, 'a new snapshot, so a reader of the snapshot redraws');
  m.unmount();
});
