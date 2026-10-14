/**
 * The three configure calls and the doors every key has: a hand-written table of calls by key classes, a sweep of the
 * catalog through each call, and what a template view may do through its own handle.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { PANEL_SETTINGS_CATALOG, definePanel } from '../index.js';
import type { ConfigureResult, PanelReader, ViewHandle } from '../index.js';
import { PanelManagerError } from '../panelManagerError.js';
import { panelKey } from '../panelSettings.js';
import type { PanelWindow } from '../panelWindow.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { cleanup } from './support/mount-harness.js';
import { pinRig, type PinRig } from './support/pin-rig.js';

afterEach(() => cleanup());

type Refused = Extract<ConfigureResult, { ok: false }>;

const WORKSPACE_ONLY = ['rowGap', 'saveQuietMs', 'gestureLockMs', 'gestureQuietMs', 'resizeSettleSlides', 'returnTieBreak', 'dropTieBreak', 'rowGesture', 'initialScroll', 'maxLivePanels', 'chrome', 'phoneFit', 'phoneFitMin', 'phoneFitMax'];
const PER_PANEL = ['dragToClose', 'slide', 'hopFraction', 'edgeScroll'];
const TEMPLATE = ['hostCreatable', 'multiple', 'maxInstances'];

/** One legal value for every settings key the catalog names, so a sweep can ask each of them. */
const VALUE: Record<string, unknown> = {
  closable: false,
  parkable: false,
  draggable: false,
  crossable: false,
  placeable: false,
  resizable: false,
  clearable: false,
  hostCreatable: false,
  multiple: false,
  maxInstances: 3,
  listed: false,
  startVisibility: 'parked',
  hideStickiness: 'until-room',
  capacityReturn: 'manual',
  overflow: 'park',
  revealOnScroll: 'any',
  scrollOnOpen: 'center',
  scrollOnMove: 'none',
  toggleWhenClosed: 'reopen',
  showWhenClosed: 'reopen',
  placeOnAdd: 'row-start',
  placeOnShow: 'in-place',
  layer: 'raised',
  enterFrom: 'left',
  title: 'Renamed',
  pinning: { pinned: { placement: 'row-start' }, unpinned: { placement: 'row-end' } },
  pinningWhenNotLive: 'refuse',
  headerButtons: { x: false },
  restoreVisibility: 'parked',
  afterClose: 'return-next-launch',
  rowGap: 20,
  dragToClose: { minDistancePx: 90 },
  slide: { durationSec: 0.3 },
  hopFraction: 0.4,
  edgeScroll: { zonePx: 60 },
  saveQuietMs: 700,
  gestureLockMs: 400,
  gestureQuietMs: 300,
  resizeSettleSlides: 2,
  returnTieBreak: 'row-order',
  dropTieBreak: 'rightmost',
  rowGesture: 'free',
  initialScroll: 'end',
  chrome: { mode: 'hover-or-active', fadeMs: 80 },
  maxLivePanels: 3,
  phoneFit: 'fit',
  phoneFitMin: 0.9,
  phoneFitMax: 1.1,
  slots: 2,
  maxSlots: 3,
};

const names = PANEL_SETTINGS_CATALOG.map((d) => d.name);
const flatKeys = names.filter((n) => !n.startsWith('tuning.'));
const leafKeys = names.filter((n) => n.startsWith('tuning.')).map((n) => n.slice('tuning.'.length));
const instanceKeys = flatKeys.filter((k) => !TEMPLATE.includes(k));

const watchRow = (r: PinRig) => {
  const before = r.m.latest().entries;
  const version = r.ws.panels.getSnapshot().version;
  return () => {
    assert.equal(r.m.latest().entries === before || r.m.latest().entries.every((p, k) => p === before[k]), true, 'the entries are reference-equal');
    assert.equal(r.ws.panels.getSnapshot().version, version, 'the snapshot version did not move');
  };
};

// ---------------------------------------------------------------------------
// The hand-written table: three calls by four key classes
// ---------------------------------------------------------------------------

