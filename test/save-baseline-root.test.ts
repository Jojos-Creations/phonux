/**
 * Opening a workspace that has a root template changes nothing, so nothing is saved: the restore baseline and the save
 * projection must agree about the root.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace, type WorkspaceState, type WorkspaceStorage } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { settle } from './support/workspace-launch.js';

afterEach(cleanup);

const rootTemplate = markerTemplate('history');
const page = markerTemplate('page', { settings: { multiple: true } });

function recordingStorage(initial: WorkspaceState | null): WorkspaceStorage & { saves: WorkspaceState[] } {
  const saves: WorkspaceState[] = [];
  return { saves, load: async () => initial, save: (state) => void saves.push(structuredClone(state)) };
}

test('opening with nothing saved and a root template saves nothing', async () => {
  const storage = recordingStorage(null);
  const ws = createWorkspace({ mount: false, root: rootTemplate, templates: [page], storage, tuning: { saveQuietMs: 5 } });
  mountWorkspace(ws);
  await flush();
  await settle();
  assert.deepEqual(storage.saves, []);
});

test('opening a restored file with a root template saves nothing', async () => {
  const storage = recordingStorage({ version: 1, panels: [{ id: 'a', uid: 'u_00000000000000000000000000000001', key: 'page~a', instance: {}, overrides: {}, applied: { placeOnAdd: 'row-end' }, view: 'page', live: true, anchor: { panel: 'history', position: 'right', priority: 0 } }], root: 'history' });
  const ws = createWorkspace({ mount: false, root: rootTemplate, templates: [page], storage, tuning: { saveQuietMs: 5 } });
  mountWorkspace(ws);
  await flush();
  await settle();
  assert.deepEqual(storage.saves, []);
});

test('opening a file whose root was saved two slots wide saves nothing', async () => {
  const storage = recordingStorage({ version: 1, panels: [], root: 'history', rootSlots: 2 });
  const ws = createWorkspace({ mount: false, root: rootTemplate, templates: [page], storage, tuning: { saveQuietMs: 5 } });
  const m = mountWorkspace(ws);
  await flush();
  await settle();
  assert.equal(m.latest().entries.find((p) => p.id === ws.rootId)?.slots, 2, 'control: the root restored at two slots');
  assert.deepEqual(storage.saves, []);
});

test('a change after open still saves once, with the root', async () => {
  const storage = recordingStorage(null);
  const ws = createWorkspace({ mount: false, root: rootTemplate, templates: [page], storage, tuning: { saveQuietMs: 5 } });
  mountWorkspace(ws);
  await flush();
  await act(async () => void ws.addPanel('page', { id: 'p1' }));
  await settle();
  assert.equal(storage.saves.length, 1);
  assert.equal(storage.saves[0]!.root, 'history');
  assert.deepEqual(storage.saves[0]!.panels.map((p) => p.key), ['p1']);
});
