/**
 * `tuning.maxLivePanels`: how many unpinned parkable panels are live. A scrolling row keeps exactly N whatever the
 * window, a row that does not scroll keeps the smaller of the window's fit and N, the cap holds before the row is
 * measured, and a new value at run time parks at once. Rows are written as the rig writes them: names in array order,
 * `*` after a parked panel.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { createWorkspace, useProvidePanels } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelWindow, ProvidedPanels, WorkspaceTuning } from '../index.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, useSeededInput } from './support/mount-harness.js';
import { capRig, liveRightOfRoot, rowOf } from './support/cap-rig.js';
import { markerTemplate } from './support/workspace-row.js';

afterEach(() => cleanup());

const thrownCode = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

test('a workspace made with a value that is not an integer of 1 or more starts with no cap, as its other tuning leaves do', () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, '3', true]) {
    const ws = createWorkspace({ mount: false, root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: bad as never } });
    assert.equal(ws.tuning.maxLivePanels, null, String(bad));
  }
  assert.equal(createWorkspace({ mount: false, root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: 3 } }).tuning.maxLivePanels, 3);
  assert.equal(createWorkspace({ mount: false, root: markerTemplate('root'), templates: [] }).tuning.maxLivePanels, null, 'left out, there is none');
});

test('null is a value of its own: a workspace takes it as no cap, and a panel layer carrying it is refused like any other tuning key', () => {
  assert.equal(createWorkspace({ mount: false, root: markerTemplate('root'), templates: [], tuning: { maxLivePanels: null } }).tuning.maxLivePanels, null);
  assert.throws(() => resolvePanelSettings({ instance: { tuning: { maxLivePanels: null } } as never }), /instance\.tuning/);
});

// ---------------------------------------------------------------------------
// A row that does not scroll
// ---------------------------------------------------------------------------

const entry = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id.toUpperCase(), live: true, view: 'web', collapsible: true, listed: true, ...over });
const historyEntry = (): PanelWindow => entry('root', { url: '', title: 'History', collapsible: false, listed: false });

/** Hand-built entries, which carry no settings and so give a row with no scroll entry. `rows` collects the row of every committed render. */
function handBuilt(entries: PanelWindow[], width: number, tuning?: WorkspaceTuning, rows?: string[], strict = false): { now: () => ProvidedPanels; row: () => string } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: entries, containerWidth: width, ...(tuning === undefined ? {} : { tuning }) }));
    const seen = latest;
    React.useLayoutEffect(() => {
      rows?.push(rowOf(seen.entries));
    });
    return React.createElement('output');
  }
  mount(strict ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe));
  return { now: () => latest!, row: () => rowOf(latest!.entries) };
}
const six = (): PanelWindow[] => [historyEntry(), entry('a'), entry('b'), entry('c'), entry('d'), entry('e'), entry('f')];

test('row that does not scroll: a hand-built row whose tuning value is not an integer of 1 or more has no cap', () => {
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(handBuilt(six(), 3000, { maxLivePanels: bad }).row(), 'root a b c d e f', String(bad));
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Before the row is measured
// ---------------------------------------------------------------------------

test('unmeasured row: with the key unset nothing parks, as before', async () => {
  const r = await capRig({ count: 4, width: 0 });
  assert.equal(r.row(), 'root w1 w2 w3 w4');
});

test('unmeasured row: the render probe does see a row that holds more than N when there is one', async () => {
  const r = await capRig({ count: 4, width: 0, record: true });
  r.m.setWidth(1280);
  await r.settle();
  assert.ok(Math.max(...r.commits.map(liveRightOfRoot)) >= 4, 'control: with the key unset the probe records the four live panels');
});

// ---------------------------------------------------------------------------
// Committed rows
// ---------------------------------------------------------------------------

/** The first committed row that holds a panel besides History. */
const firstWithPanels = (commits: readonly string[]): string | undefined => commits.find((row) => row !== 'root');

