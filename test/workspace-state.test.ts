/**
 * The saved workspace shape and its pure functions (workspaceState.ts): what project saves, what
 * hydrate rebuilds, what the guard accepts. No React, no DOM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowOrder } from '../panelRowOrder.js';
import { appendPanel, createHistoryPanel, slotsOf } from '../panelWindow.js';
import { ALL_SLOTS } from '../rowConstants.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings } from '../panelSettings.js';
import { DISMISSED_LIMIT, cleanDismissed, cleanSavedExtras, hydrateWorkspaceState, isWorkspaceState, projectWorkspaceState } from '../workspaceState.js';
import type { Dropped } from '../workspaceState.js';
import type { JsonValue, PanelWindow, WorkspacePanelState, WorkspaceState } from '../index.js';

const ROOT = 'history';

/** A collapsible live panel as the host holds it; `more` overrides any field. */
const uidFor = (id: string): string => `u_${Buffer.from(id).toString('hex').padEnd(32, '0')}`;
const panel = (id: string, more: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  uid: uidFor(id),
  url: `https://${id}.example`,
  live: true,
  view: 'web',
  collapsible: true,
  listed: true,
  ...more,
});

/** A saved entry anchored right of the root; `more` overrides any field. */
const saved = (id: string, more: Partial<WorkspacePanelState> = {}): WorkspacePanelState => ({
  id,
  view: 'web',
  url: `https://${id}.example`,
  live: true,
  anchor: { panel: ROOT, position: 'right', priority: 0 },
  ...more,
});

const file = (...panels: WorkspacePanelState[]): WorkspaceState => ({ version: 1, panels });

/** A freshId that hands out `ids` in order and fails loudly when asked for more. */
const drawFrom = (ids: readonly string[]) => {
  const drawn: string[] = [];
  const freshId = (): string => {
    const next = ids[drawn.length];
    assert.ok(next !== undefined, `freshId was asked for draw ${drawn.length + 1}, but only ${ids.length} were planned`);
    drawn.push(next);
    return next;
  };
  return Object.assign(freshId, { drawn });
};

test('W1 project saves exactly the documented keys, never hostData, size, locked, collapsible or anchoredEnter, and never the root', () => {
  const root: PanelWindow = { ...createHistoryPanel(ROOT), hostData: { secret: 'root' } };
  const full = panel('7', {
    title: 'Seven',
    params: { k: ['v'] },
    hostData: { webContentsId: 12 },
    anchor: { panel: ROOT, position: 'right', priority: 0 },
    layer: 'raised',
    anchoredEnter: true,
    slots: 2,
  });
  const state = projectWorkspaceState([root, full], ROOT);
  assert.equal(state.version, 1);
  assert.deepEqual(state.panels.map((p) => p.uid), [uidFor('7')], 'control: the panel is saved and the root is not');
  const entry = state.panels[0]!;
  assert.deepEqual(Object.keys(entry).sort(), ['anchor', 'layer', 'listed', 'live', 'params', 'slots', 'title', 'uid', 'url', 'view'], 'no counter id is saved');
  for (const key of ['hostData', 'size', 'locked', 'collapsible', 'anchoredEnter', 'permanent']) assert.equal(key in entry, false, key);
  assert.deepEqual(entry, {
    uid: uidFor('7'),
    view: 'web',
    url: 'https://7.example',
    title: 'Seven',
    params: { k: ['v'] },
    listed: true,
    live: true,
    anchor: { panel: ROOT, position: 'right', priority: 0 },
    slots: 2,
    layer: 'raised',
  });
  assert.equal(JSON.stringify(state).includes('secret'), false, 'the root is not in the file, hostData included');
});

