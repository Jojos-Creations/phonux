/**
 * A saved workspace carries no counter id: relaunching and saving again leaves every unchanged panel's saved bytes as
 * they were, and a file that still holds counter ids restores.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace, type WorkspaceHandle, type WorkspacePanelState, type WorkspaceState } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { cleanup } from './support/mount-harness.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { hydrateWorkspaceState, isWorkspaceState, projectWorkspaceState } from '../workspaceState.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { settle } from './support/workspace-launch.js';

afterEach(cleanup);

const root = markerTemplate('history');
const inbox = markerTemplate('inbox');
const page = markerTemplate('page', { settings: { multiple: true } });

function open(storage: ReturnType<typeof memoryWorkspaceStorage>): WorkspaceHandle {
  const ws = createWorkspace({ mount: false, root, templates: [inbox, page], storage, tuning: { saveQuietMs: 5 } });
  mountWorkspace(ws);
  return ws;
}

const byKey = (state: WorkspaceState): Map<string | undefined, WorkspacePanelState> => new Map(state.panels.map((p) => [p.key, p]));

test('a relaunch and one more change rewrites no unchanged panel', async () => {
  const storage = memoryWorkspaceStorage();
  const first = open(storage);
  await flush();
  act(() => void first.addPanel(inbox));
  for (const id of ['p1', 'p2', 'p3']) act(() => void first.addPanel(page, { id }));
  act(() => void first.panels.get('p2')?.close());
  await settle();
  const before = storage.saved!;
  assert.deepEqual(before.panels.map((p) => p.key), ['inbox', 'p1', 'p3'], 'control: the first launch saved three panels');

  const second = open(storage);
  await flush();
  await settle();
  act(() => void second.addPanel(page, { id: 'p9' }));
  await settle();
  const after = storage.saved!;
  assert.deepEqual(after.panels.map((p) => p.key), ['inbox', 'p1', 'p3', 'p9'], 'control: the second launch saved its change');

  const held = byKey(before);
  for (const p of after.panels) {
    if (p.key === 'p9') continue;
    assert.equal(JSON.stringify(p), JSON.stringify(held.get(p.key)), `panel ${p.key} was rewritten`);
  }
});

const ROOT = 'history';
const UID_A = 'u_0000000000000000000000000000000a';
const UID_B = 'u_0000000000000000000000000000000b';
const entry = (over: Partial<WorkspacePanelState>): WorkspacePanelState => ({ view: 'web', url: '', live: true, anchor: { panel: ROOT, position: 'right', priority: 0 }, ...over });
const counting = (): (() => string) => {
  let n = 100;
  return () => String((n += 1));
};

test('the projection of a restored list equals the file it came from, anchors between panels included', () => {
  const [a, b] = appendPanel(appendPanel([], { view: 'web' }, '1', ROOT, UID_A), { view: 'web' }, '2', ROOT, UID_B);
  const file = projectWorkspaceState([createHistoryPanel(ROOT), { ...b!, anchor: { panel: '1', position: 'left', priority: 0 } }, a!], ROOT);
  assert.equal(file.panels[0]!.anchor.panel, UID_A, 'control: the second panel anchors to the first by its uid');
  const restored = hydrateWorkspaceState(file, counting(), ROOT);
  assert.equal(restored.find((p) => p.uid === UID_B)!.anchor?.panel, restored.find((p) => p.uid === UID_A)!.id, 'the anchor reaches the first panel under its new runtime id');
  assert.equal(JSON.stringify(projectWorkspaceState([createHistoryPanel(ROOT), ...restored], ROOT)), JSON.stringify(file));
});

test('a file that still holds counter ids restores, their anchors are followed, and the next projection drops them', () => {
  const old: WorkspaceState = {
    version: 1,
    panels: [entry({ id: '4', uid: UID_A }), entry({ id: '9', uid: UID_B, anchor: { panel: '4', position: 'left', priority: 2 } }), entry({ id: '2', title: 'no uid' })],
  };
  assert.equal(isWorkspaceState(old), true);
  const restored = hydrateWorkspaceState(old, counting(), ROOT);
  const first = restored.find((p) => p.uid === UID_A)!;
  assert.equal(restored.find((p) => p.uid === UID_B)!.anchor?.panel, first.id, 'the anchor named the counter id 4 and now reaches the first panel');
  const again = projectWorkspaceState([createHistoryPanel(ROOT), ...restored], ROOT);
  assert.ok(again.panels.every((p) => !('id' in p)), 'no entry carries an id');
  assert.equal(again.panels.find((p) => p.uid === UID_B)!.anchor.panel, UID_A, 'the anchor names the first panel by its uid');
});

test('in a file with counter ids, an anchor naming a counter id that is another entry\'s key reaches the entry with that id', () => {
  const file: WorkspaceState = { version: 1, panels: [entry({ id: 'x', key: 'k' }), entry({ id: 'k' }), entry({ id: 'z', anchor: { panel: 'k', position: 'left', priority: 0 } })] };
  const restored = hydrateWorkspaceState(file, counting(), ROOT);
  assert.equal(restored.find((p) => p.anchor?.position === 'left')!.anchor?.panel, '102', 'the second entry was drawn the id 102');
});

test('an entry with no id is a well-formed file entry; two entries holding one id are not', () => {
  assert.equal(isWorkspaceState({ version: 1, panels: [entry({ uid: UID_A }), entry({ uid: UID_B })] }), true);
  assert.equal(isWorkspaceState({ version: 1, panels: [entry({ id: '1' }), entry({ id: '1' })] }), false);
});