type Call = 'configure' | 'configureTemplate' | 'configureTuning';
const ROWS: readonly [Call, string, string, 'accepts' | 'wrong-scope'][] = [
  ['configure', 'an instance key', 'scrollOnOpen', 'accepts'],
  ['configure', 'a template key', 'maxInstances', 'wrong-scope'],
  ['configure', 'a workspace-only tuning key', 'rowGap', 'wrong-scope'],
  ['configure', 'a per-panel tuning leaf', 'dragToClose', 'accepts'],
  ['configureTemplate', 'an instance key', 'scrollOnOpen', 'wrong-scope'],
  ['configureTemplate', 'a template key', 'maxInstances', 'accepts'],
  ['configureTemplate', 'a workspace-only tuning key', 'rowGap', 'wrong-scope'],
  ['configureTemplate', 'a per-panel tuning leaf', 'dragToClose', 'wrong-scope'],
  ['configureTuning', 'an instance key', 'scrollOnOpen', 'wrong-scope'],
  ['configureTuning', 'a template key', 'maxInstances', 'wrong-scope'],
  ['configureTuning', 'a workspace-only tuning key', 'rowGap', 'accepts'],
  ['configureTuning', 'a per-panel tuning leaf', 'dragToClose', 'accepts'],
];

function ask(r: PinRig, call: Call, key: string): ConfigureResult {
  const value = VALUE[key];
  if (call === 'configure') return r.ws.panels.configure('b', (PER_PANEL.includes(key) || WORKSPACE_ONLY.includes(key) ? { tuning: { [key]: value } } : { [key]: value }) as never);
  if (call === 'configureTemplate') return r.ws.panels.configureTemplate('b', (PER_PANEL.includes(key) || WORKSPACE_ONLY.includes(key) ? { tuning: { [key]: value } } : { [key]: value }) as never);
  return r.ws.panels.configureTuning({ [key]: value } as never);
}

let executed = 0;
for (const [call, cls, key, want] of ROWS) {
  test(`doors: ${call} ${want === 'accepts' ? 'accepts' : 'answers wrong-scope for'} ${cls} (${key})`, async () => {
    const r = await pinRig();
    const unchanged = watchRow(r);
    const res = r.turn(() => ask(r, call, key));
    executed += 1;
    if (want === 'accepts') {
      assert.equal(res.ok, true, res.ok ? '' : `${(res as Refused).code}: ${(res as Refused).message}`);
    } else {
      assert.equal(res.ok, false);
      assert.equal((res as Refused).code, 'wrong-scope');
      assert.equal((res as Refused).setting, PER_PANEL.includes(key) || WORKSPACE_ONLY.includes(key) ? `tuning.${key}` : key);
      unchanged();
    }
  });
}

test('doors: the table ran every row, calls by classes by one key each', () => {
  assert.equal(executed, 3 * 4);
  assert.equal(ROWS.length, executed);
});

// ---------------------------------------------------------------------------
// The sweep: every catalog key through every call
// ---------------------------------------------------------------------------

test('doors: the catalog holds the plain keys, three template keys among them, and eighteen tuning leaves', () => {
  assert.equal(flatKeys.length + leafKeys.length, names.length);
  assert.deepEqual(leafKeys.sort(), [...PER_PANEL, ...WORKSPACE_ONLY].sort());
  assert.equal(leafKeys.length, 18);
  assert.deepEqual(PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.length === 1 && d.configure.doors[0] === 'template').map((d) => d.name).sort(), [...TEMPLATE].sort());
});

for (const key of instanceKeys) {
  test(`sweep: configure(id) accepts the instance key ${key} and the patched value reads source instance`, async () => {
    const r = await pinRig();
    const res = r.turn(() => r.ws.panels.configure('c', { [key]: VALUE[key] } as never));
    // A key that no valid arrangement of this row could take at once is refused whole with a typed code, never thrown.
    assert.equal(res.ok || ['settings-conflict', 'slots-above-max'].includes((res as Refused).code), true, res.ok ? '' : `${(res as Refused).code}: ${(res as Refused).message}`);
    if (res.ok) assert.equal(r.h.c!.getSettings().source[key], 'instance');
  });
}

