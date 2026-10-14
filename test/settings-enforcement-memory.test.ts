/**
 * What the workspace remembers between launches and which settings govern it: persist, rememberLayout,
 * restoreVisibility, and the template-scope hostCreatable, multiple and maxInstances on every creation path. Each
 * name has a differential; the rest drives two launches over one in-memory storage.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels } from '../index.js';
import type { PanelSettings, PanelWindow, ProvidedPanels, SettingNote, WorkspaceState, WorkspaceStorage } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { definePanel } from '../panelTemplate.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { appendPanel, createHistoryPanel, recordOverride } from '../panelWindow.js';
import { computeRowOrder, deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { placePanel } from '../panelPlacement.js';
import { reconcileWorkspace } from '../workspacePlan.js';
import { projectWorkspaceState } from '../workspaceState.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, useSeededInput, type SeededOver } from './support/mount-harness.js';
import { made, mountRow, rootEntry } from './support/scroll-row.js';
import { registerTestView } from './support/test-views.js';

registerTestView('memory-view', ({ panel }) => React.createElement('i', null, panel.title));

const ROOT = 'root';
const QUIET_MS = 100;
const View = (): null => null;
const tpl = (id: string, settings: PanelSettings = {}): PanelTemplate => definePanel({ id, view: View, settings });

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

interface Memory {
  storage: WorkspaceStorage;
  /** The file as storage holds it now, or null before the first save. */
  file(): WorkspaceState | null;
  saves: WorkspaceState[];
}

/** One storage slot shared by every launch of a test; what is saved is what JSON keeps. */
function memory(): Memory {
  let held: WorkspaceState | null = null;
  const saves: WorkspaceState[] = [];
  return {
    storage: {
      load: () => Promise.resolve(held === null ? null : (JSON.parse(JSON.stringify(held)) as WorkspaceState)),
      save: (state) => {
        held = JSON.parse(JSON.stringify(state)) as WorkspaceState;
        saves.push(state);
      },
    },
    file: () => held,
    saves,
  };
}

interface Launch {
  latest: () => ProvidedPanels;
  notes: SettingNote[];
  /** Titles of every panel but History, in row order. */
  titles: () => string[];
  byTitle: (title: string) => PanelWindow;
  /** Advances past the save quiet time so the current list is stored. */
  flush: () => void;
  unmount: () => void;
}

/** A provider over History alone, restored from `mem`; resolves once the load has settled. */
async function launch(mem: Memory, over: Partial<SeededOver> = {}): Promise<Launch> {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout'] });
  const notes: SettingNote[] = [];
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries: [createHistoryPanel(ROOT)], storage: mem.storage, tuning: { saveQuietMs: QUIET_MS }, onNote: (n) => void notes.push(n), ...over }));
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe));
  await act(async () => {});
  const entries = (): PanelWindow[] => latest!.entries.filter((p) => p.id !== ROOT);
  return {
    latest: () => latest!,
    notes,
    titles: () => entries().map((p) => p.title ?? ''),
    byTitle: (title) => entries().find((p) => p.title === title)!,
    flush: () => act(() => mock.timers.tick(QUIET_MS + 50)),
    unmount: mounted.unmount,
  };
}

const create = (l: Launch, options: Parameters<ProvidedPanels['create']>[0] & object): void => act(() => l.latest().create(options));
const idOf = (l: Launch, title: string): string => l.byTitle(title).id;

// ---------------------------------------------------------------------------
// Two launches over one storage
// ---------------------------------------------------------------------------

test('a declared singleton and two anonymous panels come back in the same order when nothing was dragged', async () => {
  const mem = memory();
  const over = { workspaceDefaults: {}, templates: [tpl('single')], declared: [{ id: 'single', templateId: 'single', settings: { title: 'single' } }] };
  const first = await launch(mem, over);
  create(first, { title: 'x' });
  create(first, { title: 'y' });
  assert.deepEqual(first.titles(), ['single', 'x', 'y']);
  first.flush();
  first.unmount();
  const second = await launch(mem, over);
  assert.deepEqual(second.titles(), ['single', 'x', 'y']);
  assert.equal(second.latest().entries.filter((p) => p.key === 'single').length, 1, 'the singleton was claimed from the file, not made twice');
});

