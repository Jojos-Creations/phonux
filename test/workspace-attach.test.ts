/**
 * createWorkspace and the provider that attaches it: declarative intents, the read-only handles and reader, the
 * template adapter, the snapshot, the root and the marker, placement by `order`, `newId` and the scroll requests of
 * the verbs this workspace adds.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { readFileSync, readdirSync } from 'node:fs';
import { act } from 'react';
import { PanelManagerError, createWorkspace } from '../index.js';
import type { PanelHandle, PanelSettings, WorkspaceHandle } from '../index.js';
import { bindingOf, type EngineOps } from '../workspaceCore.js';
import type { PanelWindow } from '../panelWindow.js';
import { cleanup, } from './support/mount-harness.js';
import { differential, differentialsCovered } from './support/differential.js';
import { flush, markerTemplate, mountWorkspace } from './support/workspace-row.js';
import { engineId, launch, live, settle } from './support/workspace-launch.js';
import { memoryWorkspaceStorage } from '../fakeHost.js';

/** Operations for a commit the test publishes by hand: no engine stands behind it, so every one refuses. */
const NO_OPS: EngineOps = {
  show: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  hide: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  close: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  open: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  move: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  place: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  land: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  setSlots: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  scrollTo: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  reopen: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  pin: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  reset: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  inUndoWindow: () => false,
  resetClosed: () => false,
  configure: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  reprice: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
  release: () => ({ ok: false, code: 'is-closed', message: 'no engine' }),
};

afterEach(() => cleanup());

const KEYS_OF_STATE = ['id', 'templateId', 'status', 'held', 'engineId', 'index', 'title', 'url', 'params', 'listed', 'settings', 'pinned', 'deferredPin', 'openedBy'];
const statuses = (w: WorkspaceHandle): string[] => w.panels.getSnapshot().panels.map((p) => `${p.id}:${p.status}`);

// ---------------------------------------------------------------------------
// The two-template example and the template adapter
// ---------------------------------------------------------------------------

test('the two-template example: two templates added to a workspace mount two panels and both handles answer getState', () => {
  const One = markerTemplate('one');
  const Two = markerTemplate('two');
  const w = createWorkspace({ mount: false, templates: [One, Two] });
  const one = w.addPanel(One);
  const two = w.addPanel(Two);
  const m = mountWorkspace(w);
  assert.equal(m.slots().length, 2, 'positive control: the markers exist after mount, so a mount that never attached would turn this red');
  assert.deepEqual(
    [...m.container.querySelectorAll('[data-template]')].map((n) => (n as HTMLElement).dataset.template),
    ['one', 'two'],
  );
  assert.equal(one.getState().status, 'live');
  assert.equal(two.getState().status, 'live');
  assert.equal(one.getState().templateId, 'one');
});

test('the two-template example with a root template: the root and two panels mount, and the root is the engine root under its template id', () => {
  const Root = markerTemplate('history', { settings: { title: 'History' } });
  const w = createWorkspace({ mount: false, root: Root, templates: [markerTemplate('one'), markerTemplate('two')] });
  w.addPanel('one');
  w.addPanel('two');
  const m = mountWorkspace(w);
  assert.equal(m.slots().length, 3);
  assert.equal(w.rootId, 'history');
  const entries = m.latest().entries;
  assert.equal(entries[0]!.id, 'history');
  assert.equal(entries.some((p) => p.marker === true), false, 'a root template means no marker');
  assert.equal(entries[0]!.view, 'history');
});

test('a template view receives its panel summary, the seventeen sorted keys of the operable handle (the read-only five and the twelve verbs) and the four of the reader', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('probe')] });
  w.addPanel('probe');
  const m = mountWorkspace(w);
  const node = m.container.querySelector('[data-template="probe"]') as HTMLElement;
  assert.ok(node, 'the template view did not render');
  assert.equal(node.dataset.slot, m.latest().entries.find((p) => p.view === 'probe')!.key, 'panel is the row entry summary, and its id is the key');
  assert.deepEqual(node.dataset.handleKeys!.split(',').sort(), ['close', 'configure', 'getSettings', 'getState', 'hide', 'id', 'move', 'open', 'pin', 'place', 'scrollTo', 'setSlots', 'show', 'subscribe', 'templateId', 'toggleVisibility', 'unpin'], 'id, templateId, getState, getSettings, subscribe, show, hide, toggleVisibility, close, open, move, place, setSlots, scrollTo, pin, unpin, configure: 17 keys and no manager');
  assert.equal(node.dataset.managerKeys, 'get,list,getSnapshot,subscribe');
  assert.equal(node.dataset.handleId, 'probe');
});

