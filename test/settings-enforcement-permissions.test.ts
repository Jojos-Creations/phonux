/**
 * The engine's reading of the twelve permission and lifecycle settings it owns: one differential per name through
 * the real pure function or hook, the effect each setting has, the two writers of an entry's mirror fields, the
 * legacy defaults of a hand-built entry and the slot hooks. Entries are built the way a creation path will build
 * them (appendPanel's skeleton, then applyTemplate over a resolved layer), so the settings are the only variable.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import {
  LIBRARY_PANEL_DEFAULTS,
  PanelRow,
  registerView,
  resolvePanelSettings,
  usePanelCapabilities,
  usePanelCloseEligible,
  usePanelNeighborWidths,
  usePanelReorderEligible,
  useProvidePanels,
} from '../index.js';
import type { CaptureTrigger, PanelSettings, PanelWindow, PanelsInput, ProvidedPanels, ResolvedPanelSettings } from '../index.js';
import { applyTemplate, effective, panelKey } from '../panelSettings.js';
import { deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { appendPanel, closePanel, createHistoryPanel, movePanel, reanchorPanel, restorePanel, setSlots } from '../panelWindow.js';
import { sizeOfSlots } from '../panelTiers.js';
import { hydrateWorkspaceState } from '../workspaceState.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, panelsInput, withHost } from './support/mount-harness.js';

const ROOT = 'root';
const OWNED = ['closable', 'parkable', 'draggable', 'crossable', 'placeable', 'resizable', 'clearable', 'listed', 'title', 'undoWindowMs', 'reportClose', 'snapshot'];

const resolve = (layer: PanelSettings = {}): ResolvedPanelSettings => resolvePanelSettings({ template: layer }).value;

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { url: `https://${id}.example`, title: id.toUpperCase() }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, ...over }, resolve(layer), 'create');
}

/** History: the root resolves closable false and parkable false by rule, whatever the layers ask. */
const rootEntry = (): PanelWindow =>
  applyTemplate(createHistoryPanel(ROOT), resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');

/** A hand-built 0.1.0 entry: no settings, no key. */
const hand = (id: string, over: Partial<PanelWindow> = {}): PanelWindow => ({ id, url: `https://${id}.example`, title: id.toUpperCase(), live: true, locked: false, view: 'web', collapsible: true, listed: true, ...over });

/** The row in array order with every anchor read from it, as the engine keeps it. */
const row = (...entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
const ids = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);

type Spy = CaptureTrigger & { captured: string[]; evicted: string[] };
const spyCapture = (): Spy => {
  const captured: string[] = [];
  const evicted: string[] = [];
  return { captured, evicted, capture: (id) => void captured.push(id), evict: (id) => void evicted.push(id) };
};

/** Mounts useProvidePanels over `initialEntries`; `now()` is the latest render's value. */
function provide(initialEntries: PanelWindow[], over: Partial<PanelsInput> = {}): { now: () => ProvidedPanels; ids: () => string[] } {
  let latest: ProvidedPanels | undefined;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ initialEntries, ...over }));
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  const now = (): ProvidedPanels => {
    assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
    return latest;
  };
  return { now, ids: () => now().entries.map((p) => p.id) };
}

const NONE: ReadonlySet<string> = new Set();

registerView('perm-probe', ({ panel }) => {
  const widths = usePanelNeighborWidths();
  const caps = usePanelCapabilities();
  return React.createElement('i', {
    'data-probe': panel.id,
    'data-widths': JSON.stringify(widths),
    'data-caps': JSON.stringify(caps),
    'data-keys': Object.keys(caps).join(','),
    'data-reorder': String(usePanelReorderEligible()),
    'data-close': String(usePanelCloseEligible()),
  });
});

/** A PanelRow over `entries`, each rendered by the probe view; returns a reader of what slot `id` saw. */
function mountRow(entries: PanelWindow[]): (id: string) => Record<string, string> {
  const probed = entries.map((p) => ({ ...p, view: 'perm-probe' }));
  const mounted = mount(withHost(React.createElement(PanelRow, { entries: probed, rootId: ROOT, closingIds: NONE, enteringViaAnchorIds: NONE })));
  return (id) => {
    const node = mounted.container.querySelector(`[data-probe="${id}"]`);
    assert.ok(node, `slot ${id} is not mounted`);
    return { ...(node as HTMLElement).dataset } as Record<string, string>;
  };
}

type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const chance = (rng: Rng, p: number): boolean => rng() < p;
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

// ---------------------------------------------------------------------------
// One differential per owned name
// ---------------------------------------------------------------------------

test('differential closable: a close removes the entry under true and leaves the row alone under false', () => {
  const closeOutcome = (closable: boolean): string[] => {
    const p = provide([rootEntry(), made('a', { closable })]);
    act(() => p.now().close('a'));
    return p.ids();
  };
  differential('closable', (run) => {
    run(true, () => closeOutcome(true));
    run(false, () => closeOutcome(false));
  });
});

test('differential parkable: false makes the entry a fixed column the provider counts, true leaves it a parkable panel', () => {
  const fixedCount = (parkable: boolean): number => provide([rootEntry(), made('a', { parkable })]).now().fixedViewCount;
  differential('parkable', (run) => {
    run(true, () => fixedCount(true));
    run(false, () => fixedCount(false));
  });
});

