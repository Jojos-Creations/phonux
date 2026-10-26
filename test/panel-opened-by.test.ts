/**
 * PanelState.openedBy, PanelManager.familyOf and the family move: a panel's opener is recorded once from the view that added it,
 * survives a reorder and a relaunch, passes to the grandparent when the opener closes, and a whole family moves to another
 * workspace together or not at all.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspaceColumn, definePanel, useWorkspace } from '../index.js';
import type { ColumnState, ColumnStorage, MovePanelResult, ViewWorkspace, WorkspaceColumnHandle, WorkspaceHandle, WorkspaceState } from '../index.js';
import { memoryWorkspaceStorage, type MemoryWorkspaceStorage } from '../fakeHost.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  views.clear();
  rigCleanup();
});

/** The workspace each drawn panel's view received, by panel id. */
const views = new Map<string, ViewWorkspace>();
const view = ({ handle }: { handle: { id: string } }): React.ReactElement => {
  const ws = useWorkspace();
  if (ws !== undefined) views.set(handle.id, ws);
  return React.createElement('i', { 'data-slot': handle.id });
};
const note = definePanel({ id: 'note', view, settings: { multiple: true } });
const solo = definePanel({ id: 'solo', view });
const home = definePanel({ id: 'home', view });

function disk(): { storage: ColumnStorage; files: Map<string, MemoryWorkspaceStorage> } {
  const files = new Map<string, MemoryWorkspaceStorage>();
  const list: { state: ColumnState | null } = { state: null };
  const storage: ColumnStorage = {
    load: async () => list.state,
    save: (s) => void (list.state = s),
    workspace: (id) => {
      let f = files.get(id);
      if (f === undefined) files.set(id, (f = memoryWorkspaceStorage()));
      return f;
    },
  };
  return { storage, files };
}
type Disk = ReturnType<typeof disk>;

async function launch(d: Disk): Promise<{ column: WorkspaceColumnHandle; top: WorkspaceHandle; bottom: WorkspaceHandle }> {
  const column = createWorkspaceColumn({ root: home, templates: [note, solo], storage: d.storage, tuning: { saveQuietMs: 0 } });
  columns.push(column);
  const top = column.addWorkspace({ id: 'top' });
  const bottom = column.addWorkspace({ id: 'bottom' });
  await until('both rows ready', () => top.status === 'ready' && bottom.status === 'ready');
  return { column, top, bottom };
}

const live = (ws: WorkspaceHandle, id: string): Promise<void> => until(`panel ${id}`, () => ws.panels.get(id)?.getState().status === 'live' && views.has(id));
const openerOf = (ws: WorkspaceHandle, id: string): string | null | undefined => ws.panels.get(id)?.getState().openedBy;
const saved = (d: Disk, ws: string): WorkspaceState | null => d.files.get(ws)?.saved ?? null;
/** The panels the row holds, in row order: a closed panel keeps answering through its handle but has no place. */
const ids = (ws: WorkspaceHandle): string[] => ws.panels.getSnapshot().panels.filter((s) => s.index !== null).map((s) => s.id);

/** Opens `child` from the view of `parent`. */
async function openFrom(ws: WorkspaceHandle, parent: string, child: string, template = 'note'): Promise<void> {
  await act(async () => void views.get(parent)!.panels.addPanel(template, { id: child }));
  await live(ws, child);
}

/** A three-level family in `ws`: a opened b, b opened c; d stands alone. */
async function tree(ws: WorkspaceHandle): Promise<void> {
  ws.addPanel('note', { id: 'a' });
  await live(ws, 'a');
  await openFrom(ws, 'a', 'b');
  await openFrom(ws, 'b', 'c');
  ws.addPanel('note', { id: 'd' });
  await live(ws, 'd');
}

const refusal = (r: MovePanelResult): Extract<MovePanelResult, { ok: false }> => {
  assert.equal(r.ok, false, 'the move was refused');
  return r as Extract<MovePanelResult, { ok: false }>;
};

test("a panel added through a view's addPanel records that view's panel; one the host adds has no opener", async () => {
  const d = disk();
  const { top } = await launch(d);
  await tree(top);
  assert.equal(openerOf(top, 'a'), null, 'the host opened a');
  assert.equal(openerOf(top, 'b'), 'a');
  assert.equal(openerOf(top, 'c'), 'b');
  assert.equal(openerOf(top, 'd'), null);
  assert.equal(views.get('a'), views.get('a'), 'each view keeps one workspace object');
  assert.notEqual(views.get('a'), views.get('b'), 'each view has its own');
});