// ---------------------------------------------------------------------------
// The snapshot, the handles and the reader
// ---------------------------------------------------------------------------

test('getSnapshot is reference-equal until something changes and its keys are exactly version, status and panels', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('s')] });
  w.addPanel('s');
  const m = mountWorkspace(w);
  const first = w.panels.getSnapshot();
  assert.deepEqual(Object.keys(first), ['version', 'status', 'panels']);
  act(() => m.rerender(m.latest() === undefined ? null : undefined));
  const again = w.panels.getSnapshot();
  assert.equal(first === again || first.version !== again.version, true);
  act(() => void m.latest());
  assert.equal(w.panels.getSnapshot(), again, 'nothing changed, so the snapshot is the same object');
});

test('each PanelState has exactly the fifteen keys in order, with engineId and index null for a pending panel', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('k')] });
  const h = w.addPanel('k');
  const pending = h.getState();
  assert.deepEqual(Object.keys(pending), KEYS_OF_STATE);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.engineId, null);
  assert.equal(pending.index, null);
  mountWorkspace(w);
  const live = h.getState();
  assert.deepEqual(Object.keys(live), KEYS_OF_STATE);
  assert.equal(typeof live.engineId, 'string');
  assert.equal(live.index, 0);
});

test('a panel that is over its limit is closed with engineId and index null', () => {
  const t = markerTemplate('lim', { settings: { multiple: true, maxInstances: 1 } });
  const w = createWorkspace({ mount: false, templates: [t] });
  w.addPanel(t, { id: 'a' });
  const over = w.addPanel(t, { id: 'b' });
  assert.equal(over.getState().status, 'closed');
  assert.equal(over.getState().engineId, null);
  assert.equal(over.getState().index, null);
});

test('list filters by status and listed: reader.list({ status: live, listed: true }) keeps only the listed live panels', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('vis'), markerTemplate('hid', { settings: { listed: false } })] });
  w.addPanel('vis');
  w.addPanel('hid');
  mountWorkspace(w);
  const all = w.panels.getSnapshot().panels;
  assert.equal(all.length, 2);
  const kept = w.panels.list({ status: 'live', listed: true }).map((h) => h.id);
  assert.deepEqual(kept, ['vis']);
  assert.deepEqual(w.panels.list({ status: ['live', 'parked'] }).map((h) => h.id), ['vis', 'hid']);
  assert.deepEqual(w.panels.list({ status: 'closed' }).map((h) => h.id), []);
  assert.equal(w.panels.list().length, 2);
});

test('the version increments exactly once per commit that changed the state, and not for a call that changed nothing', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('v')] });
  mountWorkspace(w);
  const seen: number[] = [];
  w.panels.subscribe(() => void seen.push(w.panels.getSnapshot().version));
  const before = w.panels.getSnapshot().version;
  act(() => void w.addPanel('v'));
  assert.equal(w.panels.getSnapshot().version, before + 1);
  act(() => void w.addPanel('v'));
  assert.equal(w.panels.getSnapshot().version, before + 1, 'get-or-create changed nothing');
  assert.deepEqual(seen, [before + 1], 'one notification for one version');
});

test('handles are valid before mount (pending), live after attach, and still answer getState after unmount', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('life')] });
  const h = w.addPanel('life');
  assert.equal(h.getState().status, 'pending');
  const m = mountWorkspace(w);
  assert.equal(h.getState().status, 'live');
  act(() => m.unmount());
  assert.equal(w.status, 'detached');
  assert.equal(h.getState().status, 'live', 'the last state stays answerable');
  assert.equal(h.getState().id, 'life');
});

test('getSettings returns the resolver output: value, a source word per catalog name, conflicts and notes', () => {
  const w = createWorkspace({ mount: false, defaults: { scrollOnOpen: 'start' }, templates: [markerTemplate('res', { settings: { closable: false } })] });
  const h = w.addPanel('res', { settings: { title: 'Mine' } });
  mountWorkspace(w);
  const r = h.getSettings();
  assert.deepEqual(Object.keys(r).filter((k) => ['value', 'source', 'conflicts', 'notes'].includes(k)).sort(), ['conflicts', 'notes', 'source', 'value']);
  assert.equal(r.source.scrollOnOpen, 'workspace');
  assert.equal(r.source.closable, 'template');
  assert.equal(r.source.title, 'instance');
  assert.equal(typeof r.source.listed, 'string');
  assert.equal(r.value.title, 'Mine');
  assert.equal(h.getState().settings, r.value, 'the state carries the resolved value');
});