test('after a drag every non-root remembering panel keeps its saved position, and a changed placeOnAdd default moves none', async () => {
  const mem = memory();
  const first = await launch(mem, { workspaceDefaults: {} });
  for (const title of ['x', 'y', 'z']) create(first, { title });
  act(() => first.latest().move(idOf(first, 'z'), 'left'));
  assert.deepEqual(first.titles(), ['x', 'z', 'y']);
  first.flush();
  first.unmount();
  const second = await launch(mem, { workspaceDefaults: { placeOnAdd: 'row-start' } });
  assert.deepEqual(second.titles(), ['x', 'z', 'y']);
});

test('an untouched panel whose default changed follows the new default, and one whose default is unchanged keeps its slot', async () => {
  const mem = memory();
  const templates = (aSettings: PanelSettings): PanelTemplate[] => [tpl('ta', { multiple: true, ...aSettings }), tpl('tb', { multiple: true })];
  const first = await launch(mem, { templates: templates({}) });
  create(first, { view: 'tb', title: 'tb1' });
  create(first, { view: 'ta', title: 'ta1' });
  create(first, { view: 'tb', title: 'tb2' });
  assert.deepEqual(first.titles(), ['tb1', 'ta1', 'tb2']);
  first.flush();
  first.unmount();
  const second = await launch(mem, { templates: templates({ placeOnAdd: 'row-start' }) });
  assert.deepEqual(second.titles(), ['ta1', 'tb1', 'tb2']);
});

test('only the resized panel carries overrides.slots', async () => {
  const mem = memory();
  const first = await launch(mem, { workspaceDefaults: {} });
  create(first, { title: 'x' });
  create(first, { title: 'y' });
  act(() => first.latest().setSlots(idOf(first, 'x'), 2));
  first.flush();
  const byTitle = Object.fromEntries(mem.file()!.panels.map((p) => [p.title, p.overrides]));
  assert.equal(byTitle.x!.slots, 2);
  assert.equal('slots' in byTitle.y!, false);
});

test('an anonymous panel and a Host-bag panel of a template follow a changed workspace default their instance layer did not set', async () => {
  const mem = memory();
  const templates = [tpl('ta', { multiple: true })];
  const first = await launch(mem, { workspaceDefaults: {}, templates });
  create(first, { title: 'anon' });
  create(first, { view: 'ta', title: 'host' });
  first.flush();
  first.unmount();
  const second = await launch(mem, { workspaceDefaults: { slots: 2 }, templates });
  assert.deepEqual([second.byTitle('anon').slots, second.byTitle('host').slots], [2, 2]);
});

test('a Host-bag create naming slots keeps it through a save and a second mount', async () => {
  const mem = memory();
  const first = await launch(mem, { workspaceDefaults: {} });
  create(first, { title: 'wide', slots: 3 });
  first.flush();
  first.unmount();
  const second = await launch(mem, { workspaceDefaults: {} });
  assert.equal(second.byTitle('wide').slots, 3);
});

test('rememberLayout false on a multiple template ignores the file\'s anchor and slots, where true applies them', async () => {
  for (const remember of [true, false]) {
    const mem = memory();
    const templates = (rememberLayout: boolean): PanelTemplate[] => [tpl('tm', { multiple: true, placeOnAdd: 'row-start', rememberLayout })];
    const first = await launch(mem, { templates: templates(true) });
    create(first, { view: 'tm', title: 'a' });
    create(first, { view: 'tm', title: 'b' });
    assert.deepEqual(first.titles(), ['b', 'a']);
    act(() => first.latest().move(idOf(first, 'a'), 'left'));
    act(() => first.latest().setSlots(idOf(first, 'a'), 2));
    assert.deepEqual(first.titles(), ['a', 'b']);
    first.flush();
    first.unmount();
    const second = await launch(mem, { templates: templates(remember) });
    assert.deepEqual(second.titles(), remember ? ['a', 'b'] : ['b', 'a'], `remember ${remember}: order`);
    assert.equal(second.byTitle('a').slots, remember ? 2 : 1, `remember ${remember}: slots`);
    cleanup();
  }
});