test('asking addPanel for a panel that already exists never rewrites its opener', async () => {
  const d = disk();
  const { top } = await launch(d);
  await tree(top);
  await act(async () => void views.get('d')!.panels.addPanel('note', { id: 'c' }));
  assert.equal(openerOf(top, 'c'), 'b');
});

test('the opener survives a reorder and a relaunch', async () => {
  const d = disk();
  const { column, top } = await launch(d);
  await tree(top);
  assert.ok(top.panels.get('c')!.move(-2, 'person').ok);
  await until('reordered', () => ids(top).join() === 'home,c,a,b,d');
  assert.equal(openerOf(top, 'c'), 'b');
  await until('saved', () => saved(d, 'top')?.panels.map((p) => p.key).join() === 'c,a,b,d');
  const file = saved(d, 'top')!;
  const uidOf = (key: string): string | undefined => file.panels.find((p) => p.key === key)?.uid;
  assert.equal(file.panels.find((p) => p.key === 'c')?.openedBy, uidOf('b'), 'the file names the opener by its uid');
  assert.equal('openedBy' in file.panels.find((p) => p.key === 'a')!, false, 'a panel with no opener writes none');

  act(() => column.dispose());
  const again = await launch(d);
  await until('restored', () => ids(again.top).join() === 'home,c,a,b,d');
  assert.equal(openerOf(again.top, 'a'), null);
  assert.equal(openerOf(again.top, 'b'), 'a');
  assert.equal(openerOf(again.top, 'c'), 'b');
});

test('a file saved before openers loads with none, and one naming a missing panel drops it', async () => {
  const d = disk();
  const { column, top } = await launch(d);
  await tree(top);
  await until('saved', () => saved(d, 'top')?.panels.length === 4);
  const file = saved(d, 'top')!;
  for (const p of file.panels) delete p.openedBy;
  file.panels[3]!.openedBy = 'u_00000000000000000000000000000000';
  act(() => column.dispose());
  d.files.set('top', memoryWorkspaceStorage(file));
  const again = await launch(d);
  await until('restored', () => ids(again.top).length === 5);
  for (const id of ['a', 'b', 'c', 'd']) assert.equal(openerOf(again.top, id), null, id);
});

test("when a panel closes, the panels it opened take its opener", async () => {
  const d = disk();
  const { top } = await launch(d);
  await tree(top);
  await act(async () => void top.panels.get('b')!.close());
  await until('b gone', () => !ids(top).includes('b'));
  assert.equal(openerOf(top, 'c'), 'a');
  await act(async () => void top.panels.get('a')!.close());
  await until('a gone', () => !ids(top).includes('a'));
  assert.equal(openerOf(top, 'c'), null, 'c tops its own family now');
});

test('familyOf lists the panel and every descendant in row order, and nothing for a panel the row does not hold', async () => {
  const d = disk();
  const { top } = await launch(d);
  await tree(top);
  await openFrom(top, 'a', 'e');
  assert.ok(top.panels.get('e')!.move(-3, 'person').ok);
  await until('reordered', () => ids(top).join() === 'home,a,e,b,c,d');
  assert.deepEqual(top.panels.familyOf('a'), ['a', 'e', 'b', 'c']);
  assert.deepEqual(top.panels.familyOf('b'), ['b', 'c']);
  assert.deepEqual(top.panels.familyOf('d'), ['d']);
  assert.deepEqual(top.panels.familyOf('nope'), []);
});

test('a family moves whole: every member lands at the end of the target in row order, none stay behind, and the top has no opener there', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  bottom.addPanel('note', { id: 'x' });
  await live(bottom, 'x');
  await tree(top);
  const check = column.canMovePanel(top, 'a', bottom, { withFamily: true });
  assert.ok(check.ok);
  assert.deepEqual(check.panelIds, ['a', 'b', 'c']);
  assert.deepEqual(ids(top), ['home', 'a', 'b', 'c', 'd'], 'the dry run moved nothing');

  const moved = column.movePanel(top, 'a', bottom, { withFamily: true });
  assert.ok(moved.ok);
  assert.deepEqual(moved.panelIds, ['a', 'b', 'c']);
  assert.equal(moved.panelId, 'a');
  await until('landed', () => ids(bottom).join() === 'home,x,a,b,c' && ids(top).join() === 'home,d');
  await live(bottom, 'c');
  assert.equal(openerOf(bottom, 'a'), null, "the top's link to its old opener is cut");
  assert.equal(openerOf(bottom, 'b'), 'a');
  assert.equal(openerOf(bottom, 'c'), 'b');
  assert.deepEqual(bottom.panels.familyOf('a'), ['a', 'b', 'c']);
  await until('both saved', () => saved(d, 'top')?.panels.length === 1 && saved(d, 'bottom')?.panels.length === 4);
});

