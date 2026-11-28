/**
 * What a column does with a saved list it could not read or does not understand: it leaves the record alone and says so, and a
 * record that older builds read stays readable by them.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspaceColumn } from '../index.js';
import type { ColumnState, ColumnStorage, WorkspaceColumnHandle } from '../index.js';
import { columnCoreOf } from '../columnHandle.js';
import { rigCleanup, until } from './support/auto-rig.js';

const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});

const GOOD: ColumnState = { version: 1, workspaces: [{ id: 'a', name: 'Research' }, { id: 'b', name: 'Trip food' }, { id: 'c', name: 'Taxes' }], current: 'b' };

interface Run {
  held: unknown;
  saves: unknown[];
  errors: unknown[];
  c: WorkspaceColumnHandle;
}
/** A store holding `initial` whose `load` is `read`; resolves once the column is ready and then adds one workspace, as a host does. */
async function run(initial: unknown, read: (held: unknown) => unknown, o: { sideBySide?: boolean } = {}): Promise<Run> {
  const r: Run = { held: initial, saves: [], errors: [], c: undefined as never };
  const storage: ColumnStorage = {
    load: () => read(r.held) as Promise<ColumnState | null>,
    save: (s) => {
      r.held = JSON.parse(JSON.stringify(s));
      r.saves.push(r.held);
    },
  };
  r.c = createWorkspaceColumn({ mount: false, ...o, storage, onError: (e) => r.errors.push(e) });
  columns.push(r.c);
  await until('ready', () => r.c.status === 'ready');
  if (o.sideBySide === true) columnCoreOf(r.c).setWindowWidth(2560, 390);
  r.c.addWorkspace({ id: 'default', name: 'Space 1' });
  await act(() => new Promise<void>((res) => setTimeout(res, 20)));
  return r;
}

test('control: a list that reads back is kept and saved with the workspace added after it', async () => {
  const r = await run(GOOD, async (h) => h);
  assert.deepEqual((r.held as ColumnState).workspaces.map((w) => w.name), ['Research', 'Trip food', 'Taxes', 'Space 1']);
  assert.equal(r.errors.length, 0);
});

test('control: nothing saved reads as an empty list, and the first change is saved', async () => {
  const r = await run(null, async (h) => h);
  assert.deepEqual((r.held as ColumnState).workspaces.map((w) => w.name), ['Space 1']);
  assert.equal(r.errors.length, 0);
});

for (const [name, read] of [
  ['rejects', async (): Promise<never> => Promise.reject(new Error('the database is locked'))],
  [
    'throws',
    (): never => {
      throw new Error('the bridge is not up');
    },
  ],
] as const) {
  test(`a load that ${name} leaves the saved list as it was, reports it, and saves nothing this launch`, async () => {
    const r = await run(GOOD, read);
    assert.deepEqual(r.held, GOOD);
    assert.equal(r.saves.length, 0);
    assert.equal(r.errors.length, 1, 'the failure is reported once');
    assert.match(String((r.errors[0] as Error).message), /locked|bridge/);
    assert.deepEqual(r.c.workspaces.map((w) => w.id), ['default'], 'the column still works with what code added');
    r.c.addWorkspace({ id: 'more' });
    await act(() => new Promise<void>((res) => setTimeout(res, 20)));
    assert.deepEqual(r.held, GOOD, 'a later change is not saved over it either');
  });
}

for (const [name, record] of [
  ['a version this build does not know', { version: 3, workspaces: GOOD.workspaces, current: 'b', future: true }],
  ['something that is not a record', 'text'],
  ['a record whose workspaces are not a list', { version: 1, workspaces: 'x', current: null }],
] as const) {
  test(`${name} is left alone and reported`, async () => {
    for (const sideBySide of [false, true]) {
      const r = await run(record, async (h) => h, { sideBySide });
      assert.deepEqual(r.held, record);
      assert.equal(r.saves.length, 0);
      assert.equal(r.errors.length, 1);
      assert.deepEqual(r.c.workspaces.map((w) => w.id), ['default']);
      act(() => r.c.dispose());
    }
  });
}

test('one bad entry costs only that entry: the others are restored, the loss is reported, and the list is saved', async () => {
  const bad = { version: 1, workspaces: [GOOD.workspaces[0], { id: '', name: 'Half written' }, { id: 'x', name: 7 }, GOOD.workspaces[1], GOOD.workspaces[0], GOOD.workspaces[2]], current: 'b' };
  const r = await run(bad, async (h) => h);
  assert.deepEqual((r.held as ColumnState).workspaces.map((w) => w.name), ['Research', 'Trip food', 'Taxes', 'Space 1']);
  assert.equal(r.c.workspaces[r.c.current]!.id, 'b');
  assert.equal(r.errors.length, 1, 'the dropped entries are reported once');
});

// ---------------------------------------------------------------------------
// What an older build reads

/** The reader of 0.2.0-rc.8: version 1 exactly, a list of well formed workspaces, a string or null current; keys it does not know are not looked at. */
function readsLikeRc8(v: unknown): ColumnState | null {
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;
  if (s.version !== 1 || !Array.isArray(s.workspaces)) return null;
  if (s.current !== null && typeof s.current !== 'string') return null;
  const seen = new Set<string>();
  const ok = s.workspaces.every((w) => {
    if (typeof w !== 'object' || w === null) return false;
    const { id, name } = w as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return ok ? (v as ColumnState) : null;
}

test('a side-by-side column writes a record that rc.8 reads, with its side as an extra key', async () => {
  const r = await run(null, async (h) => h, { sideBySide: true });
  r.c.addWorkspace({ id: 'two', name: 'Two' });
  assert.equal(r.c.showSide(1).ok, true);
  await act(() => new Promise<void>((res) => setTimeout(res, 20)));
  const held = r.held as ColumnState;
  assert.equal(held.version, 1);
  assert.deepEqual(held.side?.shown, ['default', 'two']);
  assert.deepEqual(readsLikeRc8(held)?.workspaces.map((w) => w.name), ['Space 1', 'Two']);
});

test('a record of version 2, written by an earlier release, is still read with its side', async () => {
  const two = [{ id: 'a', name: 'Research' }, { id: 'b', name: 'Trip food' }];
  const r = await run({ version: 2, workspaces: two, current: 'b', side: { shown: ['a', 'b'], split: [2, 4] } }, async (h) => h, { sideBySide: true });
  assert.deepEqual(r.c.workspaces.map((w) => w.id), ['a', 'b', 'default']);
  assert.deepEqual(r.c.shown.map((s) => s.workspace.id).slice(0, 2), ['a', 'b']);
});