test('the file has no instance key for a code-declared panel and one for an anonymous, a multiple and a Host-bag panel', async () => {
  const mem = memory();
  const first = await launch(mem, {
    workspaceDefaults: {},
    templates: [tpl('decl'), tpl('multi', { multiple: true }), tpl('host')],
    declared: [{ id: 'decl', templateId: 'decl', settings: { title: 'decl' } }],
  });
  create(first, { title: 'anon' });
  create(first, { view: 'multi', title: 'multi' });
  create(first, { view: 'host', title: 'host', slots: 2 });
  first.flush();
  const byTitle = Object.fromEntries(mem.file()!.panels.map((p) => [p.title, p]));
  assert.equal('instance' in byTitle.decl!, false);
  for (const title of ['anon', 'multi', 'host']) assert.ok('instance' in byTitle[title]!, `${title} has an instance key`);
  assert.deepEqual(byTitle.host!.instance, { title: 'host', slots: 2 });
});

test('a code placement through the engine-level placePanel is not recorded as an override', () => {
  const made = (id: string): PanelWindow => applyTemplate(appendPanel([], { url: id, title: id }, id, ROOT)[0]!, resolvePanelSettings().value, 'create');
  const row = computeRowOrder([createHistoryPanel(ROOT), made('a'), made('b')], ROOT);
  const placed = placePanel(row, 'b', 'row-start', { fallback: 'row-end', rootId: ROOT }).row;
  assert.deepEqual(placed.map((p) => p.id), ['b', ROOT, 'a']);
  assert.deepEqual(placed.map((p) => p.overrides), [undefined, undefined, undefined]);
  assert.equal(recordOverride(placed, 'anchor', [], ROOT), placed);
});

test('a drag marks every non-root remembering panel but not a panel whose rememberLayout is false', async () => {
  const mem = memory();
  const first = await launch(mem, { workspaceDefaults: {}, templates: [tpl('keep', { multiple: true, rememberLayout: false })] });
  create(first, { title: 'x' });
  create(first, { title: 'y' });
  create(first, { view: 'keep', title: 'k' });
  act(() => first.latest().move(idOf(first, 'y'), 'left'));
  assert.deepEqual(
    first.latest().entries.filter((p) => p.id !== ROOT).map((p) => [p.title, p.overrides?.anchor !== undefined]),
    [['y', true], ['x', true], ['k', false]],
  );
});

test('a move marks the moved row\'s remembering panels, and a move that changes nothing returns the same list', async () => {
  const first = await launch(memory(), { workspaceDefaults: {} });
  create(first, { title: 'x' });
  create(first, { title: 'y' });
  act(() => first.latest().move(idOf(first, 'x'), 'left'));
  assert.deepEqual(first.latest().entries.map((p) => p.overrides?.anchor?.position), ['left', undefined, 'right']);
  const before = first.latest().entries;
  act(() => first.latest().move(idOf(first, 'x'), 'left'));
  assert.equal(first.latest().entries, before);
});

// restoreVisibility, held

test('restoreVisibility parked restores a saved-live panel parked and held', async () => {
  const mem = memory();
  const templates = (restoreVisibility: 'saved' | 'parked'): PanelTemplate[] => [tpl('tv', { restoreVisibility, parkable: true })];
  const first = await launch(mem, { templates: templates('saved'), declared: [{ id: 'tv', templateId: 'tv', settings: { title: 'tv' } }] });
  assert.equal(first.byTitle('tv').live, true);
  create(first, { title: 'other' });
  first.flush();
  assert.equal(mem.file()!.panels.find((p) => p.key === 'tv')!.live, true);
  first.unmount();
  const second = await launch(mem, { templates: templates('parked'), declared: [{ id: 'tv', templateId: 'tv', settings: { title: 'tv' } }] });
  assert.equal(second.byTitle('tv').live, false);
});

