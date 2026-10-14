/**
 * A workspace's life across mounts: when it loads, when it is ready, what a second or a mismatched attach does, how
 * errors reach `onError`, how `newId` and `order` are read, and which `addPanel` calls ask the row to scroll.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { flushSync } from 'react-dom';
import { PanelManagerError, createWorkspace, useProvidePanels } from '../index.js';
import type { PanelSettings, WorkspaceHandle, WorkspaceState, WorkspaceStorage } from '../index.js';
import { LIBRARY_PANEL_DEFAULTS } from '../panelSettings.js';
import { rowScrollerFor } from '../rowScroller.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { advanceFrames, cleanup, mount, panelsInput, withHost } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());

const QUICK = { tuning: { saveQuietMs: 5 } };
const pause = (ms: number): Promise<void> => act(async () => void (await new Promise((r) => setTimeout(r, ms))));

function countingStorage(inner = memoryWorkspaceStorage()): WorkspaceStorage & { loads: number; saves: number } {
  const s = {
    loads: 0,
    saves: 0,
    load: (): ReturnType<WorkspaceStorage['load']> => {
      s.loads += 1;
      return inner.load();
    },
    save: (state: WorkspaceState): ReturnType<WorkspaceStorage['save']> => {
      s.saves += 1;
      return inner.save(state);
    },
  };
  return s;
}

test('StrictMode applies one load: each declared panel is created once and the loaded file is applied once', async () => {
  const storage = countingStorage();
  const w = createWorkspace({ mount: false, storage, templates: [markerTemplate('strict-a')] });
  w.addPanel('strict-a');
  const m = mountWorkspace(w, { strict: true });
  await flush();
  assert.equal(storage.loads, 2, 'control: StrictMode ran the mount effect twice');
  assert.deepEqual(m.slots().length, 1);
  assert.equal(w.panels.getSnapshot().panels.length, 1);
  assert.equal(w.status, 'ready');
});

test('without storage the workspace is ready on the first commit and creates its panels once under StrictMode', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('strict-b')] });
  w.addPanel('strict-b');
  const m = mountWorkspace(w, { strict: true });
  assert.equal(w.status, 'ready');
  assert.equal(m.slots().length, 1);
});

test('status is detached before mount, loading while the load is pending, ready after, and detached again after unmount', async () => {
  let release: (v: WorkspaceState | null) => void = () => {};
  const storage: WorkspaceStorage = { load: () => new Promise((r) => void (release = r)), save: () => {} };
  const w = createWorkspace({ mount: false, storage, templates: [markerTemplate('stat-a')] });
  assert.equal(w.status, 'detached');
  const m = mountWorkspace(w);
  assert.equal(w.status, 'loading');
  assert.equal(w.panels.getSnapshot().status, 'loading');
  release(null);
  await flush();
  assert.equal(w.status, 'ready');
  assert.equal(w.panels.getSnapshot().status, 'ready', 'the settle commit carries the status');
  act(() => m.unmount());
  assert.equal(w.status, 'detached');
});

test('a remount restores from storage; with no storage it starts from the declared panels again', async () => {
  const storage = memoryWorkspaceStorage();
  const t = markerTemplate('re-a', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, tuning: QUICK.tuning, storage, templates: [t] });
  w.addPanel(t, { id: 're-1' });
  const first = mountWorkspace(w);
  await flush();
  act(() => void w.addPanel(t, { id: 're-2' }));
  await pause(60);
  first.unmount();
  cleanup();
  const again = mountWorkspace(w);
  await flush();
  assert.deepEqual(again.slots().length, 2, 'both panels came back');
  const bare = createWorkspace({ mount: false, templates: [t] });
  bare.addPanel(t, { id: 'b-1' });
  const m1 = mountWorkspace(bare);
  m1.unmount();
  cleanup();
  const m2 = mountWorkspace(bare);
  assert.equal(m2.slots().length, 1);
});

test('a second useProvidePanels on a workspace that is attached throws already-attached', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('two-a')] });
  mountWorkspace(w);
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.throws(
      () => mountWorkspace(w),
      (e: unknown) => e instanceof PanelManagerError && e.code === 'already-attached',
    );
  } finally {
    console.error = quiet;
  }
});

test('a storage whose save throws or rejects reaches onError and the row keeps working', async () => {
  for (const mode of ['throw', 'reject'] as const) {
    const errors: unknown[] = [];
    const storage: WorkspaceStorage = {
      load: () => Promise.resolve(null),
      save: () => {
        if (mode === 'throw') throw new Error('disk');
        return Promise.reject(new Error('disk'));
      },
    };
    const t = markerTemplate(`err-${mode}`, { settings: { multiple: true } });
    const w = createWorkspace({ mount: false, tuning: QUICK.tuning, storage, templates: [t], onError: (e) => void errors.push(e) });
    mountWorkspace(w);
    await flush();
    act(() => void w.addPanel(t, { id: `e-${mode}` }));
    await pause(60);
    assert.ok(errors.length >= 1, `${mode}: onError heard it`);
    assert.equal(w.panels.get(`e-${mode}`)?.getState().status, 'live');
    cleanup();
  }
});

test('with onError unset a failed save is logged with console.error', async () => {
  const logged: unknown[] = [];
  const quiet = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const storage: WorkspaceStorage = { load: () => Promise.resolve(null), save: () => { throw new Error('disk'); } };
    const t = markerTemplate('err-default', { settings: { multiple: true } });
    const w = createWorkspace({ mount: false, tuning: QUICK.tuning, storage, templates: [t] });
    mountWorkspace(w);
    await flush();
    act(() => void w.addPanel(t, { id: 'ed-1' }));
    await pause(60);
  } finally {
    console.error = quiet;
  }
  assert.ok(logged.length >= 1);
});

test('newId draws the engine ids and the suffix of an anonymous instance', () => {
  let n = 0;
  const t = markerTemplate('nid', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t], newId: () => `n${(n += 1)}` });
  mountWorkspace(w);
  let h: ReturnType<typeof w.addPanel> | undefined;
  act(() => void (h = w.addPanel(t)));
  assert.match(h!.id, /^nid~n\d+$/);
  assert.match(h!.getState().engineId ?? '', /^n\d+$/);
});

test('order is read by a placeOnAdd of order and is called with no argument', () => {
  const calls: number[] = [];
  const a = markerTemplate('ord-a', { settings: { placeOnAdd: 'order' } });
  const b = markerTemplate('ord-b', { settings: { placeOnAdd: 'order' } });
  const w = createWorkspace({ mount: false, templates: [a, b], order: () => {
      calls.push(1);
      return ['ord-b', 'ord-a'];
    } });
  w.addPanel(a);
  w.addPanel(b);
  const m = mountWorkspace(w);
  assert.ok(calls.length >= 1, 'positive control: order was consulted');
  assert.deepEqual(m.latest().entries.filter((p) => p.marker !== true).map((p) => p.view), ['ord-b', 'ord-a']);
});

test('a render before the load settles has live handles for what the row already shows', async () => {
  const storage = memoryWorkspaceStorage();
  const t = markerTemplate('first-a');
  const w = createWorkspace({ mount: false, storage, templates: [t] });
  const h = w.addPanel(t);
  const m = mountWorkspace(w);
  assert.equal(h.getState().status === 'pending' || h.getState().status === 'live', true);
  await flush();
  assert.equal(h.getState().status, 'live');
  assert.equal(m.slots().length, 1);
});

test('panels added before mount arrive in call order', async () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('o1'), markerTemplate('o2'), markerTemplate('o3')] });
  for (const id of ['o2', 'o3', 'o1']) w.addPanel(id);
  mountWorkspace(w);
  assert.deepEqual(w.panels.getSnapshot().panels.map((p) => p.id), ['o2', 'o3', 'o1']);
});

test('a destroyed mount leaves the workspace usable by the next one', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('re-use')] });
  w.addPanel('re-use');
  const a = mountWorkspace(w);
  a.unmount();
  cleanup();
  const b = mountWorkspace(w);
  assert.equal(b.slots().length, 1);
});

const FILLER = ['f1', 'f2', 'f3', 'f4', 'f5'];

/** Where the row rests after `addPanel` of a template asking `scrollOnOpen`, with five panels already there and a 1000 wide window. */
async function addedAt(scrollOnOpen: PanelSettings['scrollOnOpen'] | undefined): Promise<{ at: number; mountedAt: number; notes: string[] }> {
  const t = markerTemplate('scr', { settings: { placeOnAdd: { after: 'f2' }, ...(scrollOnOpen === undefined ? {} : { scrollOnOpen }) } });
  const w = createWorkspace({ mount: false, templates: [t, ...FILLER.map((id) => markerTemplate(id, { settings: { scrollOnOpen: 'none' } }))], tuning: { rowGesture: 'free' } });
  for (const id of FILLER) w.addPanel(id);
  const m = mountWorkspace(w);
  await flush();
  await advanceFrames(900);
  const mountedAt = m.container.scrollLeft;
  act(() => void w.addPanel(t));
  await advanceFrames(900);
  return { at: m.container.scrollLeft, mountedAt, notes: m.notes.map((n) => n.code) };
}