test('W2 project derives permanent from collapsible and emits an optional key only when it is defined', () => {
  const bare = { id: 'bare', url: 'https://bare.example', live: false, view: 'web', collapsible: true } as PanelWindow;
  const undefinedKeys = panel('undef', { title: undefined, params: undefined, layer: undefined, slots: undefined });
  const rail = panel('rail', { collapsible: false, listed: false, title: 'Rail', slots: 1 });
  const rich = panel('rich', { title: '', params: null, listed: false, layer: 'raised', slots: ALL_SLOTS });
  const [b, u, r, c] = projectWorkspaceState([createHistoryPanel(ROOT), bare, undefinedKeys, rail, rich], ROOT).panels;
  assert.deepEqual(Object.keys(b!).sort(), ['anchor', 'live', 'url', 'view'], 'a record without listed, title, params, layer or slots saves none of those keys');
  assert.equal(b!.live, false);
  assert.deepEqual(Object.keys(u!).sort(), ['anchor', 'listed', 'live', 'uid', 'url', 'view'], 'keys that are present but undefined are not emitted');
  assert.equal(r!.permanent, true, 'collapsible false is saved as permanent');
  assert.deepEqual(Object.keys(r!).sort(), ['anchor', 'listed', 'live', 'permanent', 'title', 'uid', 'url', 'view']);
  assert.equal('slots' in r!, false, 'one slot is the default and is not written');
  assert.equal('permanent' in u!, false, 'a collapsible panel never carries permanent');
  assert.equal('permanent' in c!, false);
  assert.deepEqual([c!.title, c!.params, c!.listed, c!.layer, c!.slots], ['', null, false, 'raised', ALL_SLOTS], 'defined values are emitted as they are, falsy ones included');
  for (const entry of [b!, u!, r!, c!]) {
    for (const [key, value] of Object.entries({ ...entry, ...entry.anchor })) assert.notEqual(value, undefined, `${entry.uid}.${key} holds undefined`);
  }
});

test('W3 project fills a missing anchor from position, round-trips through JSON and is assignable to JsonValue', () => {
  const left = panel('l');
  const right1 = panel('r1');
  const right2 = panel('r2', { anchor: { panel: 'r1', position: 'left', priority: 4 } });
  const state = projectWorkspaceState([left, createHistoryPanel(ROOT), right1, right2], ROOT);
  assert.deepEqual(state.panels.map((p) => [p.uid, p.anchor]), [
    [uidFor('l'), { panel: ROOT, position: 'left', priority: 0 }],
    [uidFor('r1'), { panel: ROOT, position: 'right', priority: 0 }],
    [uidFor('r2'), { panel: uidFor('r1'), position: 'left', priority: 4 }],
  ], 'an anchor the panel already has is copied as it stands, its target named by uid');
  const asJson: JsonValue = state;
  assert.deepEqual(JSON.parse(JSON.stringify(asJson)), state);
  assert.equal(isWorkspaceState(JSON.parse(JSON.stringify(state))), true, 'what project writes is what the guard reads');
});

test('W4 hydrate replaces every id with freshId\'s and re-points anchors, never reusing a saved id that equals a fresh one', () => {
  // The fresh ids are a permutation of the saved ones: a hydrate that kept saved ids, or mapped them wrongly, fails.
  const freshId = drawFrom(['2', '3', '1']);
  const state = file(
    saved('1', { url: 'https://a.example' }),
    saved('2', { url: 'https://b.example', anchor: { panel: '1', position: 'right', priority: 0 } }),
    saved('3', { url: 'https://c.example', anchor: { panel: '2', position: 'right', priority: 0 } }),
  );
  const out = hydrateWorkspaceState(state, freshId, ROOT);
  assert.deepEqual(freshId.drawn, ['2', '3', '1'], 'one draw per saved entry, in file order, and no other');
  assert.deepEqual(out.map((p) => [p.url, p.id]), [['https://a.example', '2'], ['https://b.example', '3'], ['https://c.example', '1']]);
  assert.deepEqual(out.map((p) => p.anchor), [
    { panel: ROOT, position: 'right', priority: 0 },
    { panel: '2', position: 'right', priority: 0 },
    { panel: '3', position: 'right', priority: 0 },
  ]);
  assert.equal(new Set(out.map((p) => p.id)).size, 3);
});