// ---------------------------------------------------------------------------
// persist
// ---------------------------------------------------------------------------

test('JSON.parse of the saved file has no entry for a persist:session panel; a declared one is recreated and a runtime one is gone', async () => {
  const mem = memory();
  const over = { templates: [tpl('sess', { persist: 'session', multiple: true })], declared: [{ id: 'decl', templateId: 'sess', settings: { title: 'declared' } }], workspaceDefaults: {} };
  const first = await launch(mem, over);
  create(first, { view: 'sess', title: 'runtime' });
  create(first, { title: 'plain' });
  assert.deepEqual(first.titles(), ['declared', 'runtime', 'plain']);
  first.flush();
  assert.deepEqual(mem.file()!.panels.map((p) => p.title), ['plain']);
  first.unmount();
  const second = await launch(mem, over);
  assert.deepEqual([...second.titles()].sort(), ['declared', 'plain']);
});

// ---------------------------------------------------------------------------
// Creation paths: restore and the Host-bag create naming a template
// ---------------------------------------------------------------------------

test('closable false yields locked entries on the create path and on restore', async () => {
  const mem = memory();
  const templates = [tpl('lock', { closable: false, multiple: true })];
  const first = await launch(mem, { templates });
  create(first, { view: 'lock', title: 'l' });
  assert.equal(first.byTitle('l').locked, true);
  first.flush();
  first.unmount();
  const second = await launch(mem, { templates });
  assert.equal(second.byTitle('l').locked, true);
});

test('hostCreatable false makes the Host-bag create a no-op while a restore works', async () => {
  const mem = memory();
  const open = [tpl('hc', { multiple: true })];
  const first = await launch(mem, { templates: open });
  create(first, { view: 'hc', title: 'one' });
  first.flush();
  first.unmount();
  const closed = [tpl('hc', { multiple: true, hostCreatable: false })];
  const second = await launch(mem, { templates: closed });
  assert.deepEqual(second.titles(), ['one'], 'the saved copy was restored');
  create(second, { view: 'hc', title: 'two' });
  assert.deepEqual(second.titles(), ['one'], 'and no more can be made');
});

test('multiple false makes a second create a no-op while a restore keeps an extra saved copy', async () => {
  const mem = memory();
  const first = await launch(mem, { templates: [tpl('mu', { multiple: true })] });
  create(first, { view: 'mu', title: 'one' });
  create(first, { view: 'mu', title: 'two' });
  first.flush();
  first.unmount();
  const second = await launch(mem, { templates: [tpl('mu', { multiple: false })] });
  assert.deepEqual(second.titles(), ['one', 'two']);
  create(second, { view: 'mu', title: 'three' });
  assert.deepEqual(second.titles(), ['one', 'two']);
});

test('multiple false allows the first create of a template and names its panel by the template', async () => {
  const first = await launch(memory(), { templates: [tpl('solo')] });
  create(first, { view: 'solo', title: 'one' });
  create(first, { view: 'solo', title: 'two' });
  assert.deepEqual(first.titles(), ['one']);
  assert.equal(first.byTitle('one').key, 'solo');
  assert.equal(first.byTitle('one').view, 'solo');
});

test('maxInstances stops creation at the limit and a restore is exempt', async () => {
  const mem = memory();
  const first = await launch(mem, { templates: [tpl('mx', { multiple: true })] });
  for (const title of ['a', 'b', 'c']) create(first, { view: 'mx', title });
  first.flush();
  first.unmount();
  const second = await launch(mem, { templates: [tpl('mx', { multiple: true, maxInstances: 2 })] });
  assert.deepEqual(second.titles(), ['a', 'b', 'c']);
  create(second, { view: 'mx', title: 'd' });
  assert.deepEqual(second.titles(), ['a', 'b', 'c']);
  const fresh = await launch(memory(), { templates: [tpl('mx', { multiple: true, maxInstances: 2 })] });
  for (const title of ['a', 'b', 'c']) create(fresh, { view: 'mx', title });
  assert.deepEqual(fresh.titles(), ['a', 'b']);
});