test('first paint never scrolls: panels declared before mount and replayed at settle leave the row at 0', async () => {
  const r = await addedAt('start');
  assert.equal(r.mountedAt, 0);
});

test('addPanel after ready scrolls to the literal target of scrollOnOpen: into-view, start and center each land elsewhere', async () => {
  const into = await addedAt('into-view');
  const start = await addedAt('start');
  const center = await addedAt('center');
  assert.ok(into.at > 0, 'positive control: a request was recorded and the row moved');
  assert.equal(new Set([into.at, start.at, center.at]).size, 3, `${into.at} ${start.at} ${center.at}`);
  assert.ok(start.at > into.at);
  assert.ok(center.at > into.at && center.at < start.at);
});

test('the default scrollOnOpen is the library default', async () => {
  const dflt = await addedAt(undefined);
  const explicit = await addedAt(LIBRARY_PANEL_DEFAULTS.scrollOnOpen === 'none' ? 'into-view' : LIBRARY_PANEL_DEFAULTS.scrollOnOpen);
  assert.equal(dflt.at, explicit.at);
});

test('scrollOnOpen none records no request: the row stays where it was', async () => {
  const r = await addedAt('none');
  assert.equal(r.at, r.mountedAt);
});

test('a request recorded while a drag holds the row is dropped with the note scroll-dropped-during-drag', async () => {
  const t = markerTemplate('held', { settings: { scrollOnOpen: 'start' } });
  const w = createWorkspace({ mount: false, templates: [t] });
  const m = mountWorkspace(w);
  await flush();
  const claim = rowScrollerFor(m.container).claim();
  assert.ok(claim !== null && rowScrollerFor(m.container).claimHeld(), 'positive control: the drag holds the row');
  act(() => void w.addPanel(t));
  await advanceFrames(300);
  assert.equal(m.notes.some((n) => n.code === 'scroll-dropped-during-drag'), true);
  assert.equal(m.container.scrollLeft, 0);
  claim.release();
});

