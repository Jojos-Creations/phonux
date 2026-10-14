/**
 * A panel made after a restore never takes the key of a restored panel, though the counter behind default ids starts
 * again at every launch.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, useProvidePanels } from '../index.js';
import type { ProvidedPanels, WorkspaceState } from '../index.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';
import { panelKey } from '../panelSettings.js';
import { definePanel } from '../panelTemplate.js';
import { nextEngineId, seedEngineIdsPast } from '../workspaceCore.js';
import { createHistoryPanel } from '../panelWindow.js';
import { cleanup, mount, panelsInput } from './support/mount-harness.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';

afterEach(() => cleanup());


const saved = (view: string, keys: readonly string[]): WorkspaceState => ({
  version: 1,
  panels: keys.map((key, k) => ({ id: String(k + 1), key, view, title: key, live: true, anchor: { panel: 'root', position: 'right', priority: k } })),
});
// The counter is process-wide, so the saved keys sit just ahead of wherever it stands now.
const sparse = (template: string): string[] => {
  const here = Number(nextEngineId());
  return [3, 6, 9, 12].map((n) => `${template}~${here + n}`);
};
/** The next number the counter hands out; reading it spends one. */
const counter = (): number => Number(nextEngineId());

test('new anonymous panels after a restore take keys no restored panel holds', async () => {
  const t = markerTemplate('reseed-a', { settings: { multiple: true } });
  const keys = sparse('reseed-a');
  const storage = memoryWorkspaceStorage();
  void storage.save(saved('reseed-a', keys));
  const w = createWorkspace({ mount: false, storage, templates: [t] });
  mountWorkspace(w);
  await flush();
  const made: string[] = [];
  for (let k = 0; k < 12; k += 1) act(() => void made.push(w.addPanel(t).id));
  const all = w.panels.getSnapshot().panels.map((p) => p.id);
  assert.equal(new Set(all).size, all.length, `keys are unique: ${all.join(', ')}`);
  assert.equal(all.length, 16, 'the restored panels and the twelve new ones are all present');
  for (const key of keys) assert.ok(!made.includes(key), `${key} was handed to a new panel`);
});

test('the hand-wired hook restores through the same seed: create after a restore takes no restored key', async () => {
  const t = definePanel({ id: 'reseed-b', view: () => null, settings: { multiple: true } });
  const keys = sparse('reseed-b');
  const storage = memoryWorkspaceStorage();
  void storage.save(saved('reseed-b', keys));
  let latest: ProvidedPanels | undefined;
  const Probe = (): null => {
    latest = useProvidePanels(panelsInput({ initialEntries: [createHistoryPanel('root')], storage, templates: [t], defaultView: 'reseed-b' }));
    return null;
  };
  mount(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  await flush();
  for (let k = 0; k < 12; k += 1) act(() => latest!.create({ view: 'reseed-b' }));
  const ids = latest!.entries.filter((p) => p.view === 'reseed-b').map(panelKey);
  assert.equal(new Set(ids).size, ids.length, `keys are unique: ${ids.join(', ')}`);
  assert.equal(ids.length, 16, 'the restored panels and the twelve new ones are all present');
});

test('a workspace with an anonymous multiple panel before it is ready needs an explicit id, so the counter is not drawn on early', () => {
  const t = markerTemplate('reseed-c', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, storage: { load: () => new Promise(() => {}), save: () => {} }, templates: [t] });
  assert.throws(() => w.addPanel(t), (e: unknown) => (e as { code?: string }).code === 'instance-id-required');
});

test('the seed moves the counter past the number after the first ~ and nothing else', () => {
  const base = counter();
  seedEngineIdsPast([`w~${base + 40}`, undefined, 'plain', `w~${base + 100}`, `w~${base + 5}`]);
  assert.equal(counter(), base + 101, 'the highest key sets it, and a lower one later does not lower it');
});

test('a key whose suffix is not a plain count never moves the counter', () => {
  const base = counter();
  seedEngineIdsPast([
    'w~123e4567-e89b-42d3-a456-426614174000',
    'w~0900000000',
    'w~1e9',
    'w~99999999999999999999',
    `w~9007199254740991`,
    'w~',
    'w~-5',
    'w~1.5',
    'w~y~900000000',
    'w~ 900000000',
  ]);
  assert.equal(counter(), base + 1, 'the counter went on by one');
});

test('seeding twice, as StrictMode runs the restore effect twice, lands on the same counter', () => {
  const base = counter();
  seedEngineIdsPast([`w~${base + 10}`]);
  seedEngineIdsPast([`w~${base + 10}`]);
  assert.equal(counter(), base + 11);
});
