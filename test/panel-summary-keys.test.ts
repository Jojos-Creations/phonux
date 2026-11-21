/** What a view learns of a panel through `useHost().panels`: exactly the PanelSummary keys, never the host's own record. */
import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, definePanel, useHost } from '../index.js';
import type { PanelsAPI } from '../index.js';
import { rigCleanup, resize, slots, track, until } from './support/auto-rig.js';

afterEach(() => {
  mock.restoreAll();
  rigCleanup();
});

const SUMMARY_KEYS = ['id', 'live', 'maxSlots', 'params', 'slots', 'title', 'url'];

async function rig() {
  const seen: { panels?: PanelsAPI } = {};
  const probe = definePanel({
    id: 'probe',
    settings: {},
    view: () => {
      seen.panels = useHost().panels;
      return React.createElement('i', { 'data-slot': 'probe' });
    },
  });
  const other = definePanel({ id: 'other', settings: { multiple: true }, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });
  await resize(1600);
  const ws = track(createWorkspace({ templates: [probe, other] }));
  ws.addPanel(probe);
  ws.addPanel(other, { id: 'one' });
  ws.addPanel(other, { id: 'two' });
  await until('the panels', () => slots(document.body).length === 3);
  return { ws, seen };
}

test('panelList holds exactly the PanelSummary keys for every panel', async () => {
  const { seen } = await rig();
  const list = seen.panels!.panelList;
  assert.ok(list.length >= 2, 'precondition: the listed panels are there');
  assert.deepEqual(list.map((p) => Object.keys(p).sort()), list.map(() => SUMMARY_KEYS));
});

test('recentlyClosed holds exactly the PanelSummary keys as well', async () => {
  const { ws, seen } = await rig();
  act(() => ws.panels.get('one')!.close());
  await until('the close is in the undo window', () => (seen.panels!.recentlyClosed?.length ?? 0) > 0);
  assert.deepEqual(seen.panels!.recentlyClosed!.map((p) => Object.keys(p).sort()), seen.panels!.recentlyClosed!.map(() => SUMMARY_KEYS));
});
