/**
 * The uid a saved panel carries: how it is made, written, read back, adopted and written once more after a restore
 * that had to mint one. It is never a name: a panel's key and public id are unchanged.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { registerView, useProvidePanels, type PanelWindow, type PanelsInput, type ProvidedPanels, type WorkspaceState, type WorkspaceStorage } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { definePanel } from '../panelTemplate.js';
import { PANEL_UID_FORM, newPanelUid } from '../panelUid.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { summarisePanel } from '../panelRowEntry.js';
import { reconcileWorkspace, type ReconcileInput } from '../workspacePlan.js';
import { projectWorkspaceState, hydrateWorkspaceState, type WorkspacePanelState } from '../workspaceState.js';
import { cleanup, mount, panelsInput } from './support/mount-harness.js';

registerView('uid-view', ({ panel }) => React.createElement('i', null, panel.title));

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

const ROOT = 'root';
const QUIET_MS = 200;
const U1 = `u_${'1'.repeat(32)}`;
const U3 = `u_${'3'.repeat(32)}`;

const counter = (): (() => string) => {
  let n = 0;
  return () => `n${++n}`;
};
const uids = (): (() => string) => {
  let n = 0;
  return () => `u_${String(++n).padStart(32, 'a')}`;
};
const run = (over: Partial<ReconcileInput> = {}): ReturnType<typeof reconcileWorkspace> =>
  reconcileWorkspace({ saved: null, templates: [], declared: undefined, rootId: ROOT, current: [], freshId: counter(), newUid: uids(), ...over });
const entry = (id: string, more: Partial<WorkspacePanelState> = {}): WorkspacePanelState => ({
  id,
  view: 'uid-view',
  url: `https://${id}.example`,
  title: id,
  live: true,
  anchor: { panel: ROOT, position: 'right', priority: 0 },
  ...more,
});
const file = (...panels: WorkspacePanelState[]): WorkspaceState => ({ version: 1, panels: panels.map((p, k) => ({ ...p, anchor: { panel: ROOT, position: 'right', priority: k } })) });
const tpl = (id: string) => definePanel({ id, view: () => null });

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

test('newPanelUid has one fixed form, takes its bytes from the injected source, and 1000 draws do not repeat', () => {
  assert.equal(newPanelUid((b) => b.fill(0xab)), `u_${'ab'.repeat(16)}`);
  const seen = new Set<string>();
  for (let k = 0; k < 1000; k += 1) {
    const uid = newPanelUid();
    assert.match(uid, PANEL_UID_FORM);
    seen.add(uid);
  }
  assert.equal(seen.size, 1000);
});

test('newPanelUid falls back to Math.random where crypto.getRandomValues is missing', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    assert.match(newPanelUid(), PANEL_UID_FORM);
  } finally {
    if (descriptor !== undefined) Object.defineProperty(globalThis, 'crypto', descriptor);
  }
});

// ---------------------------------------------------------------------------
// Creation, projection, the public surface
// ---------------------------------------------------------------------------

test('appendPanel is the one place a uid is made: every panel carries one, and a given one is kept', () => {
  const [a] = appendPanel([], { view: 'uid-view' }, 'a', ROOT);
  assert.match(a!.uid!, PANEL_UID_FORM);
  assert.equal(appendPanel([], { view: 'uid-view' }, 'b', ROOT, U1)[0]!.uid, U1);
});

test('a plain panel\'s key and public summary are unchanged: the uid is never its name', () => {
  const [p] = appendPanel([], { view: 'uid-view' }, 'p1', ROOT);
  assert.equal(p!.key, undefined);
  assert.equal('uid' in summarisePanel(p!), false);
});

test('the file writes each saved panel\'s uid', () => {
  const plain = appendPanel([createHistoryPanel(ROOT)], { view: 'uid-view' }, 'p1', ROOT, U1);
  const state = projectWorkspaceState(plain, ROOT);
  assert.deepEqual(state.panels.map((s) => s.uid), [U1]);
});

// ---------------------------------------------------------------------------
// Restore: reconcileWorkspace
// ---------------------------------------------------------------------------

test('a saved uid survives the restore in both branches: with no settings anywhere, and under a registered template', () => {
  const plain = run({ saved: file(entry('x', { uid: U1 })) });
  assert.deepEqual(plain.entries.map((p) => p.uid), [U1]);
  assert.equal(plain.minted, false);
  const withTemplate = run({ saved: file(entry('x', { uid: U1, view: 't' })), templates: [tpl('t')] });
  assert.deepEqual(withTemplate.entries.map((p) => p.uid), [U1]);
  assert.equal(withTemplate.minted, false);
});

test('an entry with no uid gets a new one and the restore says the file must be written', () => {
  const result = run({ saved: file(entry('x'), entry('y', { uid: U1 })) });
  assert.deepEqual(result.entries.map((p) => p.uid), [`u_${'1'.padStart(32, 'a')}`, U1]);
  assert.equal(result.minted, true);
});

test('a repeated, empty, malformed or non-string uid is dropped with a note and made again; the first holder keeps it', () => {
  const saved = file(entry('a', { uid: U1 }), entry('b', { uid: U1 }), entry('c', { uid: '' }), entry('d', { uid: 7 as unknown as string }), entry('e', { uid: 'not-a-uid' }));
  const result = run({ saved });
  const got = result.entries.map((p) => p.uid!);
  assert.equal(got[0], U1);
  assert.equal(new Set(got).size, 5);
  for (const uid of got) assert.match(uid, PANEL_UID_FORM);
  assert.equal(result.minted, true);
  assert.equal(result.notes.filter((n) => n.key === 'uid').length, 4);
});

test('a 0.1.0 singleton is still claimed once: the claim reads the key, so minting a uid cannot make the entry look keyed', () => {
  const result = run({ saved: file(entry('x', { view: 't', title: 'old' })), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.key, 'a');
  assert.match(result.entries[0]!.uid!, PANEL_UID_FORM);
  assert.equal(result.minted, true);
});

test('a declared panel the file lacks is made with a uid', () => {
  const result = run({ saved: file(), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }] });
  assert.match(result.entries[0]!.uid!, PANEL_UID_FORM);
});

test('a panel already in the row takes the uid the file holds for it, and keeps its own where the file has none', () => {
  const current = applyTemplate({ ...appendPanel([], { view: 't' }, 'live1', ROOT, U3)[0]!, key: 'a' }, resolvePanelSettings({}).value, 'create');
  const taken = run({ saved: file(entry('x', { view: 't', key: 'a', uid: U1, overrides: {} })), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }], current: [current] });
  assert.deepEqual(taken.entries, []);
  assert.deepEqual(taken.adopted, [{ id: 'live1', uid: U1 }]);
  assert.equal(taken.minted, false);
  const kept = run({ saved: file(entry('x', { view: 't', key: 'a', overrides: {} })), templates: [tpl('t')], declared: [{ id: 'a', templateId: 't' }], current: [current] });
  assert.deepEqual(kept.adopted, []);
  assert.equal(kept.minted, true, 'the file lacks the uid the row holds, so it is written');
});

test('hydrateWorkspaceState keeps a good uid and makes another for a repeated one', () => {
  const entries = hydrateWorkspaceState(file(entry('a', { uid: U1 }), entry('b', { uid: U1 })), counter(), ROOT);
  assert.equal(entries[0]!.uid, U1);
  assert.notEqual(entries[1]!.uid, U1);
  assert.match(entries[1]!.uid!, PANEL_UID_FORM);
});

// ---------------------------------------------------------------------------
// The workspace over storage
// ---------------------------------------------------------------------------

interface Mounted {
  latest: () => ProvidedPanels;
  entries: () => readonly PanelWindow[];
  saves: WorkspaceState[];
}

function mountProvider(load: () => Promise<WorkspaceState | null>, over: Partial<PanelsInput> = {}): Mounted {
  const saves: WorkspaceState[] = [];
  const storage: WorkspaceStorage = { load, save: (state) => void saves.push(state) };
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries: [createHistoryPanel(ROOT)], storage, tuning: { saveQuietMs: QUIET_MS }, ...over }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  return { latest: () => latest!, entries: () => latest!.entries, saves };
}

async function settleAndWait(): Promise<void> {
  await act(async () => {});
  act(() => mock.timers.tick(QUIET_MS + 50));
}

const uidsOf = (state: WorkspaceState): (string | undefined)[] => state.panels.map((p) => p.uid);

test('a panel saved on one workspace comes back with the same uid on another, under another runtime id, and the restore writes nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const first = mountProvider(() => Promise.resolve(null));
  await settleAndWait();
  act(() => first.latest().create({ view: 'uid-view', title: 'one' }));
  act(() => mock.timers.tick(QUIET_MS + 50));
  assert.equal(first.saves.length, 1);
  const written = first.saves[0]!;
  assert.match(written.panels[0]!.uid!, PANEL_UID_FORM);
  cleanup();

  const second = mountProvider(() => Promise.resolve(structuredClone(written)));
  await settleAndWait();
  assert.deepEqual(second.entries().slice(1).map((p) => p.uid), uidsOf(written));
  assert.equal(second.saves.length, 0, 'a file whose uids are all good is not written again');
});

test('a file without uids is restored unchanged, then written once with a uid on every entry, and a second workspace reads those back', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const old = file(entry('x'), entry('y'));
  const first = mountProvider(() => Promise.resolve(structuredClone(old)));
  await settleAndWait();
  assert.deepEqual(first.entries().slice(1).map((p) => p.title), ['x', 'y']);
  assert.equal(first.saves.length, 1, 'one save follows the restore that minted');
  assert.equal(uidsOf(first.saves[0]!).every((u) => u !== undefined && PANEL_UID_FORM.test(u)), true);
  act(() => mock.timers.tick(QUIET_MS * 5));
  assert.equal(first.saves.length, 1, 'and no write loop');
  const written = first.saves[0]!;
  cleanup();

  const second = mountProvider(() => Promise.resolve(structuredClone(written)));
  await settleAndWait();
  assert.deepEqual(second.entries().slice(1).map((p) => p.uid), uidsOf(written));
  assert.equal(second.saves.length, 0);
});

test('a declared panel made before the restore takes the uid the file holds, and the next save carries it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = tpl('t');
  const mine = applyTemplate({ ...appendPanel([], { view: 't' }, 'live1', ROOT)[0]!, key: 'a', declared: true }, resolvePanelSettings({}).value, 'create');
  const m = mountProvider(() => Promise.resolve(file(entry('x', { view: 't', key: 'a', uid: U1, overrides: {} }))), {
    initialEntries: [createHistoryPanel(ROOT), mine],
    templates: [t],
    declared: [{ id: 'a', templateId: 't' }],
  });
  await settleAndWait();
  assert.equal(m.entries().length, 2, 'the file entry did not make a second panel');
  assert.equal(m.entries()[1]!.uid, U1);
  const last = m.saves[m.saves.length - 1];
  if (last !== undefined) assert.deepEqual(uidsOf(last), [U1]);
});

test('closing a panel and undoing the close keeps its uid and leaves it without a key', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const m = mountProvider(() => Promise.resolve(null));
  await settleAndWait();
  act(() => m.latest().create({ view: 'uid-view', title: 'one' }));
  const before = m.entries()[1]!;
  act(() => void m.latest().close(before.id));
  assert.equal(m.entries().length, 1);
  act(() => m.latest().undoClose());
  const after = m.entries()[1]!;
  assert.equal(after.uid, before.uid);
  assert.equal(after.key, undefined);
});