// ---------------------------------------------------------------------------
// WorkspaceOptions members: newId, onError, order, conflicts, tuning
// ---------------------------------------------------------------------------

test('newId: an id-less addPanel after ready is note~k1 then note~k2 and every id drawn counts one call', () => {
  let n = 0;
  const t = markerTemplate('note-k', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t], newId: () => `k${(n += 1)}` });
  mountWorkspace(w);
  const before = n;
  let a: ReturnType<typeof w.addPanel> | undefined;
  let b: ReturnType<typeof w.addPanel> | undefined;
  act(() => void (a = w.addPanel(t)));
  const afterFirst = n;
  act(() => void (b = w.addPanel(t)));
  assert.match(a!.id, /^note-k~k\d+$/);
  assert.match(b!.id, /^note-k~k\d+$/);
  assert.notEqual(a!.id, b!.id);
  assert.equal(a!.id, `note-k~k${before + 1}`);
  assert.ok(afterFirst > before && n > afterFirst, 'every draw is a call to newId');
});

test('newId unset: the id is the template id, a tilde and a non-empty string, and 50 calls give 50 distinct ids', () => {
  const t = markerTemplate('dflt-id', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t] });
  mountWorkspace(w);
  const ids = new Set<string>();
  for (let i = 0; i < 50; i++) {
    let h: ReturnType<typeof w.addPanel> | undefined;
    act(() => void (h = w.addPanel(t)));
    assert.match(h!.id, /^dflt-id~.+$/);
    ids.add(h!.id);
  }
  assert.equal(ids.size, 50);
});

