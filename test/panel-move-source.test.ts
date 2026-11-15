/**
 * `panels.subscribeMoves` reports every completed move or place with the panel's id and its source: a host call for the person or for
 * code, a drag released in the row (the release `usePanelDragProps` hands the grab handle) and the grab handle's arrow keys, each after
 * the snapshot that shows the change. The drag calls the release directly: a pointer drag through dnd-kit does not reorder a mounted
 * workspace row under jsdom on this branch (default-frame's own sideways-drag test fails the same way).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import * as React from 'react';
import { createWorkspace, definePanel, usePanelDragProps } from '../index.js';
import type { PanelMove, PanelTemplate, WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { flush, mountWorkspace, type MountedWorkspace } from './support/workspace-row.js';
import { pinRig } from './support/pin-rig.js';

afterEach(() => cleanup());

/** Each reported move as `id source`, with the snapshot's row order at the moment it was reported. */
function record(ws: WorkspaceHandle): { moves: string[]; orders: string[]; stop: () => void } {
  const moves: string[] = [];
  const orders: string[] = [];
  const stop = ws.panels.subscribeMoves((m: PanelMove) => {
    moves.push(`${m.id} ${m.source}`);
    orders.push(ws.panels.getSnapshot().panels.map((s) => s.id).join(' '));
  });
  return { moves, orders, stop };
}

test('a host move or place with source person reports the panel as the person\'s, after the snapshot shows it', async () => {
  const r = await pinRig();
  const seen = record(r.ws);
  r.turn(() => r.h.b!.move(1, 'person'));
  assert.equal(r.order().join(' '), 'root a c b');
  assert.deepEqual(seen.moves, ['b person']);
  assert.deepEqual(seen.orders, ['root a c b'], 'the listener already reads the moved row from the snapshot');
  r.turn(() => r.h.a!.place('row-end', 'person'));
  assert.deepEqual(seen.moves, ['b person', 'a person']);
  assert.equal(seen.orders[1], 'root c b a');
});

test('a host move or place from code reports the panel as code\'s', async () => {
  const r = await pinRig();
  const seen = record(r.ws);
  r.turn(() => r.h.b!.move(1, 'code'));
  r.turn(() => r.h.c!.place('row-start', 'code'));
  r.turn(() => r.h.a!.move(-1));
  assert.deepEqual(seen.moves, ['b code', 'c code', 'a code'], 'a call with no source is from code');
  assert.equal(r.order().join(' '), 'c a root b');
});

test('a refused move, a move that changes nothing and an unsubscribed listener report nothing', async () => {
  const r = await pinRig({ settings: { b: { movable: false } } });
  const seen = record(r.ws);
  assert.equal(r.turn(() => r.h.b!.move(1, 'person')).ok, false);
  assert.equal(r.turn(() => r.h.a!.move(0, 'person')).ok, true);
  assert.deepEqual({ ...r.turn(() => r.h.c!.move(3, 'person')) }, { ok: true, changed: false }, 'c is already at the row end');
  assert.deepEqual(seen.moves, []);
  r.turn(() => r.h.c!.move(-1, 'code'));
  assert.deepEqual(seen.moves, ['c code'], 'the positive control: the same listener hears a real move');
  seen.stop();
  r.turn(() => r.h.c!.move(1, 'code'));
  assert.equal(r.order().join(' '), 'root a b c');
  assert.deepEqual(seen.moves, ['c code'], 'no call after the listener stopped');
});

test('a panel carried along by the one that moved is reported after it, with the same source', async () => {
  const r = await pinRig({ ids: ['a', 'b', 'c', 'd'] });
  const seen = record(r.ws);
  r.turn(() => r.h.d!.place({ after: 'a' }, 'code'));
  assert.equal(r.order().join(' '), 'root a d b c');
  r.turn(() => r.h.a!.place('row-end', 'person'));
  assert.equal(r.order().join(' '), 'root b c a d', 'd is anchored to a and follows it');
  assert.deepEqual(seen.moves, ['d code', 'a person', 'd person']);
});

const rowOrder = (m: MountedWorkspace): string => m.latest().entries.filter((p) => p.marker !== true).map((p) => p.key ?? p.id).join(' ');
/** The grab bar the library's default frame draws on panel `key`. */
const grabOf = (m: MountedWorkspace, key: string): HTMLElement => {
  const engineId = m.latest().entries.find((p) => (p.key ?? p.id) === key)!.id;
  const grab = m.container.querySelector<HTMLElement>(`[data-row-id="${engineId}"] [data-panel-grab-bar]`);
  assert.ok(grab !== null, `${key} has a grab bar`);
  return grab;
};
async function grabRig(): Promise<{ ws: WorkspaceHandle; m: MountedWorkspace }> {
  const r = await pinRig();
  await advanceFrames(2000);
  return { ws: r.ws, m: r.m };
}
const SPAN = 406;

/** The drag props each panel's view got from `usePanelDragProps`, by panel id: what the grab handle's pointer drag calls on release. */
const dragProps = new Map<string, ReturnType<typeof usePanelDragProps>>();
const dragView = (id: string): PanelTemplate =>
  definePanel({
    id,
    view: ({ panel }) => {
      dragProps.set(panel.id, usePanelDragProps());
      return React.createElement('i', null, panel.id);
    },
  });

test('a drag released in the row reports the dragged panel as the person\'s', async () => {
  dragProps.clear();
  const ws = createWorkspace({ mount: false, root: dragView('root'), templates: ['a', 'b', 'c'].map(dragView) });
  for (const id of ['a', 'b', 'c']) ws.addPanel(id);
  const m = mountWorkspace(ws, { width: 4000 });
  await flush();
  await advanceFrames(2000);
  const seen = record(ws);
  const reorder = dragProps.get('a')?.reorder;
  assert.ok(reorder !== undefined, 'the row hands a movable panel a reorder');
  // A release past half of b's span is one hop right, the steps the pointer drag's release computes.
  act(() => reorder.onDragEnd(SPAN * 0.6));
  await advanceFrames(1500);
  assert.equal(rowOrder(m), 'root b a c');
  assert.deepEqual(seen.moves, ['a person']);
  assert.deepEqual(seen.orders, ['root b a c']);
});

test('the grab handle\'s arrow keys report the panel as the person\'s', async () => {
  const { ws, m } = await grabRig();
  const seen = record(ws);
  await act(async () => void grabOf(m, 'b').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  await advanceFrames(1500);
  assert.equal(rowOrder(m), 'root a c b');
  await act(async () => void grabOf(m, 'c').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  await advanceFrames(1500);
  assert.equal(rowOrder(m), 'root c a b');
  assert.deepEqual(seen.moves, ['b person', 'c person']);
});
