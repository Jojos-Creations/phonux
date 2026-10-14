/**
 * configure({ snapshot: 'never' }) asks the host's CaptureTrigger to evict the panel's stored picture once, from the
 * commit's layout effect: for a live, parked, hidden and protected panel, plain and under StrictMode, and not for a
 * closed record or a panel inside its undo window, which store the edit and ask nothing at the call.
 */
import './support/jsdom-globals.js';
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { act, useEffect } from 'react';
import { createWorkspace, useProvidePanels } from '../index.js';
import type { CaptureTrigger, ConfigureResult, PanelHandle, WorkspaceHandle } from '../index.js';
import { panelKey } from '../panelSettings.js';
import { advanceFrames, cleanup, mount, panelsInput } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace, type MountedWorkspace } from './support/workspace-row.js';

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
  cleanup();
});

type Spy = CaptureTrigger & { captured: string[]; evicted: string[] };

const spyOf = (): Spy => {
  const captured: string[] = [];
  const evicted: string[] = [];
  return { captured, evicted, capture: (id) => void captured.push(id), evict: (id) => void evicted.push(id) };
};

type Done = Extract<ConfigureResult, { ok: true }>;

const done = (r: ConfigureResult): Done => {
  assert.equal(r.ok, true, r.ok ? '' : `${r.code}: ${r.message}`);
  return r as Done;
};

const turn = <T,>(fn: () => T): T => {
  let out!: T;
  act(() => {
    out = fn();
  });
  return out;
};

interface Rig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
  spy: Spy;
  b: PanelHandle;
  /** The engine id of the entry whose key is 'b'. */
  id: string;
}

/** A root titled History and one marker template per id, all added, mounted at `width` with the spy as the host's capture. */
async function build(ids: readonly string[], o: { width: number; park?: boolean; strict?: boolean }): Promise<Rig> {
  const spy = spyOf();
  const ws = createWorkspace({
    mount: false,
    root: markerTemplate('root', { settings: { title: 'History' } }),
    templates: ids.map((id) => markerTemplate(id, o.park === true ? { settings: { overflow: 'park' } } : {})),
  });
  const handles = ids.map((id) => ws.addPanel(id));
  const m = mountWorkspace(ws, { width: o.width, over: { capture: spy }, ...(o.strict === true ? { strict: true } : {}) });
  await flush();
  const found = m.latest().entries.find((p) => p.marker !== true && panelKey(p) === 'b');
  assert.ok(found, 'the row holds an entry keyed b');
  return { ws, m, spy, b: handles[ids.indexOf('b')]!, id: panelKey(found) };
}

const liveRig = (strict = false): Promise<Rig> => build(['a', 'b', 'c'], { width: 4000, strict });

/** Templates a to e that park on overflow in a row of 1000: the engine parks b. */
async function parkRig(strict = false): Promise<Rig> {
  const r = await build(['a', 'b', 'c', 'd', 'e'], { width: 1000, park: true, strict });
  await advanceFrames(900);
  return r;
}

const read = (r: Rig): { status: string; held: boolean } => {
  const s = r.b.getState();
  return { status: s.status, held: s.held };
};

type Kind = 'live' | 'parked' | 'hidden' | 'protected';

async function rigOf(kind: Kind, strict: boolean): Promise<Rig> {
  if (kind === 'live') return liveRig(strict);
  if (kind === 'hidden') {
    const r = await liveRig(strict);
    turn(() => r.b.hide());
    await advanceFrames(900);
    return r;
  }
  return parkRig(strict);
}

const BEFORE: Record<Kind, { status: string; held: boolean }> = {
  live: { status: 'live', held: false },
  parked: { status: 'parked', held: false },
  hidden: { status: 'parked', held: true },
  protected: { status: 'parked', held: false },
};

for (const strict of [false, true]) {
  for (const kind of ['live', 'parked', 'hidden', 'protected'] as const) {
    test(`switching to never evicts the stored picture once, for a ${kind} panel (${strict ? 'StrictMode' : 'plain'})`, async () => {
      const r = await rigOf(kind, strict);
      assert.deepEqual(read(r), BEFORE[kind], 'control: the status before the switch');
      assert.deepEqual(r.spy.evicted, [], 'control: nothing evicted before the switch');
      if (kind !== 'live') assert.ok(r.spy.captured.includes(r.id), 'control: the park stored a picture of b');
      const res = done(turn(() => r.b.configure({ snapshot: 'never' })));
      assert.deepEqual([res.changed, res.now, res.later], [true, [], ['snapshot']]);
      assert.deepEqual(r.spy.evicted, [r.id], 'one ask, made by the commit that applied the switch');
      assert.equal(done(turn(() => r.b.configure({ snapshot: 'never' }))).changed, false);
      assert.equal(done(turn(() => r.b.configure({ title: 'again' }))).changed, true);
      assert.deepEqual(r.spy.evicted, [r.id], 'an equal patch and an unrelated patch ask nothing');
      if (kind === 'protected') {
        turn(() => r.b.show());
        await advanceFrames(900);
        assert.equal(r.b.getState().status, 'live');
        assert.deepEqual(r.spy.evicted, [r.id], 'showing the panel asks nothing');
      }
    });
  }
}