test('onError is called exactly once per failed save with that error, and the next save still runs', async () => {
  for (const mode of ['throw', 'reject'] as const) {
    const errors: unknown[] = [];
    const planted = new Error(`disk-${mode}`);
    let saves = 0;
    const storage: WorkspaceStorage = {
      load: () => Promise.resolve(null),
      save: () => {
        saves += 1;
        if (saves > 1) return;
        if (mode === 'throw') throw planted;
        return Promise.reject(planted);
      },
    };
    const t = markerTemplate(`once-${mode}`, { settings: { multiple: true } });
    const w = createWorkspace({ mount: false, tuning: QUICK.tuning, storage, templates: [t], onError: (e) => void errors.push(e) });
    mountWorkspace(w);
    await flush();
    act(() => void w.addPanel(t, { id: `o1-${mode}` }));
    await pause(60);
    assert.deepEqual(errors, [planted], mode);
    act(() => void w.addPanel(t, { id: `o2-${mode}` }));
    await pause(60);
    assert.equal(saves, 2, `${mode}: the next save ran`);
    assert.equal(errors.length, 1);
    cleanup();
  }
});

test('with onError unset a failed save reaches console.error exactly once', async () => {
  const logged: unknown[] = [];
  const quiet = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const storage: WorkspaceStorage = { load: () => Promise.resolve(null), save: () => { throw new Error('disk'); } };
    const t = markerTemplate('once-default', { settings: { multiple: true } });
    const w = createWorkspace({ mount: false, tuning: QUICK.tuning, storage, templates: [t] });
    mountWorkspace(w);
    await flush();
    act(() => void w.addPanel(t, { id: 'od-1' }));
    await pause(60);
  } finally {
    console.error = quiet;
  }
  assert.equal(logged.length, 1);
});

test('order: b with placeOnAdd order lands right of a, before c when its predecessors are absent, and at the fallback when order omits it', () => {
  const place = (present: string[], order: (() => string[]) | undefined): string[] => {
    const tpl = (id: string) => markerTemplate(id, { settings: { placeOnAdd: id === 'b' ? 'order' : 'row-end', placeFallback: 'row-end' } });
    const templates = ['a', 'b', 'c'].map(tpl);
    const w = createWorkspace({ mount: false, templates, ...(order !== undefined ? { order } : {}) });
    for (const id of present) w.addPanel(id);
    const m = mountWorkspace(w);
    const row = m.latest().entries.filter((p) => p.marker !== true).map((p) => p.view);
    cleanup();
    return row;
  };
  const wanted = () => ['a', 'b', 'c'];
  assert.deepEqual(place(['a', 'c', 'b'], wanted), ['a', 'b', 'c']);
  assert.deepEqual(place(['c', 'b'], wanted), ['b', 'c']);
  assert.deepEqual(place(['a', 'c', 'b'], () => ['a', 'c']), ['a', 'c', 'b']);
  assert.deepEqual(place(['a', 'c', 'b'], undefined), ['a', 'c', 'b']);
});

