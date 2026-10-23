/**
 * `WorkspacePanel`: its three groups in order with empty ones omitted, its tile counts and their overrides, its live
 * search, and the pure model under them.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { WorkspacePanel, createWorkspace, definePanel } from '../index.js';
import type { PanelTemplate, WorkspacePanelProps } from '../index.js';
import { DEFAULT_LABELS } from '../labels.js';
import { DEFAULT_WORKSPACE_TILE_COUNTS, filterWorkspaceTiles, workspaceGroups, workspaceTileColumns, type WorkspacePanelEntry } from '../workspacePanelModel.js';
import { cleanup } from './support/mount-harness.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const h = React.createElement;
const L = DEFAULT_LABELS;

const tile = (id: string, over: Partial<WorkspacePanelEntry> = {}): WorkspacePanelEntry => ({ id, title: id, live: true, pinned: false, ...over });

/**
 * A workspace whose only view is a WorkspacePanel (unlisted, so it does not tile itself), with the titled panels `titles`
 * added. Returns the workspace and each panel's handle by its template id.
 */
function workspaceWith(props: WorkspacePanelProps, titles: Record<string, string>) {
  const view = definePanel({ id: 'workspace', view: () => h(WorkspacePanel, props), settings: { listed: false } });
  const templates: PanelTemplate[] = [view];
  for (const [id, title] of Object.entries(titles)) templates.push(markerTemplate(id, { settings: { title } }));
  const ws = createWorkspace({ mount: false, root: markerTemplate('root', { settings: { title: 'History' } }), templates });
  ws.addPanel(view);
  const handles: Record<string, ReturnType<typeof ws.addPanel>> = {};
  for (const id of Object.keys(titles)) handles[id] = ws.addPanel(id);
  return { ws, handles };
}

function groupsIn(container: HTMLElement): { key: string; ids: string[] }[] {
  return [...container.querySelectorAll<HTMLElement>('[data-workspace-group]')].map((heading) => {
    const tiles = heading.nextElementSibling as HTMLElement;
    return { key: heading.dataset.workspaceGroup ?? '', ids: [...tiles.querySelectorAll<HTMLElement>('[data-workspace-tile]')].map((t) => t.dataset.workspaceTile ?? '') };
  });
}

test('the rendered groups read pinned, viewing, hidden, and a pinned panel sits only in pinned', () => {
  const { ws, handles } = workspaceWith({}, { viewing: 'Viewing', hidden: 'Hidden', pinned: 'Pinned' });
  const m = mountWorkspace(ws);
  act(() => {
    handles.hidden?.hide();
    handles.pinned?.pin();
  });
  assert.deepEqual(
    groupsIn(m.container).map((g) => g.key),
    ['pinned', 'viewing', 'hidden'],
  );
  const [pinned, viewing, hidden] = groupsIn(m.container);
  assert.deepEqual(pinned?.ids, ['pinned']);
  assert.deepEqual(viewing?.ids, ['viewing']);
  assert.deepEqual(hidden?.ids, ['hidden']);
  m.unmount();
});

test('a rendered group with no panels is omitted', () => {
  const { ws } = workspaceWith({}, { only: 'Only' });
  const m = mountWorkspace(ws);
  assert.deepEqual(
    groupsIn(m.container).map((g) => g.key),
    ['viewing'],
    'with one live, unpinned panel only viewing shows',
  );
  m.unmount();
});

test('the pure grouping keeps pinned, viewing, hidden order and drops empty groups', () => {
  const groups = workspaceGroups([tile('h', { live: false }), tile('v'), tile('p', { pinned: true, live: false }), tile('pv', { pinned: true })], L);
  assert.deepEqual(
    groups.map((g) => [g.key, g.tiles.map((t) => t.id)]),
    [
      ['pinned', ['p', 'pv']],
      ['viewing', ['v']],
      ['hidden', ['h']],
    ],
  );
  assert.deepEqual(
    workspaceGroups([tile('v')], L).map((g) => g.key),
    ['viewing'],
  );
  assert.deepEqual(workspaceGroups([], L), []);
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

test('search keeps the tiles whose title holds the text, ignoring case and outer spaces', () => {
  const tiles = [tile('a', { title: 'Inbox Zero' }), tile('b', { title: 'Calendar' }), tile('c', { title: 'inbox' })];
  assert.deepEqual(
    filterWorkspaceTiles(tiles, '  INBOX ').map((t) => t.id),
    ['a', 'c'],
  );
  assert.equal(filterWorkspaceTiles(tiles, '   '), tiles, 'blank text keeps everything');
  assert.deepEqual(filterWorkspaceTiles(tiles, 'nothing'), []);
});

test('typing in the search field narrows the rendered tiles and shows the no-match message', () => {
  const { ws } = workspaceWith({}, { alpha: 'Alpha', beta: 'Beta' });
  const m = mountWorkspace(ws);
  const input = m.container.querySelector<HTMLInputElement>('[data-workspace-search]');
  assert.ok(input, 'the search field rendered');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  assert.ok(set, 'the input value setter exists');
  const type = (value: string): void => {
    act(() => {
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  type('alp');
  assert.deepEqual(
    [...m.container.querySelectorAll<HTMLElement>('[data-workspace-tile]')].map((t) => t.dataset.workspaceTile),
    ['alpha'],
  );
  type('zzz');
  assert.equal(m.container.querySelector('[data-workspace-empty]')?.textContent, L.workspaceNoMatches);
  m.unmount();
});

test('the group headings come from the label keys, so a host overrides them in one place', () => {
  assert.equal(L.workspacePinned, 'Pinned');
  assert.equal(L.workspaceViewing, 'Viewing');
  assert.equal(L.workspaceHidden, 'Hidden');
  assert.deepEqual(
    workspaceGroups([tile('v')], { ...L, workspaceViewing: 'Open' }).map((g) => g.label),
    ['Open'],
  );
});