test('differential draggable: movePanel moves the source under true and returns the same array under false', () => {
  const moved = (draggable: boolean): string[] => ids(movePanel(row(rootEntry(), made('a', { draggable }), made('b')), 'a', 'right', ROOT));
  differential('draggable', (run) => {
    run(true, () => moved(true));
    run(false, () => moved(false));
  });
});

test('differential crossable: a hop past the entry happens under true and is refused under false', () => {
  const hop = (crossable: boolean): string[] => ids(movePanel(row(rootEntry(), made('p'), made('x', { crossable }), made('q')), 'p', 'right', ROOT));
  differential('crossable', (run) => {
    run(true, () => hop(true));
    run(false, () => hop(false));
  });
});

test('differential placeable: reanchorPanel changes the row under true and returns the same array under false', () => {
  const reanchored = (placeable: boolean): boolean => {
    const panels = row(rootEntry(), made('a', { placeable }), made('b'));
    return reanchorPanel(panels, 'a', { position: 'left' }, ROOT) !== panels;
  };
  differential('placeable', (run) => {
    run(true, () => reanchored(true));
    run(false, () => reanchored(false));
  });
});

test('differential resizable: setSlots changes the slot count under true and returns the same array under false', () => {
  const slotsAfter = (resizable: boolean): number | undefined => setSlots(row(rootEntry(), made('a', { resizable })), 'a', 2).find((p) => p.id === 'a')?.slots;
  differential('resizable', (run) => {
    run(true, () => slotsAfter(true));
    run(false, () => slotsAfter(false));
  });
});

test('differential clearable: clearAll removes the entry under true and keeps it under false', () => {
  const afterClear = (clearable: boolean): string[] => {
    const p = provide([rootEntry(), made('a', { clearable })]);
    act(() => p.now().clearAll());
    return p.ids();
  };
  differential('clearable', (run) => {
    run(true, () => afterClear(true));
    run(false, () => afterClear(false));
  });
});

test('differential listed: panelList holds the entry under true and not under false', () => {
  const listedIds = (listed: boolean): string[] => provide([rootEntry(), made('a', { listed })]).now().panelList.map((s) => s.id);
  differential('listed', (run) => {
    run(true, () => listedIds(true));
    run(false, () => listedIds(false));
  });
});

test('differential title: the title the settings carry is the one panelList summarises', () => {
  const titleOf = (title: string): string | undefined => provide([rootEntry(), made('a', { title })]).now().panelList[0]?.title;
  differential('title', (run) => {
    run('One', () => titleOf('One'));
    run('Two', () => titleOf('Two'));
  });
});

test('differential undoWindowMs: a close is held in recentlyClosed under 10000 and is final at once under 0', () => {
  const held = (undoWindowMs: number): string[] | null => {
    const p = provide([rootEntry(), made('a', { undoWindowMs })]);
    act(() => p.now().close('a'));
    return p.now().recentlyClosed?.map((s) => s.id) ?? null;
  };
  differential('undoWindowMs', (run) => {
    run(10000, () => held(10000));
    run(0, () => held(0));
  });
});

test('differential reportClose: onPanelsClosed is called once under true and never under false', () => {
  const reports = (reportClose: boolean): number => {
    const seen: string[] = [];
    const p = provide([rootEntry(), made('a', { reportClose })], { onPanelsClosed: (e) => void seen.push(e.id) });
    act(() => p.now().close('a'));
    return seen.length;
  };
  differential('reportClose', (run) => {
    run(true, () => reports(true));
    run(false, () => reports(false));
  });
});

test('differential snapshot: a close asks the host for a picture under both and not under never', () => {
  const pictures = (snapshot: 'both' | 'never'): string[] => {
    const spy = spyCapture();
    const p = provide([rootEntry(), made('a', { snapshot })], { capture: spy });
    act(() => p.now().close('a'));
    return spy.captured;
  };
  differential('snapshot', (run) => {
    run('both', () => pictures('both'));
    run('never', () => pictures('never'));
  });
});

