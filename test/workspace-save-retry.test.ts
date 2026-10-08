/**
 * The persistence hook's last-saved baseline: it advances only when a save succeeds, so a save that rejects or throws
 * is reported once and saved again by the next change, never by a timer of its own.
 * Time is mocked over WORKSPACE_SAVE_QUIET_MS; the retry tests commit a new panels array through the hook itself,
 * because no workspace operation commits one whose projection stays equal.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createWorkspace } from '../index.js';
import type { PanelWindow, WorkspaceState, WorkspaceStorage } from '../index.js';
import { WORKSPACE_SAVE_QUIET_MS, useWorkspacePersistence } from '../panels/useWorkspacePersistence.js';
import { cleanup, mount } from './support/mount-harness.js';
import { ROOT, made, rootEntry } from './support/scroll-row.js';
import { markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => {
  cleanup();
  mock.timers.reset();
  mock.restoreAll();
});

type Update = (panels: PanelWindow[]) => PanelWindow[];
const add =
  (id: string): Update =>
  (panels) => [...panels, made(id)];
const without =
  (id: string): Update =>
  (panels) => panels.filter((p) => p.id !== id);
/** A new array holding the same entries: the projection is unchanged. */
const same: Update = (panels) => [...panels];

/** Fires the timers due within `ms` and lets the promise continuations they started run. */
const tick = (ms = WORKSPACE_SAVE_QUIET_MS): Promise<void> => act(async () => void mock.timers.tick(ms));
const turn = (): Promise<void> => act(async () => {});

/** The persistence hook alone over a one-entry row; `commit` is its `setPanels`. */
function hookRig(storage: WorkspaceStorage, onError?: (e: unknown) => void): { commit(update: Update): void } {
  let set: Dispatch<SetStateAction<PanelWindow[]>> | undefined;
  function Probe(): null {
    const [panels, setPanels] = React.useState<PanelWindow[]>(() => [rootEntry()]);
    set = setPanels;
    useWorkspacePersistence({ storage, panels, setPanels, rootId: ROOT, freshId: () => 'unused', defaultHostData: undefined, ...(onError === undefined ? {} : { onError }) });
    return null;
  }
  mount(React.createElement(Probe));
  return { commit: (update) => act(() => void set!(update)) };
}

/** A storage whose saves fail in `mode` until `heal()`; it keeps every state it was handed. */
function failingStorage(mode: 'reject' | 'throw'): { storage: WorkspaceStorage; saves: WorkspaceState[]; planted: Error; heal(): void } {
  const planted = new Error(`disk-${mode}`);
  const saves: WorkspaceState[] = [];
  let failing = true;
  const storage: WorkspaceStorage = {
    load: async () => null,
    save: (state) => {
      saves.push(state);
      if (!failing) return;
      if (mode === 'throw') throw planted;
      return Promise.reject(planted);
    },
  };
  return { storage, saves, planted, heal: () => void (failing = false) };
}

/** A storage whose every save stays pending until the test settles it. */
function pendingStorage(): { storage: WorkspaceStorage; saves: { state: WorkspaceState; resolve(): void; reject(e: unknown): void }[] } {
  const saves: { state: WorkspaceState; resolve(): void; reject(e: unknown): void }[] = [];
  const storage: WorkspaceStorage = {
    load: async () => null,
    save: (state) =>
      new Promise<void>((resolve, reject) => {
        saves.push({ state, resolve, reject });
      }),
  };
  return { storage, saves };
}

async function failedSaveIsRetried(mode: 'reject' | 'throw'): Promise<void> {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = markerTemplate(`retry-${mode}`, { settings: { multiple: true } });

  const viaWorkspace = failingStorage(mode);
  const errors: unknown[] = [];
  const w = createWorkspace({ storage: viaWorkspace.storage, templates: [t], onError: (e) => void errors.push(e) });
  mountWorkspace(w);
  await turn();
  act(() => void w.addPanel(t, { id: 'a' }));
  await assert.doesNotReject(async () => {
    await tick();
  }, 'the failure is not rethrown out of the timer');
  assert.equal(viaWorkspace.saves.length, 1);
  assert.deepEqual(errors, [viaWorkspace.planted], 'the failure reached onError once');
  viaWorkspace.heal();
  act(() => void w.addPanel(t, { id: 'b' }));
  await tick();
  assert.equal(viaWorkspace.saves.length, 2, 'the next change saved again');
  assert.equal(viaWorkspace.saves[1]!.panels.length, 2, 'with the full current state');
  assert.deepEqual(viaWorkspace.saves[1]!.panels[0], viaWorkspace.saves[0]!.panels[0]);
  assert.equal(errors.length, 1, 'no second report');
  cleanup();

  const logged = mock.method(console, 'error', () => {});
  const unreported = failingStorage(mode);
  const bare = createWorkspace({ storage: unreported.storage, templates: [t] });
  mountWorkspace(bare);
  await turn();
  act(() => void bare.addPanel(t, { id: 'c' }));
  await tick();
  assert.equal(unreported.saves.length, 1);
  assert.deepEqual(
    logged.mock.calls.map((c) => c.arguments),
    [[unreported.planted]],
    'with onError unset the failure reached console.error once',
  );
  cleanup();
  logged.mock.restore();

  const direct = failingStorage(mode);
  const heard: unknown[] = [];
  const rig = hookRig(direct.storage, (e) => void heard.push(e));
  await turn();
  rig.commit(add('a'));
  await tick();
  assert.equal(direct.saves.length, 1);
  assert.deepEqual(heard, [direct.planted]);
  direct.heal();
  rig.commit(same);
  await tick();
  assert.equal(direct.saves.length, 2, 'a new array whose projection equals the failed one saves again');
  assert.deepEqual(direct.saves[1], direct.saves[0]);
  assert.equal(heard.length, 1);
}

