/**
 * What a view reaches as `useHost().panels` on the auto mount: the PanelsAPI members only, with the per-panel verbs deprecated
 * (each still works and warns once in development, naming what replaces it).
 */
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

async function rig() {
  const seen: { panels?: PanelsAPI } = {};
  const probe = definePanel({
    id: 'probe',
    settings: { frame: 'none' },
    view: () => {
      seen.panels = useHost().panels;
      return React.createElement('i', { 'data-slot': 'probe' });
    },
  });
  const other = definePanel({ id: 'other', settings: { frame: 'none', multiple: true }, view: ({ handle }) => React.createElement('i', { 'data-slot': handle.id }) });
  await resize(1600);
  const ws = track(createWorkspace({ templates: [probe, other] }));
  ws.addPanel(probe);
  const first = ws.addPanel(other, { id: 'one' });
  const second = ws.addPanel(other, { id: 'two' });
  await until('the panels', () => slots(document.body).length === 3);
  return { ws, seen, first, second };
}

test('a view is given the PanelsAPI members and none of the row\'s own', async () => {
  const { seen } = await rig();
  assert.deepEqual(Object.keys(seen.panels!).sort(), ['activate', 'clearAll', 'close', 'create', 'maxFitPanels', 'move', 'panelList', 'reanchor', 'recentlyClosed', 'setFormFactor', 'setSlots', 'undoClose']);
  for (const name of ['entries', 'rowNumbers', 'tuning', 'liveWidths', 'fixedViewCount', 'scrollTo', 'followPanel']) assert.equal(name in seen.panels!, false, name);
  assert.equal(typeof seen.panels!.maxFitPanels, 'number', 'maxFitPanels is a number once the row is measured');
});

test('each per-panel verb still works and warns once, naming what replaces it', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const { ws, seen, first, second } = await rig();
  const panels = (): PanelsAPI => seen.panels!;
  const warnings = (): string[] => warn.mock.calls.map((c) => String(c.arguments[0]));
  const verbs = ['activate', 'move', 'setFormFactor', 'setSlots', 'reanchor', 'close', 'create'];

  act(() => panels().setSlots!(first.id, 2));
  act(() => panels().setSlots!(first.id, 1));
  act(() => panels().setFormFactor(first.id, 'tablet'));
  assert.equal(ws.panels.get(first.id)!.getState().formFactor, 'tablet', 'setFormFactor');
  const order = (): string => ws.panels.list().map((h) => h.id).join(',');
  const before = order();
  act(() => panels().move(first.id, 'right'));
  assert.notEqual(order(), before, 'move');
  act(() => panels().reanchor(second.id, { position: 'left' }));
  act(() => panels().create({ view: 'other', title: 'made' }));
  act(() => panels().create());
  act(() => ws.panels.get(second.id)!.hide());
  await until('parked', () => ws.panels.get(second.id)!.getState().status === 'parked');
  act(() => panels().activate(second.id));
  await until('live again', () => ws.panels.get(second.id)!.getState().status === 'live');
  act(() => panels().close(first.id));
  await until('closed', () => ws.panels.get(first.id)!.getState().status === 'closed');
  act(() => panels().close(first.id));

  for (const verb of verbs) assert.equal(warnings().filter((w) => w.includes(`panels.${verb} is deprecated`)).length, 1, `${verb}: one warning, however often it is called`);
  assert.match(warnings().find((w) => w.includes('panels.close'))!, /useWorkspace\(\)\.panels\.get\(key\)\?\.close\(\)/);
});

test('the read members, undoClose and clearAll do not warn', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const { seen } = await rig();
  const panels = seen.panels!;
  assert.ok(panels.panelList.length >= 0);
  void panels.recentlyClosed;
  void panels.maxFitPanels;
  act(() => panels.undoClose());
  act(() => panels.clearAll());
  assert.equal(warn.mock.calls.filter((c) => String(c.arguments[0]).includes('deprecated')).length, 0);
});