test('differential coverage: the names the differentials above completed are exactly the fourteen this entry owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});

// ---------------------------------------------------------------------------
// Permission effects
// ---------------------------------------------------------------------------

test('closable false: a close leaves the entries and closingIds as they were, calls nothing and clearAll keeps the panel', () => {
  const closed: string[] = [];
  const p = provide([rootEntry(), made('a', { closable: false }), made('b')], { onPanelsClosed: (e) => void closed.push(e.id) });
  const entries = p.now().entries;
  const closing = p.now().closingIds;
  act(() => p.now().close('a'));
  assert.ok(p.now().entries === entries, 'the entries are the same array');
  assert.ok(p.now().closingIds === closing, 'closingIds is the same set');
  assert.deepEqual(closed, []);
  assert.equal(p.now().recentlyClosed, null);
  act(() => p.now().clearAll());
  assert.deepEqual(p.ids(), ['root', 'a'], 'clearAll removed the closable one and kept the locked one');
});

test('closable false: the entry is locked and not clearable, which is what the close gate and clearAll read', () => {
  const entry = made('a', { closable: false });
  assert.equal(entry.locked, true);
  assert.equal(effective(entry).clearable, false, 'C2: an unclosable panel is not cleared either');
});

test('the root resolves closable false by rule and its close is refused', () => {
  const root = rootEntry();
  assert.equal(effective(root).closable, false);
  assert.equal(root.locked, true);
  const closed: string[] = [];
  const p = provide([root, made('a')], { onPanelsClosed: (e) => void closed.push(e.id) });
  const entries = p.now().entries;
  act(() => p.now().close(ROOT));
  assert.ok(p.now().entries === entries);
  assert.deepEqual(closed, []);
});

test('draggable false: movePanel returns the same array for that source while another panel still crosses it', () => {
  const panels = row(rootEntry(), made('a', { draggable: false }), made('b'));
  assert.ok(movePanel(panels, 'a', 'right', ROOT) === panels, 'the source itself is refused');
  assert.deepEqual(ids(movePanel(panels, 'b', 'left', ROOT)), ['root', 'b', 'a'], 'b crosses a: draggable never stops a crossing');
});

test('placeable false: reanchorPanel returns the same array', () => {
  const panels = row(rootEntry(), made('a', { placeable: false }), made('b'));
  assert.ok(reanchorPanel(panels, 'a', { position: 'left' }, ROOT) === panels);
  assert.ok(reanchorPanel(panels, 'b', { position: 'left' }, ROOT) !== panels, 'control: a placeable panel is re-anchored');
});

test('resizable false: setSlots returns the same array and onPanelResize never fires, while a resizable panel fires it', () => {
  let resizes = 0;
  const p = provide([rootEntry(), made('frozen', { resizable: false }), made('free')], { onPanelResize: () => void (resizes += 1) });
  act(() => p.now().setSlots('frozen', 2));
  assert.equal(resizes, 0, 'a frozen slot count fires nothing');
  assert.equal(p.now().entries.find((e) => e.id === 'frozen')?.slots, 1);
  act(() => p.now().setSlots('free', 2));
  assert.equal(resizes, 1, 'control: the free panel resizes and fires once');
  const panels = row(rootEntry(), made('frozen', { resizable: false }));
  assert.ok(setSlots(panels, 'frozen', 2) === panels);
});

test('a slot count above maxSlots: setSlots leaves a panel already at maxSlots alone and onPanelResize never fires', () => {
  let resizes = 0;
  const p = provide([rootEntry(), made('a', { maxSlots: 1 }), made('b', { maxSlots: 2 })], { onPanelResize: () => void (resizes += 1) });
  act(() => p.now().setSlots('a', 2));
  assert.equal(resizes, 0);
  act(() => p.now().setSlots('b', 2));
  assert.equal(resizes, 1);
});

test('clearable false survives clearAll while another panel is removed', () => {
  const p = provide([rootEntry(), made('keep', { clearable: false }), made('gone')]);
  act(() => p.now().clearAll());
  assert.deepEqual(p.ids(), ['root', 'keep']);
});

test('clearAll evicts the picture of exactly the panels it removed', () => {
  const spy = spyCapture();
  const p = provide([rootEntry(), made('keep', { clearable: false }), made('gone')], { capture: spy });
  act(() => p.now().clearAll());
  assert.deepEqual(spy.evicted, ['gone']);
});

test('listed false hides the panel from panelList and leaves it in the row', () => {
  const p = provide([rootEntry(), made('hidden', { listed: false }), made('shown')]);
  assert.deepEqual(p.now().panelList.map((s) => s.id), ['shown']);
  assert.deepEqual(p.ids(), ['root', 'hidden', 'shown']);
});

// ---------------------------------------------------------------------------
// crossable
// ---------------------------------------------------------------------------

test('crossable false: a parked non-crossable panel between source and target is a barrier, where the default let the hop through', () => {
  const open = row(rootEntry(), made('p'), made('x', {}, { live: false }), made('q'));
  assert.deepEqual(ids(movePanel(open, 'p', 'right', ROOT)), ['root', 'x', 'q', 'p'], 'the default: the parked panel shifts with the hop');
  const barrier = row(rootEntry(), made('p'), made('x', { crossable: false }, { live: false }), made('q'));
  assert.ok(movePanel(barrier, 'p', 'right', ROOT) === barrier, 'parked and non-crossable: same array');
});

test('crossable false: a present non-crossable neighbour is a barrier from either side', () => {
  const panels = row(rootEntry(), made('p'), made('x', { crossable: false }), made('q'));
  assert.ok(movePanel(panels, 'p', 'right', ROOT) === panels);
  assert.ok(movePanel(panels, 'q', 'left', ROOT) === panels);
  assert.deepEqual(ids(movePanel(panels, 'p', 'left', ROOT)), ['p', 'root', 'x', 'q'], 'control: p still crosses History on its other side');
});

test('crossable false: a hop that stays clear of the barrier still happens', () => {
  const panels = row(rootEntry(), made('p'), made('q'), made('x', { crossable: false }));
  assert.deepEqual(ids(movePanel(panels, 'p', 'right', ROOT)), ['root', 'q', 'p', 'x']);
  assert.ok(movePanel(panels, 'p', 'right', ROOT) !== panels);
});

test('a PanelRow mount shows usePanelNeighborWidths truncated at the non-crossable entry', () => {
  const read = mountRow(row(rootEntry(), made('p'), made('x', { crossable: false }), made('q')));
  assert.equal(read('p').widths, '{"left":[390],"right":[]}', 'p sees History to its left and nothing past x on its right');
  assert.equal(read('q').widths, '{"left":[],"right":[]}', 'q sees nothing past x on its left');
});

test('a PanelRow mount lists every neighbour when none is non-crossable, and stops at a parked barrier too', () => {
  const open = mountRow(row(rootEntry(), made('p'), made('x'), made('q')));
  assert.equal(open('p').widths, '{"left":[390],"right":[390,390]}');
  cleanup();
  const parked = mountRow(row(rootEntry(), made('p'), made('x', { crossable: false }, { live: false }), made('q')));
  assert.equal(parked('p').widths, '{"left":[390],"right":[]}', 'a parked non-crossable entry has no slot but still ends the list');
});

/** Everything on one side of `id` in `panels`, as a sorted list. */
const leftOf = (panels: readonly PanelWindow[], id: string): string[] => {
  const at = panels.findIndex((p) => p.id === id);
  return ids(panels.slice(0, at)).sort();
};

test('a parkable non-crossable panel keeps the same entries on each side under 200 seeded moves of others, live and parked', () => {
  const rng = mulberry32(2024);
  let panels = row(
    rootEntry(),
    made('a'),
    made('b', {}, { live: false }),
    made('n', { crossable: false }),
    made('c'),
    made('d', {}, { live: false }),
    made('e'),
  );
  const before = leftOf(panels, 'n');
  let moves = 0;
  for (let step = 0; step < 200; step += 1) {
    const movable = panels.filter((p) => p.id !== 'n' && p.id !== ROOT);
    const next = movePanel(panels, pick(rng, movable).id, pick(rng, ['left', 'right'] as const), ROOT);
    if (next !== panels) moves += 1;
    panels = next;
    assert.deepEqual(leftOf(panels, 'n'), before, `step ${step}: a panel crossed n`);
  }
  assert.ok(moves > 20, `only ${moves} of 200 moves happened, so the invariant was barely exercised`);
});

test('a draggable false fixed column is never moved by its own drag and keeps its neighbours under 200 seeded moves of others', () => {
  const rng = mulberry32(77);
  const fixed = made('f', { parkable: false, crossable: false });
  assert.equal(effective(fixed).draggable, false, 'a fixed column is not draggable by derivation');
  let panels = row(rootEntry(), made('a'), made('b', {}, { live: false }), fixed, made('c'), made('d'));
  assert.ok(movePanel(panels, 'f', 'left', ROOT) === panels);
  assert.ok(movePanel(panels, 'f', 'right', ROOT) === panels);
  const before = leftOf(panels, 'f');
  let moves = 0;
  for (let step = 0; step < 200; step += 1) {
    const movable = panels.filter((p) => p.id !== 'f' && p.id !== ROOT);
    const next = movePanel(panels, pick(rng, movable).id, pick(rng, ['left', 'right'] as const), ROOT);
    if (next !== panels) moves += 1;
    panels = next;
    assert.deepEqual(leftOf(panels, 'f'), before, `step ${step}: a panel crossed f`);
  }
  assert.ok(moves > 20, `only ${moves} of 200 moves happened`);
});

// ---------------------------------------------------------------------------
// undoWindowMs, reportClose, snapshot
// ---------------------------------------------------------------------------

/** Mock timers over setTimeout and Date, after everything is loaded, so a window end is read off the tick count. */
const clock = (): void => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
const tick = (ms: number): void => act(() => mock.timers.tick(ms));
const heldIds = (p: { now: () => ProvidedPanels }): string[] => p.now().recentlyClosed?.map((s) => s.id) ?? [];

test('undoWindowMs 0: the close is absent from recentlyClosed, undoClose leaves it, and exactly one evict is seen', () => {
  const spy = spyCapture();
  const p = provide([rootEntry(), made('a', { undoWindowMs: 0 }), made('b')], { capture: spy });
  act(() => p.now().close('a'));
  assert.equal(p.now().recentlyClosed, null);
  assert.deepEqual(p.ids(), ['root', 'b']);
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids(), ['root', 'b'], 'nothing to undo');
  assert.deepEqual(spy.evicted, ['a'], 'exactly one evict, at the close');
});