for (const key of TEMPLATE) {
  test(`sweep: configure(id) answers wrong-scope for the template key ${key}, configureTemplate accepts it and configureTuning answers wrong-scope`, async () => {
    const r = await pinRig();
    const unchanged = watchRow(r);
    const onPanel = r.turn(() => r.ws.panels.configure('c', { [key]: VALUE[key] } as never)) as Refused;
    assert.deepEqual([onPanel.code, onPanel.setting], ['wrong-scope', key]);
    const onTuning = r.turn(() => r.ws.panels.configureTuning({ [key]: VALUE[key] } as never)) as Refused;
    assert.deepEqual([onTuning.code, onTuning.setting], ['wrong-scope', key]);
    unchanged();
    assert.equal(r.turn(() => r.ws.panels.configureTemplate('c', { [key]: VALUE[key] } as never)).ok, true);
  });
}

for (const leaf of leafKeys) {
  const perPanel = PER_PANEL.includes(leaf);
  test(`sweep: the tuning leaf ${leaf} is ${perPanel ? 'accepted by configure(id) and configureTuning' : 'accepted by configureTuning only'}`, async () => {
    const r = await pinRig();
    const onPanel = r.turn(() => r.ws.panels.configure('c', { tuning: { [leaf]: VALUE[leaf] } } as never));
    if (perPanel) {
      assert.equal(onPanel.ok, true);
      assert.equal(r.h.c!.getSettings().source[`tuning.${leaf}`], 'instance');
    } else {
      assert.deepEqual([(onPanel as Refused).code, (onPanel as Refused).setting], ['wrong-scope', `tuning.${leaf}`]);
    }
    const onTuning = r.turn(() => r.ws.panels.configureTuning({ [leaf]: VALUE[leaf] } as never));
    assert.equal(onTuning.ok, true);
    const onTemplate = r.turn(() => r.ws.panels.configureTemplate('c', { tuning: { [leaf]: VALUE[leaf] } } as never)) as Refused;
    assert.deepEqual([onTemplate.code, onTemplate.setting], ['wrong-scope', `tuning.${leaf}`]);
  });
}

test('sweep: configureTuning answers wrong-scope for every instance key and every template key, none accepted', async () => {
  const r = await pinRig();
  const unchanged = watchRow(r);
  for (const key of flatKeys) {
    const res = r.turn(() => r.ws.panels.configureTuning({ [key]: VALUE[key] } as never)) as Refused;
    assert.deepEqual([res.ok, res.code, res.setting], [false, 'wrong-scope', key], key);
  }
  unchanged();
});

test('sweep: configureTemplate answers wrong-scope for every key but the three template keys', async () => {
  const r = await pinRig();
  const unchanged = watchRow(r);
  for (const key of instanceKeys) {
    const res = r.turn(() => r.ws.panels.configureTemplate('c', { [key]: VALUE[key] } as never)) as Refused;
    assert.deepEqual([res.ok, res.code, res.setting], [false, 'wrong-scope', key], key);
  }
  unchanged();
});

test('an unknown key throws invalid-settings naming it, at each call, and an unknown template throws unknown-template', async () => {
  const r = await pinRig();
  const thrown = (fn: () => unknown): PanelManagerError => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof PanelManagerError);
      return e;
    }
    return assert.fail('nothing was thrown');
  };
  assert.deepEqual([thrown(() => r.h.c!.configure({ nope: 1 } as never)).code, thrown(() => r.h.c!.configure({ nope: 1 } as never)).key], ['invalid-settings', 'nope']);
  assert.equal(thrown(() => r.ws.panels.configureTemplate('c', { nope: 1 } as never)).code, 'invalid-settings');
  assert.equal(thrown(() => r.ws.panels.configureTuning({ nope: 1 } as never)).code, 'invalid-settings');
  assert.equal(thrown(() => r.h.c!.configure({ tuning: { nope: 1 } } as never)).key, 'tuning.nope');
  assert.equal(thrown(() => r.ws.panels.configureTemplate('zzz', { multiple: true })).code, 'unknown-template');
  assert.equal(thrown(() => r.h.c!.configure({ closable: 'yes' } as never)).code, 'invalid-settings', 'a wrong type throws');
  assert.equal(thrown(() => r.ws.panels.configureTuning({ rowGap: -4 })).code, 'invalid-settings', 'an out-of-range leaf throws');
  assert.equal(thrown(() => r.h.c!.configure({ tuning: { slide: { durationSec: 99 } } })).code, 'invalid-settings');
  // An unknown key throws even beside a key that earns a refusal.
  assert.equal(thrown(() => r.ws.panels.configure('c', { maxInstances: 2, nope: 1 } as never)).code, 'invalid-settings');
});

