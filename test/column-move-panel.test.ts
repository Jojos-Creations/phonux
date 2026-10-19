/**
 * WorkspaceColumnHandle.movePanel: a panel leaves one workspace for the end of another's row as the same panel, both workspaces
 * save the result and come back from storage as moved, and each refusal leaves both workspaces as they were.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, createWorkspaceColumn, definePanel, useHost } from '../index.js';
import type { ColumnOptions, ColumnState, ColumnStorage, MovePanelResult, WorkspaceColumnHandle, WorkspaceHandle, WorkspaceState } from '../index.js';
import { memoryWorkspaceStorage, type MemoryWorkspaceStorage } from '../fakeHost.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const view = ({ handle }: { handle: { id: string } }): React.ReactElement => React.createElement('i', { 'data-slot': handle.id });
const note = definePanel({ id: 'note', view, settings: { multiple: true } });
const solo = definePanel({ id: 'solo', view });
const pair = definePanel({ id: 'pair', view, settings: { multiple: true, maxInstances: 1 } });
const rail = definePanel({ id: 'rail', view, settings: { parkable: false } });
const pinned = definePanel({ id: 'pinned', view, settings: { multiple: true, movable: false } });
const sticky = definePanel({ id: 'sticky', view, settings: { afterClose: 'return-next-launch' } });
const front = definePanel({ id: 'front', view, settings: { multiple: true, placeOnAdd: 'row-start' } });
/** What the root view saw of the host's undo window at each render. */
const undoSeen: Array<number | null> = [];
const home = definePanel({
  id: 'home',
  view: () => {
    const { panels } = useHost();
    undoSeen.push(panels?.recentlyClosed?.length ?? null);
    return React.createElement('i', { 'data-slot': 'home' });
  },
});

/** Storage that outlives a column, so a second column built over it is a relaunch. A workspace named in `hold` does not finish loading until `let` is called for it. */
function disk(hold: string[] = []): { storage: ColumnStorage; files: Map<string, MemoryWorkspaceStorage>; list: { state: ColumnState | null }; let: (id: string) => void } {
  const files = new Map<string, MemoryWorkspaceStorage>();
  const list: { state: ColumnState | null } = { state: null };
  const gates = new Map<string, () => void>();
  const waits = new Map(hold.map((id) => [id, new Promise<void>((resolve) => gates.set(id, resolve))]));
  const storage: ColumnStorage = {
    load: async () => list.state,
    save: (s) => void (list.state = s),
    workspace: (id) => {
      let f = files.get(id);
      if (f === undefined) files.set(id, (f = memoryWorkspaceStorage()));
      const inner = f;
      const wait = waits.get(id);
      return wait === undefined ? inner : { load: () => wait.then(() => inner.load()), save: (state) => inner.save(state) };
    },
  };
  return { storage, files, list, let: (id) => gates.get(id)?.() };
}

type Disk = ReturnType<typeof disk>;

function build(d: Disk, extra: Partial<ColumnOptions> = {}): WorkspaceColumnHandle {
  const column = createWorkspaceColumn({ root: home, templates: [note, solo, pair, rail, pinned, sticky, front], storage: d.storage, tuning: { saveQuietMs: 0 }, ...extra });
  columns.push(column);
  return column;
}

async function launch(d: Disk, ids: string[] = ['top', 'bottom'], declare?: (ws: WorkspaceHandle) => void, extra: Partial<ColumnOptions> = {}): Promise<{ column: WorkspaceColumnHandle; top: WorkspaceHandle; bottom: WorkspaceHandle; all: WorkspaceHandle[] }> {
  const column = build(d, extra);
  const made = ids.map((id) => column.addWorkspace({ id }));
  for (const ws of made) declare?.(ws);
  await until('all rows ready', () => made.every((w) => w.status === 'ready'));
  return { column, top: made[0]!, bottom: made[1]!, all: made };
}