test('undoWindowMs 0: a second close of the same panel in the same turn is a no-op', () => {
  const spy = spyCapture();
  const closed: string[] = [];
  const p = provide([rootEntry(), made('a', { undoWindowMs: 0 })], { capture: spy, onPanelsClosed: (e) => void closed.push(e.id) });
  act(() => {
    const stale = p.now();
    stale.close('a');
    stale.close('a');
  });
  assert.deepEqual(spy.evicted, ['a'], 'one evict, not two');
  assert.equal(closed.length, 1, 'one report, not two');
});

test('undoWindowMs 0 closed inside an open window leaves that window\'s end where it was', () => {
  clock();
  const p = provide([rootEntry(), made('a'), made('z', { undoWindowMs: 0 })]);
  act(() => p.now().close('a'));
  tick(3000);
  act(() => p.now().close('z'));
  assert.deepEqual(heldIds(p), ['a'], 'only a is held');
  tick(6999);
  assert.deepEqual(heldIds(p), ['a'], 'the window still ends at 10 s from the first close');
  tick(1);
  assert.deepEqual(heldIds(p), [], 'and it ends there');
});

test('undoWindowMs 2000 closed inside a 10 s window leaves the end unchanged', () => {
  clock();
  const p = provide([rootEntry(), made('a'), made('s', { undoWindowMs: 2000 })]);
  act(() => p.now().close('a'));
  tick(1000);
  act(() => p.now().close('s'));
  tick(8999);
  assert.deepEqual(heldIds(p), ['a', 's'], 'at 9999 ms both are still held: the 2 s value did not shorten the window');
  tick(1);
  assert.deepEqual(heldIds(p), [], 'both end together at 10 s');
});

