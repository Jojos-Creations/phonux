/**
 * What a workspace remembers between launches: a closed `afterClose: 'stay-closed'` panel stays closed through a
 * tombstone in the saved file, a `return-next-launch` one comes back, and every path that removes a panel from the
 * list without the person choosing it leaves the tombstones alone. Two launches share one `memoryWorkspaceStorage`.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace } from '../index.js';
import type { PanelTemplate, WorkspaceHandle } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { DISMISSED_LIMIT } from '../workspaceState.js';
import { cleanup } from './support/mount-harness.js';
import { differential, differentialsCovered } from './support/differential.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import type { MountedWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const QUICK = { tuning: { saveQuietMs: 5 } };
const settle = async (): Promise<void> => {
  await flush();
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
};

interface Launch {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
}

/** One launch: a fresh workspace over `store` with `templates` all added, mounted and restored. */
async function launch(store: ReturnType<typeof memoryWorkspaceStorage>, templates: PanelTemplate[]): Promise<Launch> {
  const ws = createWorkspace({ templates, storage: store });
  for (const t of templates) ws.addPanel(t, t.settings?.multiple === true ? { id: `${t.id}-1` } : undefined);
  const m = mountWorkspace(ws, { over: QUICK });
  await flush();
  return { ws, m };
}

const engineId = (ws: WorkspaceHandle, id: string): string => ws.panels.get(id)!.getState().engineId!;
const live = (ws: WorkspaceHandle): string[] => ws.panels.getSnapshot().panels.filter((p) => p.status === 'live').map((p) => p.id);

test('stay-closed: a panel the person closed is not created at the next launch', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('tomb-a');
  const b = markerTemplate('tomb-b');
  const first = await launch(store, [a, b]);
  assert.deepEqual(live(first.ws), ['tomb-a', 'tomb-b']);
  act(() => first.m.latest().close(engineId(first.ws, 'tomb-a')));
  await settle();
  first.m.unmount();
  cleanup();
  const second = await launch(store, [a, b]);
  assert.deepEqual(live(second.ws), ['tomb-b']);
  assert.equal(second.ws.panels.get('tomb-a')?.getState().status, 'closed');
});

test('return-next-launch: a closed panel is created again at the next launch', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('ret-a', { settings: { afterClose: 'return-next-launch' } });
  const first = await launch(store, [a]);
  act(() => first.m.latest().close(engineId(first.ws, 'ret-a')));
  await settle();
  first.m.unmount();
  cleanup();
  const second = await launch(store, [a]);
  assert.deepEqual(live(second.ws), ['ret-a']);
});

test('the afterClose differential: the same close, run under each value, differs at the next launch', async () => {
  for (const value of ['stay-closed', 'return-next-launch'] as const) {
    const store = memoryWorkspaceStorage();
    const t = markerTemplate(`diff-${value}`, { settings: { afterClose: value } });
    const first = await launch(store, [t]);
    act(() => first.m.latest().close(engineId(first.ws, t.id)));
    await settle();
    first.m.unmount();
    cleanup();
    const second = await launch(store, [t]);
    outcomes.push([value, live(second.ws).length]);
  }
  differential('afterClose', (run) => {
    for (const [value, count] of outcomes) run(value, () => count);
  });
  assert.deepEqual(differentialsCovered().filter((n) => n === 'afterClose'), ['afterClose']);
});
const outcomes: Array<[string, number]> = [];

test('clearAll counts as a close for the stay-closed panels it removes', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('clr-a');
  const first = await launch(store, [a]);
  act(() => first.m.latest().clearAll());
  await settle();
  first.m.unmount();
  cleanup();
  const second = await launch(store, [a]);
  assert.deepEqual(live(second.ws), []);
});

test('undoing a close removes its tombstone', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('undo-a');
  const first = await launch(store, [a]);
  act(() => first.m.latest().close(engineId(first.ws, 'undo-a')));
  act(() => first.m.latest().undoClose());
  await settle();
  first.m.unmount();
  cleanup();
  const second = await launch(store, [a]);
  assert.deepEqual(live(second.ws), ['undo-a']);
  assert.deepEqual((await store.load())?.dismissed ?? [], []);
});

