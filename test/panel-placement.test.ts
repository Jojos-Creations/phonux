/**
 * Where a panel lands: placeOnAdd and placeOnShow, and the fixed rules for a return, a fallback and an undo. First the pure
 * resolver over literal rows (every expected id array is written out, none is derived from the code under test), then
 * the show, return and undo paths through the real provider. Rows are built the way a creation path builds them:
 * appendPanel's skeleton, then applyTemplate over a resolved layer.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { PanelRow, useProvidePanels } from '../index.js';
import { resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelWindow, PanelsInput, ProvidedPanels, ResolvedPanelSettings, SettingNote } from '../index.js';
import { placePanel, reportNotes, resolvePlacement, restorePlaced, type NamedPlacement, type PlacementOptions } from '../panelPlacement.js';
import { computeRowOrder, deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { applyTemplate } from '../panelSettings.js';
import type { AddPlacement } from '../panelSettings.js';
import { anchorPanel, appendPanel, createRootPanel, sideOfLiveRange, type AnchorRequest } from '../panelWindow.js';
import { differential, differentialsCovered } from './support/differential.js';
import { advanceFrames, cleanup, mount, withHost, useSeededInput, type SeedOptions } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'H';
const OWNED = ['placeOnAdd', 'placeOnShow'];

registerTestView('place-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

const resolve = (layer: PanelSettings = {}): ResolvedPanelSettings => resolvePanelSettings({ template: layer }).value;
const ids = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);
const liveFlags = (panels: readonly PanelWindow[]): string[] => panels.map((p) => `${p.id}${p.live ? '' : '~'}`);

/** A parkable panel as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'place-view' }, id, ROOT)[0]!;
  return { ...applyTemplate({ ...skeleton, ...over }, resolve({ overflow: 'park', ...layer }), 'create'), instance: { overflow: 'park', ...layer } };
}
/** A fixed column: never parked, anchored to nothing when it is the root. */
const fixed = (id: string): PanelWindow => applyTemplate({ ...createRootPanel(id), title: id }, resolvePanelSettings({ template: { title: id } }, { root: true }).value, 'create');
const rowOf = (entries: PanelWindow[], rootId = ROOT): PanelWindow[] => deriveAnchorsFromOrder(entries, rootId);

// ---------------------------------------------------------------------------
// The placement table: values x rows x variants, literal expected arrays
// ---------------------------------------------------------------------------

interface Value {
  name: string;
  value: AddPlacement | 'in-place';
  order?: () => readonly string[];
}
const VALUES: readonly Value[] = [
  { name: 'row-start', value: 'row-start' },
  { name: 'row-end', value: 'row-end' },
  { name: 'parkable-start', value: 'parkable-start' },
  { name: 'parkable-end', value: 'parkable-end' },
  { name: 'after-fixed', value: 'after-fixed' },
  { name: '{ after: H }', value: { after: 'H' } },
  { name: '{ before: A }', value: { before: 'A' } },
  { name: 'order', value: 'order', order: () => ['A', 'N', 'B'] },
  { name: '{ anchor: A right 0 }', value: { anchor: { panel: 'A', position: 'right', priority: 0 } } },
  { name: 'in-place', value: 'in-place' },
];

interface Row {
  name: string;
  build: (aLive: boolean) => PanelWindow[];
  /** Expected id sequence with N landed, per value name. */
  want: Record<string, string[]>;
  /** How many of the values must have landed at the fallback, with a note. */
  fallbacks: readonly string[];
}
const A_VARIANTS = [true, false] as const;
const a = (live: boolean): PanelWindow => made('A', {}, { live });

// The table's fallback is 'row-start', so a value that fell back is visible against the fixed 'row-end'.
const FALLBACK: NamedPlacement = 'row-start';

