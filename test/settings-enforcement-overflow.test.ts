/**
 * The engine's reading of `overflow`: a scroll panel is never parked for room and a park panel is, priced over the
 * widths the reserved panels leave. One differential for the name, seeded sequences for the default row, the park
 * role, the rest-relative park exit, the workspaceDefaults path and the doc comments that promised parking.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { definePanel, useProvidePanels } from '../index.js';
import type { PanelSettings, PanelWindow, ProvidedPanels } from '../index.js';
import { computeRowLayout } from '../panelRowLayout.js';
import { applyTemplate, effective, resolvePanelSettings } from '../panelSettings.js';
import { appendPanel, createRootPanel } from '../panelWindow.js';
import { panelRowSlotMotion, parkExitTarget, } from '../PanelRowSlot.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, useSeededInput, type SeedOptions, type SeededOver } from './support/mount-harness.js';
import { registerTestView } from './support/test-views.js';

const ROOT = 'root';
const OWNED = ['overflow'];

registerTestView('ov-view', ({ panel }) => React.createElement('i', { 'data-slot': panel.id }, panel.title));

afterEach(() => cleanup());

const scrollRoot = (): PanelWindow =>
  applyTemplate({ ...createRootPanel(ROOT), view: 'ov-view' }, resolvePanelSettings({ template: { title: 'History' } }, { root: true }).value, 'create');
const legacyRoot = (): PanelWindow => ({ ...createRootPanel(ROOT), view: 'ov-view' });
function made(id: string, layer: PanelSettings = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id, view: 'ov-view' }, id, ROOT)[0]!;
  return applyTemplate(skeleton, resolvePanelSettings({ template: layer }).value, 'create');
}

interface Provided {
  now(): ProvidedPanels;
  ids(): string[];
  live(): string[];
  parked(): string[];
}
/** useProvidePanels mounted under `input`; every call below goes through the latest render's api, in its own act. */
function provide(input: Partial<SeededOver>): Provided {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [], ...input }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const entries = (): readonly PanelWindow[] => latest!.entries;
  return {
    now: () => latest!,
    ids: () => entries().map((p) => p.id),
    live: () => entries().filter((p) => p.live).map((p) => p.id),
    parked: () => entries().filter((p) => !p.live).map((p) => p.id),
  };
}

// ---------------------------------------------------------------------------
// The default row never parks (seeded sequences)
// ---------------------------------------------------------------------------

/** mulberry32: the same seed gives the same sequence on every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SLOT_COUNTS: readonly number[] = [1, 2, 3];

interface Run {
  /** The ids that were open and not hidden but are parked, or hidden and live, after the last step. */
  wrong: string[];
  /** How many panels the sequence created, hidden ones included. */
  created: number;
  /** The most panels it held open at once. */
  peak: number;
}

/**
 * One seeded sequence over a row at `containerWidth` whose panels come from `defaults`. A hidden panel is a create
 * under startVisibility 'parked'; showing it is an activate of that id. Returns the first step's wrong ids, if any.
 */