test('permanent true is ignored for a template view, with a not-view-settable conflict from the host layer on parkable', async () => {
  const first = await launch(memory(), { templates: [tpl('pm', { multiple: true })] });
  create(first, { view: 'pm', title: 'p', permanent: true });
  assert.equal(first.byTitle('p').collapsible, true, 'it is still a parkable panel');
  const note = first.notes.find((n) => n.code === 'not-view-settable');
  assert.ok(note, 'a note names the refused ask');
  assert.equal(note.key, 'parkable');
  assert.equal(note.panelId, first.byTitle('p').id);
  assert.match(note.message, /host layer/);
});

test('permanent true on a plain registered view keeps its 0.1.0 meaning: a fixed column that restores fixed', async () => {
  const mem = memory();
  const first = await launch(mem, { workspaceDefaults: {} });
  create(first, { view: 'memory-view', title: 'fixed', permanent: true });
  assert.equal(first.byTitle('fixed').collapsible, false);
  assert.deepEqual(first.notes, [], 'no conflict is raised for a plain view');
  first.flush();
  first.unmount();
  const second = await launch(mem, { workspaceDefaults: {} });
  assert.deepEqual([second.byTitle('fixed').collapsible, second.byTitle('fixed').live], [false, true]);
});

test('a Host-bag create of a plain registerView view resolves through the cascade when workspaceDefaults is passed', async () => {
  const l = await launch(memory(), { workspaceDefaults: {} });
  create(l, { view: 'memory-view', title: 'p' });
  const p = l.byTitle('p');
  assert.notEqual(p.settings, undefined);
  assert.equal(p.settings!.overflow, 'scroll');
});

test('a Host-bag create naming no template while templates exist still resolves through the cascade', async () => {
  const l = await launch(memory(), { templates: [tpl('other')] });
  create(l, { view: 'memory-view', title: 'p' });
  assert.notEqual(l.byTitle('p').settings, undefined);
  assert.equal(l.byTitle('p').view, 'memory-view');
});

// ---------------------------------------------------------------------------
// The six differentials
// ---------------------------------------------------------------------------

const declaredPanel = (settings: PanelSettings): PanelWindow => {
  const result = reconcileWorkspace({ saved: null, templates: [tpl('d', settings)], declared: [{ id: 'd', templateId: 'd' }], rootId: ROOT, current: [], freshId: (() => { let n = 0; return () => `f${++n}`; })() });
  return result.entries[0]!;
};

test('differential persist: a saved panel is written to the file under saved and left out under session', () => {
  differential('persist', (run) => {
    for (const value of ['saved', 'session'] as const) run(value, () => projectWorkspaceState([createHistoryPanel(ROOT), declaredPanel({ persist: value })], ROOT).panels.length);
  });
});

test('differential rememberLayout: a drag is recorded under true and not under false', () => {
  differential('rememberLayout', (run) => {
    for (const value of [true, false]) {
      run(value, () => {
        const row = computeRowOrder([createHistoryPanel(ROOT), declaredPanel({ rememberLayout: value })], ROOT);
        return recordOverride(row, 'anchor', row.map((p) => p.id), ROOT).map((p) => p.overrides?.anchor !== undefined);
      });
    }
  });
});

