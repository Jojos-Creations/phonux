/**
 * `reorderWorkspace` moves a workspace to another index and saves the new order. The current workspace stays the same workspace at
 * its new index; a stranger, a non-whole index and a column still reading its saved list are refused with nothing changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceColumn, type ColumnState } from '../index.js';

const three = () => {
  const c = createWorkspaceColumn({ mount: false });
  const a = c.addWorkspace({ id: 'a' });
  const b = c.addWorkspace({ id: 'b' });
  const d = c.addWorkspace({ id: 'd' });
  return { c, a, b, d };
};
const ids = (c: ReturnType<typeof createWorkspaceColumn>) => c.workspaces.map((w) => w.id);

test('moving a workspace down closes the gap and keeps the current workspace', () => {
  const { c, a, b } = three();
  c.scrollTo(b);
  assert.equal(c.reorderWorkspace(a, 2), true);
  assert.deepEqual(ids(c), ['b', 'd', 'a']);
  assert.equal(c.workspaces[c.current], b);
  assert.equal(c.current, 0);
});

test('moving the current workspace up keeps it current at its new index', () => {
  const { c, d } = three();
  c.scrollTo(d);
  assert.equal(c.reorderWorkspace(2, 0), true);
  assert.deepEqual(ids(c), ['d', 'a', 'b']);
  assert.equal(c.current, 0);
  assert.equal(c.workspaces[c.current], d);
});

test('an index past either end is clamped, and the list is a new array', () => {
  const { c, a } = three();
  const before = c.workspaces;
  assert.equal(c.reorderWorkspace(a, 99), true);
  assert.deepEqual(ids(c), ['b', 'd', 'a']);
  assert.notEqual(c.workspaces, before);
  assert.equal(c.reorderWorkspace(a, -5), true);
  assert.deepEqual(ids(c), ['a', 'b', 'd']);
});

test('a stranger, an out-of-range source and a non-whole index change nothing', () => {
  const { c, a } = three();
  const stranger = createWorkspaceColumn({ mount: false }).addWorkspace({ id: 'x' });
  const before = c.workspaces;
  assert.equal(c.reorderWorkspace(stranger, 0), false);
  assert.equal(c.reorderWorkspace(7, 0), false);
  assert.equal(c.reorderWorkspace(a, 1.5), false);
  assert.equal(c.reorderWorkspace(a, Number.NaN), false);
  assert.equal(c.workspaces, before);
});

test('the new order is saved with the same current workspace', async () => {
  const saves: ColumnState[] = [];
  const c = createWorkspaceColumn({
    mount: false,
    storage: { load: async () => ({ version: 1, workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'd', name: 'D' }], current: 'b' }), save: (s) => void saves.push(s) },
  });
  assert.equal(c.reorderWorkspace(0, 2), false, 'refused while the saved list is read');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(c.status, 'ready');
  saves.length = 0;
  assert.equal(c.reorderWorkspace(0, 2), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saves.at(-1), { version: 1, workspaces: [{ id: 'b', name: 'B' }, { id: 'd', name: 'D' }, { id: 'a', name: 'A' }], current: 'b' });
});

test('a disposed column refuses', () => {
  const { c, a } = three();
  c.dispose();
  assert.equal(c.reorderWorkspace(a, 1), false);
});
