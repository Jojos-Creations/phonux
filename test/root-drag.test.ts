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
import { capRig } from './support/cap-rig.js';
import { settle } from './support/workspace-launch.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { refusedWith } from './support/configure-matrix.js';

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
  const match = /translateX\((-?[\d.e+-]+)px\)/.exec(slotOf(r, key).style.transform);
  return match === null ? 0 : Math.round(Number(match[1]));
};
const grabOf = (r: Rig, key: string): HTMLElement => {
  const grab = r.m.container.querySelector<HTMLElement>(`[data-grab="${engineId(r, key)}"]`);
  assert.ok(grab, `${key} has a grab handle`);
  return grab;
};
const pinned = (r: Rig): Record<string, boolean> => Object.fromEntries(['a', 'b', 'c'].map((k) => [k, r.ws.panels.get(k)!.getState().pinned]));


const ALL = ['root', 'a', 'b', 'c'];
const hold = (r: Rig, dx: number) => drag(grabOf(r, 'root'), { dx, dy: 0, steps: 12, hold: 8, keepDown: true });
/** The orders the commits showed, a repeat of the one before dropped. */
const distinct = (commits: string[][]): string[] => commits.map((c) => c.join(' ')).filter((c, k, all) => c !== all[k - 1]);
const sides = (r: Rig): Record<string, string> => Object.fromEntries(Object.entries(anchorsOf(r)).map(([k, v]) => [k, v.split(' ').slice(0, 2).join(' ')]));

test('the preview: a held root drag slides the neighbour it would cross aside, and the order changes only at the drop', async () => {
  const r = await rig({ root: { movable: true } });
  const rest = Object.fromEntries(ALL.map((k) => [k, xOf(r, k)]));
  await hold(r, SPAN * 0.5 + 10);
  await advanceFrames(1000);
  assert.equal(xOf(r, 'a'), rest.a! - SPAN, 'the first neighbour made room');
  assert.equal(xOf(r, 'b'), rest.b, 'a neighbour past the hop point has not moved');
  assert.equal(order(r).join(' '), 'root a b c', 'the order only changes at the drop');
  assert.equal(slotOf(r, 'root').style.zIndex, '3', 'the dragged slot is drawn over its neighbours');
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(xOf(r, 'a'), rest.root, 'the crossed neighbour rests where the root was: it did not jump at the drop');
  assert.equal(xOf(r, 'root'), rest.a, 'and the root rests where the neighbour was');
});

test('the commit: a drop past one panel re-anchors that panel alone, in one commit', async () => {
  const commits: string[][] = [];
  const r = await rig({ root: { movable: true }, commits });
  const before = sides(r);
  commits.length = 0;
  await hold(r, SPAN * 0.5 + 10);
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(r).join(' '), 'a root b c');
  assert.deepEqual(anchorsOf(r), { a: 'root left 0', b: 'root right 0', c: 'root right 1' });
  const after = sides(r);
  assert.deepEqual(Object.keys(after).filter((k) => after[k] !== before[k]), ['a'], 'only the crossed panel changed its side');
  assert.deepEqual(distinct(commits), ['a root b c'], 'the one change of order is the drop');
});

test('the commit: a drop past two panels re-anchors those two to the root\'s other side and nothing else', async () => {
  const commits: string[][] = [];
  const r = await rig({ root: { movable: true }, commits });
  const before = sides(r);
  const rest = Object.fromEntries(ALL.map((k) => [k, xOf(r, k)]));
  commits.length = 0;
  await hold(r, SPAN * 1.5 + 10);
  await advanceFrames(1000);
  assert.deepEqual([xOf(r, 'a'), xOf(r, 'b'), xOf(r, 'c')], [rest.a! - SPAN, rest.b! - SPAN, rest.c], 'both crossed panels stand aside during the hold and the third stays');
  await release(SPAN * 1.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(r).join(' '), 'a b root c');
  assert.deepEqual(anchorsOf(r), { a: 'root left 1', b: 'root left 0', c: 'root right 0' });
  const after = sides(r);
  assert.deepEqual(Object.keys(after).filter((k) => after[k] !== before[k]).sort(), ['a', 'b']);
  assert.deepEqual(distinct(commits), ['a b root c'], 'no commit showed the root past only the first panel');
});

test('the pin flip: crossed panels read pinned and unpinned by their new side, others are unchanged, and the way back flips them again', async () => {
  const r = await rig({ root: { movable: true } });
  assert.deepEqual(pinned(r), { a: false, b: false, c: false });
  await hold(r, SPAN * 1.5 + 10);
  await release(SPAN * 1.5 + 10, 0);
  await advanceFrames(3000);
  assert.deepEqual(pinned(r), { a: true, b: true, c: false });
  await drag(grabOf(r, 'root'), { dx: -SPAN * 0.5 - 10, dy: 0, steps: 12, hold: 8 });
  await advanceFrames(3000);
  assert.equal(order(r).join(' '), 'a root b c');
  assert.deepEqual(pinned(r), { a: true, b: false, c: false }, 'only the panel crossed back changed');
});

test('keys: ArrowRight and ArrowLeft on the root\'s grab handle move it one slot, as they do any panel', async () => {
  const r = await rig({ root: { movable: true } });
  const press = async (key: string): Promise<void> => {
    await act(async () => void grabOf(r, 'root').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await advanceFrames(1500);
  };
  await press('ArrowRight');
  assert.equal(order(r).join(' '), 'a root b c');
  assert.deepEqual(pinned(r), { a: true, b: false, c: false });
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

test('a neighbour that cannot be crossed stops the root\'s drag, as it stops any panel', async () => {
  const r = await rig({ root: { movable: true } });
  act(() => void r.ws.panels.get('b')!.configure({ crossable: false }));
  await advanceFrames(100);
  await hold(r, SPAN * 2.5 + 10);
  await release(SPAN * 2.5 + 10, 0);
  await advanceFrames(3000);
  assert.equal(order(r).join(' '), 'a root b c', 'the root crossed the first panel and stopped before the one that cannot be crossed');
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

test('a root dragged to the middle is restored there: the saved file names the crossed panels\' sides, and the root\'s place follows', async () => {
  const store = memoryWorkspaceStorage();
  const first = await rig({ root: { movable: true }, storage: store });
  await hold(first, SPAN * 0.5 + 10);
  await release(SPAN * 0.5 + 10, 0);
  await advanceFrames(3000);
  await settle();
  assert.equal(order(first).join(' '), 'a root b c');
  cleanup();
  const second = await rig({ root: { movable: true }, storage: store });
  await settle();
  await advanceFrames(3000);
  assert.equal(order(second).join(' '), 'a root b c');
  assert.deepEqual(pinned(second), { a: true, b: false, c: false });
});

test('under a cap, panels the root crosses to its left are pinned and stay live, and the cap counts only the panels right of the root', async () => {
  const r = await capRig({ count: 6, cap: 2 });
  assert.equal(r.row(), 'root w1* w2* w3* w4* w5 w6');
  act(() => void r.ws.panels.configure(r.ws.rootId, { movable: true }));
  let answer: { ok: boolean; changed?: boolean } | undefined;
  r.turn(() => {
    answer = r.ws.panels.get(r.ws.rootId)!.move(2);
  });
  await advanceFrames(3000);
  assert.deepEqual(answer, { ok: true, changed: true });
  assert.equal(r.row(), 'w1* w2* w3* w4* w5 w6 root');
  assert.deepEqual(r.pinnedLive(), ['w5', 'w6'], 'the two panels now left of the root are exempt from the cap');
  assert.deepEqual(r.unpinnedLive(), []);
});
