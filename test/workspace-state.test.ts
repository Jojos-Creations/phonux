/**
 * The saved workspace shape and its pure functions (shared/phone/workspaceState.ts): what project saves, what
 * hydrate rebuilds, what the guard accepts. No React, no DOM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRowOrder } from '../panelRowOrder.js';
import { DEFAULT_PANEL_SIZE, TIER_SIZES } from '../panelTiers.js';
import { appendPanel, createHistoryPanel } from '../panelWindow.js';
import { hydrateWorkspaceState, isWorkspaceState, projectWorkspaceState } from '../workspaceState.js';
import type { JsonValue, PanelWindow, WorkspacePanelState, WorkspaceState } from '../index.js';

const ROOT = 'history';

/** A collapsible live panel as the host holds it; `more` overrides any field. */
const panel = (id: string, more: Partial<PanelWindow> = {}): PanelWindow => ({
  id,
  url: `https://${id}.example`,
  live: true,
  locked: false,
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
    formFactor: 'tablet',
    size: { ...TIER_SIZES.tablet },
  });
  const state = projectWorkspaceState([root, full], ROOT);
  assert.equal(state.version, 1);
  assert.deepEqual(state.panels.map((p) => p.id), ['7'], 'control: the panel is saved and the root is not');
  const entry = state.panels[0]!;
  assert.deepEqual(Object.keys(entry).sort(), ['anchor', 'formFactor', 'id', 'layer', 'listed', 'live', 'params', 'title', 'url', 'view']);
  for (const key of ['hostData', 'size', 'locked', 'collapsible', 'anchoredEnter', 'permanent']) assert.equal(key in entry, false, key);
  assert.deepEqual(entry, {
    id: '7',
    view: 'web',
    url: 'https://7.example',
    title: 'Seven',
    params: { k: ['v'] },
    listed: true,
    live: true,
    anchor: { panel: ROOT, position: 'right', priority: 0 },
    formFactor: 'tablet',
    layer: 'raised',
  });
  assert.equal(JSON.stringify(state).includes('secret'), false, 'the root is not in the file, hostData included');
});

test('W2 project derives permanent from collapsible and emits an optional key only when it is defined', () => {
  const bare = { id: 'bare', url: 'https://bare.example', live: false, locked: false, view: 'web', collapsible: true } as PanelWindow;
  const undefinedKeys = panel('undef', { title: undefined, params: undefined, layer: undefined, formFactor: undefined });
  const rail = panel('rail', { collapsible: false, listed: false, title: 'Rail', formFactor: 'phone' });
  const rich = panel('rich', { title: '', params: null, listed: false, layer: 'raised', formFactor: 'desktop' });
  const [b, u, r, c] = projectWorkspaceState([createHistoryPanel(ROOT), bare, undefinedKeys, rail, rich], ROOT).panels;
  assert.deepEqual(Object.keys(b!).sort(), ['anchor', 'id', 'live', 'url', 'view'], 'a record without listed, title, params, layer or formFactor saves none of those keys');
  assert.equal(b!.live, false);
  assert.deepEqual(Object.keys(u!).sort(), ['anchor', 'id', 'listed', 'live', 'url', 'view'], 'keys that are present but undefined are not emitted');
  assert.equal(r!.permanent, true, 'collapsible false is saved as permanent');
  assert.deepEqual(Object.keys(r!).sort(), ['anchor', 'formFactor', 'id', 'listed', 'live', 'permanent', 'title', 'url', 'view']);
  assert.equal('permanent' in u!, false, 'a collapsible panel never carries permanent');
  assert.equal('permanent' in c!, false);
  assert.deepEqual([c!.title, c!.params, c!.listed, c!.layer, c!.formFactor], ['', null, false, 'raised', 'desktop'], 'defined values are emitted as they are, falsy ones included');
  for (const entry of [b!, u!, r!, c!]) {
    for (const [key, value] of Object.entries({ ...entry, ...entry.anchor })) assert.notEqual(value, undefined, `${entry.id}.${key} holds undefined`);
  }
});