const ready = (ws: WorkspaceHandle, id: string): Promise<void> => until(`panel ${id}`, () => ws.panels.get(id)?.getState().status === 'live');
const saved = (d: Disk, ws: string): WorkspaceState | null => d.files.get(ws)?.saved ?? null;
const savedViews = (d: Disk, ws: string): string[] => saved(d, ws)?.panels.map((p) => p.view) ?? [];
const failed = (r: MovePanelResult): Extract<MovePanelResult, { ok: false }> => {
  assert.equal(r.ok, false, 'the move was refused');
  return r as Extract<MovePanelResult, { ok: false }>;
};

test('a panel keeps its template, params, size and uid, lands at the end of the target row, and both workspaces come back from storage as moved', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('note', { id: 'n1', params: { text: 'kept' }, settings: { slots: 2 } });
  bottom.addPanel('note', { id: 'n2' });
  await ready(top, 'n1');
  await ready(bottom, 'n2');
  await until('both saved', () => savedViews(d, 'top').length === 1 && savedViews(d, 'bottom').length === 1);
  const uid = saved(d, 'top')!.panels[0]!.uid;
  assert.ok(uid !== undefined && uid !== '', 'the panel has a uid before the move');

  const moved = column.movePanel(top, 'n1', 1);
  assert.equal(moved.ok, true);
  assert.ok(moved.ok);
  assert.equal(moved.workspace, bottom);
  assert.equal(moved.index, 1);
  assert.equal(moved.panelId, 'n1');
  assert.equal(column.current, 0, 'the current workspace does not change');

  await until('moved and saved', () => savedViews(d, 'top').length === 0 && savedViews(d, 'bottom').length === 2);
  const there = saved(d, 'bottom')!;
  assert.deepEqual(there.panels.map((p) => p.key), ['n2', 'n1'], 'it lands after the panel already there');
  const entry = there.panels[1]!;
  assert.equal(entry.uid, uid, 'the uid goes with the panel');
  assert.equal(entry.slots, 2, 'the size goes with the panel');
  assert.deepEqual(entry.params, { text: 'kept' });
  assert.equal(entry.view, 'note');
  assert.equal(top.panels.get('n1')?.getState().status ?? 'closed', 'closed', 'the source no longer holds it');
  assert.equal(bottom.panels.get('n1')?.getState().status, 'live');

  // A relaunch over the same storage.
  act(() => column.dispose());
  const again = await launch(d);
  await ready(again.bottom, 'n1');
  assert.equal(again.top.panels.get('n1'), undefined, 'the source does not bring it back');
  assert.deepEqual(again.bottom.panels.list().map((h) => h.id), ['home', 'n2', 'n1']);
  const back = again.bottom.panels.get('n1')!.getState();
  assert.deepEqual(back.params, { text: 'kept' });
  assert.equal(back.settings.slots, 2);
});

test('a panel moves to a workspace given by handle as well as by index, and to one above', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  bottom.addPanel('note', { id: 'up' });
  await ready(bottom, 'up');
  const r = column.movePanel(bottom, 'up', top);
  assert.ok(r.ok);
  assert.equal(r.index, 0);
  assert.equal(r.workspace, top);
  await until('landed', () => top.panels.get('up')?.getState().status === 'live');
  assert.equal(column.current, 0);
  column.scrollTo(r.workspace);
  assert.equal(column.current, r.index, 'the answer is enough to follow the panel');
});

test('a size the person chose goes with the panel and is saved as theirs', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  assert.ok(top.panels.get('n1')!.setSlots(3, 'person').ok);
  await until('saved big', () => saved(d, 'top')?.panels[0]?.slots === 3);
  assert.ok(column.movePanel(top, 'n1', bottom).ok);
  await until('saved there', () => saved(d, 'bottom')?.panels[0]?.slots === 3);
  assert.equal(saved(d, 'bottom')!.panels[0]!.overrides?.slots, 3);
  assert.equal(bottom.panels.get('n1')!.getState().settings.slots, 3);
});