test('W5 hydrate sends a dangling anchor through the root-right fallback, keeping its priority, and never attaches it to a panel whose fresh id equals the dangling saved id', () => {
  // '7' is saved as an anchor target but is not in the file, and the first fresh id is also '7'.
  const freshId = drawFrom(['7', '8', '9', '10']);
  const state = file(
    saved('x', { url: 'https://x.example', anchor: { panel: ROOT, position: 'right', priority: 0 } }),
    saved('d', { url: 'https://d.example', anchor: { panel: '7', position: 'left', priority: 1 } }),
    saved('y', { url: 'https://y.example', anchor: { panel: ROOT, position: 'right', priority: 2 } }),
  );
  const out = hydrateWorkspaceState(state, freshId, ROOT);
  assert.deepEqual(out.map((p) => p.url), ['https://x.example', 'https://d.example', 'https://y.example'], 'priority 1 lands between 0 and 2');
  assert.deepEqual(out.map((p) => p.anchor), [
    { panel: ROOT, position: 'right', priority: 0 },
    { panel: ROOT, position: 'right', priority: 1 },
    { panel: ROOT, position: 'right', priority: 2 },
  ], 'the dangling panel is on the root\'s right, not beside the panel that holds fresh id 7');
  assert.equal(out[0]!.id, '7', 'control: a panel really holds the fresh id equal to the dangling saved id');
  assert.deepEqual(freshId.drawn, ['7', '8', '9', '10'], 'one sentinel, drawn after the entries');
});