test('a rejected save keeps the baseline: the next change saves the full state again and the failure is reported once', async () => {
  await failedSaveIsRetried('reject');
});

test('a thrown save keeps the baseline: the next change saves the full state again and the failure is reported once', async () => {
  await failedSaveIsRetried('throw');
});

test('a save that resolves advances the baseline: a new array with an equal projection saves nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const saves: WorkspaceState[] = [];
  const rig = hookRig({
    load: async () => null,
    save: (state) => {
      saves.push(state);
      return Promise.resolve();
    },
  });
  await turn();
  rig.commit(add('a'));
  await tick();
  assert.equal(saves.length, 1);
  rig.commit(same);
  await tick();
  assert.equal(saves.length, 1, 'an equal projection after a resolved save is not saved again');
  rig.commit(add('b'));
  await tick();
  assert.equal(saves.length, 2, 'control: a changed projection is saved');
});

test('a save that returns nothing advances the baseline at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const saves: WorkspaceState[] = [];
  const rig = hookRig({ load: async () => null, save: (state) => void saves.push(state) });
  await turn();
  rig.commit(add('a'));
  // No microtask turn between the save and the commit: a baseline that waited for a promise would not be there yet.
  act(() => void mock.timers.tick(WORKSPACE_SAVE_QUIET_MS));
  rig.commit(same);
  act(() => void mock.timers.tick(WORKSPACE_SAVE_QUIET_MS));
  assert.equal(saves.length, 1);
  rig.commit(add('b'));
  act(() => void mock.timers.tick(WORKSPACE_SAVE_QUIET_MS));
  assert.equal(saves.length, 2, 'control: a changed projection is saved');
});

test('after a failed save no timer retries by itself, however long the wait', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const failing = failingStorage('reject');
  const heard: unknown[] = [];
  const rig = hookRig(failing.storage, (e) => void heard.push(e));
  await turn();
  rig.commit(add('a'));
  await tick();
  assert.equal(failing.saves.length, 1);
  for (let period = 0; period < 10; period++) await tick();
  assert.equal(failing.saves.length, 1, 'ten quiet periods later nothing was saved again');
  assert.equal(heard.length, 1);
  failing.heal();
  rig.commit(same);
  await tick();
  assert.equal(failing.saves.length, 2, 'control: a change is what retries');
});

test('saves that settle out of order: an older one never advances nor resets the baseline; content in flight is not saved twice, a return to the baseline is', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });

  {
    const { storage, saves } = pendingStorage();
    const heard: unknown[] = [];
    const rig = hookRig(storage, (e) => void heard.push(e));
    await turn();
    rig.commit(add('a'));
    await tick();
    rig.commit(add('b'));
    await tick();
    assert.equal(saves.length, 2, 'the newer save started while the older was pending');
    saves[1]!.resolve();
    await turn();
    const late = new Error('older');
    saves[0]!.reject(late);
    await turn();
    assert.deepEqual(heard, [late], 'the older failure is still reported once');
    rig.commit(same);
    await tick();
    assert.equal(saves.length, 2, 'older rejection after a newer success: the baseline stayed at the newer projection');
  }

  {
    const { storage, saves } = pendingStorage();
    const rig = hookRig(storage);
    await turn();
    rig.commit(add('a'));
    await tick();
    rig.commit(add('b'));
    await tick();
    saves[1]!.resolve();
    await turn();
    saves[0]!.resolve();
    await turn();
    rig.commit(same);
    await tick();
    assert.equal(saves.length, 2, 'older success after a newer success: the baseline stayed at the newer projection');
  }

  {
    const { storage, saves } = pendingStorage();
    const heard: unknown[] = [];
    const rig = hookRig(storage, (e) => void heard.push(e));
    await turn();
    rig.commit(add('a'));
    await tick();
    rig.commit(add('b'));
    await tick();
    const newer = new Error('newer');
    saves[1]!.reject(newer);
    await turn();
    saves[0]!.resolve();
    await turn();
    assert.deepEqual(heard, [newer]);
    rig.commit(without('b'));
    await tick();
    assert.equal(saves.length, 3, 'older success after a newer failure: the baseline stayed where it was, so the older projection is saved again');
  }

  {
    const { storage, saves } = pendingStorage();
    const rig = hookRig(storage, () => {});
    await turn();
    rig.commit(add('a'));
    await tick();
    rig.commit(same);
    await tick();
    assert.equal(saves.length, 1, 'the same content is already on its way');
    saves[0]!.reject(new Error('down'));
    await turn();
    rig.commit(same);
    await tick();
    assert.equal(saves.length, 2, 'after the failure the same content retries');
  }

  {
    const { storage, saves } = pendingStorage();
    const rig = hookRig(storage);
    await turn();
    rig.commit(add('a'));
    await tick();
    saves[0]!.resolve();
    await turn();
    rig.commit(add('b'));
    await tick();
    rig.commit(without('b'));
    await tick();
    assert.equal(saves.length, 3, 'a change back to the baseline is saved while a save is in flight, because that save may land after it');
    assert.equal(saves[2]!.state.panels.length, 1);
  }
});