test('undoWindowMs 30000 closed inside a 10 s window extends the end', () => {
  clock();
  const p = provide([rootEntry(), made('a'), made('l', { undoWindowMs: 30000 })]);
  act(() => p.now().close('a'));
  tick(1000);
  act(() => p.now().close('l'));
  tick(29999);
  assert.deepEqual(heldIds(p), ['a', 'l'], 'at 30999 ms, still inside now + 30 s');
  tick(1);
  assert.deepEqual(heldIds(p), [], 'and over at 31 s');
});

test('the default window still restarts from each close: a second default close 1 s in ends the window at 11 s', () => {
  clock();
  const p = provide([rootEntry(), made('a'), made('b')]);
  act(() => p.now().close('a'));
  tick(1000);
  act(() => p.now().close('b'));
  tick(9999);
  assert.deepEqual(heldIds(p), ['a', 'b']);
  tick(1);
  assert.deepEqual(heldIds(p), []);
});

test('reportClose false: onPanelsClosed is not called and onPanelsRestored lists only the reported, restored ids', () => {
  const closedIds: string[] = [];
  const restoredBatches: string[][] = [];
  const p = provide([rootEntry(), made('quiet', { reportClose: false }), made('loud'), made('other')], {
    onPanelsClosed: (e) => void closedIds.push(e.id),
    onPanelsRestored: (batch) => void restoredBatches.push(batch),
  });
  act(() => p.now().close('quiet'));
  assert.deepEqual(closedIds, [], 'nothing reported for the quiet one');
  act(() => p.now().close('loud'));
  assert.equal(closedIds.length, 1);
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids().sort(), ['loud', 'other', 'quiet', 'root'].sort(), 'both are restored');
  assert.deepEqual(restoredBatches, [closedIds], 'only the id that was reported comes back');
});

test('reportClose false for every close: undoClose restores them and onPanelsRestored is not called', () => {
  const restoredBatches: string[][] = [];
  const p = provide([rootEntry(), made('quiet', { reportClose: false })], { onPanelsRestored: (batch) => void restoredBatches.push(batch) });
  act(() => p.now().close('quiet'));
  act(() => p.now().undoClose());
  assert.deepEqual(p.ids(), ['root', 'quiet']);
  assert.deepEqual(restoredBatches, []);
});

/** Root plus three live panels, all under `layer`, in a container that holds three columns: the reconcile effect parks the leftmost one. */
const parkingRow = (layer: PanelSettings, spy: Spy): ReturnType<typeof provide> =>
  provide([rootEntry(), made('a', { overflow: 'park', ...layer }), made('b', { overflow: 'park', ...layer }), made('c', { overflow: 'park', ...layer })], { capture: spy, containerWidth: 1300 });

test('snapshot control: the row above really parks a panel, so the park scenarios below can be positive', () => {
  const spy = spyCapture();
  const p = parkingRow({}, spy);
  assert.deepEqual(p.now().entries.filter((e) => !e.live).map((e) => e.id), ['a']);
});

test('snapshot never: a park, a close and a clearAll make 0 capture and 0 evict calls, where both makes at least one of each', () => {
  const runAll = (snapshot: 'both' | 'never'): { captured: number; evicted: number } => {
    const spy = spyCapture();
    const parked = parkingRow({ snapshot }, spy);
    act(() => parked.now().close('a'));
    act(() => parked.now().clearAll());
    return { captured: spy.captured.length, evicted: spy.evicted.length };
  };
  const both = runAll('both');
  assert.ok(both.captured >= 1 && both.evicted >= 1, `positive control: both captured ${both.captured} and evicted ${both.evicted}`);
  cleanup();
  assert.deepEqual(runAll('never'), { captured: 0, evicted: 0 });
});

test('snapshot never: the picture of a close that elapses unrestored is not evicted either', () => {
  clock();
  const spy = spyCapture();
  const p = provide([rootEntry(), made('a', { snapshot: 'never' }), made('b')], { capture: spy });
  act(() => p.now().close('a'));
  act(() => p.now().close('b'));
  tick(10_000);
  assert.deepEqual(spy.evicted, ['b'], 'b is evicted when its window elapses; a never asked for a picture');
  assert.deepEqual(spy.captured, ['b']);
});

test("snapshot 'park' differs from 'both': it captures a park and not a close", () => {
  const spyPark = spyCapture();
  const parked = parkingRow({ snapshot: 'park' }, spyPark);
  assert.deepEqual(spyPark.captured, ['a'], 'the park of a is captured under park');
  act(() => parked.now().close('b'));
  assert.deepEqual(spyPark.captured, ['a'], 'the close of b is not');
  const closeOnly = spyCapture();
  const p = provide([rootEntry(), made('a', { snapshot: 'park' })], { capture: closeOnly });
  act(() => p.now().close('a'));
  assert.deepEqual(closeOnly.captured, [], 'a close is not a park');
});

test("snapshot 'close' differs from 'both': it captures a close and not a park", () => {
  const spyPark = spyCapture();
  parkingRow({ snapshot: 'close' }, spyPark);
  assert.deepEqual(spyPark.captured, [], 'the park of a is not captured under close');
  cleanup();
  const spyClose = spyCapture();
  const p = provide([rootEntry(), made('a', { snapshot: 'close' })], { capture: spyClose });
  act(() => p.now().close('a'));
  assert.deepEqual(spyClose.captured, ['a']);
});