function sequence(seed: number, defaults: PanelSettings, steps: number): Run {
  const rand = seeded(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const containerWidth = pick([600, 1000, 1500]);
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [scrollRoot()], containerWidth, workspaceDefaults: defaults, templates: [definePanel({ id: 'ov-hid', view: () => null, settings: { startVisibility: 'parked', multiple: true } })] }));
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe));
  const hiddenIds = new Set<string>();
  const others = (): string[] => latest!.entries.filter((p) => p.id !== ROOT).map((p) => p.id);
  const wrongNow = (): string[] =>
    latest!.entries.filter((p) => p.id !== ROOT && p.live === hiddenIds.has(p.id)).map((p) => p.id).concat(latest!.entries.some((p) => p.id === ROOT && !p.live) ? [ROOT] : []);
  let wrong: string[] = [];
  let created = 0;
  let peak = 0;
  for (let step = 0; step < steps && wrong.length === 0; step += 1) {
    const op = Math.floor(rand() * 8);
    const open = others();
    if (op <= 1 || open.length === 0) {
      const before = new Set(latest!.entries.map((p) => p.id));
      const hide = op === 1 && open.length > 0;
      act(() => latest!.create(hide ? { view: 'ov-hid' } : {}));
      for (const p of latest!.entries) {
        if (before.has(p.id)) continue;
        created += 1;
        if (hide) hiddenIds.add(p.id);
      }
    } else if (op === 2) {
      const id = pick(open);
      hiddenIds.delete(id);
      act(() => latest!.activate(id));
    } else if (op === 3) {
      act(() => latest!.setSlots(pick(open), pick(SLOT_COUNTS)));
    } else if (op === 4) {
      act(() => latest!.close(pick(open)));
    } else if (op === 5) {
      act(() => latest!.undoClose());
    } else if (op === 6) {
      act(() => latest!.move(pick(open), pick(['left', 'right'] as const)));
    } else {
      const shown = open.filter((id) => hiddenIds.has(id));
      const id = shown.length > 0 ? pick(shown) : pick(open);
      hiddenIds.delete(id);
      act(() => latest!.activate(id));
    }
    peak = Math.max(peak, others().length);
    wrong = wrongNow();
  }
  mounted.unmount();
  return { wrong, created, peak };
}

test('S11: 500 seeded sequences of create, activate, resize, close, undo, drag, hide and show over scroll panels never park one for room', () => {
  let run = 0;
  let created = 0;
  let crowded = 0;
  const failures: string[] = [];
  for (let seed = 1; seed <= 500; seed += 1) {
    run += 1;
    const result = sequence(seed, {}, 14);
    created += result.created;
    if (result.peak >= 4) crowded += 1;
    if (result.wrong.length > 0) failures.push(`seed ${seed}: ${result.wrong.join(',')}`);
  }
  console.log(`sequences run: ${run}`);
  assert.ok(run >= 500);
  assert.ok(created > 2000 && crowded > 100, `the sequences did real work: ${created} panels created, ${crowded} rows of four or more`);
  assert.deepEqual(failures, []);
});

test('with no park panel to park, a crowded row overflows and scrolls: no refusal and no park', () => {
  const p = provide({ initialEntries: [scrollRoot()], containerWidth: 1000, workspaceDefaults: { overflow: 'scroll' } });
  for (let i = 0; i < 6; i += 1) act(() => p.now().create());
  assert.equal(p.live().length, 7);
  assert.deepEqual(p.parked(), []);
  assert.equal(p.now().rowScroll, true);
  assert.ok(p.now().rowNumbers.stripWidth > p.now().rowNumbers.windowWidth, 'the strip is wider than the window');
});

test('a template asking overflow park on a parkable:false panel is a settings-conflict, the reverse is not', () => {
  const forced = resolvePanelSettings({ template: { parkable: false, overflow: 'park' } });
  assert.equal(forced.value.overflow, 'scroll');
  assert.deepEqual(forced.conflicts.filter((c) => c.key === 'overflow').map((c) => [c.kind, c.rule]), [['forced', 'C1']]);
  const reverse = resolvePanelSettings({ template: { parkable: true, overflow: 'scroll' } });
  assert.deepEqual(reverse.conflicts, []);
});

// ---------------------------------------------------------------------------
// Park exits start from the slot's rest
// ---------------------------------------------------------------------------

test('parkExitTarget: a scrolling row exits one span from the rest, a row that never scrolls exits to the origin', () => {
  assert.deepEqual(parkExitTarget(2030, 406, 'left', true), { x: 1624, opacity: 0 });
  assert.deepEqual(parkExitTarget(2030, 406, 'right', true), { x: 2436, opacity: 0 });
  assert.deepEqual(parkExitTarget(2030, 406, 'left', false), { x: -406, opacity: 0 });
  assert.deepEqual(panelRowSlotMotion(2030, 390, 700, 'right', 'left', 16, undefined, true).exit, { x: 1624, opacity: 0 });
  assert.deepEqual(panelRowSlotMotion(2030, 390, 700, 'right', 'left', 16, undefined, false).exit, { x: -406, opacity: 0 });
});