test('differential restoreVisibility: a panel saved parked is restored parked under saved and live under live', () => {
  differential('restoreVisibility', (run) => {
    for (const value of ['saved', 'live'] as const) {
      run(value, () => {
        const saved: WorkspaceState = { version: 1, panels: [{ id: 'p', view: 't', url: '', live: false, anchor: { panel: ROOT, position: 'right', priority: 0 }, overrides: {} }] };
        return reconcileWorkspace({ saved, templates: [tpl('t', { restoreVisibility: value })], declared: undefined, rootId: ROOT, current: [], freshId: () => 'f1' }).entries[0]!.live;
      });
    }
  });
});

const createdCount = async (settings: PanelSettings, times: number): Promise<number> => {
  const l = await launch(memory(), { templates: [tpl('q', settings)] });
  for (let k = 0; k < times; k += 1) create(l, { view: 'q', title: `q${k}` });
  const count = l.titles().length;
  l.unmount();
  return count;
};

test('differential hostCreatable: the Host-bag create makes a panel under true and none under false', async () => {
  const outcomes = new Map<boolean, number>([
    [true, await createdCount({ hostCreatable: true }, 1)],
    [false, await createdCount({ hostCreatable: false }, 1)],
  ]);
  differential('hostCreatable', (run) => {
    for (const value of [true, false]) run(value, () => outcomes.get(value));
  });
});

test('differential multiple: a second Host-bag create adds a panel under true and none under false', async () => {
  const outcomes = new Map<boolean, number>([
    [true, await createdCount({ multiple: true }, 2)],
    [false, await createdCount({ multiple: false }, 2)],
  ]);
  differential('multiple', (run) => {
    for (const value of [true, false]) run(value, () => outcomes.get(value));
  });
});

test('differential maxInstances: three Host-bag creates leave three panels under unlimited and one under 1', async () => {
  const outcomes = new Map<string, number>([
    ['unlimited', await createdCount({ multiple: true, maxInstances: 'unlimited' }, 3)],
    ['1', await createdCount({ multiple: true, maxInstances: 1 }, 3)],
  ]);
  differential('maxInstances', (run) => {
    for (const value of ['unlimited', '1']) run(value, () => outcomes.get(value));
  });
});

test('every name this file owns has a completed differential', () => {
  assert.deepEqual(differentialsCovered().filter((n) => ['persist', 'rememberLayout', 'restoreVisibility', 'hostCreatable', 'multiple', 'maxInstances'].includes(n)), ['hostCreatable', 'maxInstances', 'multiple', 'persist', 'rememberLayout', 'restoreVisibility']);
});