test("snapshot 'both' captures a park and a close: the default the two cases above are measured against", () => {
  const spy = spyCapture();
  const p = parkingRow({}, spy);
  assert.deepEqual(spy.captured, ['a']);
  act(() => p.now().close('b'));
  assert.deepEqual(spy.captured, ['a', 'b']);
  assert.equal(effective(hand('x')).snapshot, 'both');
});

test('a close the gate refuses takes no picture', () => {
  const spy = spyCapture();
  const p = provide([rootEntry(), made('a', { closable: false })], { capture: spy });
  act(() => p.now().close('a'));
  act(() => p.now().close('nobody'));
  assert.deepEqual(spy.captured, []);
});

// ---------------------------------------------------------------------------
// The writers: applyTemplate 'create' and 'reconfigure'
// ---------------------------------------------------------------------------

function randomLayer(rng: Rng): PanelSettings {
  const layer: PanelSettings = {};
  if (chance(rng, 0.5)) layer.closable = chance(rng, 0.5);
  if (chance(rng, 0.5)) layer.parkable = chance(rng, 0.6);
  if (chance(rng, 0.3)) layer.listed = chance(rng, 0.5);
  if (chance(rng, 0.3)) layer.layer = pick(rng, ['base', 'raised'] as const);
  if (chance(rng, 0.3)) layer.enterFrom = pick(rng, ['auto', 'left', 'right', 'anchor'] as const);
  if (chance(rng, 0.4)) layer.slots = pick(rng, [1, 2, 3, 64] as const);
  if (chance(rng, 0.3)) layer.maxSlots = pick(rng, [1, 2, 64] as const);
  if (chance(rng, 0.3)) layer.title = pick(rng, ['A', 'B', 'C']);
  return layer;
}

test('create over 300 resolver-random entries writes every mirror field from the resolved settings', () => {
  const rng = mulberry32(31337);
  let checked = 0;
  for (let n = 0; n < 300; n += 1) {
    const resolved = resolvePanelSettings({ template: randomLayer(rng), instance: randomLayer(rng) }, { root: chance(rng, 0.1) }).value;
    const skeleton = appendPanel([], { url: 'https://x.example', title: 'X' }, `id${n}`, ROOT)[0]!;
    const entry = applyTemplate(skeleton, resolved, 'create');
    assert.equal(entry.locked, !resolved.closable, `#${n} locked`);
    assert.equal(entry.collapsible, resolved.parkable, `#${n} collapsible`);
    assert.equal(entry.listed, resolved.listed, `#${n} listed`);
    assert.equal(entry.layer, resolved.layer, `#${n} layer`);
    assert.equal(entry.slots, resolved.slots, `#${n} slots`);
    assert.deepEqual(entry.size, sizeOfSlots(resolved.slots), `#${n} size follows the slots`);
    assert.equal(entry.anchoredEnter, resolved.enterFrom === 'anchor', `#${n} anchoredEnter`);
    assert.ok(entry.settings === resolved, `#${n} the entry holds the resolved settings themselves`);
    assert.equal(entry.key, `id${n}`, `#${n} key`);
    assert.equal(entry.title, resolved.title ?? 'X', `#${n} title`);
    checked += 1;
  }
  assert.equal(checked, 300);
});

test('create sizes the entry from its slots: each count equals sizeOfSlots, which the row prices widths from', () => {
  for (const slots of [1, 2, 3, 64] as const) {
    const entry = made('a', { slots });
    assert.deepEqual(entry.size, sizeOfSlots(slots), `${slots}: the size literals in panelSettings.ts drifted from sizeOfSlots`);
  }
});

test('create keeps a size the entry already has for that slot count and replaces one for another count', () => {
  const skeleton = appendPanel([], { url: 'https://x.example', slots: 2 }, 'a', ROOT)[0]!;
  assert.ok(applyTemplate(skeleton, resolve({ slots: 2 }), 'create').size === skeleton.size, 'same count: the same size object');
  assert.deepEqual(applyTemplate(skeleton, resolve({ slots: 64 }), 'create').size, sizeOfSlots(64));
});

test("create over the library defaults equals appendPanel's literals", () => {
  const skeleton = appendPanel([], { url: 'https://x.example', title: 'X' }, 'a', ROOT)[0]!;
  const created = applyTemplate(skeleton, resolvePanelSettings().value, 'create');
  const { settings, key, ...rest } = created;
  assert.ok(settings !== undefined && key === 'a');
  assert.deepEqual(rest, { ...skeleton, slots: 1 }, 'every field appendPanel wrote is what create writes over the defaults, and the slot count the settings resolve to');
  assert.deepEqual([created.locked, created.collapsible, created.listed, created.layer, created.anchoredEnter, created.slots], [false, true, true, 'base', false, 1]);
});

test("create writes key from the entry's own key when it has one, else its id, and never touches the input", () => {
  const skeleton = appendPanel([], { url: 'https://x.example' }, 'a', ROOT)[0]!;
  const frozen = Object.freeze({ ...skeleton });
  assert.equal(applyTemplate(frozen, resolve(), 'create').key, 'a');
  assert.equal(applyTemplate({ ...skeleton, key: 'named' }, resolve(), 'create').key, 'named');
  assert.equal('key' in frozen, false, 'the input entry was not written to');
});

/** The keys whose value differs between two entries by reference. */
const changedKeys = (before: PanelWindow, after: PanelWindow): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => (before as unknown as Record<string, unknown>)[k] !== (after as unknown as Record<string, unknown>)[k]).sort();

