/**
 * configureTuning needs no mounted row: before the first load it stores the patch where the load reads it, and only a disposed
 * workspace refuses. The column version reaches every workspace, those added later and the column's own tuning.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, createWorkspaceColumn, definePanel } from '../index.js';
import type { ColumnState, ColumnStorage, WorkspaceColumnHandle, WorkspaceHandle } from '../index.js';
import { rigCleanup, until } from './support/auto-rig.js';

const view = () => React.createElement('i');
const tpl = definePanel({ id: 'a', view });
const live: WorkspaceHandle[] = [];
const columns: WorkspaceColumnHandle[] = [];
afterEach(() => {
  for (const w of live.splice(0)) w.dispose();
  for (const c of columns.splice(0)) act(() => c.dispose());
  rigCleanup();
});
const workspace = (): WorkspaceHandle => {
  const w = createWorkspace({ templates: [tpl], mount: false });
  live.push(w);
  return w;
};
const column = (o: Parameters<typeof createWorkspaceColumn>[0] = {}): WorkspaceColumnHandle => {
  const c = createWorkspaceColumn({ templates: [tpl], mount: false, ...o });
  columns.push(c);
  return c;
};

test('a workspace that is not attached to a row accepts a tuning change and resolves it', () => {
  const w = workspace();
  assert.equal(w.status, 'detached');
  const result = w.panels.configureTuning({ hopFraction: 0.25 });
  assert.equal(result.ok, true);
  assert.equal(w.tuning.hopFraction, 0.25);
  assert.equal((w.panels.configureTuning({ hopFraction: 0.25 }) as { changed: boolean }).changed, false, 'the same value again changes nothing');
});

test('a rowGap change before the first load is applied without a row to reprice', () => {
  const w = workspace();
  assert.equal(w.panels.configureTuning({ rowGap: 32 }).ok, true);
  assert.equal(w.tuning.rowGap, 32);
});

test('a bad value still throws invalid-settings before the load', () => {
  const w = workspace();
  assert.throws(() => w.panels.configureTuning({ hopFraction: 'x' } as never), { code: 'invalid-settings' });
});

test('a disposed workspace still refuses', () => {
  const w = workspace();
  w.dispose();
  const r = w.panels.configureTuning({ hopFraction: 0.25 });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'disposed');
});

test('column.configureTuning reaches the workspaces already in the column and the ones added later', () => {
  const c = column();
  const first = c.addWorkspace();
  assert.equal(c.configureTuning({ hopFraction: 0.25 }).ok, true);
  const later = c.addWorkspace();
  assert.equal(first.tuning.hopFraction, 0.25);
  assert.equal(later.tuning.hopFraction, 0.25, 'a workspace added after the change starts from it');
});

test('column.configureTuning works while the saved list is still loading, and null takes a leaf back', async () => {
  let release: ((s: ColumnState | null) => void) | undefined;
  const storage: ColumnStorage = { load: () => new Promise((r) => (release = r)), save: () => undefined };
  const c = column({ storage });
  const early = c.addWorkspace({ id: 'early' });
  assert.equal(c.status, 'loading');
  assert.equal(c.configureTuning({ rowGap: 40 }).ok, true);
  assert.equal(early.tuning.rowGap, 40);
  await until('load asked', () => release !== undefined);
  release!({ version: 1, workspaces: [{ id: 'early', name: 'Early' }, { id: 'saved', name: 'Saved' }], current: 'early' });
  await until('ready', () => c.status === 'ready');
  const saved = c.workspaces.find((w) => w.id === 'saved')!;
  assert.equal(saved.tuning.rowGap, 40, 'a workspace rebuilt from the saved list starts from the column tuning');
  assert.equal(c.configureTuning({ rowGap: null }).ok, true);
  assert.equal(early.tuning.rowGap, 16);
  assert.equal(saved.tuning.rowGap, 16);
});

test('a disposed column refuses', () => {
  const c = column();
  c.addWorkspace();
  act(() => c.dispose());
  const r = c.configureTuning({ hopFraction: 0.25 });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, 'disposed');
});