test('a switch between two values that are not never evicts nothing, and the next switch to never evicts once', async () => {
  const r = await parkRig();
  for (const snapshot of ['park', 'close', 'both', 'park'] as const) {
    assert.equal(done(turn(() => r.b.configure({ snapshot }))).changed, true, snapshot);
    assert.equal(r.b.getSettings().value.snapshot, snapshot);
    assert.deepEqual(r.spy.evicted, [], `switching to ${snapshot} asks nothing`);
  }
  assert.equal(done(turn(() => r.b.configure({ snapshot: 'never' }))).changed, true);
  assert.deepEqual(r.spy.evicted, [r.id], 'the switch to never asks once');
  assert.equal(done(turn(() => r.b.configure({ snapshot: 'both' }))).changed, true);
  assert.deepEqual(r.spy.evicted, [r.id], 'leaving never asks nothing');
});

test('a closed declared panel stores the switch and asks nothing, at the call or at the reopen', async () => {
  const r = await liveRig();
  mock.timers.enable({ apis: ['setTimeout'] });
  turn(() => r.b.close());
  act(() => mock.timers.tick(10001));
  assert.equal(r.b.getState().status, 'closed');
  const asked = r.spy.evicted.length;
  const res = done(turn(() => r.b.configure({ snapshot: 'never' })));
  assert.deepEqual([res.changed, res.now, res.later], [true, [], ['snapshot']]);
  assert.equal(r.spy.evicted.length, asked, 'the call asked nothing');
  turn(() => r.b.open());
  await advanceFrames(900);
  assert.deepEqual([r.b.getState().status, r.b.getSettings().value.snapshot], ['live', 'never']);
  assert.equal(r.spy.evicted.length, asked, 'the reopen asked nothing: only an id present in two successive commits is asked about');
});

test('a panel in its undo window stores the switch and asks nothing, at the call or at the undo', async () => {
  const r = await liveRig();
  mock.timers.enable({ apis: ['setTimeout'] });
  turn(() => r.b.close());
  assert.equal(r.b.getState().status, 'closed');
  const asked = r.spy.evicted.length;
  const res = done(turn(() => r.b.configure({ snapshot: 'never' })));
  assert.deepEqual([res.changed, res.now, res.later], [true, [], ['snapshot']]);
  assert.equal(r.spy.evicted.length, asked, 'the call asked nothing');
  turn(() => r.m.latest().undoClose());
  await advanceFrames(900);
  assert.deepEqual([r.b.getState().status, r.b.getSettings().value.snapshot], ['live', 'never']);
  assert.equal(r.spy.evicted.length, asked, 'the undo asked nothing: only an id present in two successive commits is asked about');
});

test('the ask is made by the commit that applies the switch: a child sees it before its own passive effect runs', async () => {
  const spy = spyOf();
  const ws = createWorkspace({
    mount: false,
    root: markerTemplate('root', { settings: { title: 'History' } }),
    templates: ['a', 'b', 'c'].map((id) => markerTemplate(id)),
  });
  const [, b] = ['a', 'b', 'c'].map((id) => ws.addPanel(id));
  const atPassive: number[] = [];
  function Watcher(): null {
    useEffect(() => {
      atPassive.push(spy.evicted.length);
    });
    return null;
  }
  function Probe(): React.ReactElement {
    useProvidePanels(panelsInput({ workspace: ws, containerWidth: 4000, capture: spy }));
    return React.createElement(Watcher);
  }
  mount(React.createElement(Probe));
  await flush();
  const before = atPassive.length;
  act(() => void b!.configure({ snapshot: 'never' }));
  assert.ok(atPassive.length > before, 'the switch committed and the child ran its passive effect');
  assert.deepEqual(atPassive.slice(before), [1]);
  assert.equal(spy.evicted.length, 1);
});