// ---------------------------------------------------------------------------
// The workspaceDefaults path
// ---------------------------------------------------------------------------

test('workspaceDefaults {}: a created entry carries its settings, scrolls, and takes listed and layer from the options', () => {
  const p = provide({ initialEntries: [legacyRoot()], containerWidth: 1000, workspaceDefaults: {} });
  assert.equal(p.now().rowScroll, false, 'before any entry carries settings');
  act(() => p.now().create({ title: 'Tab', listed: false, layer: 'raised' }));
  const entry = p.now().entries[1]!;
  assert.ok(entry.settings !== undefined && effective(entry) === entry.settings, 'effective(entry) is the entry settings, by reference');
  assert.equal(entry.settings.overflow, 'scroll');
  assert.equal(entry.key, entry.id);
  assert.equal(entry.listed, false);
  assert.equal(entry.layer, 'raised');
  assert.equal(entry.title, 'Tab');
  assert.deepEqual([entry.settings.listed, entry.settings.layer], [false, 'raised']);
  assert.equal(p.now().rowScroll, true);
});

test('workspaceDefaults on a restore: entries keep their saved live, anchor, slots, size and listed, and a permanent column stays a live fixed column', async () => {
  const saved = {
    version: 1 as const,
    panels: [
      { id: 'w', view: 'ov-view', url: 'https://w.example', live: true, anchor: { panel: ROOT, position: 'right' as const, priority: 0 }, slots: 2, layer: 'raised' as const, listed: false },
      { id: 'c', view: 'ov-view', url: '', live: true, permanent: true, anchor: { panel: ROOT, position: 'right' as const, priority: 1 } },
      { id: 'h', view: 'ov-view', url: 'https://h.example', live: false, anchor: { panel: ROOT, position: 'right' as const, priority: 2 } },
    ],
  };
  const restore = async (workspaceDefaults?: SeedOptions['workspaceDefaults']): Promise<readonly PanelWindow[]> => {
    const p = provide({ initialEntries: [legacyRoot()], containerWidth: 1500, storage: { load: () => Promise.resolve(saved), save: () => {} }, ...(workspaceDefaults === undefined ? {} : { workspaceDefaults }) });
    await act(async () => {});
    const entries = p.now().entries;
    cleanup();
    return entries;
  };
  const without = await restore();
  assert.equal(without.length, 4);
  const withDefaults = await restore({});
  assert.deepEqual(withDefaults.map((e) => e.id === ROOT || e.settings !== undefined), [true, true, true, true]);
  const [, wide, column, hidden] = withDefaults;
  assert.deepEqual([wide!.live, wide!.slots, wide!.listed, wide!.layer], [true, 2, false, 'raised']);
  assert.deepEqual([column!.live, column!.collapsible, column!.settings?.parkable], [true, false, false]);
  assert.equal(hidden!.live, false, 'a panel saved parked stays parked');
  assert.deepEqual(withDefaults.map((e) => e.anchor), without.map((e) => e.anchor));
  assert.equal(wide!.settings?.overflow, 'scroll');
  assert.equal(wide!.key, undefined, 'a restored entry has no key; readers use its id');
});

// ---------------------------------------------------------------------------
// The doc comments that promised parking
// ---------------------------------------------------------------------------

test("the four PanelsAPI comments that promised parking say it applies to a panel whose overflow is 'park'", () => {
  const source = readFileSync(new URL('../hostApi.tsx', import.meta.url), 'utf8');
  const phrases = ['Appends a live panel', 'Make a panel live in place', 'Sets `id` to `slots`', 'Undo every close in `recentlyClosed`'];
  for (const phrase of phrases) {
    const at = source.indexOf(phrase);
    assert.ok(at > 0, `${phrase} is in hostApi.tsx`);
    const comment = source.slice(source.lastIndexOf('/**', at), source.indexOf('*/', at));
    assert.match(comment, /overflow/, `the comment starting "${phrase}" names the overflow setting`);
  }
});