test('W3 project fills a missing anchor from position, round-trips through JSON and is assignable to JsonValue', () => {
  const left = panel('l');
  const right1 = panel('r1');
  const right2 = panel('r2', { anchor: { panel: 'r1', position: 'left', priority: 4 } });
  const state = projectWorkspaceState([left, createHistoryPanel(ROOT), right1, right2], ROOT);
  assert.deepEqual(state.panels.map((p) => [p.id, p.anchor]), [
    ['l', { panel: ROOT, position: 'left', priority: 0 }],
    ['r1', { panel: ROOT, position: 'right', priority: 0 }],
    ['r2', { panel: 'r1', position: 'left', priority: 4 }],
  ], 'an anchor the panel already has is copied as it stands');
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

test('W7 hydrate applies appendPanel\'s creation rules: permanent wins over listed, tier and live, sizes come from the tier, an unknown view is kept', () => {
  const freshId = drawFrom(['21', '22', '23', '24']);
  const state = file(
    saved('p', { url: 'https://p.example', permanent: true, listed: true, formFactor: 'desktop', live: false, anchor: { panel: ROOT, position: 'right', priority: 0 } }),
    saved('t', { url: 'https://t.example', formFactor: 'tablet', live: false, anchor: { panel: ROOT, position: 'right', priority: 1 } }),
    saved('m', { url: 'https://m.example', view: 'mystery-view', anchor: { panel: ROOT, position: 'right', priority: 2 } }),
    saved('l', { url: 'https://l.example', listed: false, layer: 'raised', title: 'Kept', params: { n: 1 }, anchor: { panel: ROOT, position: 'right', priority: 3 } }),
  );
  const [p, t, m, l] = hydrateWorkspaceState(state, freshId, ROOT) as [PanelWindow, PanelWindow, PanelWindow, PanelWindow];
  assert.deepEqual([p.collapsible, p.listed, p.formFactor, p.live, p.size], [false, false, 'phone', true, DEFAULT_PANEL_SIZE], 'permanent: not collapsible, not listed, phone, and shown though saved parked');
  assert.deepEqual([t.collapsible, t.formFactor, t.live, t.size], [true, 'tablet', false, TIER_SIZES.tablet], 'a collapsible tablet keeps its tier, its size and its parked flag');
  assert.notEqual(t.size, TIER_SIZES.tablet, 'the size is a copy of the tier table entry');
  assert.deepEqual([m.view, m.listed, m.formFactor, m.layer], ['mystery-view', true, 'phone', 'base'], 'an unknown view key survives, and every default comes from appendPanel');
  assert.deepEqual([l.listed, l.layer, l.title, l.params], [false, 'raised', 'Kept', { n: 1 }]);
  for (const entry of [p, t, m, l]) {
    assert.deepEqual([entry.locked, entry.anchoredEnter, 'hostData' in entry], [false, false, false], 'hostData is left for the provider');
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
  row = appendPanel(row, { url: 'https://two.example', title: 'two', view: 'note', params: { a: [1, { b: null }] }, formFactor: 'tablet' }, id(), ROOT);
  row = appendPanel(row, { url: 'https://rail.example', title: 'rail', permanent: true, anchor: { position: 'left' } }, id(), ROOT);
  row = appendPanel(row, { url: 'https://three.example', title: 'three', listed: false, layer: 'raised', anchor: { position: 'left' } }, id(), ROOT);
  row = appendPanel(row, { url: 'https://four.example', title: 'four', formFactor: 'desktop', anchor: { position: 'right', priority: -1 } }, id(), ROOT);
  row = row.map((p) => (p.title === 'one' || p.title === 'four' ? { ...p, live: false } : p));
  assert.ok(new Set(row.map((p) => p.live)).size === 2 && new Set(row.map((p) => p.formFactor)).size === 3, 'control: the row is mixed in live flag and tier');

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
      { id: 'b', view: 'web', url: 'https://b.example', live: false, title: 'B', listed: false, permanent: false, layer: 'raised', formFactor: 'desktop', params: { deep: [1, null] }, anchor: { panel: 'a', position: 'left', priority: -1 } },
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
    ['no id', (s) => { delete s.panels[1].id; }],
    ['a numeric id', (s) => { s.panels[1].id = 2; }],
    ['no view', (s) => { delete s.panels[1].view; }],
    ['no url', (s) => { delete s.panels[1].url; }],
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
  for (const value of [null, undefined, 0, 1, 'text', true, [], [good()], () => good()]) assert.equal(isWorkspaceState(value), false, String(value));
});
