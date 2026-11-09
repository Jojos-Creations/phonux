/**
 * Raising `tuning.maxLivePanels` brings back the 'manual' panels the CAPACITY parked, most recently parked first, in one commit,
 * up to the new value. Nothing else does: an equal or lower value, a mount, a resize, a panel the host hid, and a raise
 * before the workspace has loaded all return nothing.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { createWorkspace, useProvidePanels } from '../index.js';
import type { PanelWindow, ProvidedPanels } from '../index.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { markerTemplate } from './support/workspace-row.js';
import { capRig, rowOf } from './support/cap-rig.js';

afterEach(cleanup);

const raise = (r: Awaited<ReturnType<typeof capRig>>, n: number | null) => r.turn(() => r.ws.panels.configureTuning({ maxLivePanels: n }));

test('a raise before the workspace has loaded is stored for the load to read, and nothing is refilled without a row', () => {
  const ws = createWorkspace({ mount: false, root: markerTemplate('root'), templates: [markerTemplate('a')], tuning: { maxLivePanels: 2 } });
  const result = ws.panels.configureTuning({ maxLivePanels: 4 });
  assert.equal(result.ok, true);
  assert.equal(ws.tuning.maxLivePanels, 4);
  assert.equal(ws.status, 'detached');
});

test('returned panels land where they were and the panels already live keep their order', async () => {
  const r = await capRig({ count: 5, width: 4000, cap: 2 });
  const liveBefore = r.unpinnedLive();
  raise(r, 4);
  await r.settle();
  assert.deepEqual(r.unpinnedLive().filter((n) => liveBefore.includes(n)), liveBefore);
  assert.equal(r.row().split(' ').indexOf('w2') < r.row().split(' ').indexOf('w3'), true, 'w2 returned in place, left of the live w3');
});

/** A hand-built row, which has no scroll entry and no settings: the walk a raise takes is the capacity-rise walk, bounded by the window. */
function flatRow(width: number, cap: number): { row: () => string; raiseTo: (n: number) => void; seen: string[] } {
  const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id, live: true, view: 'web', collapsible: true, listed: true, ...over });
  const entries = [entry('root', { url: '', title: 'History', collapsible: false, listed: false }), ...['a', 'b', 'c', 'd', 'e', 'f'].map((id) => entry(id))];
  let latest: ProvidedPanels | undefined;
  const seen: string[] = [];
  let setCap: (n: number) => void = () => undefined;
  function Probe(): React.ReactElement {
    const [n, set] = React.useState(cap);
    setCap = set;
    latest = useProvidePanels(useSeededInput({ initialEntries: entries, containerWidth: width, workspaceDefaults: { overflow: 'park' }, tuning: { maxLivePanels: n } }));
    seen.push(rowOf(latest.entries));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return { row: () => rowOf(latest!.entries), raiseTo: (n) => void act(() => setCap(n)), seen };
}

