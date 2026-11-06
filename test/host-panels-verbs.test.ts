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
  const first = ws.addPanel(other, { id: 'one' });
  const second = ws.addPanel(other, { id: 'two' });
  await until('the panels', () => slots(document.body).length === 3);
  return { ws, seen, first, second };
}

test('a view is given the PanelsAPI members and none of the row\'s own', async () => {
  const { seen } = await rig();
  assert.deepEqual(Object.keys(seen.panels!).sort(), ['activate', 'clearAll', 'close', 'closedByPerson', 'create', 'maxFitPanels', 'move', 'panelList', 'reanchor', 'recentlyClosed', 'setSlots', 'undoClose']);
  for (const name of ['entries', 'rowNumbers', 'tuning', 'liveWidths', 'fixedViewCount', 'scrollTo', 'followPanel']) assert.equal(name in seen.panels!, false, name);
  assert.equal(typeof seen.panels!.maxFitPanels, 'number', 'maxFitPanels is a number once the row is measured');
});

const REPLACEMENTS: Record<string, RegExp> = {
  activate: /useWorkspace\(\)\.panels\.get\(key\)\?\.show\(\)/,
  move: /useWorkspace\(\)\.panels\.get\(key\)\?\.move\(count\)/,
  setSlots: /useWorkspace\(\)\.panels\.get\(key\)\?\.setSlots\(slots\)/,
  reanchor: /useWorkspace\(\)\.panels\.get\(key\)\?\.place\(anchor\)/,
  close: /useWorkspace\(\)\.panels\.get\(key\)\?\.close\(\)/,
  create: /useWorkspace\(\)\.panels\.addPanel\(template\)/,
};

test('each per-panel verb still does its work, and warns once naming what replaces it', async () => {
  const warn = mock.method(console, 'warn', () => undefined);
  const { ws, seen, first, second } = await rig();
  const panels = (): PanelsAPI => seen.panels!;
  const order = (): string => ws.panels.list().map((h) => h.id).join(',');
  const slotsOf = (id: string): number | undefined => panels().panelList.find((p) => p.id === id)?.slots;

  assert.notEqual(slotsOf(first.id), 2, 'control: the panel starts narrower');
  act(() => panels().setSlots!(first.id, 2));
  await until('the panel is two slots wide', () => slotsOf(first.id) === 2);

  const beforeMove = order();
  act(() => panels().move(first.id, 'right'));
  assert.notEqual(order(), beforeMove, 'move');

  const beforeAnchor = order();
  act(() => panels().reanchor(second.id, { position: 'left' }));
  assert.notEqual(order(), beforeAnchor, 'reanchor');

  const before = ws.panels.list().length;
  act(() => panels().create({ view: 'other', title: 'made' }));
  await until('the created panel', () => ws.panels.list().length === before + 1);
  assert.ok(panels().panelList.some((p) => p.title === 'made'), 'create');

  act(() => ws.panels.get(second.id)!.hide());
  await until('parked', () => ws.panels.get(second.id)!.getState().status === 'parked');
  act(() => panels().activate(second.id));
  await until('live again', () => ws.panels.get(second.id)!.getState().status === 'live');

  act(() => panels().close(first.id));
  await until('closed', () => ws.panels.get(first.id)!.getState().status === 'closed');

  // The warning is once per process, so a second round proves it is not once per call.
  act(() => panels().setSlots!(first.id, 1));
  act(() => panels().move(second.id, 'right'));
  act(() => panels().reanchor(second.id, { position: 'left' }));
  act(() => panels().create({ view: 'other' }));
  act(() => panels().activate(second.id));
  act(() => panels().close(second.id));
  const warnings = warn.mock.calls.map((c) => String(c.arguments[0]));
  for (const [verb, replacement] of Object.entries(REPLACEMENTS)) {
    const own = warnings.filter((w) => w.includes(`panels.${verb} is deprecated`));
    assert.equal(own.length, 1, `${verb}: one warning, however often it is called`);
    assert.match(own[0]!, replacement, `${verb}: names its replacement`);
  }
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
