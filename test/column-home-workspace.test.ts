/**
 * `homeWorkspace` names a workspace that is always first: it cannot be removed or moved, and nothing is added or moved ahead of
 * it. Without the option the first workspace is like any other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceColumn, type ColumnState } from '../index.js';

const ids = (c: ReturnType<typeof createWorkspaceColumn>) => c.workspaces.map((w) => w.id);
const withHome = () => {
  const c = createWorkspaceColumn({ mount: false, homeWorkspace: 'home' });
  const home = c.addWorkspace({ id: 'home' });
  const a = c.addWorkspace({ id: 'a' });
  const b = c.addWorkspace({ id: 'b' });
  return { c, home, a, b };
};

test('the home workspace cannot be removed, by handle or by index, and the others still can', () => {
  const { c, home, a } = withHome();
  assert.equal(c.removeWorkspace(home), false);
  assert.equal(c.removeWorkspace(0), false);
  c.scrollTo(home);
  assert.equal(c.removeWorkspace(home), false, 'not even while it is current');
  assert.deepEqual(ids(c), ['home', 'a', 'b']);
  assert.equal(home.status === 'disposed', false);
  assert.equal(c.removeWorkspace(a), true, 'control: another workspace is removed');
  assert.deepEqual(ids(c), ['home', 'b']);
});

test('the home workspace cannot be moved', () => {
  const { c, home } = withHome();
  const before = c.workspaces;
  assert.equal(c.reorderWorkspace(home, 2), false);
  assert.equal(c.reorderWorkspace(0, 1), false);
  assert.equal(c.workspaces, before, 'nothing changed');
});

test('nothing is moved or added ahead of the home workspace: an index of 0 lands at 1', () => {
  const { c, b } = withHome();
  assert.equal(c.reorderWorkspace(b, 0), true);
  assert.deepEqual(ids(c), ['home', 'b', 'a']);
  assert.equal(c.reorderWorkspace(b, -3), true);
  assert.deepEqual(ids(c), ['home', 'b', 'a']);
  c.addWorkspace({ id: 'x', index: 0 });
  assert.deepEqual(ids(c), ['home', 'x', 'b', 'a']);
});

test('the home workspace is put first wherever it is added', () => {
  const c = createWorkspaceColumn({ mount: false, homeWorkspace: 'home' });
  c.addWorkspace({ id: 'a' });
  c.addWorkspace({ id: 'b' });
  c.addWorkspace({ id: 'home', index: 2 });
  assert.deepEqual(ids(c), ['home', 'a', 'b']);
});

test('the home workspace is put first when the saved list is read', async () => {
  const saved: ColumnState = { version: 1, workspaces: [{ id: 'a', name: 'A' }, { id: 'home', name: 'Home' }, { id: 'b', name: 'B' }], current: 'b' };
  const c = createWorkspaceColumn({ mount: false, homeWorkspace: 'home', storage: { load: async () => saved, save: () => {} } });
  for (let k = 0; k < 20 && c.status !== 'ready'; k += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.status, 'ready');
  assert.deepEqual(ids(c), ['home', 'a', 'b']);
  assert.equal(c.workspaces[c.current]!.id, 'b', 'the saved current workspace stays current');
});

test('the last workspace is still refused, home or not', () => {
  const c = createWorkspaceColumn({ mount: false, homeWorkspace: 'home' });
  const only = c.addWorkspace({ id: 'other' });
  assert.equal(c.removeWorkspace(only), false);
});

test('off by default: the first workspace is removed and moved like any other', () => {
  const c = createWorkspaceColumn({ mount: false });
  const first = c.addWorkspace({ id: 'home' });
  c.addWorkspace({ id: 'a' });
  c.addWorkspace({ id: 'b' });
  assert.equal(c.reorderWorkspace(first, 2), true);
  assert.deepEqual(ids(c), ['a', 'b', 'home']);
  c.addWorkspace({ id: 'x', index: 0 });
  assert.deepEqual(ids(c), ['x', 'a', 'b', 'home']);
  assert.equal(c.removeWorkspace(first), true);
});