test('the root panel never moves', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  assert.equal(failed(column.movePanel(top, 'home', bottom)).code, 'root-fixed');
  assert.equal(bottom.panels.get('home')?.getState().status, 'live', 'the target keeps only its own root');
  assert.equal(top.panels.get('home')?.getState().status, 'live');
});

test('an always-shown column stays where it is', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('rail');
  await ready(top, 'rail');
  const r = failed(column.movePanel(top, 'rail', bottom));
  assert.equal(r.code, 'not-movable');
  assert.match(r.message, /always-shown/);
  assert.equal(bottom.panels.get('rail')?.getState().status ?? 'closed', 'closed');
});

test('a panel whose movable is false stays where it is', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('pinned', { id: 'p1' });
  await ready(top, 'p1');
  assert.equal(failed(column.movePanel(top, 'p1', bottom)).code, 'not-movable');
  assert.equal(top.panels.get('p1')?.getState().status, 'live');
});

test('an unknown panel, an unknown workspace and the same workspace are refused', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  assert.equal(failed(column.movePanel(top, 'nope', bottom)).code, 'unknown-panel');
  assert.equal(failed(column.movePanel(top, 'n1', 7)).code, 'unknown-workspace');
  assert.equal(failed(column.movePanel(-1, 'n1', bottom)).code, 'unknown-workspace');
  const outsider = createWorkspace({ mount: false });
  assert.equal(failed(column.movePanel(top, 'n1', outsider)).code, 'unknown-workspace');
  outsider.dispose();
  assert.equal(failed(column.movePanel(top, 'n1', top)).code, 'same-workspace');
  assert.equal(failed(column.movePanel(1, 'n1', bottom)).code, 'same-workspace');
  assert.equal(top.panels.get('n1')?.getState().status, 'live', 'the panel never left');
});

test('a target at the template instance limit, or holding the same id, is refused', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('solo');
  bottom.addPanel('solo');
  top.addPanel('pair', { id: 'q1' });
  bottom.addPanel('pair', { id: 'q2' });
  top.addPanel('note', { id: 'same' });
  bottom.addPanel('note', { id: 'same' });
  await ready(top, 'q1');
  await ready(bottom, 'q2');
  await ready(top, 'same');
  await ready(bottom, 'same');
  await ready(top, 'solo');
  await ready(bottom, 'solo');
  assert.equal(failed(column.movePanel(top, 'solo', bottom)).code, 'instance-limit');
  assert.equal(failed(column.movePanel(top, 'q1', bottom)).code, 'instance-limit');
  const clash = failed(column.movePanel(top, 'same', bottom));
  assert.equal(clash.code, 'instance-limit');
  assert.match(clash.message, /target workspace/);
  for (const id of ['solo', 'q1', 'same']) assert.equal(top.panels.get(id)?.getState().status, 'live', `${id} stayed`);
});

test('a column that is disposed refuses', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  column.dispose();
  assert.equal(failed(column.movePanel(top, 'n1', bottom)).code, 'disposed');
});

test('a source or a target that is not drawn yet refuses, and moves nothing', async () => {
  const d = disk();
  const { column, top } = await launch(d);
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  const late = column.addWorkspace({ id: 'late' });
  assert.equal(late.status, 'detached');
  assert.equal(failed(column.movePanel(top, 'n1', late)).code, 'not-attached');
  assert.equal(failed(column.movePanel(late, 'n1', top)).code, 'not-attached');
  assert.equal(top.panels.get('n1')?.getState().status, 'live', 'the panel never left');
});

