/**
 * What the workspace restore does where a load fails or misbehaves. A pin states what the code does; the ones that
 * name a defect say KNOWN-BAD, and a change that fixes one renames the pin, never deletes it.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels, type PanelWindow, type PanelsInput, type ProvidedPanels, type WorkspaceState, type WorkspaceStorage } from '../index.js';
import { createRootPanel } from '../panelWindow.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

registerTestView('pin-persistence', ({ panel }) => React.createElement('i', null, panel.title));

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const ROOT = 'root';
const QUIET_MS = 200;

const savedPanel = (id: string, priority: number): WorkspaceState['panels'][number] => ({
  id,
  view: 'pin-persistence',
  url: `https://${id}.example`,
  live: true,
  anchor: { panel: ROOT, position: 'right', priority },
});
const savedFile = (): WorkspaceState => ({ version: 1, panels: [savedPanel('x', 0), savedPanel('y', 1)] });

interface Mounted {
  latest: () => ProvidedPanels;
  ids: () => string[];
  saves: WorkspaceState[];
  loads: () => number;
  unmount: () => void;
}

/** A provider over History alone whose storage loads through `load`; every save is recorded. */
function mountProvider(load: () => Promise<WorkspaceState | null>, over: Partial<PanelsInput> = {}, strict = false): Mounted {
  const saves: WorkspaceState[] = [];
  let loadCalls = 0;
  const storage: WorkspaceStorage = {
    load: () => {
      loadCalls += 1;
      return load();
    },
    save: (state) => void saves.push(state),
  };
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [createRootPanel(ROOT)], storage, tuning: { saveQuietMs: QUIET_MS }, ...over }));
    return React.createElement('output');
  }
  const mounted = mount(strict ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe));
  return { latest: () => latest!, ids: () => latest!.entries.map((p: PanelWindow) => p.id), saves, loads: () => loadCalls, unmount: mounted.unmount };
}

/** Lets the load settle, then advances the save timer past its quiet time. */
async function settleAndWait(): Promise<void> {
  await act(async () => {});
  act(() => mock.timers.tick(QUIET_MS + 50));
}

const nothingSaved: { name: string; load: () => Promise<WorkspaceState | null> }[] = [{ name: 'null', load: () => Promise.resolve(null) }];
const unreadable: { name: string; load: () => Promise<WorkspaceState | null> }[] = [
  { name: 'a rejection', load: () => Promise.reject(new Error('disk gone')) },
  {
    name: 'a throw',
    load: () => {
      throw new Error('load threw');
    },
  },
  { name: 'an invalid file', load: () => Promise.resolve({ version: 1, panels: 'x' } as unknown as WorkspaceState) },
  { name: 'an unknown version', load: () => Promise.resolve({ version: 2, panels: [savedPanel('x', 0)] } as unknown as WorkspaceState) },
];

for (const { name, load } of nothingSaved) {
  test(`load that finds ${name}: nothing is restored, and a later change is saved`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const m = mountProvider(load);
    await settleAndWait();
    assert.deepEqual(m.ids(), [ROOT], 'nothing came back from the load');
    assert.equal(m.saves.length, 0, 'control: a load alone saves nothing');
    act(() => m.latest().create({ view: 'pin-persistence', title: 'later' }));
    act(() => mock.timers.tick(QUIET_MS + 50));
    assert.equal(m.saves.length, 1, 'the change after the load was saved');
    assert.equal(m.saves[0]!.panels.length, 1);
  });
}

for (const { name, load } of unreadable) {
  test(`failed load (${name}): nothing is restored, it is reported, and no change is saved over the file`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const warn = mock.method(console, 'warn', () => undefined);
    const reported = mock.method(console, 'error', () => undefined);
    const m = mountProvider(load);
    await settleAndWait();
    assert.deepEqual(m.ids(), [ROOT], 'nothing came back from the failed load');
    assert.equal(reported.mock.callCount(), 1, 'the failure is reported once');
    act(() => m.latest().create({ view: 'pin-persistence', title: 'later' }));
    act(() => mock.timers.tick(QUIET_MS + 50));
    assert.deepEqual(m.ids().length, 2, 'the panel is still made');
    assert.equal(m.saves.length, 0, 'the file the load could not read is not replaced');
    warn.mock.restore();
    reported.mock.restore();
  });
}

test('StrictMode applies one load: the saved panels come back once, not twice', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const m = mountProvider(() => Promise.resolve(savedFile()), {}, true);
  await settleAndWait();
  assert.equal(m.loads(), 2, 'control: StrictMode ran the mount effect twice, so load was asked twice');
  assert.equal(m.ids().length, 3, 'History and the two saved panels, each once');
});

test('an unmount drops the last change: nothing flushes on the way out', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const m = mountProvider(() => Promise.resolve(null));
  await settleAndWait();
  act(() => m.latest().create({ view: 'pin-persistence' }));
  m.unmount();
  act(() => mock.timers.tick(QUIET_MS * 5));
  assert.equal(m.saves.length, 0);
});

test('a throw inside the load success handler takes the failed-load path: the workspace settles, the throw is reported, and the file it could not restore is not saved over', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const planted = new Error('planted in the success handler');
  const seen: unknown[] = [];
  const reported = mock.method(console, 'error', () => undefined);
  const listeners = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason) => void seen.push(reason));
  try {
    let thrown = false;
    const m = mountProvider(() => Promise.resolve(savedFile()), {
      defaultHostData: () => {
        if (!thrown) {
          thrown = true;
          throw planted;
        }
        return null;
      },
    });
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(seen.length, 0, 'the throw no longer surfaces as an unhandled rejection');
    assert.equal(thrown, true, 'control: the planted throw did run');
    assert.deepEqual(m.ids(), [ROOT], 'nothing from the file was applied');
    act(() => m.latest().create({ view: 'pin-persistence', title: 'later' }));
    act(() => mock.timers.tick(QUIET_MS * 5));
    assert.equal(m.ids().length, 2, 'the workspace settled: the new panel was made');
    assert.deepEqual(reported.mock.calls.map((c) => c.arguments[0]), [planted]);
    assert.equal(m.saves.length, 0, 'the file that could not be restored is not replaced');
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const listener of listeners) process.on('unhandledRejection', listener);
    reported.mock.restore();
  }
});
