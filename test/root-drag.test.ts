/**
 * The root panel drags sideways like any other panel when its `movable` setting is on: its neighbors slide aside live
 * through the root's own view and its `grabProps`, and the drop re-anchors exactly the crossed panels to the root's other side.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { DragToClose, Panel, createWorkspace, definePanel, usePanelDragProps } from '../index.js';
import type { PanelSettings, PanelSummary, PanelTemplate, WorkspaceHandle } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { drag, release } from './support/drag-gesture.js';
import { flush, mountWorkspace, type MountedWorkspace } from './support/workspace-row.js';
import { settle } from './support/workspace-launch.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { refusedWith } from './support/configure-matrix.js';
import { slotTransform } from './support/strip.js';

afterEach(() => cleanup());

// A view that draws its own Panel with grabProps as the handle, the way an app's view does.
function GrabView({ panel }: { panel: PanelSummary }): React.ReactElement {
  const dragProps = usePanelDragProps();
  return React.createElement(DragToClose, {
    ...dragProps,
    children: (grab) => React.createElement(Panel, { title: panel.id, viewId: panel.id, grabProps: { ...grab, 'data-grab': panel.id }, children: React.createElement('i', null, panel.id) }),
  });
}
const template = (id: string, settings?: PanelSettings): PanelTemplate => definePanel({ id, view: GrabView, ...(settings === undefined ? {} : { settings }) });

interface Rig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
}
async function rig(o: { tuning?: Record<string, unknown>; commits?: string[][]; root?: PanelSettings; ids?: readonly string[]; storage?: ReturnType<typeof memoryWorkspaceStorage>; panelSettings?: PanelSettings } = {}): Promise<Rig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const ws = createWorkspace({
    mount: false,
    root: template('root', { title: 'Root', ...o.root }),
    templates: ids.map((id) => template(id, o.panelSettings)),
    tuning: { saveQuietMs: 5, ...o.tuning },
    ...(o.storage === undefined ? {} : { storage: o.storage }),
  });
  for (const id of ids) ws.addPanel(id);
  const m = mountWorkspace(ws, { width: 4000, onCommit: (provided) => void o.commits?.push(provided.entries.filter((p) => p.marker !== true).map((p) => p.key ?? p.id)) });
  await flush();
  await advanceFrames(2000);
  return { ws, m };
}

const SPAN = 406;
const order = (r: Rig): string[] => r.m.latest().entries.filter((p) => p.marker !== true).map((p) => p.key ?? p.id);
const entryOf = (r: Rig, key: string) => r.m.latest().entries.find((p) => (p.key ?? p.id) === key)!;
const anchorsOf = (r: Rig): Record<string, string> =>
  Object.fromEntries(r.m.latest().entries.filter((p) => p.anchor !== undefined).map((p) => [p.key ?? p.id, `${r.m.latest().entries.find((e) => e.id === p.anchor!.panel)?.key ?? p.anchor!.panel} ${p.anchor!.position} ${p.anchor!.priority}`]));
const engineId = (r: Rig, key: string): string => entryOf(r, key).id;
const slotOf = (r: Rig, key: string): HTMLElement => {
  const slot = r.m.container.querySelector<HTMLElement>(`[data-row-id="${engineId(r, key)}"]`);
  assert.ok(slot, `${key} has a slot`);
  return slot;
};
const xOf = (r: Rig, key: string): number => {
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(slotTransform(slotOf(r, key)));
  return match === null ? 0 : Math.round(Number(match[1]));
};
const grabOf = (r: Rig, key: string): HTMLElement => {
  const grab = r.m.container.querySelector<HTMLElement>(`[data-grab="${engineId(r, key)}"]`);
  assert.ok(grab, `${key} has a grab handle`);
  return grab;
};

const ALL = ['root', 'a', 'b', 'c'];
const hold = (r: Rig, dx: number) => drag(grabOf(r, 'root'), { dx, dy: 0, steps: 12, hold: 8, keepDown: true });
/** The orders the commits showed, a repeat of the one before dropped. */
const distinct = (commits: string[][]): string[] => commits.map((c) => c.join(' ')).filter((c, k, all) => c !== all[k - 1]);
const sides = (r: Rig): Record<string, string> => Object.fromEntries(Object.entries(anchorsOf(r)).map(([k, v]) => [k, v.split(' ').slice(0, 2).join(' ')]));

test('keys: ArrowRight and ArrowLeft on the root\'s grab handle move it one slot, as they do any panel', async () => {
  const r = await rig({ root: { movable: true } });
  const press = async (key: string): Promise<void> => {
    await act(async () => void grabOf(r, 'root').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await advanceFrames(1500);
  };
  await press('ArrowRight');
  assert.equal(order(r).join(' '), 'a root b c');
  await press('ArrowLeft');
  assert.equal(order(r).join(' '), 'root a b c');
  await press('ArrowLeft');
  assert.equal(order(r).join(' '), 'root a b c', 'the first slot cannot go further left');
});

test('without the setting the root is not movable: no reorder through the handle, key or pointer', async () => {
  const r = await rig();
  assert.equal(r.ws.panels.get('root')!.getState().settings.movable, false);
  await act(async () => void grabOf(r, 'root').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  await hold(r, SPAN * 1.5 + 10);
  await advanceFrames(1000);
  assert.equal(xOf(r, 'a'), 406, 'no neighbour moved');
  await release(SPAN * 1.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(r).join(' '), 'root a b c');
});

test('settings: movable true is accepted on the root; closable and parkable true still answer settings-conflict', async () => {
  const resolved = resolvePanelSettings({ template: { movable: true } }, { root: true });
  assert.deepEqual([resolved.value.movable, resolved.source.movable, resolved.conflicts], [true, 'template', []]);
  assert.deepEqual([resolved.value.closable, resolved.value.parkable], [false, false], 'the rest of C5 stands beside it');
  const r = await rig();
  let accepted: ReturnType<typeof r.ws.panels.configure> | undefined;
  act(() => {
    accepted = r.ws.panels.configure(r.ws.rootId, { movable: true });
  });
  assert.equal(accepted?.ok, true, 'accepted through the instance door');
  assert.equal(r.ws.panels.get('root')!.getState().settings.movable, true);
  for (const key of ['closable', 'parkable'] as const) {
    let answer: ReturnType<typeof r.ws.panels.configure> | undefined;
    act(() => {
      answer = r.ws.panels.configure(r.ws.rootId, { [key]: true } as never);
    });
    const refusal = refusedWith(answer!, 'settings-conflict');
    assert.equal(refusal.setting, key);
    assert.match(refusal.message, /C5/);
  }
});