const ROWS: readonly Row[] = [
  {
    name: '[H* A B]',
    build: (live) => rowOf([fixed('H'), a(live), made('B')]),
    want: {
      'row-start': ['N', 'H', 'A', 'B'],
      'row-end': ['H', 'A', 'B', 'N'],
      'parkable-start': ['H', 'N', 'A', 'B'],
      'parkable-end': ['H', 'A', 'B', 'N'],
      'after-fixed': ['H', 'N', 'A', 'B'],
      '{ after: H }': ['H', 'N', 'A', 'B'],
      '{ before: A }': ['H', 'N', 'A', 'B'],
      order: ['H', 'A', 'N', 'B'],
      '{ anchor: A right 0 }': ['H', 'A', 'N', 'B'],
      'in-place': ['H', 'A', 'B', 'N'],
    },
    fallbacks: [],
  },
  {
    name: '[P H* A B]',
    build: (live) => rowOf([made('P'), fixed('H'), a(live), made('B')]),
    want: {
      'row-start': ['N', 'P', 'H', 'A', 'B'],
      'row-end': ['P', 'H', 'A', 'B', 'N'],
      'parkable-start': ['N', 'P', 'H', 'A', 'B'],
      'parkable-end': ['P', 'H', 'A', 'B', 'N'],
      'after-fixed': ['P', 'H', 'N', 'A', 'B'],
      '{ after: H }': ['P', 'H', 'N', 'A', 'B'],
      '{ before: A }': ['P', 'H', 'N', 'A', 'B'],
      order: ['P', 'H', 'A', 'N', 'B'],
      '{ anchor: A right 0 }': ['P', 'H', 'A', 'N', 'B'],
      'in-place': ['P', 'H', 'A', 'B', 'N'],
    },
    fallbacks: [],
  },
  {
    name: 'root-less [A B]',
    build: (live) => rowOf([a(live), made('B')]),
    want: {
      'row-start': ['N', 'A', 'B'],
      'row-end': ['A', 'B', 'N'],
      'parkable-start': ['N', 'A', 'B'],
      'parkable-end': ['A', 'B', 'N'],
      'after-fixed': ['N', 'A', 'B'],
      '{ after: H }': ['N', 'A', 'B'],
      '{ before: A }': ['N', 'A', 'B'],
      order: ['A', 'N', 'B'],
      '{ anchor: A right 0 }': ['A', 'N', 'B'],
      'in-place': ['A', 'B', 'N'],
    },
    fallbacks: ['{ after: H }'],
  },
  {
    name: '[H*] alone',
    build: () => rowOf([fixed('H')]),
    want: {
      'row-start': ['N', 'H'],
      'row-end': ['H', 'N'],
      'parkable-start': ['H', 'N'],
      'parkable-end': ['H', 'N'],
      'after-fixed': ['H', 'N'],
      '{ after: H }': ['H', 'N'],
      '{ before: A }': ['N', 'H'],
      order: ['N', 'H'],
      '{ anchor: A right 0 }': ['N', 'H'],
      'in-place': ['H', 'N'],
    },
    fallbacks: ['{ before: A }', 'order', '{ anchor: A right 0 }'],
  },
  {
    name: 'only the new panel',
    build: () => [],
    want: {
      'row-start': ['N'],
      'row-end': ['N'],
      'parkable-start': ['N'],
      'parkable-end': ['N'],
      'after-fixed': ['N'],
      '{ after: H }': ['N'],
      '{ before: A }': ['N'],
      order: ['N'],
      '{ anchor: A right 0 }': ['N'],
      'in-place': ['N'],
    },
    fallbacks: ['{ after: H }', '{ before: A }', 'order', '{ anchor: A right 0 }'],
  },
];

/** `N` appended the way a creation path does: the resolved anchor request, or none (in-place), through appendPanel. */
function landNew(row: PanelWindow[], v: Value): { ids: string[]; anchor: AnchorRequest | null; notes: SettingNote[] } {
  const o: PlacementOptions = { fallback: FALLBACK, ...(v.order === undefined ? {} : { order: v.order }) };
  const { anchor, notes } = resolvePlacement(row, ROOT, 'N', v.value, o);
  const landed = appendPanel(row, { view: 'web', url: 'https://n.example', ...(anchor === null ? {} : { anchor }) }, 'N', ROOT);
  return { ids: ids(landed), anchor, notes };
}

let executed = 0;
for (const v of VALUES) {
  for (const row of ROWS) {
    for (const aLive of A_VARIANTS) {
      test(`placement ${v.name} over ${row.name}, A ${aLive ? 'live' : 'parked'}`, () => {
        executed += 1;
        const built = row.build(aLive);
        const got = landNew(built, v);
        assert.deepEqual(got.ids, row.want[v.name], 'the appended panel lands at the literal slot');
        assert.equal(got.notes.length, row.fallbacks.includes(v.name) ? 1 : 0, row.fallbacks.includes(v.name) ? 'a fallback is noted once' : 'no note when the value was honoured');
        if (got.notes.length === 1) assert.equal(got.notes[0]!.code, 'placement-fallback');
        // The same value moves a panel already in the row to the same slot, whatever slot it starts in.
        if (v.value !== 'in-place' && built.length > 0) {
          const present = [...built, made('N')];
          const o: PlacementOptions & { rootId: string } = { rootId: ROOT, fallback: FALLBACK, ...(v.order === undefined ? {} : { order: v.order }) };
          assert.deepEqual(ids(placePanel(present, 'N', v.value, o).row), row.want[v.name], 're-placing a present panel gives the same arrangement');
        }
        if (v.value === 'in-place') assert.equal(got.anchor, null, 'in-place resolves to no anchor');
      });
    }
  }
}

test('the placement table executed values x rows x variants cases', () => {
  assert.equal(VALUES.length * ROWS.length * A_VARIANTS.length, 100, 'the table is 10 values over 5 rows in 2 variants');
  assert.equal(executed, VALUES.length * ROWS.length * A_VARIANTS.length);
});

// ---------------------------------------------------------------------------
// Anchors: the pinned zone, the marker and priority
// ---------------------------------------------------------------------------

const request = (row: PanelWindow[], rootId: string, value: AddPlacement, fallback: NamedPlacement = 'row-end'): AnchorRequest => {
  const { anchor } = resolvePlacement(row, rootId, 'N', value, { fallback });
  assert.ok(anchor !== null, 'a named value resolves to an anchor');
  return anchor;
};
const sideOf = (a: AnchorRequest): string => `${a.panel} ${a.position}`;

test('pinned zone: in [P H* A B] a new panel lands anchored { H, left } under row-start and parkable-start and { H, right } under after-fixed, { after: H } and row-end', () => {
  const row = rowOf([made('P'), fixed('H'), made('A'), made('B')]);
  assert.equal(sideOf(request(row, ROOT, 'row-start')), 'H left');
  assert.equal(sideOf(request(row, ROOT, 'parkable-start')), 'H left');
  assert.equal(sideOf(request(row, ROOT, 'after-fixed')), 'H right');
  assert.equal(sideOf(request(row, ROOT, { after: 'H' })), 'H right');
  assert.equal(sideOf(request(row, ROOT, 'row-end')), 'H right');
  const landed = appendPanel(row, { view: 'web', url: 'https://n.example', anchor: request(row, ROOT, 'parkable-start') }, 'N', ROOT);
  assert.equal(landed.find((p) => p.id === 'N')!.anchor!.position, 'left', 'the landed anchor reads left of the root: the panel is pinned');
});