test('a wrong-scope refusal leaves the entries reference-equal', async () => {
  const r = await pinRig();
  const unchanged = watchRow(r);
  const renders = r.m.renders();
  r.turn(() => [r.ws.panels.configure('c', { maxInstances: 2 } as never), r.ws.panels.configureTemplate('c', { closable: false } as never), r.ws.panels.configureTuning({ closable: false } as never)]);
  unchanged();
  assert.equal(r.m.renders(), renders);
});

// ---------------------------------------------------------------------------
// Views: what a template view may do through its own handle
// ---------------------------------------------------------------------------

interface Seen {
  handle: ViewHandle;
  manager: PanelReader;
}

/** A rig whose panels are drawn by a view that keeps the handle and the reader it receives. */
async function viewRig(): Promise<{ r: PinRig; seen: Map<string, Seen> }> {
  const seen = new Map<string, Seen>();
  const probe = (id: string) =>
    definePanel({
      id,
      view: ({ panel, handle, manager }) => {
        seen.set(id, { handle, manager });
        return React.createElement('i', { 'data-slot': panel.id });
      },
    });
  const r = await pinRig({ ids: [], extra: [probe('v')], root: true });
  r.turn(() => void r.ws.addPanel('v'));
  await r.settle();
  return { r, seen };
}

const VIEW_ACCEPTS: readonly [string, unknown][] = [
  ['title', 'From the view'],
  ['listed', false],
  ['layer', 'raised'],
  ['closable', false],
  ['slots', 2],
  ['placeOnAdd', { anchor: { panel: 'root', position: 'left' } }],
  ['enterFrom', 'anchor'],
];

for (const [key, value] of VIEW_ACCEPTS) {
  test(`view: the handle accepts ${key} and null removes it again`, async () => {
    const { r, seen } = await viewRig();
    const handle = seen.get('v')!.handle;
    const set = r.turn(() => handle.configure({ [key]: value } as never));
    assert.equal(set.ok, true, set.ok ? '' : (set as Refused).message);
    assert.equal(r.ws.panels.get('v')!.getSettings().source[key], 'instance');
    const cleared = r.turn(() => handle.configure({ [key]: null } as never));
    assert.equal(cleared.ok, true);
    assert.notEqual(r.ws.panels.get('v')!.getSettings().source[key], 'instance');
  });
}

const VIEW_REFUSES = [...instanceKeys.filter((k) => !VIEW_ACCEPTS.some(([a]) => a === k)), ...TEMPLATE];
for (const key of VIEW_REFUSES) {
  test(`view: the handle answers not-view-settable for ${key} and the entries stay reference-equal`, async () => {
    const { r, seen } = await viewRig();
    const unchanged = watchRow(r);
    const res = r.turn(() => seen.get('v')!.handle.configure({ [key]: VALUE[key] } as never)) as Refused;
    assert.deepEqual([res.ok, res.code, res.setting], [false, 'not-view-settable', key]);
    unchanged();
  });
}

test('view: placeOnAdd other than an anchor and enterFrom other than anchor are not view-settable', async () => {
  const { r, seen } = await viewRig();
  const handle = seen.get('v')!.handle;
  assert.equal((r.turn(() => handle.configure({ placeOnAdd: 'row-start' } as never)) as Refused).code, 'not-view-settable');
  assert.equal((r.turn(() => handle.configure({ enterFrom: 'left' } as never)) as Refused).code, 'not-view-settable');
});