test('a panel moved alone arrives with no opener and its children take its old opener', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  await tree(top);
  const moved = column.movePanel(top, 'b', bottom);
  assert.ok(moved.ok);
  assert.deepEqual(moved.panelIds, ['b']);
  await until('landed', () => ids(bottom).includes('b') && !ids(top).includes('b'));
  assert.equal(openerOf(bottom, 'b'), null);
  assert.equal(openerOf(top, 'c'), 'a');
});

test('one member the target refuses moves nothing, and the answer names it; canMovePanel answers the same', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  bottom.addPanel('solo');
  await live(bottom, 'solo');
  await tree(top);
  await act(async () => void views.get('b')!.panels.addPanel('solo'));
  await live(top, 'solo');
  assert.equal(openerOf(top, 'solo'), 'b');

  const asked = refusal(column.canMovePanel(top, 'a', bottom, { withFamily: true }));
  const r = refusal(column.movePanel(top, 'a', bottom, { withFamily: true }));
  assert.deepEqual(asked, r);
  assert.equal(r.code, 'instance-limit');
  assert.match(r.message, /panel 'solo'/);
  assert.deepEqual(ids(top), ['home', 'a', 'b', 'c', 'd', 'solo'], 'the source keeps every member');
  assert.deepEqual(ids(bottom), ['home', 'solo'], 'the target took none');
  assert.ok(column.movePanel(top, 'c', bottom, { withFamily: true }).ok, 'a family without the refused member still moves');
});

test('two members of one template are counted together against the target limit', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  await tree(top);
  bottom.panels.configureTemplate('note', { maxInstances: 2 });
  const r = refusal(column.canMovePanel(top, 'a', bottom, { withFamily: true }));
  assert.equal(r.code, 'instance-limit');
  assert.match(r.message, /panel 'c'/);
  assert.ok(column.canMovePanel(top, 'b', bottom, { withFamily: true }).ok);
});

test('a family move can leave members behind: what moves stays one family there, and what stays takes the moved opener\'s old opener', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  await tree(top);
  const check = column.canMovePanel(top, 'a', bottom, { withFamily: true, leave: ['b'] });
  assert.ok(check.ok);
  assert.deepEqual(check.panelIds, ['a', 'c'], 'the answer names only what would move');
  const moved = column.movePanel(top, 'a', bottom, { withFamily: true, leave: ['b'] });
  assert.ok(moved.ok);
  assert.deepEqual(moved.panelIds, ['a', 'c']);
  await until('landed', () => ids(bottom).join() === 'home,a,c' && ids(top).join() === 'home,b,d');
  await live(bottom, 'c');
  assert.equal(openerOf(bottom, 'a'), null);
  assert.equal(openerOf(bottom, 'c'), 'a', 'c takes its nearest moved ancestor, as b stayed');
  assert.equal(openerOf(top, 'b'), null, "b takes a's old opener, none");
  assert.deepEqual(bottom.panels.familyOf('a'), ['a', 'c']);
});

test('a member left behind no longer refuses the move; leave without withFamily, or naming the panel itself, changes nothing', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  bottom.addPanel('note', { id: 'b' });
  await live(bottom, 'b');
  await tree(top);
  refusal(column.canMovePanel(top, 'a', bottom, { withFamily: true }));
  const check = column.canMovePanel(top, 'a', bottom, { withFamily: true, leave: ['b', 'a'] });
  assert.ok(check.ok, 'b is the only member the target refuses, and it stays');
  assert.deepEqual(check.panelIds, ['a', 'c'], 'a moves though it was named');
  const alone = column.canMovePanel(top, 'a', bottom, { leave: ['b'] });
  assert.ok(alone.ok);
  assert.deepEqual(alone.panelIds, ['a']);
});