test("root marker: in a root-less row [M A B] row-start lands left of the marker and every other value right of it", () => {
  const marker: PanelWindow = { ...fixed('__root__'), marker: true };
  const row = rowOf([marker, made('A'), made('B')], '__root__');
  const landedIds = (value: AddPlacement): string[] => {
    const { anchor } = resolvePlacement(row, '__root__', 'N', value, { fallback: 'row-end' });
    return ids(appendPanel(row, { view: 'web', url: 'https://n.example', ...(anchor === null ? {} : { anchor }) }, 'N', '__root__'));
  };
  assert.deepEqual(landedIds('row-start'), ['N', '__root__', 'A', 'B']);
  assert.deepEqual(landedIds('row-end'), ['__root__', 'A', 'B', 'N']);
  assert.deepEqual(landedIds('parkable-start'), ['__root__', 'N', 'A', 'B']);
  assert.deepEqual(landedIds('parkable-end'), ['__root__', 'A', 'B', 'N']);
  assert.deepEqual(landedIds('after-fixed'), ['__root__', 'N', 'A', 'B']);
  assert.deepEqual(landedIds({ before: 'A' }), ['__root__', 'N', 'A', 'B']);
  assert.deepEqual(landedIds({ after: '__root__' }), ['__root__', 'N', 'A', 'B']);
});

test('priority: { after: root } and { before: X } emit priority -1 and land immediately next to the target, appended or already present', () => {
  const rightRow = rowOf([fixed('H'), made('A'), made('B')]);
  assert.equal(request(rightRow, ROOT, { after: 'H' }).priority, -1);
  assert.deepEqual(ids(appendPanel(rightRow, { view: 'web', url: 'https://n.example', anchor: request(rightRow, ROOT, { after: 'H' }) }, 'N', ROOT)), ['H', 'N', 'A', 'B'], 'A already holds priority 0 beside H; an appended panel at priority 0 would sit behind it');
  const presentRight = [...rightRow, made('N')];
  assert.deepEqual(ids(placePanel(presentRight, 'N', { after: 'H' }, { rootId: ROOT, fallback: 'row-end' }).row), ['H', 'N', 'A', 'B']);

  // Y is already the left neighbour of X at priority 0, and the present N sits before Y in the array: at priority 0 the
  // later entry wins a left-side tie, so only -1 lands N beside X.
  const leftRow: PanelWindow[] = [
    fixed('H'),
    made('N', {}, { anchor: { panel: 'H', position: 'right', priority: 5 } }),
    made('Y', {}, { anchor: { panel: 'X', position: 'left', priority: 0 } }),
    made('X', {}, { anchor: { panel: 'H', position: 'right', priority: 0 } }),
  ];
  assert.deepEqual(ids(computeRowOrder(leftRow, ROOT)), ['H', 'Y', 'X', 'N'], 'control: before placement N sits at the far end');
  const placed = placePanel(leftRow, 'N', { before: 'X' }, { rootId: ROOT, fallback: 'row-end' }).row;
  assert.deepEqual(ids(placed), ['H', 'Y', 'N', 'X'], 'N is X\'s nearest left neighbour, ahead of Y');
  assert.equal(request(leftRow, ROOT, { before: 'X' }).priority, -1);
  const appended = appendPanel(leftRow.filter((p) => p.id !== 'N'), { view: 'web', url: 'https://n.example', anchor: request(leftRow, ROOT, { before: 'X' }) }, 'N', ROOT);
  assert.deepEqual(ids(appended), ['H', 'Y', 'N', 'X']);
});

type Rng = () => number;
function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('row-end is the 0.1.0 default { position: right } by computeRowOrder id sequence over 250 seeded random rows', () => {
  const rng = mulberry32(20261005);
  let checked = 0;
  let withRoot = 0;
  for (let seed = 0; seed < 250; seed++) {
    const count = Math.floor(rng() * 8);
    const entries = Array.from({ length: count }, (_, i) => made(`e${i}`, {}, { live: rng() > 0.3 }));
    const rootAt = rng() < 0.7 ? Math.floor(rng() * (count + 1)) : -1;
    if (rootAt >= 0) entries.splice(rootAt, 0, fixed(ROOT));
    // Half the rows keep nested anchors instead of a flat read of the order.
    const nested = rng() < 0.5 ? entries.map((p, i) => (p.id !== ROOT && i > 1 && rng() < 0.4 ? { ...p, anchor: { panel: entries[i - 1]!.id, position: 'right' as const, priority: 0 } } : p)) : entries;
    const row = computeRowOrder(rowOf(nested), ROOT);
    const resolved = resolvePlacement(row, ROOT, 'N', 'row-end', { fallback: 'row-start' });
    assert.deepEqual(resolved.notes, [], 'row-end never needs its fallback');
    const viaValue = appendPanel(row, { view: 'web', url: 'https://n.example', anchor: resolved.anchor! }, 'N', ROOT);
    const viaDefault = appendPanel(row, { view: 'web', url: 'https://n.example', anchor: { position: 'right' } }, 'N', ROOT);
    assert.deepEqual(ids(viaValue), ids(viaDefault), `row ${seed}: ${ids(row).join(',')}`);
    checked += 1;
    if (rootAt >= 0) withRoot += 1;
  }
  assert.ok(checked >= 200, `checked ${checked} rows`);
  assert.ok(withRoot > 50 && withRoot < checked, 'the rows include both a present and an absent root');
});