test('a panel lands at the end of the row even when its template places new panels at the start, and stays there after a relaunch', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  bottom.addPanel('note', { id: 'n2' });
  top.addPanel('front', { id: 'f1' });
  await ready(bottom, 'n2');
  await ready(top, 'f1');
  assert.ok(column.movePanel(top, 'f1', bottom).ok);
  await until('saved', () => savedViews(d, 'bottom').length === 2);
  assert.deepEqual(saved(d, 'bottom')!.panels.map((p) => p.key), ['n2', 'f1']);
  act(() => column.dispose());
  const again = await launch(d);
  await ready(again.bottom, 'f1');
  assert.deepEqual(again.bottom.panels.list().map((h) => h.id), ['home', 'n2', 'f1']);
});

test('a panel code declares moves only when closing it is final, and then the source does not bring it back', async () => {
  const d = disk();
  const declare = (ws: WorkspaceHandle): void => {
    if (ws.id === 'top') {
      ws.addPanel('note', { id: 'fixed' });
      ws.addPanel('sticky');
    }
  };
  const first = await launch(d, ['top', 'bottom'], declare);
  await ready(first.top, 'fixed');
  await ready(first.top, 'sticky');
  const r = failed(first.column.movePanel(first.top, 'sticky', first.bottom));
  assert.equal(r.code, 'not-movable');
  assert.match(r.message, /next launch/);
  const ok = first.column.movePanel(first.top, 'fixed', first.bottom);
  assert.ok(ok.ok);
  await until('saved', () => savedViews(d, 'bottom').length === 1 && (saved(d, 'top')!.dismissed ?? []).includes('fixed'));
  act(() => first.column.dispose());

  const second = await launch(d, ['top', 'bottom'], declare);
  await ready(second.top, 'sticky');
  await new Promise((r2) => setTimeout(r2, 30));
  assert.equal(second.top.panels.get('fixed')?.getState().status ?? 'closed', 'closed', 'the declaration does not recreate it where it left');
  assert.equal(second.bottom.panels.get('fixed')?.getState().status, 'live');
});

test('addWorkspace at index 0 and at the end puts a workspace above the first and below the last, and the current one stays', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  column.scrollTo(bottom);
  const above = column.addWorkspace({ index: 0 });
  const below = column.addWorkspace({ index: column.workspaces.length });
  assert.deepEqual(column.workspaces, [above, top, bottom, below]);
  assert.equal(column.workspaces[column.current], bottom);
});

test('two moves of one panel in one turn: the second answers busy and the panel is in one workspace only', async () => {
  const d = disk();
  const { column, top, bottom, all } = await launch(d, ['top', 'bottom', 'third']);
  const third = all[2]!;
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  let first: MovePanelResult | undefined;
  let second: MovePanelResult | undefined;
  act(() => {
    first = column.movePanel(top, 'n1', bottom);
    second = column.movePanel(top, 'n1', third);
  });
  assert.equal(first?.ok, true);
  assert.equal(failed(second!).code, 'busy');
  await ready(bottom, 'n1');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(third.panels.get('n1')?.getState().status ?? 'closed', 'closed', 'the refused move added nothing');
  assert.equal(top.panels.get('n1')?.getState().status ?? 'closed', 'closed');
});

test('a move is not a close: no closed-panel report and no undo window', async () => {
  const d = disk();
  const closed: string[] = [];
  const { column, top, bottom } = await launch(d, ['top', 'bottom'], undefined, { panels: { onPanelsClosed: (e) => void closed.push(e.id) } });
  top.addPanel('note', { id: 'n1' });
  top.addPanel('note', { id: 'n2' });
  await ready(top, 'n1');
  await ready(top, 'n2');
  undoSeen.length = 0;
  assert.ok(column.movePanel(top, 'n1', bottom).ok);
  await ready(bottom, 'n1');
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(closed, [], 'the host is told of no close');
  assert.deepEqual(undoSeen.filter((n) => n !== null), [], 'the undo window never opened');
  // The probes see a real close.
  assert.ok(top.panels.get('n2')!.close().ok);
  await until('close reported', () => closed.length === 1);
  await until('undo window seen', () => undoSeen.some((n) => n === 1));
});

