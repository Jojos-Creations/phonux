/**
 * How long a kept view lives: it mounts at the first show and never at a park, and it ends at a close, clearAll, a
 * re-render with keepMounted false or the row's own unmount. None of it is saved.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, registerView, resolvePanelSettings, useProvidePanels, useViewState } from '../index.js';
import type { PanelWindow, ProvidedPanels } from '../index.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { createFakeHost } from '../fakeHost.js';
import { advanceFrames, cleanup, mount, panelsInput, withHost } from './support/mount-harness.js';

const counts = new Map<string, { mounts: number; unmounts: number }>();
const countOf = (id: string): { mounts: number; unmounts: number } => {
  let c = counts.get(id);
  if (c === undefined) counts.set(id, (c = { mounts: 0, unmounts: 0 }));
  return c;
};
let stored = -1;
let setStored: ((n: number) => void) | undefined;

registerView('kl-view', ({ panel }) => {
  React.useEffect(() => {
    countOf(panel.id).mounts += 1;
    return () => {
      countOf(panel.id).unmounts += 1;
    };
  }, []);
  const [value, setValue] = useViewState('n', 0);
  if (panel.id === 'a') {
    stored = value;
    setStored = setValue;
  }
  return React.createElement('i', { 'data-slot': panel.id });
});
registerView('kl-root', () => React.createElement('b'));

const base = resolvePanelSettings().value;
const entry = (id: string, live: boolean, keep: boolean, over: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  title: id,
  live,
  locked: false,
  view: 'kl-view',
  collapsible: true,
  listed: true,
  settings: { ...base, overflow: 'park', keepMounted: keep },
  ...over,
});
const root = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'kl-root', collapsible: false, listed: false });
const NONE: ReadonlySet<string> = new Set();
const rowOf = (entries: PanelWindow[]): React.ReactElement => withHost(React.createElement(PanelRow, { entries, rootId: 'root', closingIds: NONE, enteringViaAnchorIds: NONE }));
const present = (container: HTMLElement, id: string): boolean => container.querySelector(`[data-slot="${id}"]`) !== null;

afterEach(() => {
  cleanup();
  counts.clear();
  stored = -1;
});

test('lazy mount: a panel that arrives parked, restored or by startVisibility, renders no view until it is first shown', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(at(false));
  await advanceFrames(1000);
  assert.equal(countOf('a').mounts, 0);
  assert.equal(present(mounted.container, 'a'), false);
  mounted.rerender(at(true));
  await advanceFrames(1000);
  assert.equal(countOf('a').mounts, 1);
});

test('lazy mount: a panel that parks in the same commit it would first have been live never mounts', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(rowOf([root()]));
  act(() => {
    mounted.rerender(at(true));
    mounted.rerender(at(false));
  });
  await advanceFrames(1000);
  assert.equal(countOf('a').mounts, 0);
  assert.equal(present(mounted.container, 'a'), false);
});

/** A root plus a kept `a` in a row driven by useProvidePanels, parked by capacity once two more panels open. */
async function parkedByCapacity(keep = true, park = true): Promise<{ provided: () => ProvidedPanels; container: HTMLElement; unmount: () => void }> {
  let latest: ProvidedPanels | undefined;
  function Driver(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: [root(), entry('a', true, keep)], containerWidth: 1000 }));
    // The row reads the undo window from the host's panels, so the host is built from the provided ones.
    const row = React.createElement(PanelRow, {
      entries: latest.entries,
      rootId: 'root',
      closingIds: latest.closingIds,
      enteringViaAnchorIds: latest.enteringViaAnchorIds,
      exitRightIds: latest.exitRightIds,
      enterSideById: latest.enterSideById,
      maxLiveWidth: latest.maxLiveWidth,
    });
    return withHost(row, createFakeHost({ panels: latest }));
  }
  const mounted = mount(React.createElement(Driver));
  await advanceFrames(1000);
  act(() => setStored!(9));
  for (let i = 0; park && i < 6 && latest!.entries.find((p) => p.id === 'a')!.live; i += 1) {
    act(() => latest!.create());
    await advanceFrames(100);
  }
  await advanceFrames(1000);
  assert.equal(latest!.entries.find((p) => p.id === 'a')!.live, !park, park ? 'a was parked by capacity' : 'a stays live');
  return { provided: () => latest!, container: mounted.container, unmount: mounted.unmount };
}

test('lifetime: closing a hidden kept panel unmounts it within three frames', async () => {
  const row = await parkedByCapacity();
  assert.equal(present(row.container, 'a'), true, 'kept while hidden');
  act(() => row.provided().close('a'));
  await advanceFrames(48);
  assert.equal(present(row.container, 'a'), false);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('lifetime: control, a live panel is still on its way out three frames after its close', async () => {
  const control = await parkedByCapacity(false, false);
  act(() => control.provided().close('a'));
  await advanceFrames(48);
  assert.equal(present(control.container, 'a'), true);
});

test('lifetime: clearAll unmounts a hidden kept panel', async () => {
  const row = await parkedByCapacity();
  act(() => row.provided().clearAll());
  await advanceFrames(1000);
  assert.equal(present(row.container, 'a'), false);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('lifetime: a re-render with keepMounted false unmounts a hidden panel', async () => {
  const at = (live: boolean, keep: boolean): React.ReactElement => rowOf([root(), entry('a', live, keep)]);
  const mounted = mount(at(true, true));
  await advanceFrames(1000);
  mounted.rerender(at(false, true));
  await advanceFrames(1000);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 0 });
  mounted.rerender(at(false, false));
  await advanceFrames(1000);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('lifetime: the row unmounting unmounts a hidden kept panel', async () => {
  const at = (live: boolean): React.ReactElement => rowOf([root(), entry('a', live, true)]);
  const mounted = mount(at(true));
  await advanceFrames(1000);
  mounted.rerender(at(false));
  await advanceFrames(1000);
  mounted.unmount();
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
});

test('lifetime: an undo brings a closed kept panel back parked, and showing it remounts the view fresh', async () => {
  const row = await parkedByCapacity();
  act(() => row.provided().close('a'));
  await advanceFrames(1000);
  assert.deepEqual(countOf('a'), { mounts: 1, unmounts: 1 });
  act(() => row.provided().undoClose());
  await advanceFrames(1000);
  assert.equal(row.provided().entries.find((p) => p.id === 'a')!.live, false, 'restored parked, so not mounted until shown');
  assert.equal(countOf('a').mounts, 1);
  act(() => row.provided().activate('a'));
  await advanceFrames(1000);
  assert.equal(countOf('a').mounts, 2);
});

test('lifetime: the viewState a closed kept view held is intact after an undo and a show', async () => {
  const row = await parkedByCapacity();
  act(() => row.provided().close('a'));
  await advanceFrames(1000);
  act(() => row.provided().undoClose());
  act(() => row.provided().activate('a'));
  await advanceFrames(1000);
  assert.equal(stored, 9);
});

test('lifetime: nothing about a kept entry is saved', async () => {
  const row = await parkedByCapacity();
  assert.equal(JSON.stringify(projectWorkspaceState(row.provided().entries, 'root')).includes('keepMounted'), false);
});