// ---------------------------------------------------------------------------
// Fallbacks, order and placePanel
// ---------------------------------------------------------------------------

const abc = (): PanelWindow[] => rowOf([fixed('H'), made('A'), made('B')]);

test('a missing target, a self-naming target, an order with no list and an order of unknown ids all land at the fallback with one note', () => {
  const cases: { name: string; value: AddPlacement; order?: () => readonly string[] }[] = [
    { name: 'missing before', value: { before: 'ghost' } },
    { name: 'missing after', value: { after: 'ghost' } },
    { name: 'missing anchor', value: { anchor: { panel: 'ghost', position: 'left' } } },
    { name: 'self-naming', value: { after: 'N' } },
    { name: 'order with no list', value: 'order' },
    { name: 'order of unknown ids', value: 'order', order: () => ['x', 'N', 'y'] },
    { name: 'order that does not name the panel', value: 'order', order: () => ['A', 'B'] },
  ];
  for (const c of cases) {
    const got = resolvePlacement([...abc(), made('N')], ROOT, 'N', c.value, { fallback: 'row-start', ...(c.order === undefined ? {} : { order: c.order }) });
    assert.equal(sideOf(got.anchor!), 'H left', `${c.name}: lands where row-start lands`);
    assert.equal(got.notes.length, 1, `${c.name}: one note`);
    assert.equal(got.notes[0]!.code, 'placement-fallback');
    assert.equal(got.notes[0]!.panelId, 'N');
  }
  assert.equal(resolvePlacement(abc(), ROOT, null, 'order', { fallback: 'row-end', order: () => ['A', 'N'] }).notes.length, 1, 'a panel with no name cannot be found in an order');
});

test('order: the nearest earlier name that is in the row wins, else the nearest later one, skipping names that are not in the row', () => {
  const order = (list: string[]) => ({ fallback: 'row-end' as const, order: () => list });
  const row = rowOf([fixed('H'), made('A'), made('B'), made('C')]);
  assert.deepEqual(ids(placePanel([...row, made('N')], 'N', 'order', { rootId: ROOT, ...order(['B', 'N', 'C']) }).row), ['H', 'A', 'B', 'N', 'C']);
  assert.deepEqual(ids(placePanel([...row, made('N')], 'N', 'order', { rootId: ROOT, ...order(['ghost', 'C', 'N', 'A']) }).row), ['H', 'A', 'B', 'C', 'N'], 'C is the nearest earlier name; the later A is not consulted');
  assert.deepEqual(ids(placePanel([...row, made('N')], 'N', 'order', { rootId: ROOT, ...order(['N', 'ghost', 'B', 'C']) }).row), ['H', 'A', 'N', 'B', 'C'], 'no earlier name: before the nearest later one in the row');
  assert.deepEqual(ids(placePanel([...row, made('N')], 'N', 'order', { rootId: ROOT, ...order(['ghost', 'N', 'ghost2']) }).row), ['H', 'A', 'B', 'C', 'N'], 'nothing known: the fallback, row-end here');
});

test('names match an entry by its key first and its id second, and the anchor names the entry id', () => {
  const keyed: PanelWindow = { ...made('7'), key: 'notes' };
  const row = rowOf([fixed('H'), keyed, made('B')]);
  const byKey = resolvePlacement(row, ROOT, 'N', { before: 'notes' }, { fallback: 'row-end' });
  assert.deepEqual([byKey.anchor!.panel, byKey.anchor!.position, byKey.notes.length], ['7', 'left', 0]);
  const byId = resolvePlacement(row, ROOT, 'N', { before: '7' }, { fallback: 'row-end' });
  assert.equal(byId.anchor!.panel, '7');
});

test('placePanel keeps the live flag, every setting and the entry itself, writing only its anchor; the person never sees it as an override', () => {
  const parked = made('N', { movable: false }, { live: false });
  const row = [...abc(), parked];
  const placed = placePanel(row, 'N', 'row-start', { rootId: ROOT, fallback: 'row-end' });
  assert.deepEqual(ids(placed.row), ['N', 'H', 'A', 'B'], 'a movable:false panel is still placed: placement is the developer\'s ask');
  const after = placed.row.find((p) => p.id === 'N')!;
  assert.equal(after.live, false, 'a parked panel stays parked');
  assert.equal(after.settings, parked.settings, 'the settings object is the very one it had');
  const { anchor: newAnchor, ...rest } = after;
  const { anchor: oldAnchor, ...restBefore } = parked;
  assert.deepEqual(rest, restBefore, 'nothing but the anchor changed');
  assert.notDeepEqual(newAnchor, oldAnchor);
  const copy = placePanel(row, 'ghost', 'row-start', { rootId: ROOT, fallback: 'row-end' });
  assert.deepEqual(ids(copy.row), ids(row), 'an unknown id leaves the order alone');
  assert.notEqual(copy.row, row, 'and hands back a copy');
  assert.deepEqual(ids(placePanel(row, 'N', 'in-place', { rootId: ROOT, fallback: 'row-end' }).row), ['H', 'A', 'B', 'N']);
});

