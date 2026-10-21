/**
 * `removeWorkspace` takes a workspace out of the column and disposes it. The current workspace moves to the one below, or the one
 * above at the end; the last workspace, a stranger and a column still reading its saved list are refused with nothing changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceColumn } from '../index.js';

const three = () => {
  const c = createWorkspaceColumn({ mount: false });
  const a = c.addWorkspace({ id: 'a' });
  const b = c.addWorkspace({ id: 'b' });
  const d = c.addWorkspace({ id: 'd' });
  return { c, a, b, d };
};

test('removing a workspace above the current one keeps the current workspace', () => {
  const { c, a, d } = three();
  c.scrollTo(2);
  assert.equal(c.removeWorkspace(a), true);
  assert.deepEqual(c.workspaces.map((w) => w.id), ['b', 'd']);
  assert.equal(c.current, 1);
  assert.equal(c.workspaces[c.current], d);
  assert.equal(a.status, 'disposed');
});

test('removing the current workspace moves to the one below it', () => {
  const { c, b, d } = three();
  c.scrollTo(1);
  assert.equal(c.removeWorkspace(b), true);
  assert.deepEqual(c.workspaces.map((w) => w.id), ['a', 'd']);
  assert.equal(c.workspaces[c.current], d);
});

test('removing the last workspace in the column moves to the one above it', () => {
  const { c, a, d } = three();
  c.scrollTo(2);
  assert.equal(c.removeWorkspace(2), true);
  assert.deepEqual(c.workspaces.map((w) => w.id), ['a', 'b']);
  assert.equal(c.workspaces[c.current], c.workspaces[1]);
  assert.equal(d.status, 'disposed');
  assert.notEqual(a.status, 'disposed');
});

test('the last workspace in the column is kept', () => {
  const c = createWorkspaceColumn({ mount: false });
  const only = c.addWorkspace({ id: 'only' });
  assert.equal(c.removeWorkspace(only), false);
  assert.deepEqual(c.workspaces.map((w) => w.id), ['only']);
  assert.notEqual(only.status, 'disposed');
});

test('a handle outside the column or an index out of range changes nothing', () => {
  const { c } = three();
  const stranger = createWorkspaceColumn({ mount: false }).addWorkspace({ id: 'x' });
  assert.equal(c.removeWorkspace(stranger), false);
  assert.equal(c.removeWorkspace(9), false);
  assert.equal(c.removeWorkspace(-1), false);
  assert.equal(c.workspaces.length, 3);
});

test('a disposed column refuses removal', () => {
  const { c, a } = three();
  c.dispose();
  assert.equal(c.removeWorkspace(a), false);
});