test('held is true exactly for a parked panel with a hold', () => {
  const w = createWorkspace({ mount: false });
  const binding = bindingOf(w);
  const owner = {};
  const entry = (id: string, live: boolean): PanelWindow => ({ id, url: '', title: id, live, view: 'x', collapsible: true, listed: true, key: id });
  binding.attach(owner);
  const root = binding.initialEntries()[0]!;
  binding.publish({
    entries: [root, entry('a', true), entry('b', false), entry('c', false)],
    held: new Set(['a', 'b']),
    settled: true,
    create: () => {},
    lateRegister: () => {},
    ops: NO_OPS,
  });
  const by = Object.fromEntries(w.panels.getSnapshot().panels.map((p) => [p.id, p]));
  assert.equal(by.a!.held, false, 'a live panel is never held');
  assert.equal(by.b!.held, true, 'parked with a hold');
  assert.equal(by.c!.held, false, 'parked without one');
  assert.equal(by.b!.status, 'parked');
});

test('subscribe fires once per change at the workspace, and a panel subscriber hears only its own change', () => {
  const t = markerTemplate('sub', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t] });
  mountWorkspace(w);
  let workspaceCalls = 0;
  w.panels.subscribe(() => void (workspaceCalls += 1));
  let first: PanelHandle | undefined;
  act(() => void (first = w.addPanel(t, { id: 'sub-a' })));
  assert.equal(workspaceCalls, 1);
  let panelCalls = 0;
  first!.subscribe(() => void (panelCalls += 1));
  act(() => void w.addPanel(t, { id: 'sub-b' }));
  assert.equal(workspaceCalls, 2);
  assert.equal(panelCalls, 0, 'a change to another panel does not reach this one');
  act(() => void w.addPanel(t, { id: 'sub-b' }));
  assert.equal(workspaceCalls, 2, 'get-or-create changed nothing');
});

test('unsubscribe stops the calls', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('un')] });
  let calls = 0;
  const stop = w.panels.subscribe(() => void (calls += 1));
  w.addPanel('un');
  assert.equal(calls, 1);
  stop();
  w.addPanel('un', { id: 'other' });
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------------------
// addPanel: ids, errors and limits
// ---------------------------------------------------------------------------

const code = (e: unknown): string | undefined => (e instanceof PanelManagerError ? e.code : undefined);

test('an id-less intent for a multiple template throws instance-id-required before the workspace is ready', () => {
  const t = markerTemplate('many', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t] });
  assert.throws(() => w.addPanel(t), (e: unknown) => code(e) === 'instance-id-required');
  assert.doesNotThrow(() => w.addPanel(t, { id: 'first' }));
});

test('an explicit id equal to a registered template id, to all or containing a tilde throws invalid-options', () => {
  const t = markerTemplate('named', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t, markerTemplate('other')] });
  for (const id of ['other', 'named', 'all', 'has~tilde']) assert.throws(() => w.addPanel(t, { id }), (e: unknown) => code(e) === 'invalid-options', id);
});

test('an explicit id obeys the template id rule: 48 characters pass, 49 throw, and whitespace, a leading underscore and all digits throw', () => {
  const t = markerTemplate('rule', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t] });
  assert.doesNotThrow(() => w.addPanel(t, { id: 'x'.repeat(48) }));
  for (const id of ['x'.repeat(49), 'has space', '_lead', '12345', '']) assert.throws(() => w.addPanel(t, { id }), (e: unknown) => code(e) === 'invalid-options', JSON.stringify(id));
});

test('addPanel throws unknown-template for an unregistered id, duplicate-template for a different template under a registered id, and invalid-settings for a bad layer', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('known')] });
  assert.throws(() => w.addPanel('nope'), (e: unknown) => code(e) === 'unknown-template');
  assert.throws(() => w.addPanel(markerTemplate('known')), (e: unknown) => code(e) === 'duplicate-template');
  assert.throws(() => w.addPanel('known', { settings: { closable: 'yes' } as unknown as PanelSettings }), (e: unknown) => code(e) === 'invalid-settings');
});

test('addPanel accepts an unregistered template object and registers it', () => {
  const w = createWorkspace({ mount: false });
  const t = markerTemplate('auto');
  const h = w.addPanel(t);
  assert.equal(h.id, 'auto');
  assert.doesNotThrow(() => w.addPanel('auto'));
});