test('unmounting the workspace is not a mass close: nothing is dismissed', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('det-a');
  const b = markerTemplate('det-b');
  const first = await launch(store, [a, b]);
  await settle();
  first.m.unmount();
  cleanup();
  assert.deepEqual((await store.load())?.dismissed ?? [], []);
  const second = await launch(store, [a, b]);
  assert.deepEqual(live(second.ws), ['det-a', 'det-b']);
});

test('the tombstones are capped at the newest DISMISSED_LIMIT, dropping the oldest', async () => {
  const seeded = Array.from({ length: DISMISSED_LIMIT }, (_, i) => `old${i}`);
  const store = memoryWorkspaceStorage({ version: 1, panels: [], dismissed: seeded } as never);
  const t = markerTemplate('cap-t');
  const first = await launch(store, [t]);
  act(() => first.m.latest().close(engineId(first.ws, 'cap-t')));
  await settle();
  const saved = (await store.load())!.dismissed!;
  assert.equal(saved.length, DISMISSED_LIMIT);
  assert.equal(saved[DISMISSED_LIMIT - 1], 'cap-t', 'newest last');
  assert.equal(saved.includes('old0'), false, 'the oldest left');
  assert.equal(saved.includes('old1'), true);
});

test('a panel that is both saved and dismissed keeps its saved entry', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('both-a');
  const first = await launch(store, [a]);
  await settle();
  first.m.unmount();
  cleanup();
  const file = (await store.load())!;
  await store.save({ ...file, dismissed: ['both-a'] });
  const second = await launch(store, [a]);
  assert.deepEqual(live(second.ws), ['both-a']);
});

test('a template that is now closable false drops its tombstone', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('lock-a');
  const first = await launch(store, [a]);
  act(() => first.m.latest().close(engineId(first.ws, 'lock-a')));
  await settle();
  first.m.unmount();
  cleanup();
  const locked = markerTemplate('lock-a', { settings: { closable: false } });
  const second = await launch(store, [locked]);
  assert.deepEqual(live(second.ws), ['lock-a']);
  await settle();
  assert.equal((await store.load())?.dismissed?.includes('lock-a') ?? false, false);
});

test('a template registered after ready is created unless it is dismissed', async () => {
  const store = memoryWorkspaceStorage();
  const a = markerTemplate('late-a');
  const first = await launch(store, [a]);
  const late = markerTemplate('late-b');
  act(() => void first.ws.addPanel(late));
  await flush();
  assert.deepEqual(live(first.ws), ['late-a', 'late-b']);
});

test('registerTemplate over a placeholder turns a saved closable false entry into a template-built locked one', async () => {
  const store = memoryWorkspaceStorage({
    version: 1,
    panels: [{ id: 'old1', view: 'late-lock', url: '', live: true, anchor: { panel: '__root__', position: 'right', priority: 0 }, closable: false }],
  });
  const w = createWorkspace({ storage: store });
  const m = mountWorkspace(w);
  await flush();
  assert.equal(m.container.querySelector('[data-template="late-lock"]'), null, 'positive control: before registration it is a placeholder');
  assert.equal(m.latest().entries.find((p) => p.view === 'late-lock')?.locked, true);
  act(() => void w.registerTemplate(markerTemplate('late-lock', { settings: { closable: false } })));
  await flush();
  assert.ok(m.container.querySelector('[data-template="late-lock"]'), 'the template view now renders');
  assert.equal(m.latest().entries.find((p) => p.view === 'late-lock')?.locked, true);
  assert.equal(w.panels.get('late-lock')?.getState().status, 'live');
});

test('hostCreatable, multiple and maxInstances hold on late registration and an over-limit addPanel does not throw', async () => {
  const w = createWorkspace();
  const m = mountWorkspace(w);
  await flush();
  const t = markerTemplate('late-cap', { settings: { multiple: true, maxInstances: 1 } });
  act(() => void w.registerTemplate(t));
  let a: ReturnType<typeof w.addPanel> | undefined;
  let b: ReturnType<typeof w.addPanel> | undefined;
  act(() => void (a = w.addPanel(t)));
  assert.doesNotThrow(() => act(() => void (b = w.addPanel(t))));
  assert.equal(a!.getState().status, 'live');
  assert.equal(b!.getState().status, 'closed');
  act(() => m.latest().create({ view: 'late-cap' }));
  assert.equal(m.latest().entries.filter((p) => p.view === 'late-cap').length, 1, 'the Host-bag create also holds the limit');
});