test('W6 hydrate resolves a self-anchor and a cycle without throwing, each panel exactly once', () => {
  const freshId = drawFrom(['11', '12', '13', '14']);
  const state = file(
    saved('a', { url: 'https://a.example', anchor: { panel: 'a', position: 'right', priority: 0 } }),
    saved('b', { url: 'https://b.example', anchor: { panel: 'c', position: 'left', priority: 0 } }),
    saved('c', { url: 'https://c.example', anchor: { panel: 'b', position: 'right', priority: 0 } }),
    saved('d', { url: 'https://d.example', anchor: { panel: ROOT, position: 'left', priority: 0 } }),
  );
  const out = hydrateWorkspaceState(state, freshId, ROOT);
  assert.deepEqual(out.map((p) => p.url).sort(), ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example']);
  assert.equal(new Set(out.map((p) => p.id)).size, 4);
  const known = new Set([ROOT, ...out.map((p) => p.id)]);
  for (const p of out) assert.ok(known.has(p.anchor!.panel), `${p.url} is anchored to something that exists`);
  assert.equal(out[0]!.url, 'https://d.example', 'control: the well-formed left entry still sits left of the root');
});

test('W7 hydrate applies appendPanel\'s creation rules: permanent wins over listed, slots and live, sizes come from the slots, an unknown view is kept', () => {
  const freshId = drawFrom(['21', '22', '23', '24']);
  const state = file(
    saved('p', { url: 'https://p.example', permanent: true, listed: true, slots: ALL_SLOTS, live: false, anchor: { panel: ROOT, position: 'right', priority: 0 } }),
    saved('t', { url: 'https://t.example', slots: 2, live: false, anchor: { panel: ROOT, position: 'right', priority: 1 } }),
    saved('m', { url: 'https://m.example', view: 'mystery-view', anchor: { panel: ROOT, position: 'right', priority: 2 } }),
    saved('l', { url: 'https://l.example', listed: false, layer: 'raised', title: 'Kept', params: { n: 1 }, anchor: { panel: ROOT, position: 'right', priority: 3 } }),
  );
  const [p, t, m, l] = hydrateWorkspaceState(state, freshId, ROOT) as [PanelWindow, PanelWindow, PanelWindow, PanelWindow];
  assert.deepEqual([p.collapsible, p.listed, p.slots, p.live], [false, false, 1, true], 'permanent: not collapsible, not listed, one slot, and shown though saved parked');
  assert.deepEqual([t.collapsible, t.slots, t.live], [true, 2, false], 'a collapsible two-slot panel keeps its slots and its parked flag');
  assert.deepEqual([m.view, m.listed, m.slots, m.layer], ['mystery-view', true, 1, 'base'], 'an unknown view key survives, and every default comes from appendPanel');
  assert.deepEqual([l.listed, l.layer, l.title, l.params], [false, 'raised', 'Kept', { n: 1 }]);
  for (const entry of [p, t, m, l]) {
    assert.deepEqual([entry.anchoredEnter, 'hostData' in entry], [false, false], 'hostData is left for the provider');
  }
});

test('W8 hydrate honors each saved live flag and the saved order of collapsible panels', () => {
  const freshId = drawFrom(['31', '32', '33', '34']);
  const state = file(
    saved('a', { url: 'https://a.example', live: true, anchor: { panel: ROOT, position: 'right', priority: 1 } }),
    saved('b', { url: 'https://b.example', live: false, anchor: { panel: ROOT, position: 'right', priority: 0 } }),
    saved('c', { url: 'https://c.example', live: true, anchor: { panel: ROOT, position: 'left', priority: 0 } }),
    saved('d', { url: 'https://d.example', live: false, anchor: { panel: ROOT, position: 'right', priority: 2 } }),
  );
  const out = hydrateWorkspaceState(state, freshId, ROOT);
  assert.deepEqual(out.map((p) => [p.url.slice(8, 9), p.live]), [['c', true], ['b', false], ['a', true], ['d', false]]);
});

test('W9 project then hydrate round-trips a mixed row: the same panels in the same order, everything but ids and hostData equal', () => {
  let n = 0;
  const id = (): string => `orig-${++n}`;
  let row: PanelWindow[] = [{ ...createHistoryPanel(ROOT), hostData: { h: 1 } }];
  row = appendPanel(row, { url: 'https://one.example', title: 'one', hostData: { h: 2 } }, id(), ROOT);
  row = appendPanel(row, { url: 'https://two.example', title: 'two', view: 'note', params: { a: [1, { b: null }] }, slots: 2 }, id(), ROOT);
  row = appendPanel(row, { url: 'https://rail.example', title: 'rail', permanent: true, anchor: { position: 'left' } }, id(), ROOT);
  row = appendPanel(row, { url: 'https://three.example', title: 'three', listed: false, layer: 'raised', anchor: { position: 'left' } }, id(), ROOT);
  row = appendPanel(row, { url: 'https://four.example', title: 'four', slots: ALL_SLOTS, anchor: { position: 'right', priority: -1 } }, id(), ROOT);
  row = row.map((p) => (p.title === 'one' || p.title === 'four' ? { ...p, live: false } : p));
  assert.ok(new Set(row.map((p) => p.live)).size === 2 && new Set(row.map(slotsOf)).size === 3, 'control: the row is mixed in live flag and slots');

  const state = JSON.parse(JSON.stringify(projectWorkspaceState(row, ROOT))) as WorkspaceState;
  const restored = computeRowOrder([createHistoryPanel(ROOT), ...hydrateWorkspaceState(state, drawFrom(['a', 'b', 'c', 'd', 'e']), ROOT)], ROOT);
  const titleOf = new Map(row.map((p) => [p.id, p.title ?? p.id]));
  const restoredTitleOf = new Map(restored.map((p) => [p.id, p.title ?? p.id]));
  const comparable = (p: PanelWindow, names: Map<string, string>) => {
    const { id: _id, hostData: _hostData, ...rest } = p;
    return { ...rest, anchor: p.anchor && { ...p.anchor, panel: names.get(p.anchor.panel) } };
  };
  assert.deepEqual(
    restored.map((p) => comparable(p, restoredTitleOf)),
    row.map((p) => comparable(p, titleOf)),
  );
  assert.equal(restored.filter((p) => 'hostData' in p).length, 0, 'control: the original row carried hostData and none of it came back');
  assert.equal(row.filter((p) => 'hostData' in p).length, 2);
});

test('W10 isWorkspaceState accepts a good file and extra keys, and rejects every malformed one, each against a valid control', () => {
  const good = (): Record<string, any> => ({
    version: 1,
    panels: [
      { id: 'a', view: 'web', url: 'https://a.example', live: true, anchor: { panel: ROOT, position: 'right', priority: 0 } },
      { id: 'b', view: 'web', url: 'https://b.example', live: false, title: 'B', listed: false, permanent: false, layer: 'raised', slots: 3, params: { deep: [1, null] }, anchor: { panel: 'a', position: 'left', priority: -1 } },
    ],
  });
  assert.equal(isWorkspaceState(good()), true);
  assert.equal(isWorkspaceState({ version: 1, panels: [] }), true, 'an empty workspace is a workspace');
  const extras = good();
  extras.future = { anything: true };
  extras.panels[0].note = 'from a later version';
  extras.panels[0].anchor.weight = 3;
  assert.equal(isWorkspaceState(extras), true, 'unknown keys are ignored, not rejected');

  const rejections: Array<[string, (s: Record<string, any>) => void]> = [
    ['version 2', (s) => { s.version = 2; }],
    ['version as a string', (s) => { s.version = '1'; }],
    ['no version', (s) => { delete s.version; }],
    ['panels is an object', (s) => { s.panels = {}; }],
    ['panels is null', (s) => { s.panels = null; }],
    ['no panels', (s) => { delete s.panels; }],
    ['an entry that is null', (s) => { s.panels[1] = null; }],
    ['an entry that is a string', (s) => { s.panels[1] = 'b'; }],
    ['an entry that is an array', (s) => { s.panels[1] = []; }],
    ['an object id', (s) => { s.panels[1].id = {}; }],
    ['a numeric id', (s) => { s.panels[1].id = 2; }],
    ['no view', (s) => { delete s.panels[1].view; }],
    ['a url that is not a string', (s) => { s.panels[1].url = 5; }],
    ['a numeric url', (s) => { s.panels[1].url = 5; }],
    ['no live', (s) => { delete s.panels[1].live; }],
    ['live as a string', (s) => { s.panels[1].live = 'false'; }],
    ['a numeric title', (s) => { s.panels[1].title = 4; }],
    ['a null title', (s) => { s.panels[1].title = null; }],
    ['listed as a number', (s) => { s.panels[1].listed = 0; }],
    ['permanent as a string', (s) => { s.panels[1].permanent = 'yes'; }],
    ['an unknown layer', (s) => { s.panels[1].layer = 'front'; }],
    ['an unknown formFactor', (s) => { s.panels[1].formFactor = 'watch'; }],
    ['a numeric formFactor', (s) => { s.panels[1].formFactor = 1; }],
    ['zero slots', (s) => { s.panels[1].slots = 0; }],
    ['slots past the library cap', (s) => { s.panels[1].slots = ALL_SLOTS + 1; }],
    ['a fractional slots', (s) => { s.panels[1].slots = 1.5; }],
    ['slots as a string', (s) => { s.panels[1].slots = '2'; }],
    ['no anchor', (s) => { delete s.panels[1].anchor; }],
    ['a string anchor', (s) => { s.panels[1].anchor = 'a'; }],
    ['a null anchor', (s) => { s.panels[1].anchor = null; }],
    ['a numeric anchor panel', (s) => { s.panels[1].anchor.panel = 1; }],
    ['an unknown anchor position', (s) => { s.panels[1].anchor.position = 'up'; }],
    ['a NaN priority', (s) => { s.panels[1].anchor.priority = Number.NaN; }],
    ['an infinite priority', (s) => { s.panels[1].anchor.priority = Number.POSITIVE_INFINITY; }],
    ['a string priority', (s) => { s.panels[1].anchor.priority = '0'; }],
    ['no priority', (s) => { delete s.panels[1].anchor.priority; }],
    ['a duplicate id', (s) => { s.panels[1].id = 'a'; }],
  ];
  for (const [label, corrupt] of rejections) {
    const control = good();
    assert.equal(isWorkspaceState(control), true, `control for ${label}`);
    corrupt(control);
    assert.equal(isWorkspaceState(control), false, label);
  }
  for (const tier of ['phone', 'tablet', 'desktop']) {
    const old = good();
    old.panels[1].formFactor = tier;
    assert.equal(isWorkspaceState(old), true, `a file with formFactor ${tier}, as one saved before slots holds, is still accepted`);
  }
  const urlless = good();
  delete urlless.panels[1].url;
  assert.equal(isWorkspaceState(urlless), true, 'a panel with no url is a valid saved panel');
  for (const value of [null, undefined, 0, 1, 'text', true, [], [good()], () => good()]) assert.equal(isWorkspaceState(value), false, String(value));
});

/** A panel as a creation path builds it: appendPanel's skeleton resolved by `layer`, carrying settings and a key. */
const made = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id }, id, ROOT)[0]!;
  return { ...applyTemplate({ ...skeleton, ...over }, resolvePanelSettings({ template: layer }).value, 'create') };
};
const rowOf = (...entries: PanelWindow[]): PanelWindow[] => computeRowOrder([createHistoryPanel(ROOT), ...entries], ROOT);