test("conflicts: a template forcing a rule warns once per panel and setting, throws under 'throw' and is silent under 'off'", () => {
  const forcing = (id: string) => markerTemplate(id, { settings: { persist: 'session', rememberLayout: true } });
  const run = (conflicts: 'warn' | 'throw' | 'off'): { warned: number; thrown: boolean } => {
    const warned: unknown[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void warned.push(a);
    let thrown = false;
    try {
      const w = createWorkspace({ mount: false, conflicts });
      try {
        w.addPanel(forcing(`cf-${conflicts}`));
        w.addPanel(`cf-${conflicts}`);
      } catch (e) {
        thrown = e instanceof PanelManagerError && e.code === 'invalid-settings';
      }
    } finally {
      console.warn = orig;
    }
    return { warned: warned.length, thrown };
  };
  const warn = run('warn');
  assert.equal(warn.thrown, false);
  assert.ok(warn.warned >= 1, 'positive control: warn mode warned');
  assert.equal(run('throw').thrown, true);
  assert.deepEqual(run('off'), { warned: 0, thrown: false });
});

test('tuning reaches the row as one value: rowGap 40 prices the offsets and ProvidedPanels.tuning, and workspace.tuning is the resolved object', () => {
  const a = markerTemplate('tn-a');
  const b = markerTemplate('tn-b');
  const w = createWorkspace({ mount: false, templates: [a, b], tuning: { rowGap: 40 } });
  w.addPanel(a);
  w.addPanel(b);
  const m = mountWorkspace(w);
  assert.equal(w.tuning.rowGap, 40);
  assert.equal(m.latest().tuning.rowGap, 40);
  assert.equal(m.latest().tuning, w.tuning);
  assert.deepEqual(m.latest().rowNumbers.leftOffsets, [0, 390 + 40]);
});

test('memoryWorkspaceStorage: a save then a load deep-equals and is a copy', async () => {
  const storage = memoryWorkspaceStorage();
  assert.equal(await storage.load(), null);
  const state: WorkspaceState = { version: 1, panels: [], dismissed: ['a'] };
  await storage.save(state);
  const back = await storage.load();
  assert.deepEqual(back, state);
  assert.notEqual(back, state);
});

test('a workspace swapped while mounted logs the cure, keeps the first attached, and the new one answers not-attached', () => {
  const first = createWorkspace({ mount: false, templates: [markerTemplate('swap-a')] });
  first.addPanel('swap-a');
  const second = createWorkspace({ mount: false, templates: [markerTemplate('swap-b')] });
  const probe = second.addPanel('swap-b');
  const logged: string[] = [];
  const quiet = console.error;
  console.error = (...a: unknown[]) => void logged.push(String(a[0]));
  try {
    const ref = React.createRef<HTMLDivElement>();
    function Hook({ ws }: { ws: WorkspaceHandle }): null {
      useProvidePanels(panelsInput({ workspace: ws, overflowContainerRef: ref }));
      return null;
    }
    const m = mount(withHost(React.createElement(Hook, { ws: first })));
    assert.equal(first.status, 'ready');
    act(() => m.rerender(withHost(React.createElement(Hook, { ws: second }))));
    assert.equal(first.status, 'ready', 'the first workspace stays attached');
    assert.equal(second.status, 'detached');
    assert.equal(probe.getState().status, 'pending', 'the new one answers not-attached');
  } finally {
    console.error = quiet;
  }
  assert.equal(logged.filter((l) => /key/.test(l)).length, 1, 'one message that names the cure');
});

test('the pre-mount drain raises no console.error, and a flushSync from a lifecycle in the same harness is captured', () => {
  const captured: string[] = [];
  const quiet = console.error;
  console.error = (...a: unknown[]) => void captured.push(String(a[0]));
  try {
    const t = markerTemplate('drain', { settings: { multiple: true } });
    const w = createWorkspace({ mount: false, templates: [t] });
    for (const id of ['d1', 'd2', 'd3']) w.addPanel(t, { id });
    mountWorkspace(w, { strict: true });
    assert.deepEqual(captured, []);
    function Offender(): null {
      React.useLayoutEffect(() => {
        flushSync(() => {});
      }, []);
      return null;
    }
    mount(React.createElement(Offender));
    assert.equal(captured.some((l) => /flushSync/.test(l)), true, 'control: the harness sees a lifecycle flushSync');
  } finally {
    console.error = quiet;
  }
});