test('url and title go with the panel, a title set at run time too, and survive a relaunch', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.addPanel('solo', { url: 'https://example.test/page' });
  top.addPanel('note', { id: 'n1', url: 'https://example.test/n1' });
  await ready(top, 'solo');
  await ready(top, 'n1');
  assert.ok(top.panels.get('n1')!.configure({ title: 'Renamed at run time' }).ok);
  const soloTitle = top.panels.get('solo')!.getState().title;
  assert.ok(soloTitle !== undefined && soloTitle !== '', 'the singleton has a default title');
  // A token on a panel lasts until the next commit.
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(column.movePanel(top, 'solo', bottom).ok);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(column.movePanel(top, 'n1', bottom).ok);
  await ready(bottom, 'solo');
  await ready(bottom, 'n1');
  assert.equal(bottom.panels.get('solo')!.getState().url, 'https://example.test/page');
  assert.equal(bottom.panels.get('solo')!.getState().title, soloTitle, 'a default title does not change with the engine id');
  assert.equal(bottom.panels.get('n1')!.getState().url, 'https://example.test/n1');
  assert.equal(bottom.panels.get('n1')!.getState().title, 'Renamed at run time');
  await until('saved', () => savedViews(d, 'bottom').length === 2);
  const file = saved(d, 'bottom')!.panels;
  assert.deepEqual(file.map((p) => [p.key, p.url, p.title]), [['solo', 'https://example.test/page', soloTitle], ['n1', 'https://example.test/n1', 'Renamed at run time']]);
  act(() => column.dispose());
  const again = await launch(d);
  await ready(again.bottom, 'n1');
  assert.equal(again.bottom.panels.get('n1')!.getState().url, 'https://example.test/n1');
  assert.equal(again.bottom.panels.get('n1')!.getState().title, 'Renamed at run time');
  assert.equal(again.bottom.panels.get('solo')!.getState().url, 'https://example.test/page');
});

test('a workspace still loading refuses as source and as target, and the panel stays', async () => {
  const d = disk(['bottom']);
  const column = build(d);
  const top = column.addWorkspace({ id: 'top' });
  const bottom = column.addWorkspace({ id: 'bottom' });
  await until('top ready', () => top.status === 'ready');
  await until('bottom loading', () => bottom.status === 'loading');
  top.addPanel('note', { id: 'n1' });
  await ready(top, 'n1');
  assert.equal(failed(column.movePanel(top, 'n1', bottom)).code, 'not-ready');
  assert.equal(failed(column.movePanel(bottom, 'n1', top)).code, 'not-ready');
  assert.equal(top.panels.get('n1')?.getState().status, 'live');
  d.let('bottom');
  await until('bottom ready', () => bottom.status === 'ready');
  assert.ok(column.movePanel(top, 'n1', bottom).ok, 'once loaded the same move goes through');
});

test('a target that lacks the panel template refuses with unknown-panel', async () => {
  const d = disk();
  const { column, top, bottom } = await launch(d);
  top.registerTemplate(definePanel({ id: 'extra', view }));
  top.addPanel('extra');
  await ready(top, 'extra');
  const r = failed(column.movePanel(top, 'extra', bottom));
  assert.equal(r.code, 'unknown-panel');
  assert.match(r.message, /not registered in the target/);
  assert.equal(top.panels.get('extra')?.getState().status, 'live');
});

test('moving a declared panel back to the workspace that declares it says so', async () => {
  const d = disk();
  const declare = (ws: WorkspaceHandle): void => {
    if (ws.id === 'top') ws.addPanel('note', { id: 'fixed' });
  };
  const { column, top, bottom } = await launch(d, ['top', 'bottom'], declare);
  await ready(top, 'fixed');
  assert.ok(column.movePanel(top, 'fixed', bottom).ok);
  await ready(bottom, 'fixed');
  const back = failed(column.movePanel(bottom, 'fixed', top));
  assert.equal(back.code, 'instance-limit');
  assert.match(back.message, /declares a panel under that id/);
});