test('restorePlaced: old-slot is restorePanel at the old index, any other value appends and places with the live flag kept, and a present id is left alone', () => {
  const row = rowOf([fixed('H'), made('A'), made('B')]);
  const closed = made('X', {}, { live: true });
  const o = { rootId: ROOT, fallback: 'row-start' as const };
  assert.deepEqual(ids(restorePlaced(row, closed, 1, 'old-slot', o).row), ['H', 'X', 'A', 'B']);
  assert.deepEqual(ids(restorePlaced(row, closed, 1, 'row-end', o).row), ['H', 'A', 'B', 'X']);
  assert.deepEqual(ids(restorePlaced(row, closed, 3, { after: 'H' }, o).row), ['H', 'X', 'A', 'B']);
  const missing = restorePlaced(row, closed, 3, { after: 'ghost' }, o);
  assert.deepEqual(ids(missing.row), ['X', 'H', 'A', 'B'], 'a missing target uses the fallback, row-start here');
  assert.equal(missing.notes.length, 1);
  assert.equal(restorePlaced(row, closed, 1, 'row-end', o).row.find((p) => p.id === 'X')!.live, true);
  const parkedClosed = made('Y', {}, { live: false });
  assert.equal(restorePlaced(row, parkedClosed, 0, 'row-end', o).row.find((p) => p.id === 'Y')!.live, false);
  assert.deepEqual(ids(restorePlaced(row, row[1]!, 0, 'row-start', o).row), ['H', 'A', 'B'], 'an id already present: unchanged');
});

test('placeOnAdd in-place is refused by the resolver with invalid-settings', () => {
  assert.throws(() => resolvePanelSettings({ template: { placeOnAdd: 'in-place' as unknown as 'row-end' } }), (error: unknown) => (error as { code?: string }).code === 'invalid-settings');
});

// ---------------------------------------------------------------------------
// Differentials through the pure resolver
// ---------------------------------------------------------------------------

test('differential placeOnAdd: the resolved setting decides where an appended panel lands', () => {
  differential('placeOnAdd', (run) => {
    const row = abc();
    for (const value of ['row-start', 'row-end'] as const) {
      run(value, () => {
        const settings = resolve({ placeOnAdd: value });
        const { anchor } = resolvePlacement(row, ROOT, 'N', settings.placeOnAdd, { fallback: 'row-end' });
        return ids(appendPanel(row, { view: 'web', url: 'https://n.example', ...(anchor === null ? {} : { anchor }) }, 'N', ROOT));
      });
    }
  });
});

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Where the values land when the target is not at the edge of the row
// ---------------------------------------------------------------------------

const O: PlacementOptions & { rootId: string } = { rootId: ROOT, fallback: 'row-start' };
const landed = (row: PanelWindow[], value: AddPlacement): string[] => {
  const { anchor } = resolvePlacement(row, ROOT, 'N', value, O);
  return ids(appendPanel(row, { view: 'web', url: 'https://n.example', ...(anchor === null ? {} : { anchor }) }, 'N', ROOT));
};
const anchored = (p: PanelWindow, panel: string, position: 'left' | 'right', priority: number): PanelWindow => ({ ...p, anchor: { panel, position, priority } });

test('a fixed column right of the parkables: parkable-end lands before it, and row-end and after-fixed land after it', () => {
  const row = rowOf([fixed('H'), made('A'), made('B'), fixed('F')]);
  assert.deepEqual(landed(row, 'parkable-end'), ['H', 'A', 'B', 'N', 'F']);
  assert.deepEqual(landed(row, 'row-end'), ['H', 'A', 'B', 'F', 'N']);
  assert.deepEqual(landed(row, 'after-fixed'), ['H', 'A', 'B', 'F', 'N']);
  assert.deepEqual(landed(row, 'parkable-start'), ['H', 'N', 'A', 'B', 'F']);
  assert.deepEqual(ids(placePanel([row[0]!, row[1]!, made('N'), row[2]!, row[3]!], 'N', 'parkable-end', O).row), ['H', 'A', 'B', 'N', 'F'], 're-placing a present panel lands it the same');
});

test('two fixed columns: after-fixed lands after the last of them, and the parkable ends land beside the parkables', () => {
  const row = rowOf([fixed('H'), fixed('F1'), made('A'), fixed('F2'), made('B')]);
  assert.deepEqual(landed(row, 'after-fixed'), ['H', 'F1', 'A', 'F2', 'N', 'B']);
  assert.deepEqual(landed(row, 'parkable-start'), ['H', 'F1', 'N', 'A', 'F2', 'B']);
  assert.deepEqual(landed(row, 'parkable-end'), ['H', 'F1', 'A', 'F2', 'B', 'N']);
});

test('priority -1 lands a placed panel nearest its neighbour even when another entry already sits there at priority 0', () => {
  // F is anchored left of A at priority 0 and N, earlier in the array, is on the root's right: at a tie the later entry on the left side is nearer.
  const base = computeRowOrder([fixed('H'), anchored(made('N'), 'H', 'right', 0), anchored(fixed('F'), 'A', 'left', 0), anchored(made('A'), 'H', 'right', 1), anchored(made('B'), 'H', 'right', 2)], ROOT);
  assert.deepEqual(ids(base), ['H', 'N', 'F', 'A', 'B'], 'control: the arrangement before the placement');
  assert.deepEqual(ids(placePanel(base, 'N', 'parkable-start', O).row), ['H', 'F', 'N', 'A', 'B'], 'N lands between F and A');
  assert.deepEqual(ids(anchorPanel(base, 'N', { panel: 'A', position: 'left', priority: 0 }, ROOT)), ['H', 'N', 'F', 'A', 'B'], 'control: priority 0 would have lost the tie');
  // F is anchored right of B at priority 0, and an appended panel loses a right-side tie to the entry earlier in the row.
  const right = computeRowOrder([fixed('H'), anchored(made('A'), 'H', 'right', 0), anchored(made('B'), 'H', 'right', 1), anchored(fixed('F'), 'B', 'right', 0)], ROOT);
  assert.deepEqual(ids(right), ['H', 'A', 'B', 'F'], 'control: the arrangement before the placement');
  assert.deepEqual(landed(right, 'parkable-end'), ['H', 'A', 'B', 'N', 'F'], 'N lands between B and F');
});

