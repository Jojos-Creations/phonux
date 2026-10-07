/**
 * Mounted rows driven by useProvidePanels: who parks, who scrolls, and which cap prices a wide panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels } from '../index.js';
import type { PanelWindow, ProvidedPanels } from '../index.js';
import { cleanup, mount, panelsInput } from './support/mount-harness.js';

afterEach(() => cleanup());

const legacyRoot = (): PanelWindow => ({ id: 'root', url: '', title: 'History', live: true, locked: true, view: 'web', collapsible: false, listed: false });

test('pin R4: a row of hand-built entries at container 1000 keeps History and the newest panel live', () => {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: [legacyRoot()], containerWidth: 1000 }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  for (let i = 0; i < 3; i += 1) act(() => latest!.create());
  const ids = latest!.entries.map((p) => p.id);
  assert.equal(ids.length, 4);
  assert.deepEqual(latest!.entries.filter((p) => p.live).map((p) => p.id), ['root', ids[3]]);
});