test('W11 project writes key, instance, overrides, applied and closable for an entry that carries settings, and nothing for a hand-built one', () => {
  const carrying = made('a', { closable: false }, { overrides: { slots: 2 }, applied: { placeOnAdd: 'row-end' }, instance: { title: 'A' } });
  const state = projectWorkspaceState(rowOf(carrying, panel('b')), ROOT);
  const [a, b] = state.panels;
  assert.deepEqual({ key: a!.key, instance: a!.instance, overrides: a!.overrides, applied: a!.applied, closable: a!.closable }, { key: 'a', instance: { title: 'A' }, overrides: { slots: 2 }, applied: { placeOnAdd: 'row-end' }, closable: false });
  for (const key of ['key', 'instance', 'overrides', 'applied', 'closable']) assert.equal(key in b!, false, `a hand-built entry has no ${key}`);
});

test('W12 project writes instance only for an entry code does not declare, and an empty one when it holds none', () => {
  const [declared, anonymous] = projectWorkspaceState(rowOf(made('d', {}, { declared: true, instance: { title: 'ignored' } }), made('x')), ROOT).panels;
  assert.equal('instance' in declared!, false);
  assert.deepEqual(anonymous!.instance, {});
});

test('W13 project never writes deferredPin, hostData, size or settings, and drops a function a settings layer holds', () => {
  const carrying = made('a', {}, { hostData: { secret: 1 }, instance: { title: 'T', headerButtons: { b: { onPress: () => undefined } } } as unknown as PanelSettings });
  const entry = projectWorkspaceState(rowOf({ ...carrying, deferredPin: { by: 'pin' } } as PanelWindow), ROOT).panels[0]! as Record<string, unknown>;
  for (const key of ['deferredPin', 'hostData', 'size', 'settings', 'locked', 'collapsible']) assert.equal(key in entry, false, key);
  assert.equal(JSON.stringify(entry.instance), '{"title":"T","headerButtons":{"b":{}}}');
});

