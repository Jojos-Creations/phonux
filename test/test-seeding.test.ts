/**
 * seedWorkspace from phonux/testing: a workspace that restores the seeded panels under their ids with their hostData and
 * visibility, and keeps them through a snapshot, a save, and a close and undo.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import { createWorkspace, type JsonValue } from '../index.js';
import { seedWorkspace, type PanelSeed } from '../fakeHost.js';
import { slotsOf } from '../panelWindow.js';
import { cleanup } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(cleanup);

const VIEW = 'seeded';
const seeds: PanelSeed[] = [
  { id: 'live1', view: VIEW, hostData: { sourceWebContentsId: 1, webContentsId: 55 }, live: true, url: 'https://live1.example', title: 'Live one' },
  { id: 'parked1', view: VIEW, hostData: { sourceWebContentsId: 2, webContentsId: 66 }, live: false, url: 'https://parked1.example' },
];

async function launch(over: Parameters<typeof mountWorkspace>[1] = {}) {
  const seeded = seedWorkspace(seeds);
  const ws = createWorkspace({ mount: false, ...seeded, templates: [markerTemplate(VIEW)], tuning: { saveQuietMs: 5 } });
  const m = mountWorkspace(ws, { over: { ...seeded.panels, ...over.over } });
  await flush();
  return { ws, m, seeded };
}

const hostDataOf = (m: Awaited<ReturnType<typeof launch>>['m']): Record<string, JsonValue | undefined> =>
  Object.fromEntries(m.latest().entries.map((p) => [p.id, p.hostData]));

test('seeded panels restore under their ids, in the given order, with their hostData', async () => {
  const { m } = await launch();
  assert.deepEqual(m.latest().entries.map((p) => p.id).slice(-2), ['live1', 'parked1']);
  assert.deepEqual(hostDataOf(m).live1, { sourceWebContentsId: 1, webContentsId: 55 });
  assert.deepEqual(hostDataOf(m).parked1, { sourceWebContentsId: 2, webContentsId: 66 });
});

test('the workspace snapshot reports each seed as live or parked as seeded, with its url and title', async () => {
  const { ws } = await launch();
  const byId = new Map(ws.panels.getSnapshot().panels.map((p) => [p.id, p]));
  assert.equal(byId.size, 2);
  const states = [...byId.values()];
  assert.deepEqual(states.map((p) => p.status), ['live', 'parked']);
  assert.deepEqual(states.map((p) => p.url), ['https://live1.example', 'https://parked1.example']);
  assert.equal(states[0]!.title, 'Live one');
});

test('the saved file still holds a seed parked, under its seeded id, after another closes', async () => {
  const { seeded, m } = await launch();
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  await act(async () => m.latest().close('live1'));
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  assert.deepEqual(seeded.storage.saved?.panels.map((p) => [p.id, p.live]), [['parked1', false]]);
});

test('a live and a parked seed close and undo with the hostData they were seeded with, handed to resetHostDataOnRestore', async () => {
  const seen: Array<[JsonValue | undefined, string]> = [];
  const { m } = await launch({
    over: {
      resetHostDataOnRestore: (hostData, panel) => {
        seen.push([hostData, panel.id]);
        return { ...(hostData as Record<string, JsonValue>), webContentsId: null };
      },
    },
  });
  await act(async () => m.latest().close('live1'));
  await act(async () => m.latest().close('parked1'));
  assert.equal(m.latest().entries.some((p) => p.id === 'live1' || p.id === 'parked1'), false, 'control: both closed');
  await act(async () => m.latest().undoClose());
  assert.deepEqual(seen.map(([data, id]) => [id, data]).sort(), [
    ['live1', { sourceWebContentsId: 1, webContentsId: 55 }],
    ['parked1', { sourceWebContentsId: 2, webContentsId: 66 }],
  ]);
  assert.deepEqual(hostDataOf(m).live1, { sourceWebContentsId: 1, webContentsId: null });
  assert.deepEqual(hostDataOf(m).parked1, { sourceWebContentsId: 2, webContentsId: null });
});

test('seedWorkspace refuses two seeds with one id, and draws ids past the seeds afterwards', () => {
  assert.throws(() => seedWorkspace([seeds[0]!, seeds[0]!]), /share an id/);
  const { newId } = seedWorkspace([{ ...seeds[0]!, id: '1' }]);
  assert.deepEqual([newId(), newId(), newId()], ['1', '2', '3']);
});

test('a seeded slot count sets the panel size and a seeded permanent column restores live and not parkable', async () => {
  const wide: PanelSeed = { id: 'wide', view: VIEW, hostData: 'w', live: true, slots: 2 };
  const column: PanelSeed = { id: 'column', view: VIEW, hostData: 'c', live: false, permanent: true };
  const seeded = seedWorkspace([wide, column]);
  const ws = createWorkspace({ mount: false, ...seeded, templates: [markerTemplate(VIEW)] });
  const m = mountWorkspace(ws, { over: { ...seeded.panels } });
  await flush();
  const byId = new Map(m.latest().entries.map((p) => [p.id, p]));
  assert.equal(slotsOf(byId.get('wide')!), 2);
  assert.equal(slotsOf(byId.get('column')!), 1);
  assert.equal(byId.get('column')!.collapsible, false);
  assert.equal(byId.get('column')!.live, true, 'a permanent column is never parked');
  assert.deepEqual([byId.get('wide')!.hostData, byId.get('column')!.hostData], ['w', 'c']);
});

test('left seeds restore left of the root in the order given, at their slot counts, and the right seed stays right', async () => {
  const left = (id: string, slots: number): PanelSeed => ({ id, view: VIEW, hostData: id, live: true, slots, side: 'left' });
  const seeded = seedWorkspace([left('l1', 2), left('l2', 3), { id: 'r1', view: VIEW, hostData: 'r', live: true }]);
  const ws = createWorkspace({ mount: false, ...seeded, templates: [markerTemplate(VIEW)], tuning: { saveQuietMs: 5 } });
  const m = mountWorkspace(ws, { over: { ...seeded.panels } });
  await flush();
  const entries = m.latest().entries;
  assert.deepEqual(entries.map((p) => p.id), ['l1', 'l2', ws.rootId, 'r1']);
  assert.deepEqual(entries.filter((p) => p.id !== ws.rootId).map(slotsOf), [2, 3, 1]);
  assert.deepEqual(ws.panels.getSnapshot().panels.map((p) => p.id), ['l1', 'l2', 'r1']);
  await act(async () => m.latest().close('l1'));
  await act(async () => m.latest().undoClose());
  assert.deepEqual(m.latest().entries.map((p) => p.id), ['l1', 'l2', ws.rootId, 'r1'], 'a left seed returns to its place after close and undo');
  await act(async () => m.latest().close('r1'));
  await act(async () => void (await new Promise((r) => setTimeout(r, 60))));
  assert.deepEqual(seeded.storage.saved?.panels.map((p) => [p.id, p.anchor.position, p.slots]), [['l1', 'left', 2], ['l2', 'left', 3]]);
});

test('a panel added to the live workspace takes the chosen engine id, and its instance key stays the one addPanel was given', async () => {
  const seeded = seedWorkspace(seeds, undefined, ['again', 'and-again']);
  const ws = createWorkspace({ mount: false, ...seeded, templates: [markerTemplate(VIEW, { settings: { multiple: true } })] });
  mountWorkspace(ws, { over: { ...seeded.panels } });
  await flush();
  await act(async () => void ws.addPanel(VIEW, { id: 'key1' }));
  await act(async () => void ws.addPanel(VIEW));
  assert.equal(ws.panels.get('key1')?.getState().engineId, 'again');
  assert.deepEqual(ws.panels.getSnapshot().panels.map((p) => p.engineId).slice(-2), ['again', 'and-again']);
  assert.throws(() => seedWorkspace(seeds, undefined, ['live1']), /given twice/);
});