test('a singleton is get-or-create by id: the second addPanel returns the same handle', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('solo')] });
  const a = w.addPanel('solo');
  const b = w.addPanel('solo');
  assert.equal(a, b);
  assert.equal(w.panels.list().length, 1);
});

test('an explicit id for another template is invalid-options', () => {
  const a = markerTemplate('first-kind', { settings: { multiple: true } });
  const b = markerTemplate('second-kind', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [a, b] });
  w.addPanel(a, { id: 'shared' });
  assert.throws(() => w.addPanel(b, { id: 'shared' }), (e: unknown) => code(e) === 'invalid-options');
});

test('an addPanel over maxInstances returns a handle in status closed, before ready and after', async () => {
  const t = markerTemplate('cap', { settings: { multiple: true, maxInstances: 2 } });
  const w = createWorkspace({ mount: false, templates: [t] });
  w.addPanel(t, { id: 'a' });
  w.addPanel(t, { id: 'b' });
  assert.equal(w.addPanel(t, { id: 'c' }).getState().status, 'closed');
  const m = mountWorkspace(w);
  assert.deepEqual(statuses(w), ['a:live', 'b:live', 'c:closed']);
  let late: PanelHandle | undefined;
  act(() => void (late = w.addPanel(t)));
  assert.equal(late!.getState().status, 'closed', 'after ready too');
  assert.equal(m.latest().entries.filter((p) => p.view === 'cap').length, 2);
});

test('a non-multiple template admits one panel: a second explicit id comes back closed', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('one-only')] });
  w.addPanel('one-only');
  assert.equal(w.addPanel('one-only', { id: 'second' }).getState().status, 'closed');
});

test('hostCreatable false does not stop addPanel: it only stops a Host-bag create', () => {
  const t = markerTemplate('hostless', { settings: { hostCreatable: false } });
  const w = createWorkspace({ mount: false, templates: [t] });
  const h = w.addPanel(t);
  const m = mountWorkspace(w);
  assert.equal(h.getState().status, 'live');
  act(() => m.latest().create({ view: 'hostless' }));
  assert.equal(m.latest().entries.filter((p) => p.view === 'hostless').length, 1, 'the Host-bag create was a no-op');
});

test('an anonymous addPanel of a multiple template after ready is templateId~suffix and each one is a new panel', () => {
  const t = markerTemplate('note', { settings: { multiple: true } });
  const w = createWorkspace({ mount: false, templates: [t] });
  mountWorkspace(w);
  let a: PanelHandle | undefined;
  let b: PanelHandle | undefined;
  act(() => void (a = w.addPanel(t)));
  act(() => void (b = w.addPanel(t)));
  assert.match(a!.id, /^note~.+$/);
  assert.notEqual(a!.id, b!.id);
  assert.equal(a!.getState().status, 'live');
  assert.equal(w.panels.get(b!.id)?.id, b!.id);
});

test('the manager answers get for a known id and undefined for an unknown one', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('g')] });
  w.addPanel('g');
  assert.equal(w.panels.get('g')?.id, 'g');
  assert.equal(w.panels.get('missing'), undefined);
  assert.equal(w.panels.list().length, 1);
});

// ---------------------------------------------------------------------------
// The root and the marker
// ---------------------------------------------------------------------------

test('a root-less workspace with two panels keeps one marker entry, draws two slots at 0 and 406 and counts no fixed column', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('a'), markerTemplate('b')] });
  w.addPanel('a');
  w.addPanel('b');
  const m = mountWorkspace(w);
  const markers = m.latest().entries.filter((p) => p.marker === true);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]!.id, '__root__');
  assert.equal(m.slots().length, 2);
  assert.equal(w.panels.getSnapshot().panels.length, 2);
  assert.equal(m.latest().fixedViewCount, 0);
  assert.deepEqual(m.latest().rowNumbers.leftOffsets, [0, 406]);
  assert.equal(w.rootId, '__root__');
});

test('a drag hop of B past A never counts the marker', () => {
  const w = createWorkspace({ mount: false, templates: [markerTemplate('a'), markerTemplate('b')] });
  w.addPanel('a');
  w.addPanel('b');
  const m = mountWorkspace(w);
  const idOf = (key: string): string => w.panels.get(key)!.getState().engineId!;
  act(() => m.latest().move(idOf('b'), 'left'));
  assert.deepEqual(
    m.latest().entries.map((p) => p.view),
    ['__root__', 'b', 'a'],
  );
  act(() => m.latest().move(idOf('b'), 'left'));
  assert.deepEqual(
    m.latest().entries.map((p) => p.view),
    ['__root__', 'b', 'a'],
    'there is no further hop: the marker is not a neighbour',
  );
});