test('a placement note reaches onNote, and an onNote that throws neither stops the others nor breaks the placement', () => {
  const seen: string[] = [];
  const row = rowOf([fixed(ROOT), made('A')]);
  const notes = resolvePlacement(row, ROOT, 'N', { after: 'ghost' }, O).notes.concat(resolvePlacement(row, ROOT, 'N', { before: 'ghost' }, O).notes);
  assert.equal(notes.length, 2);
  assert.doesNotThrow(() =>
    reportNotes((n) => {
      seen.push(n.code);
      throw new Error('a reporter that throws');
    }, notes),
  );
  assert.deepEqual(seen, ['placement-fallback', 'placement-fallback'], 'the second note was delivered after the first one threw');
  assert.doesNotThrow(() => reportNotes(undefined, notes));
});

test('{ anchor } keeps the priority it was given: a fractional priority lands between two entries on the same side', () => {
  const flat = rowOf([fixed('H'), made('A'), made('B'), made('C')]);
  const row = flat.map((p) => (p.id === 'B' ? anchored(p, 'A', 'right', 0) : p.id === 'C' ? anchored(p, 'A', 'right', 1) : p));
  assert.deepEqual(landed(row, { anchor: { panel: 'A', position: 'right', priority: 0.5 } }), ['H', 'A', 'B', 'N', 'C']);
  assert.deepEqual(landed(row, { anchor: { panel: 'A', position: 'right' } }), ['H', 'A', 'B', 'C', 'N'], 'without a priority the far end of that side is filled');
});

// ---------------------------------------------------------------------------
// The show, return and undo paths through the real provider
// ---------------------------------------------------------------------------

interface ProvideOptions {
  width?: number;
  over?: Partial<Omit<PanelsInput, 'workspace'>> & SeedOptions;
}
/** useProvidePanels over `initialEntries`; `setWidth` re-renders the same provider at another row width. */
function provide(initialEntries: PanelWindow[], options: ProvideOptions = {}) {
  let latest: ProvidedPanels | undefined;
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ rootId: ROOT, initialEntries, containerWidth, ...options.over }));
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe, { containerWidth: options.width ?? 0 }));
  const now = (): ProvidedPanels => {
    assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
    return latest;
  };
  return { now, ids: () => ids(now().entries), flags: () => liveFlags(now().entries), setWidth: (next: number) => mounted.rerender(React.createElement(Probe, { containerWidth: next })) };
}

/** The container width whose capacity beside the root column is `n` phone panels. */
const W = (n: number): number => 422 + 406 * n;

test('show: a parked panel is re-placed by placeOnShow in the update that makes it live, and a default panel keeps its slot', () => {
  const entries = (value: AddPlacement | 'in-place') => [fixed(ROOT), made('A'), made('B', { placeOnShow: value === 'in-place' ? 'in-place' : value }, { live: false }), made('C')];
  const inPlace = provide(entries('in-place'));
  act(() => inPlace.now().activate('B'));
  assert.deepEqual(inPlace.flags(), ['H', 'A', 'B', 'C'], 'default: live in its own slot');
  for (const [value, want] of [
    ['row-start', ['B', 'H', 'A', 'C']],
    ['row-end', ['H', 'A', 'C', 'B']],
    ['after-fixed', ['H', 'B', 'A', 'C']],
    [{ after: 'C' }, ['H', 'A', 'C', 'B']],
    [{ before: 'A' }, ['H', 'B', 'A', 'C']],
  ] as const) {
    const provider = provide(entries(value));
    act(() => provider.now().activate('B'));
    assert.deepEqual(provider.ids(), want, `placeOnShow ${JSON.stringify(value)}`);
    assert.equal(provider.now().entries.find((p) => p.id === 'B')!.live, true, 'live in the same update');
  }
});

test('show: placeOnShow is read by the show path; a show with an unreachable target notes a fallback', () => {
  const notes: SettingNote[] = [];
  const provider = provide([fixed(ROOT), made('A'), made('C', { placeOnShow: { after: 'ghost' } }, { live: false }), made('B', { placeOnShow: 'in-place' }, { live: false })], { over: { onNote: (n) => notes.push(n) } });
  act(() => provider.now().activate('B'));
  assert.deepEqual(provider.ids(), ['H', 'A', 'C', 'B'], 'in-place does not move a shown panel');
  assert.equal(notes.length, 0);
  act(() => provider.now().activate('C'));
  assert.deepEqual(provider.ids(), ['H', 'A', 'B', 'C'], 'the missing target landed at the row end');
  assert.deepEqual(notes.map((n) => [n.code, n.panelId]), [['placement-fallback', 'C']]);
});

