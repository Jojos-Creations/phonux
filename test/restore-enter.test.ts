/**
 * A row mounts before the workspace's restore settles, and the restored panels arrive with the settle. Those panels start at
 * their rest with no slide in; a panel added once the row is ready slides in from off its rest. The row mounts every view
 * once: a view present before the settle is not mounted again by it.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import type { PanelWindow, WorkspaceHandle } from '../index.js';
import { advanceFrames, cleanup, mount, seededWorkspace, StaticRow, withHost } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const effects = new Map<string, { mounts: number; unmounts: number }>();

registerTestView('restore-probe', ({ panel }) => {
  React.useEffect(() => {
    const e = effects.get(panel.id) ?? { mounts: 0, unmounts: 0 };
    effects.set(panel.id, e);
    e.mounts += 1;
    return () => void (e.unmounts += 1);
  }, [panel.id]);
  return React.createElement('i', { 'data-slot': panel.id }, panel.title);
});

afterEach(() => {
  effects.clear();
  cleanup();
});

const ROOT = 'root';
const NONE: ReadonlySet<string> = new Set();
/** One phone and one gap: where the second slot of a row rests. */
const STEP = 406;

const entry = (id: string): PanelWindow => ({ id, url: `https://${id}.example`, title: id.toUpperCase(), live: true, view: 'restore-probe', collapsible: true, listed: true });

/** A seeded workspace whose restore is under the test's control: `loading` until `settle()`, which tells the row. */
function restoring(all: readonly PanelWindow[]): { workspace: WorkspaceHandle; settle: () => void } {
  const workspace = seededWorkspace(all, { rootId: ROOT });
  const panels = workspace.panels as { getSnapshot: () => { status: string }; subscribe: (listener: () => void) => () => void };
  const real = panels.getSnapshot.bind(panels);
  const listeners = new Set<() => void>();
  const subscribe = panels.subscribe.bind(panels);
  let status = 'loading';
  panels.getSnapshot = () => ({ ...real(), status });
  panels.subscribe = (listener) => {
    listeners.add(listener);
    const off = subscribe(listener);
    return () => {
      listeners.delete(listener);
      off();
    };
  };
  return {
    workspace,
    settle: () => {
      status = 'ready';
      for (const listener of [...listeners]) listener();
    },
  };
}

const rowOf = (workspace: WorkspaceHandle, entries: PanelWindow[]): React.ReactElement =>
  withHost(React.createElement(StaticRow, { entries, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE, workspace }));

const slotOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector(`[data-slot="${id}"]`)!.parentElement!;
const xOf = (container: HTMLElement, id: string): number => {
  const match = /translateX\((-?[\d.]+)px\)/.exec(slotOf(container, id).style.transform);
  return match === null ? 0 : Number(match[1]);
};

/** The slot's x and opacity at the commit and on each of the next `frames` frames. */
async function track(container: HTMLElement, id: string, frames: number): Promise<Array<[number, number]>> {
  const seen: Array<[number, number]> = [[xOf(container, id), Number(slotOf(container, id).style.opacity || 1)]];
  for (let k = 0; k < frames; k++) {
    await advanceFrames(16);
    seen.push([xOf(container, id), Number(slotOf(container, id).style.opacity || 1)]);
  }
  return seen;
}

test('a panel that arrives with the restore settle starts at its rest, with no slide in', async () => {
  const { workspace, settle } = restoring([entry('a'), entry('b')]);
  const mounted = mount(rowOf(workspace, [entry('a')]));
  await advanceFrames(400);
  mounted.rerender(rowOf(workspace, [entry('a'), entry('b')]));
  act(settle);
  for (const [x, opacity] of await track(mounted.container, 'b', 30)) {
    assert.equal(x, STEP, 'at its rest on every frame');
    assert.equal(opacity, 1, 'and fully drawn');
  }
});

test('a panel added once the row is ready slides in from off its rest', async () => {
  const { workspace, settle } = restoring([entry('a'), entry('b')]);
  const mounted = mount(rowOf(workspace, [entry('a')]));
  act(settle);
  await advanceFrames(400);
  mounted.rerender(rowOf(workspace, [entry('a'), entry('b')]));
  await advanceFrames(32);
  const seen = await track(mounted.container, 'b', 40);
  assert.ok(seen[0]![0] > STEP, `the control: it starts beyond its rest (${seen[0]![0]})`);
  assert.equal(seen[seen.length - 1]![0], STEP, 'and comes to rest');
});

test('a view present before the settle is mounted once, the settle included', async () => {
  const { workspace, settle } = restoring([entry('a'), entry('b')]);
  const mounted = mount(rowOf(workspace, [entry('a')]));
  await advanceFrames(400);
  mounted.rerender(rowOf(workspace, [entry('a'), entry('b')]));
  act(settle);
  await advanceFrames(400);
  assert.deepEqual([effects.get('a')?.mounts, effects.get('a')?.unmounts], [1, 0], 'the view the row held before the settle');
  assert.deepEqual([effects.get('b')?.mounts, effects.get('b')?.unmounts], [1, 0], 'and the one that arrived with it');
});

test('control: a view whose row is remounted around it counts two mounts, so the count above can fail', async () => {
  const { workspace } = restoring([entry('a')]);
  const wrapped = (key: string): React.ReactElement => React.createElement(React.Fragment, { key }, rowOf(workspace, [entry('a')]));
  const mounted = mount(wrapped('before'));
  await advanceFrames(100);
  mounted.rerender(wrapped('after'));
  await advanceFrames(100);
  assert.deepEqual([effects.get('a')?.mounts, effects.get('a')?.unmounts], [2, 1]);
});