test('a restore of a saved root-less file keeps its order', async () => {
  const t = markerTemplate('r', { settings: { multiple: true } });
  const store = memoryWorkspaceStorage();
  const quick = { tuning: { saveQuietMs: 5 } };
  const first = createWorkspace({ mount: false, templates: [t], storage: store, ...quick });
  for (const id of ['p1', 'p2', 'p3']) first.addPanel(t, { id });
  const m1 = mountWorkspace(first);
  await flush();
  const idOf = (key: string): string => first.panels.get(key)!.getState().engineId!;
  act(() => m1.latest().move(idOf('p3'), 'left'));
  await act(async () => void (await new Promise((r) => setTimeout(r, 80))));
  m1.unmount();
  assert.ok((await store.load()) !== null, 'positive control: something was saved');
  const reopened = createWorkspace({ mount: false, templates: [t], storage: store, ...quick });
  mountWorkspace(reopened);
  await flush();
  assert.deepEqual(
    reopened.panels.getSnapshot().panels.map((p) => p.id),
    ['p1', 'p3', 'p2'],
  );
});

test('a workspace with a root template has the root as the engine root and no marker, and the root is in the snapshot', () => {
  const Root = markerTemplate('hist');
  const w = createWorkspace({ mount: false, root: Root });
  const m = mountWorkspace(w);
  assert.equal(m.latest().entries.length, 1);
  assert.equal(m.latest().entries[0]!.id, 'hist');
  assert.equal(w.panels.getSnapshot().panels[0]!.id, 'hist');
  assert.equal(w.panels.getSnapshot().panels[0]!.listed, false);
});

// ---------------------------------------------------------------------------
// No events, no flush
// ---------------------------------------------------------------------------

const sourceFiles = (): string[] => [...readdirSync('.'), ...readdirSync('panels').map((f) => `panels/${f}`)].filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts'));

test('no source file mentions PanelEvent, while PanelHandle is mentioned (control)', () => {
  const files = sourceFiles();
  assert.ok(files.length > 40, 'positive control: the scan saw the library');
  const mentions = (word: string): number => files.filter((f) => readFileSync(f, 'utf8').includes(word)).length;
  assert.equal(mentions('PanelEvent'), 0);
  assert.ok(mentions('PanelHandle') > 0);
});

test('PanelState.pinned is the pure isPinned of the entry: left of the root true, right of the root false', () => {
  const w = createWorkspace({ mount: false });
  const binding = bindingOf(w);
  binding.attach({});
  const root = binding.initialEntries()[0]!;
  const entry = (id: string, anchor: PanelWindow['anchor']): PanelWindow => ({ id, url: '', title: id, live: true, view: 'x', collapsible: true, listed: true, key: id, anchor });
  const left = entry('l', { panel: root.id, position: 'left', priority: 0 });
  const right = entry('r', { panel: root.id, position: 'right', priority: 0 });
  binding.publish({ entries: [left, root, right], held: new Set(), settled: true, create: () => {}, lateRegister: () => {}, ops: NO_OPS });
  const by = Object.fromEntries(w.panels.getSnapshot().panels.map((p) => [p.id, p]));
  assert.equal(by.l!.pinned, true);
  assert.equal(by.r!.pinned, false);
  assert.equal(by.l!.deferredPin, null);
});

test('the afterClose differential: the same close, run under each value, differs at the next launch', async () => {
  const outcomes: Array<[string, number]> = [];
  for (const value of ['stay-closed', 'return-next-launch'] as const) {
    const store = memoryWorkspaceStorage();
    const t = markerTemplate(`diff-${value}`, { settings: { afterClose: value } });
    const first = await launch(store, [t]);
    act(() => first.m.latest().close(engineId(first.ws, t.id)));
    await settle();
    first.m.unmount();
    cleanup();
    const second = await launch(store, [t]);
    outcomes.push([value, live(second.ws).length]);
  }
  differential('afterClose', (run) => {
    for (const [value, count] of outcomes) run(value, () => count);
  });
  assert.deepEqual(differentialsCovered().filter((n) => n === 'afterClose'), ['afterClose']);
});