test('reconfigure writes only locked, listed, layer, anchoredEnter, title, settings and collapsible, and leaves the slots, size, anchor, live, hostData and key alone', () => {
  const resized = setSlots(row(rootEntry(), made('a', {}, { hostData: { k: 1 } })), 'a', 2)[1]!;
  const dragged = movePanel(row(rootEntry(), resized, made('b')), 'a', 'right', ROOT).find((p) => p.id === 'a')!;
  for (const [label, entry] of [['a person-resized two-slot entry', resized], ['a dragged entry', dragged]] as const) {
    const next = applyTemplate(entry, resolve({ closable: false, listed: false, layer: 'raised', enterFrom: 'anchor', title: 'Renamed', slots: 64, parkable: false }), 'reconfigure');
    for (const kept of ['slots', 'size', 'anchor', 'live', 'hostData', 'key'] as const) {
      assert.ok(next[kept] === entry[kept], `${label}: ${kept} changed`);
    }
    assert.deepEqual(changedKeys(entry, next), ['anchoredEnter', 'collapsible', 'layer', 'listed', 'locked', 'settings', 'title']);
    assert.equal(next.slots, entry.slots, `${label}: still the slot count the person chose`);
  }
});

test('reconfigure leaves a hand-built entry without a key and rewrites collapsible only when the flip changes it', () => {
  const entry = hand('a');
  const same = applyTemplate(entry, resolve({ closable: false }), 'reconfigure');
  assert.equal('key' in same, false);
  assert.ok(same.collapsible === entry.collapsible);
  assert.equal(same.locked, true);
  const flipped = applyTemplate(entry, resolve({ parkable: false }), 'reconfigure');
  assert.equal(flipped.collapsible, false);
  assert.equal(flipped.live, true);
});

test('reconfigure never writes the key a create wrote', () => {
  const created = made('a');
  assert.equal(created.key, 'a');
  assert.ok(applyTemplate({ ...created, key: 'kept' }, resolve({ listed: false }), 'reconfigure').key === 'kept');
});

test("appendPanel, restorePanel and hydrateWorkspaceState never write a key, and a hand-built entry's key is its id", () => {
  const appended = appendPanel([], { url: 'https://a.example' }, 'a', ROOT);
  assert.equal('key' in appended[0]!, false);
  const closed = closePanel(appended, 'a', ROOT)!;
  assert.equal('key' in restorePanel(closed.remaining, closed.closed, closed.index, ROOT)[0]!, false);
  const hydrated = hydrateWorkspaceState(
    { version: 1, panels: [{ id: 's', view: 'web', url: 'https://s.example', live: true, anchor: { panel: ROOT, position: 'right', priority: 0 } }] },
    () => 'fresh',
    ROOT,
  );
  assert.equal('key' in hydrated[0]!, false);
  assert.equal(panelKey(appended[0]!), 'a');
  assert.equal(panelKey(made('b')), 'b');
  assert.equal(panelKey({ ...hand('c'), key: 'named' }), 'named');
});

test('a row of hand-built and created entries has unique names by `key ?? id`', () => {
  const panels = [rootEntry(), hand('h1'), hand('h2'), made('c1'), made('c2')];
  const names = panels.map(panelKey);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, ['root', 'h1', 'h2', 'c1', 'c2']);
});

// ---------------------------------------------------------------------------
// effective(): legacy defaults
// ---------------------------------------------------------------------------

test("effective of a hand-built collapsible entry has overflow 'park'", () => {
  assert.equal(effective(hand('a')).overflow, 'park');
});

test("effective of a hand-built fixed column has overflow 'scroll'", () => {
  assert.equal(effective(hand('a', { collapsible: false })).overflow, 'scroll');
});

test('effective of a hand-built entry has every key without a legacy field at its library default', () => {
  const eff = effective(hand('a')) as unknown as Record<string, unknown>;
  const fromFields = new Set(['closable', 'parkable', 'draggable', 'placeable', 'resizable', 'maxSlots', 'clearable', 'listed', 'overflow', 'layer', 'enterFrom', 'slots', 'title']);
  const derived = resolvePanelSettings().value as unknown as Record<string, unknown>;
  let compared = 0;
  for (const key of Object.keys(derived)) {
    if (fromFields.has(key)) continue;
    assert.deepEqual(eff[key], derived[key], `${key} is not its library default`);
    compared += 1;
  }
  assert.ok(compared > 30, `only ${compared} keys compared`);
  for (const key of ['closable', 'parkable', 'draggable', 'placeable', 'resizable', 'listed', 'clearable']) assert.equal(eff[key], true, `${key}: an ordinary hand-built entry is the library default`);
  assert.equal(eff.layer, LIBRARY_PANEL_DEFAULTS.layer);
});

test('effective of a hand-built entry reads its own legacy fields: locked, collapsible, listed, layer, anchoredEnter, slots and title', () => {
  const eff = effective(hand('a', { locked: true, listed: false, layer: 'raised', anchoredEnter: true, slots: 2, title: 'T' }));
  assert.deepEqual([eff.closable, eff.clearable, eff.listed, eff.layer, eff.enterFrom, eff.slots, eff.title], [false, false, false, 'raised', 'anchor', 2, 'T']);
  const fixed = effective(hand('f', { collapsible: false }));
  assert.deepEqual([fixed.parkable, fixed.draggable, fixed.placeable, fixed.resizable, fixed.clearable, fixed.maxSlots], [false, false, false, false, false, 1]);
});