test('W15 project keeps an anchor that names a panel the row never held, as 0.1.0 did', () => {
  const ghost: PanelWindow = panel('p', { anchor: { panel: 'ghost', position: 'left', priority: 3 } });
  assert.deepEqual(projectWorkspaceState([createHistoryPanel(ROOT), ghost], ROOT).panels[0]!.anchor, { panel: 'ghost', position: 'left', priority: 3 });
});

test('W17 project writes dismissed only when it holds a key, and root only when the root entry carries a key and settings', () => {
  assert.equal('dismissed' in projectWorkspaceState([createHistoryPanel(ROOT)], ROOT), false);
  assert.deepEqual(projectWorkspaceState([createHistoryPanel(ROOT)], ROOT, ['gone']).dismissed, ['gone']);
  assert.equal('root' in projectWorkspaceState([createHistoryPanel(ROOT)], ROOT), false, 'a hand-built root names nothing');
  const keyedRoot = applyTemplate(createHistoryPanel(ROOT), resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
  assert.equal(projectWorkspaceState([{ ...keyedRoot, key: 'history' }], ROOT).root, 'history');
});

test('W18 a file this build writes passes isWorkspaceState and survives JSON', () => {
  const state = projectWorkspaceState(rowOf(made('a', {}, { overrides: {}, applied: { placeOnAdd: 'row-end' } }), made('b')), ROOT, ['x']);
  assert.equal(isWorkspaceState(JSON.parse(JSON.stringify(state))), true);
});

test('W19 isWorkspaceState does not reject an entry for a malformed additive key', () => {
  const entry = { ...saved('a'), key: 5, instance: [], overrides: 'x', applied: 7, closable: true };
  assert.equal(isWorkspaceState({ version: 1, panels: [entry], dismissed: {} }), true);
});

const extras = (more: Record<string, unknown>, seen: Set<string> = new Set()): { out: ReturnType<typeof cleanSavedExtras>; dropped: Dropped[] } => {
  const dropped: Dropped[] = [];
  return { out: cleanSavedExtras({ ...saved('a'), ...more } as WorkspacePanelState, seen, dropped), dropped };
};

const malformed: { name: string; more: Record<string, unknown>; dropped: string; has: string }[] = [
  { name: "overrides 'x'", more: { overrides: 'x' }, dropped: 'overrides', has: 'owned' },
  { name: 'an overrides.anchor without a position', more: { overrides: { anchor: { panel: 'b', priority: 1 } } }, dropped: 'overrides.anchor', has: '' },
  { name: 'an overrides.formFactor outside the tiers of an old file', more: { overrides: { formFactor: 'watch' } }, dropped: 'overrides.formFactor', has: '' },
  { name: 'an overrides.slots below one', more: { overrides: { slots: 0 } }, dropped: 'overrides.slots', has: '' },
  { name: 'an overrides.parkable that is not a boolean', more: { overrides: { parkable: 'yes' } }, dropped: 'overrides.parkable', has: '' },
  { name: 'an applied without placeOnAdd', more: { applied: {} }, dropped: 'applied', has: 'applied' },
  { name: 'an empty key', more: { key: '' }, dropped: 'key', has: 'key' },
  { name: 'an instance that is an array', more: { instance: [] }, dropped: 'instance', has: 'instance' },
  { name: 'a closable that is true', more: { closable: true }, dropped: 'closable', has: 'closable' },
];
for (const { name, more, dropped, has } of malformed) {
  test(`W20 cleanSavedExtras drops ${name} with a note and keeps the rest`, () => {
    const { out, dropped: notes } = extras({ ...more, key: has === 'key' ? '' : 'k' });
    assert.ok(notes.some((n) => n.key === dropped), `a note names ${dropped}`);
    if (has === 'owned') assert.equal(out.owned, undefined);
    else if (has !== '') assert.equal(has in out && (out as Record<string, unknown>)[has] !== undefined, false, `${has} is gone`);
    if (has !== 'key') assert.equal(out.key, 'k', 'control: the well-formed key survived');
  });
}

test('W21 cleanSavedExtras keeps a well-formed set whole, and drops the second entry that repeats a key', () => {
  const whole = { key: 'k', instance: { title: 'T' }, overrides: { anchor: { panel: 'b', position: 'left', priority: 1 }, slots: 2, parkable: false }, applied: { placeOnAdd: 'row-end' }, closable: false };
  const seen = new Set<string>();
  const first = extras(whole, seen);
  assert.deepEqual(first.dropped, []);
  assert.deepEqual(first.out, { key: 'k', instance: { title: 'T' }, owned: whole.overrides, applied: whole.applied, closable: false });
  const second = extras({ key: 'k' }, seen);
  assert.equal(second.out.key, undefined);
  assert.equal(second.dropped.length, 1);
});

test('W22 cleanDismissed keeps strings only, once each, the newest 256, and reads a non-array as empty with a note', () => {
  const dropped: Dropped[] = [];
  assert.deepEqual(cleanDismissed(['a', 5, '', 'b', 'a'], dropped), ['b', 'a']);
  const many = Array.from({ length: 300 }, (_, k) => `k${k}`);
  const kept = cleanDismissed(many, dropped);
  assert.equal(kept.length, DISMISSED_LIMIT);
  assert.equal(kept[0], 'k44');
  assert.equal(kept[255], 'k299');
  assert.deepEqual(cleanDismissed({}, dropped), []);
  assert.deepEqual(dropped.map((d) => d.key), ['dismissed']);
  assert.deepEqual(cleanDismissed(undefined, dropped), []);
});

test('W24 hydrate reads a top-level formFactor of a file saved before slots as the slot count, and a slots key wins over it', () => {
  const old = (id: string, more: Record<string, unknown>): WorkspacePanelState => saved(id, more as Partial<WorkspacePanelState>);
  const state = file(
    old('p', { formFactor: 'phone', anchor: { panel: ROOT, position: 'right', priority: 0 } }),
    old('t', { formFactor: 'tablet', anchor: { panel: ROOT, position: 'right', priority: 1 } }),
    old('d', { formFactor: 'desktop', anchor: { panel: ROOT, position: 'right', priority: 2 } }),
    old('both', { formFactor: 'desktop', slots: 3, anchor: { panel: ROOT, position: 'right', priority: 3 } }),
    old('rail', { formFactor: 'desktop', permanent: true, anchor: { panel: ROOT, position: 'right', priority: 4 } }),
  );
  assert.equal(isWorkspaceState(state), true, 'control: the old file passes the guard');
  const out = hydrateWorkspaceState(state, drawFrom(['1', '2', '3', '4', '5']), ROOT);
  assert.deepEqual(out.map((e) => e.slots), [1, 2, ALL_SLOTS, 3, 1], 'phone 1, tablet 2, desktop every slot, slots over formFactor, a permanent column one');
});

test('W25 project never writes formFactor and writes slots only when it is not one', () => {
  const row = [createHistoryPanel(ROOT), panel('one', { slots: 1 }), panel('two', { slots: 2 }), panel('none'), panel('all', { slots: ALL_SLOTS })];
  const entries = projectWorkspaceState(row, ROOT).panels;
  assert.deepEqual(entries.map((e) => e.slots), [undefined, 2, undefined, ALL_SLOTS]);
  for (const entry of entries) assert.equal('formFactor' in entry, false, `${entry.id} has no formFactor`);
  assert.equal(JSON.stringify(entries).includes('formFactor'), false);
});

test('W26 cleanSavedExtras reads overrides.formFactor of a file saved before slots as a slot count, and overrides.slots wins over it', () => {
  const tiers: Array<[string, number]> = [['phone', 1], ['tablet', 2], ['desktop', ALL_SLOTS]];
  for (const [tier, slots] of tiers) {
    const { out, dropped } = extras({ overrides: { formFactor: tier } });
    assert.deepEqual(out.owned, { slots }, `${tier} is ${slots} slots`);
    assert.deepEqual(dropped, []);
  }
  assert.deepEqual(extras({ overrides: { formFactor: 'desktop', slots: 3 } }).out.owned, { slots: 3 }, 'slots wins when both are present');
  const bad = extras({ overrides: { formFactor: 'watch' } });
  assert.deepEqual(bad.dropped.map((d) => d.message), ['overrides.formFactor: expected phone, tablet or desktop; dropped']);
  assert.equal(bad.out.owned?.slots, undefined);
});
