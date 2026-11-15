/**
 * An addPanel made while the attached row is still loading its saved file (workspace.status === 'loading') waits and is
 * applied once the row is ready, as the same add made after ready would be. Before, it became a declaration replayed at
 * the settle, so a panel the file had closed before stayed closed with no signal. A row that leaves before it is ready
 * keeps the add as a declaration for the next attach.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace } from '../index.js';
import type { WorkspaceHandle, WorkspaceState, WorkspaceStorage } from '../index.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

/** A saved file in which the person had closed `closed`. */
const fileClosing = (closed: string): WorkspaceState => ({ version: 1, panels: [], dismissed: [closed] }) as WorkspaceState;

/** A storage whose load waits until `release` is called. */
function heldStorage(): WorkspaceStorage & { release: (v: WorkspaceState | null) => void } {
  let release: (v: WorkspaceState | null) => void = () => {};
  const loaded = new Promise<WorkspaceState | null>((r) => void (release = r));
  return { load: () => loaded, save: () => {}, release: (v) => release(v) };
}

const statuses = (w: WorkspaceHandle): string => JSON.stringify(w.panels.getSnapshot().panels.map((p) => [p.id, p.status]));

for (const when of ['while loading', 'after ready'] as const) {
  test(`AL1 an add ${when} of a panel the file had closed opens it, live and drawn`, async () => {
    const storage = heldStorage();
    const t = markerTemplate('al-a');
    const w = createWorkspace({ mount: false, storage, templates: [t] });
    const m = mountWorkspace(w);
    assert.equal(w.status, 'loading', 'control: the load is pending');
    if (when === 'while loading') {
      act(() => void w.addPanel(t));
      assert.equal(statuses(w), '[["al-a","pending"]]', 'the waiting add reads as pending');
    }
    storage.release(fileClosing('al-a'));
    await flush();
    assert.equal(w.status, 'ready');
    if (when === 'after ready') act(() => void w.addPanel(t));
    await flush();
    assert.equal(statuses(w), '[["al-a","live"]]');
    assert.equal(m.slots().length, 1, 'the panel is drawn');
  });
}

test('AL2 an add while loading of a panel the file holds finds that panel, and opens no second one', async () => {
  const storage = heldStorage();
  const t = markerTemplate('al-b');
  const w = createWorkspace({ mount: false, storage, templates: [t] });
  const m = mountWorkspace(w);
  act(() => void w.addPanel(t));
  storage.release({ version: 1, panels: [{ id: 'p1', view: 'al-b', key: 'al-b', url: '', title: '', live: true }] } as unknown as WorkspaceState);
  await flush();
  assert.equal(statuses(w), '[["al-b","live"]]');
  assert.equal(m.slots().length, 1);
});

test('AL3 a row that leaves before it is ready keeps the add, and the next attach declares it', async () => {
  const storage = heldStorage();
  const t = markerTemplate('al-c');
  const w = createWorkspace({ mount: false, storage, templates: [t] });
  const first = mountWorkspace(w);
  act(() => void w.addPanel(t));
  act(() => first.unmount());
  assert.equal(w.status, 'detached');
  assert.equal(statuses(w), '[["al-c","pending"]]', 'still owed');
  cleanup();
  const again = mountWorkspace(w);
  storage.release(null);
  await flush();
  assert.equal(w.status, 'ready');
  assert.equal(statuses(w), '[["al-c","live"]]');
  assert.equal(again.slots().length, 1);
});

test('AL4 an add before the row attaches is still a declaration: created at the restore, the file\'s tombstone kept', async () => {
  const storage = heldStorage();
  const t = markerTemplate('al-d');
  const w = createWorkspace({ mount: false, storage, templates: [t] });
  w.addPanel(t);
  assert.equal(w.status, 'detached');
  mountWorkspace(w);
  storage.release(fileClosing('al-d'));
  await flush();
  assert.equal(statuses(w), '[["al-d","closed"]]', 'a declaration the person closed stays closed');
});