// ---------------------------------------------------------------------------
// Random settings vectors over Host-bag creates and restores
// ---------------------------------------------------------------------------

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('S2 and S3: over 500 seeded sequences of Host-bag creates, restores and a plain create, no restricting setting is bypassed', async () => {
  const random = seeded(18);
  const limits = [1, 2, 3, 'unlimited'] as const;
  let sequences = 0;
  for (let run = 0; run < 520; run += 1) {
    const settings: PanelSettings = {
      hostCreatable: random() < 0.75,
      multiple: random() < 0.6,
      maxInstances: limits[Math.floor(random() * limits.length)]!,
      closable: random() < 0.7,
    };
    const mem = memory();
    const over = (): Partial<SeededOver> => ({ templates: [tpl('r', settings)], workspaceDefaults: {} });
    let l = await launch(mem, over());
    let plain = 0;
    let templated = 0;
    const cap = settings.hostCreatable === false ? 0 : settings.multiple === false ? 1 : settings.maxInstances === 'unlimited' ? Number.POSITIVE_INFINITY : (settings.maxInstances as number);
    for (let step = 0; step < 6; step += 1) {
      const roll = random();
      if (roll < 0.5) {
        const before = templated;
        create(l, { view: 'r', title: `r${step}` });
        templated = l.latest().entries.filter((p) => p.view === 'r').length;
        assert.ok(templated <= Math.max(cap, before), `run ${run}: ${templated} template panels with a cap of ${cap}`);
      } else if (roll < 0.75) {
        create(l, { title: `p${step}` });
        plain += 1;
      } else {
        l.flush();
        l.unmount();
        cleanup();
        l = await launch(mem, over());
        assert.equal(l.latest().entries.filter((p) => p.view === 'r').length, templated, `run ${run}: a restore keeps every saved copy`);
      }
      const entries = l.latest().entries.filter((p) => p.id !== ROOT);
      assert.equal(entries.filter((p) => p.view !== 'r').length, plain, `run ${run}: plain creates are never refused`);
      assert.ok(entries.filter((p) => p.view === 'r').every((p) => p.locked === (settings.closable === false)), `run ${run}: closable holds on every path`);
    }
    l.unmount();
    cleanup();
    mock.timers.reset();
    sequences += 1;
  }
  console.log(`sequences run: ${sequences}`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
});

// ---------------------------------------------------------------------------
// A 0.1.0 file, the file this build writes, malformed files, and restoreVisibility
// ---------------------------------------------------------------------------

interface Vendored {
  projectWorkspaceState(panels: readonly PanelWindow[], rootId: string): WorkspaceState;
  isWorkspaceState(value: unknown): boolean;
}
const vendored = (): Promise<Vendored> => import(new URL('./fixtures/compat-0.1.0/pkg/workspaceState.js', import.meta.url).href) as Promise<Vendored>;

const deriveAnchors = (entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
const legacyPanel = (id: string, title: string): PanelWindow => appendPanel([], { url: `https://${id}.example`, title, view: 'memory-view' }, id, ROOT)[0]!;

test('a file written by the vendored 0.1.0 projectWorkspaceState restores with one singleton, a tablet web panel read as two slots and a dragged order', async () => {
  const { projectWorkspaceState: legacyProject } = await vendored();
  const solo = { ...legacyPanel('s', 'solo'), view: 'solo' };
  const web = { ...legacyPanel('w', 'web'), formFactor: 'tablet' as const };
  const other = legacyPanel('o', 'other');
  const file = legacyProject(deriveAnchors([createHistoryPanel(ROOT), web, solo, other]), ROOT);
  const mem = memory();
  await mem.storage.save(file);
  const l = await launch(mem, { workspaceDefaults: {}, templates: [tpl('solo')], declared: [{ id: 'solo', templateId: 'solo', settings: { title: 'solo' } }] });
  assert.deepEqual(l.titles(), ['web', 'solo', 'other']);
  assert.equal(l.latest().entries.filter((p) => p.view === 'solo').length, 1);
  assert.equal(l.byTitle('web').slots, 2);
});

test('a plain 0.1.0 file restores through a workspace with no templates or declarations: its panels keep their title, slots and no key', async () => {
  const { projectWorkspaceState: legacyProject } = await vendored();
  const tablet = { ...legacyPanel('b', 'b'), formFactor: 'tablet' as const };
  const file = legacyProject(deriveAnchors([createHistoryPanel(ROOT), legacyPanel('a', 'a'), tablet]), ROOT);
  const mem = memory();
  await mem.storage.save(file);
  const l = await launch(mem);
  assert.deepEqual(l.titles(), ['a', 'b']);
  assert.deepEqual(l.latest().entries.map((p) => [p.key, p.overrides]), [[undefined, undefined], [undefined, undefined], [undefined, undefined]]);
  assert.equal(l.byTitle('b').slots, 2);
});

test('the file this build writes passes the vendored 0.1.0 isWorkspaceState', async () => {
  const { isWorkspaceState: legacyGuard } = await vendored();
  const mem = memory();
  const l = await launch(mem, { workspaceDefaults: {}, templates: [tpl('m', { multiple: true })], declared: [{ id: 'decl', templateId: 'm' }] });
  create(l, { title: 'anon' });
  create(l, { view: 'm', title: 'host', slots: 2 });
  act(() => l.latest().move(idOf(l, 'host'), 'left'));
  l.flush();
  const file = mem.file()!;
  assert.ok(file.panels.some((p) => p.overrides !== undefined && p.instance !== undefined), 'control: the file carries the new keys');
  assert.equal(legacyGuard(file), true);
});

test('malformed overrides, dismissed, applied, a duplicate key and a 300-entry dismissed each end settled with the row intact', async () => {
  const panel = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ id, view: 'memory-view', url: `https://${id}.example`, title: id, live: true, anchor: { panel: ROOT, position: 'right', priority: Number(id.slice(1)) }, ...over });
  const cases: Record<string, unknown>[] = [
    { version: 1, panels: [panel('p0', { overrides: 'x' }), panel('p1')] },
    { version: 1, dismissed: {}, panels: [panel('p0'), panel('p1')] },
    { version: 1, panels: [panel('p0', { applied: 7 }), panel('p1')] },
    { version: 1, panels: [panel('p0', { key: 'dup' }), panel('p1', { key: 'dup' })] },
    { version: 1, dismissed: Array.from({ length: 300 }, (_, k) => `d${k}`), panels: [panel('p0'), panel('p1')] },
  ];
  for (const [k, file] of cases.entries()) {
    const mem = memory();
    await mem.storage.save(file as unknown as WorkspaceState);
    const l = await launch(mem, { workspaceDefaults: {} });
    assert.equal(l.titles().length >= 1, true, `case ${k}: the row is intact`);
    create(l, { title: 'later' });
    l.flush();
    assert.ok(mem.file()!.panels.length >= 2, `case ${k}: settled, and the next save is not an empty workspace`);
    assert.ok((mem.file()!.dismissed?.length ?? 0) <= 256, `case ${k}: dismissed is capped`);
    l.unmount();
    cleanup();
  }
});

