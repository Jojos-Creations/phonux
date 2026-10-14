/** A closed panel keeps its view state until its undo window ends, under the key the row holds it by. */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, useProvidePanels, useViewState } from '../index.js';
import type { PanelWindow, ProvidedPanels } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import { createFakeHost } from '../fakeHost.js';
import { advanceFrames, cleanup, mount, withHost, useSeededInput } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

let stored = -1;
let setStored: ((n: number) => void) | undefined;

registerTestView('cvs-view', () => {
  const [value, setValue] = useViewState('n', 0);
  stored = value;
  setStored = setValue;
  return React.createElement('i');
});
registerTestView('cvs-root', () => React.createElement('b'));

const base = resolvePanelSettings().value;
const entry = (over: Partial<PanelWindow>): PanelWindow => ({
  id: 'a',
  url: 'https://a.example',
  title: 'a',
  live: true,
  locked: false,
  view: 'cvs-view',
  collapsible: true,
  listed: true,
  settings: { ...base },
  ...over,
});
const root = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'cvs-root', collapsible: false, listed: false });

afterEach(() => {
  cleanup();
  stored = -1;
});

async function liveRow(key?: string): Promise<() => ProvidedPanels> {
  let latest: ProvidedPanels | undefined;
  function Driver(): React.ReactElement {
    const input = useSeededInput({ initialEntries: [root(), entry(key === undefined ? {} : { key })], containerWidth: 1000 });
    latest = useProvidePanels(input);
    const row = React.createElement(PanelRow, {
      workspace: input.workspace,
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
  mount(React.createElement(Driver));
  await advanceFrames(1000);
  act(() => setStored!(9));
  return () => latest!;
}

test('the view state of a closed panel is intact after an undo', async () => {
  const provided = await liveRow();
  act(() => provided().close('a'));
  await advanceFrames(1000);
  act(() => provided().undoClose());
  await advanceFrames(1000);
  assert.equal(stored, 9);
});

test('the view state of a panel whose key differs from its row id is intact after an undo', async () => {
  const provided = await liveRow('web~a');
  act(() => provided().close('web~a'));
  await advanceFrames(1000);
  act(() => provided().undoClose());
  await advanceFrames(1000);
  assert.equal(stored, 9, 'the state survived the undo window under the key');
});