test('view: a tuning leaf is not view-settable', async () => {
  const { r, seen } = await viewRig();
  const res = r.turn(() => seen.get('v')!.handle.configure({ tuning: { slide: { durationSec: 0.1 } } } as never)) as Refused;
  assert.deepEqual([res.code, res.setting], ['not-view-settable', 'tuning.slide']);
});

test('view: the PanelReader has no configure, and neither the handle nor the reader reaches configureTemplate, configureTuning or resetLayout', async () => {
  const { r, seen } = await viewRig();
  const { handle, manager } = seen.get('v')!;
  assert.deepEqual(Object.keys(manager), ['get', 'list', 'getSnapshot', 'subscribe']);
  assert.deepEqual(Object.keys(manager.get('v')!).sort(), ['getSettings', 'getState', 'id', 'subscribe', 'templateId']);
  for (const reach of ['configureTemplate', 'configureTuning', 'resetLayout', 'manager']) {
    assert.equal(reach in handle, false, `handle.${reach}`);
    assert.equal(reach in manager, false, `manager.${reach}`);
  }
  assert.equal('configure' in manager, false);
  assert.equal(typeof handle.configure, 'function');
  assert.equal(handle === (r.ws.panels.get('v') as unknown), false, 'the view\'s handle is not the manager\'s');
});

test('view: handle.configure({ closable: false }) locks its own panel and null unlocks it', async () => {
  const { r, seen } = await viewRig();
  const handle = seen.get('v')!.handle;
  assert.equal(r.turn(() => handle.configure({ closable: false })).ok, true);
  assert.equal(r.ws.panels.get('v')!.getState().settings.closable, false);
  assert.equal(r.entry('v').locked, true);
  assert.equal((r.turn(() => handle.close()) as Refused).code, 'not-closable');
  assert.equal(r.turn(() => handle.configure({ closable: null })).ok, true);
  assert.equal(r.ws.panels.get('v')!.getState().settings.closable, true);
  assert.equal(r.entry('v').locked, false);
  assert.equal(r.turn(() => handle.close()).ok, true);
  assert.equal(r.ws.panels.get('v')!.getState().status, 'closed');
});

test('view: closable true is not view-settable, since a view may only lock its own panel', async () => {
  const { r, seen } = await viewRig();
  const res = r.turn(() => seen.get('v')!.handle.configure({ closable: true } as never)) as Refused;
  assert.deepEqual([res.ok, res.code, res.setting], [false, 'not-view-settable', 'closable']);
});

test('view: a lock the view set is saved in the file as closable false', async () => {
  const { r, seen } = await viewRig();
  r.turn(() => seen.get('v')!.handle.configure({ closable: false }));
  const saved = projectWorkspaceState([r.entry('v') as PanelWindow], 'root');
  assert.equal(saved.panels[0]?.closable, false);
  assert.deepEqual(saved.panels[0]?.instance, { closable: false });
});

test('the instance door still refuses closable true on the root with settings-conflict', async () => {
  const { r } = await viewRig();
  const res = r.turn(() => r.ws.panels.configure('root', { closable: true })) as Refused;
  assert.deepEqual([res.ok, res.code], [false, 'settings-conflict']);
});

test('view: the handle carries the same keys as the manager\'s handle for the same panel, configure last', async () => {
  const { r, seen } = await viewRig();
  const own = Object.keys(seen.get('v')!.handle);
  assert.deepEqual(own, Object.keys(r.ws.panels.get('v')!));
  assert.equal(own[own.length - 1], 'configure');
});

test('view: a configure from the view is one more operation on its panel: a second one in the turn is busy', async () => {
  const { r, seen } = await viewRig();
  const out = r.turn(() => [seen.get('v')!.handle.configure({ title: 'one' }), seen.get('v')!.handle.configure({ title: 'two' })]);
  assert.equal(out[0]!.ok, true);
  assert.equal((out[1] as Refused).code, 'busy');
});

test('the entries a probe reads are the engine\'s own', async () => {
  const { r } = await viewRig();
  const entries: readonly PanelWindow[] = r.m.latest().entries;
  assert.ok(entries.some((p) => panelKey(p) === 'v'));
});