test('restoreVisibility saved, live and parked applied to a saved-live and a saved-parked panel: six literal cases', () => {
  const cases: [PanelSettings['restoreVisibility'], boolean, boolean][] = [
    ['saved', true, true],
    ['saved', false, false],
    ['live', true, true],
    ['live', false, true],
    ['parked', true, false],
    ['parked', false, false],
  ];
  for (const [value, wasLive, expected] of cases) {
    const saved: WorkspaceState = { version: 1, panels: [{ id: 'p', view: 't', url: '', live: wasLive, anchor: { panel: ROOT, position: 'right', priority: 0 }, overrides: {} }] };
    const result = reconcileWorkspace({ saved, templates: [tpl('t', { restoreVisibility: value, parkable: true })], declared: undefined, rootId: ROOT, current: [], freshId: () => 'f1' });
    assert.equal(result.entries[0]!.live, expected, `${value} over saved ${wasLive ? 'live' : 'parked'}`);
  }
});

test('initialScroll through a throw planted in the load success handler: the row stays unscrolled and the workspace settles', async () => {
  const row11 = deriveAnchorsFromOrder([rootEntry(), ...Array.from({ length: 10 }, (_, k) => made(`s${k + 1}`))], ROOT);
  const file = projectWorkspaceState(row11, ROOT);
  const saves: WorkspaceState[] = [];
  let thrown = false;
  const m = mountRow([rootEntry()], 1000, {
    storage: { load: () => Promise.resolve(file), save: (state) => void saves.push(state) },
    workspaceDefaults: {},
    tuning: { initialScroll: 'root', saveQuietMs: QUIET_MS },
    defaultHostData: () => {
      if (!thrown) {
        thrown = true;
        throw new Error('planted in reconcile');
      }
      return null;
    },
  });
  mock.timers.enable({ apis: ['setTimeout'] });
  const warn = mock.method(console, 'warn', () => undefined);
  await act(async () => {});
  assert.equal(thrown, true, 'control: the planted throw ran');
  assert.equal(m.latest().entries.length, 1, 'nothing from the file was applied');
  assert.equal(m.container.scrollLeft, 0);
  act(() => m.latest().create({ view: 'scroll-row-view', title: 'later' }));
  act(() => mock.timers.tick(QUIET_MS + 50));
  assert.equal(saves.length, 1, 'saving resumed: the workspace settled');
  warn.mock.restore();
});