test('show: a panel placed by placeOnShow is not recorded as a person override -- its entry still carries only a new anchor', () => {
  const b = made('B', { placeOnShow: 'row-start' }, { live: false });
  const provider = provide([fixed(ROOT), made('A'), b]);
  act(() => provider.now().activate('B'));
  const after = provider.now().entries.find((p) => p.id === 'B')!;
  assert.equal(after.settings, b.settings, 'the settings object is untouched');
  assert.equal(after.settings!.placeOnShow, 'row-start');
});

test('return: automatic returns keep their slot', () => {
  const provider = provide([fixed(ROOT), made('A'), made('B'), made('C'), made('D')], { width: W(4) });
  act(() => provider.setWidth(W(2)));
  assert.deepEqual(provider.flags(), ['H', 'A~', 'B~', 'C', 'D'], 'control: the narrow row parked A and B');
  act(() => provider.setWidth(W(4)));
  assert.deepEqual(provider.flags(), ['H', 'A', 'B', 'C', 'D'], 'both return in their own slots');
});

test('return: a panel returned by the reveal after a close keeps its slot', () => {
  const provider = provide([fixed(ROOT), made('A'), made('B'), made('C')], { width: W(2) });
  assert.deepEqual(provider.flags(), ['H', 'A~', 'B', 'C'], 'control: the measured row parked the leftmost live panel for room');
  act(() => provider.now().close('B'));
  assert.deepEqual(provider.flags(), ['H', 'A', 'C'], 'closing B made room: A returned live in the same update, in its own slot');
});

test('undo: undoClose restores the panel at its old index, and a parked panel comes back parked', () => {
  const undone = (live: boolean) => {
    const provider = provide([fixed(ROOT), made('A'), made('X', {}, { live }), made('B'), made('C')]);
    act(() => provider.now().close('X'));
    assert.deepEqual(provider.ids(), ['H', 'A', 'B', 'C'], 'control: X closed');
    act(() => provider.now().undoClose());
    return provider;
  };
  assert.deepEqual(undone(true).ids(), ['H', 'A', 'X', 'B', 'C']);
  assert.deepEqual(undone(false).flags(), ['H', 'A', 'X~', 'B', 'C']);
});

test('undo: a restored live panel goes through the room-making rule -- the row is full, so the oldest live panel is parked', () => {
  const provider = provide([fixed(ROOT), made('A'), made('B'), made('X')], { width: W(2) });
  assert.deepEqual(provider.flags(), ['H', 'A~', 'B', 'X'], 'control: the measured row parked A');
  act(() => provider.now().close('X'));
  assert.deepEqual(provider.flags(), ['H', 'A', 'B'], 'closing X made room for A');
  act(() => provider.now().undoClose());
  assert.deepEqual(provider.flags(), ['H', 'A~', 'B', 'X'], 'X returns at the end and live, and A, the older of the two, parks');
});