test('effective is frozen and a hand-built entry with no title has no title key', () => {
  const eff = effective(hand('a', { title: undefined }));
  assert.ok(Object.isFrozen(eff));
  assert.equal('title' in eff, false);
});

test('effective returns the entry\'s own settings, reference-equal, when it has them', () => {
  const entry = made('a', { closable: false });
  assert.ok(effective(entry) === entry.settings);
  const { settings, ...summary } = entry;
  assert.ok(settings !== undefined);
  assert.ok(effective({ ...summary, settings }) === settings);
});

test('effective reads a row entry (no `listed` field) as listed for a parkable one and unlisted for a fixed one', () => {
  const { listed: _listed, ...asRowEntry } = hand('a');
  assert.equal(effective(asRowEntry).listed, true);
  const { listed: _fixedListed, ...fixedRowEntry } = hand('f', { collapsible: false });
  assert.equal(effective(fixedRowEntry).listed, false);
});

// ---------------------------------------------------------------------------
// The slot hooks
// ---------------------------------------------------------------------------

test('usePanelCapabilities in a row slot returns exactly closable, draggable, placeable, resizable and maxSlots, from that panel', () => {
  const read = mountRow(row(rootEntry(), made('a', { closable: false, resizable: false, maxSlots: 2 }), made('b')));
  assert.equal(read('a').keys, 'closable,draggable,placeable,resizable,maxSlots');
  assert.deepEqual(JSON.parse(read('a').caps!), { closable: false, draggable: true, placeable: true, resizable: false, maxSlots: 2 });
  assert.deepEqual(JSON.parse(read('b').caps!), { closable: true, draggable: true, placeable: true, resizable: true, maxSlots: 64 });
});

test('usePanelCapabilities outside a row returns the library defaults', () => {
  let seen: ReturnType<typeof usePanelCapabilities> | undefined;
  function Probe(): React.ReactElement {
    seen = usePanelCapabilities();
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  assert.deepEqual(seen, { closable: true, draggable: true, placeable: true, resizable: true, maxSlots: 64 });
  assert.deepEqual(Object.keys(seen!), ['closable', 'draggable', 'placeable', 'resizable', 'maxSlots']);
  assert.equal(seen!.maxSlots, LIBRARY_PANEL_DEFAULTS.maxSlots);
});

test('usePanelCapabilities for the root and a fixed column: not closable, draggable, placeable or resizable', () => {
  const read = mountRow(row(rootEntry(), made('f', { parkable: false })));
  const expected = { closable: false, draggable: false, placeable: false, resizable: false, maxSlots: 1 };
  assert.deepEqual(JSON.parse(read('root').caps!), expected);
  assert.deepEqual(JSON.parse(read('f').caps!), { ...expected, closable: true });
});

test('usePanelReorderEligible follows draggable, not collapsible', () => {
  const read = mountRow(row(rootEntry(), made('can'), made('cannot', { draggable: false }), made('fixed', { parkable: false })));
  assert.equal(read('can').reorder, 'true');
  assert.equal(read('cannot').reorder, 'false', 'parkable but not draggable');
  assert.equal(read('fixed').reorder, 'false');
  assert.equal(read('root').reorder, 'false');
});

test('usePanelReorderEligible and usePanelCloseEligible outside a row: reorder false, close true', () => {
  const seen: boolean[] = [];
  function Probe(): React.ReactElement {
    seen.push(usePanelReorderEligible(), usePanelCloseEligible());
    return React.createElement('output');
  }
  mount(React.createElement(Probe));
  assert.deepEqual(seen.slice(0, 2), [false, true]);
});

test('usePanelCloseEligible is false for a locked parkable entry and for a fixed column, true for an ordinary one', () => {
  const read = mountRow(row(rootEntry(), made('plain'), made('locked', { closable: false }), made('fixed', { parkable: false })));
  assert.equal(read('plain').close, 'true');
  assert.equal(read('locked').close, 'false');
  assert.equal(read('fixed').close, 'false');
});

test('a hand-built caller seeding { locked: true, collapsible: true }: clearAll keeps it and usePanelCloseEligible is false for it', () => {
  const p = provide([hand('root', { locked: true, collapsible: false, listed: false }), hand('locked', { locked: true }), hand('plain')]);
  act(() => p.now().clearAll());
  assert.deepEqual(p.ids(), ['root', 'locked']);
  cleanup();
  const read = mountRow([hand('root', { locked: true, collapsible: false, listed: false }), hand('locked', { locked: true }), hand('plain')]);
  assert.equal(read('locked').close, 'false');
  assert.equal(read('plain').close, 'true');
  assert.equal(read('locked').reorder, 'true', 'a locked panel may still be reordered');
});

test('a hand-built entry behaves as before: its close, move, resize and re-anchor guards read its legacy fields', () => {
  const panels = row(hand('root', { locked: true, collapsible: false, listed: false }), hand('a'), hand('f', { collapsible: false }), hand('b'));
  assert.ok(movePanel(panels, 'f', 'right', ROOT) === panels, 'a fixed column is never dragged');
  assert.ok(setSlots(panels, 'f', 2) === panels, 'nor resized');
  assert.ok(reanchorPanel(panels, 'f', { position: 'left' }, ROOT) === panels, 'nor re-anchored');
  assert.ok(setSlots(panels, 'a', 2) !== panels, 'an ordinary one is');
});