test('differential placeOnShow: the resolved setting decides where activate lands a parked panel', () => {
  differential('placeOnShow', (run) => {
    for (const value of ['in-place', 'row-start'] as const) {
      run(value, () => {
        const provider = provide([fixed(ROOT), made('A'), made('B', { placeOnShow: value }, { live: false })]);
        act(() => provider.now().activate('B'));
        const out = provider.ids();
        cleanup();
        return out;
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The enter side on the return, reveal and undo paths, and the updaters' re-read of the latest row
// ---------------------------------------------------------------------------

const MARK = '__root__';
const marker = (): PanelWindow => ({ ...fixed(MARK), marker: true as const });
/** The container width whose capacity is `n` phone panels in a row whose root is a marker. */
const W0 = (n: number): number => 16 + 406 * n;

/** useProvidePanels over a marker-rooted row, drawn by a real PanelRow so a slot's first transform can be read. */
function provideRow(initialEntries: PanelWindow[], width = 0, notes: SettingNote[] = []) {
  let latest: ProvidedPanels | undefined;
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    const input = useSeededInput({ rootId: MARK, initialEntries: rowOf(initialEntries, MARK), containerWidth, onNote: (n) => notes.push(n) });
    latest = useProvidePanels(input);
    return React.createElement(PanelRow, {
      workspace: input.workspace,
      entries: latest.entries,
      rootId: MARK,
      closingIds: latest.closingIds,
      enteringViaAnchorIds: latest.enteringViaAnchorIds,
      exitRightIds: latest.exitRightIds,
      enterSideById: latest.enterSideById,
    });
  }
  const mounted = mount(withHost(React.createElement(Probe, { containerWidth: width })));
  const now = (): ProvidedPanels => {
    assert.ok(latest, 'the probe never rendered');
    return latest;
  };
  const translateX = (slot: HTMLElement): number => Number(/translateX\((-?[\d.]+)px\)/.exec(slot.style.transform)?.[1] ?? 0);
  return {
    now,
    flags: () => liveFlags(now().entries),
    setWidth: (next: number) => mounted.rerender(withHost(React.createElement(Probe, { containerWidth: next }))),
    /** Lets every exit finish, so a panel that comes back mounts a new slot and does not revive one that is still leaving. */
    settle: () => advanceFrames(600),
    /** Which way `id`'s slot starts from its rest position: -1 left of it, 1 right of it. Read straight after the act that mounted it. */
    entersFrom: async (id: string): Promise<number> => {
      const slot = mounted.container.querySelector(`[data-slot="${id}"]`)?.closest<HTMLElement>('[data-row-slot]');
      assert.ok(slot, `slot ${id} is mounted`);
      const initial = translateX(slot);
      await advanceFrames(600);
      return Math.sign(initial - translateX(slot));
    },
  };
}

test('enter side, capacity rise: panels returned in place enter from the side of their old slot', async () => {
  const provider = provideRow([marker(), made('A'), made('B'), made('C'), made('D')], W0(4));
  act(() => provider.setWidth(W0(2)));
  assert.deepEqual(provider.flags(), [MARK, 'A~', 'B~', 'C', 'D'], 'control: the narrow row parked A and B');
  await provider.settle();
  act(() => provider.setWidth(W0(4)));
  assert.deepEqual(provider.flags(), [MARK, 'A', 'B', 'C', 'D']);
  for (const id of ['A', 'B']) assert.equal(provider.now().enterSideById.get(id), 'left', id);
  assert.equal(await provider.entersFrom('B'), -1);
});

test('show: two activates in one handler each place over the row the other left, not over this render', () => {
  const provider = provide([fixed(ROOT), made('A'), made('B', { placeOnShow: 'row-end' }, { live: false }), made('C', { placeOnShow: 'row-start' }, { live: false }), made('D')]);
  act(() => {
    provider.now().activate('B');
    provider.now().activate('C');
  });
  assert.deepEqual(provider.flags(), ['C', 'H', 'A', 'D', 'B']);
});

test('show: an activate that makes room parks the oldest panel and places the shown one in the same update, whatever an earlier update in the handler did', () => {
  const entries = () => [fixed(ROOT), made('A'), made('B'), made('C', { placeOnShow: 'row-start' }, { live: false })];
  const plain = provide(entries(), { width: W(2) });
  assert.deepEqual(plain.flags(), ['H', 'A', 'B', 'C~'], 'control: two live panels fill the row');
  act(() => plain.now().activate('C'));
  assert.deepEqual(plain.flags(), ['C', 'H', 'A~', 'B'], 'C is placed first, and A, the lower index of the two tied, parks');
  cleanup();
  const moved = provide(entries(), { width: W(2) });
  act(() => {
    moved.now().move('B', 'left');
    moved.now().activate('C');
  });
  assert.deepEqual(moved.flags(), ['C', 'H', 'B', 'A~'], 'the earlier move survived: B still stands before A, and the panel the render picked to park (A, first of the two tied in that render\'s row) is the one that parks');
});

test('reveal after a close: the placement runs over the row an earlier update in the same handler left', () => {
  const provider = provide([fixed(ROOT), made('A'), made('B'), made('C'), made('D')], { width: W(3) });
  assert.deepEqual(provider.flags(), ['H', 'A~', 'B', 'C', 'D']);
  act(() => {
    provider.now().move('D', 'left');
    provider.now().close('B');
  });
  assert.deepEqual(provider.flags(), ['H', 'A', 'D', 'C']);
});

// ---------------------------------------------------------------------------
// The enter side
// ---------------------------------------------------------------------------

const SIDE_CASES: readonly { name: string; value: AddPlacement; side: 'left' | 'right' }[] = [
  { name: 'row-start', value: 'row-start', side: 'left' },
  { name: 'row-end', value: 'row-end', side: 'right' },
  { name: 'parkable-start', value: 'parkable-start', side: 'left' },
  { name: 'parkable-end', value: 'parkable-end', side: 'right' },
  { name: 'after-fixed (no fixed entry: row-start)', value: 'after-fixed', side: 'left' },
  { name: '{ after: A }', value: { after: 'A' }, side: 'right' },
  { name: '{ before: A }', value: { before: 'A' }, side: 'left' },
  { name: '{ before: C }', value: { before: 'C' }, side: 'right' },
  { name: 'order with no list (row-end)', value: 'order', side: 'right' },
];

for (const c of SIDE_CASES) {
  test(`enter side: with the root absent, a panel shown at ${c.name} carries the explicit mark of the side it landed on, and its slot starts there`, async () => {
    let provided: ProvidedPanels | undefined;
    function Probe(): React.ReactElement {
      const input = useSeededInput({ rootId: 'gone', initialEntries: [made('A'), made('C'), made('B', { placeOnShow: c.value }, { live: false })] });
      provided = useProvidePanels(input);
      return React.createElement(PanelRow, {
        workspace: input.workspace,
        entries: provided.entries,
        rootId: 'gone',
        closingIds: provided.closingIds,
        enteringViaAnchorIds: provided.enteringViaAnchorIds,
        exitRightIds: provided.exitRightIds,
        enterSideById: provided.enterSideById,
      });
    }
    const mounted = mount(withHost(React.createElement(Probe)));
    act(() => provided!.activate('B'));
    assert.equal(provided!.enterSideById.get('B'), c.side, 'the explicit mark');
    assert.equal(provided!.enterSideById.get('B'), sideOfLiveRange([...provided!.entries], 'B'), 'equals sideOfLiveRange of the landing slot');
    const slot = mounted.container.querySelector('[data-slot="B"]')?.closest<HTMLElement>('[data-row-slot]');
    assert.ok(slot, 'the new slot is mounted');
    const initial = Number(/translateX\((-?[\d.]+)px\)/.exec(slot.style.transform)?.[1] ?? 0);
    await advanceFrames(600);
    const rest = Number(/translateX\((-?[\d.]+)px\)/.exec(slot.style.transform)?.[1] ?? 0);
    assert.equal(Math.sign(initial - rest), c.side === 'left' ? -1 : 1, `starts at ${initial}, rests at ${rest}`);
  });
}

test('enter side: the placement cases above cover every named value and the three target forms', () => {
  assert.equal(SIDE_CASES.length, 9);
});

test('every placement name this file owns has a completed differential', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});
