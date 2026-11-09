/**
 * The scroll requests and the initial scroll, through a mounted provider and Workspace. The container's width is the
 * host's measurement (1000), so the window is 968 and a row of n phone panels has strip 406n - 16 and, with 86 of centering
 * at both ends, maxScroll 406n - 812: 1624 at six panels, 2030 at seven and 3654 at eleven. The executor is observed through the
 * container's own scrollLeft once the glide has run, and through a spy on glideTo where a call count is the point. The row rests on
 * the one-phone grid, every rest centering the two whole panels it shows (0, 406, 812, 1218, then 1624 at six panels), so a
 * request lands on the stop nearest its raw target that shows the panel.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { setRowOffset, rowOffsetOf } from './support/strip.js';
import { act } from 'react';
import type { PanelSettings, PanelWindow, ProvidedPanels, WorkspaceTuning } from '../index.js';
import { LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { rowScrollerFor } from '../rowScroller.js';
import { projectWorkspaceState, type WorkspaceState, type WorkspaceStorage } from '../workspaceState.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow as mountScrollRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

/** The row [root a b c d e]: panel k starts at 102 + 406k (the gap and the 86 centering margin), and the stops are 0, 406, 812, 1218 and 1624. */
const sixPanels = (layer: PanelSettings = {}): PanelWindow[] => row(rootEntry(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id, layer)));

const mountRow = (o: { entries?: PanelWindow[]; over?: Parameters<typeof mountScrollRow>[2]; width?: number }): MountedRow => mountScrollRow(o.entries ?? sixPanels(), o.width ?? 1000, o.over);

/** Spies on the container's glideTo and returns the targets asked for since. */
function glides(container: HTMLElement) {
  const spy = mock.method(rowScrollerFor(container), 'glideTo');
  return () => spy.mock.calls.map((c) => c.arguments[0] as number);
}

/** Runs the glide in flight to its end. */
const settle = (): Promise<void> => advanceFrames(900);

test('first paint and a restore record no request and raise no note', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }) });
  await settle();
  assert.equal(rowOffsetOf(m.container), 0);
  assert.equal(rowScrollerFor(m.container).glideTarget(), null);
  assert.deepEqual(m.notes, []);
});

test('a panel created hidden records none and raises no waiting-request note', async () => {
  const m = mountRow({ over: { workspaceDefaults: { startVisibility: 'parked', overflow: 'park' } } });
  const asked = glides(m.container);
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  await settle();
  assert.deepEqual(m.latest().entries.filter((p) => p.collapsible && !p.live).length, 1, 'control: the new panel is parked');
  assert.deepEqual(asked(), []);
  assert.deepEqual(m.notes, []);
});

test('a request for a panel the row never gets drops with a scroll-request-dropped note after two commits, and scrolls nothing', async () => {
  const m = mountRow({});
  const asked = glides(m.container);
  let recorded = false;
  act(() => {
    recorded = m.latest().scrollTo('nope');
  });
  await settle();
  assert.equal(recorded, true);
  assert.deepEqual(asked(), []);
  assert.deepEqual(m.notes.map((n) => [n.code, n.panelId]), [['scroll-request-dropped', 'nope']]);
});

// --- scrollOnMove --------------------------------------------------------------------------------------------

const follow = async (layer: PanelSettings, from: number, run: (p: ProvidedPanels) => void): Promise<number> => {
  const m = mountRow({ entries: sixPanels(layer) });
  setRowOffset(m.container, from);
  act(() => run(m.latest()));
  await settle();
  return rowOffsetOf(m.container);
};

test('setSlots on a panel out of view scrolls nothing', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 0, (p) => p.setSlots('e', 2)), 0);
});

test('a drag release (move) records none', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 406, (p) => p.move('c', 'left')), 406);
});

// --- initialScroll -------------------------------------------------------------------------------------------

/** History in the middle, five pinned panels to its left and five web panels to its right: eleven panels at 1000. */
function elevenPanels(): PanelWindow[] {
  const pinned = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => made(id));
  const web = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => made(id));
  return row(...pinned, rootEntry(), ...web);
}
const initial = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']>): Parameters<typeof mountScrollRow>[2] => ({ tuning: { initialScroll } });

test('initialScroll default reads the meaning of LIBRARY_TUNING_DEFAULTS.initialScroll', () => {
  const m = mountRow({ entries: elevenPanels() });
  assert.equal(LIBRARY_TUNING_DEFAULTS.initialScroll, 'start');
  assert.equal(rowOffsetOf(m.container), 0);
});

test('initialScroll falls back to start for a missing panel id and for a root-less row', () => {
  assert.equal(rowOffsetOf(mountRow({ entries: elevenPanels(), over: initial({ panel: 'nope' }) }).container), 0);
  cleanup();
  const rootless = row(...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => made(id)));
  assert.equal(rowOffsetOf(mountRow({ entries: rootless, over: initial('root') }).container), 0);
});

/** A saved workspace of five pinned and five web panels (History is the host's root, not in the file). */
function savedState(): WorkspaceState {
  const row11 = elevenPanels();
  const state = projectWorkspaceState(row11, ROOT);
  return { ...state, panels: state.panels.map((p) => ({ ...p, view: 'scroll-row-view' })) };
}

function deferredStorage(): { storage: WorkspaceStorage; resolve: () => void } {
  let release: (state: WorkspaceState) => void = () => undefined;
  const loaded = new Promise<WorkspaceState | null>((resolve) => {
    release = resolve;
  });
  return { storage: { load: () => loaded, save: () => undefined }, resolve: () => release(savedState()) };
}

const deferredRow = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']>) => {
  const { storage, resolve } = deferredStorage();
  const m = mountRow({ entries: [rootEntry()], over: { storage, workspaceDefaults: {}, tuning: { initialScroll } } });
  return { m, resolve };
};

test('initialScroll is skipped when a wheel or a pointer-down reached the row before the restore settled', async () => {
  for (const kind of ['wheel', 'pointerdown'] as const) {
    const { m, resolve } = deferredRow('end');
    act(() => void m.container.dispatchEvent(new Event(kind, { bubbles: true })));
    await act(async () => {
      resolve();
    });
    assert.equal(rowOffsetOf(m.container), 0, kind);
    cleanup();
  }
});

// --- a reload keeps the row's rest ---------------------------------------------------------------------------
//
// The row here scrolls in steps (overflow 'scroll', rowGesture 'step'): the eleven panels rest on the grid 0, 406, 812, ...,
// with 86 of centering before the strip, so a stop does not sit on a panel's left edge. The end is 3654. A panel as wide as the window (a two-slot panel at container 828) is the wide case.

const SCROLLING = { overflow: 'scroll' } as const;
const stepping = (): PanelWindow[] => row(...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => made(id, SCROLLING)), rootEntry(), ...['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => made(id, SCROLLING)));
const stepTuning = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']> = 'start'): Parameters<typeof mountScrollRow>[2] => ({ tuning: { rowGesture: 'step', initialScroll, saveQuietMs: 5 } });
/** Lets the save timer (real time, so not the frame clock) fire. */
const flushSaves = (): Promise<void> => act(async () => void (await new Promise((r) => setTimeout(r, 60))));

/** The saved form of `entries`, with the marker the test gives (or none). */
function savedOf(entries: PanelWindow[], scroll?: { panel: unknown; offset: unknown }): WorkspaceState {
  const state = projectWorkspaceState(entries, ROOT);
  // The marker names a panel by its uid in a file; a test gives the entry's id.
  const named = scroll === undefined ? undefined : { ...scroll, panel: entries.find((p) => p.id === scroll.panel)?.uid ?? scroll.panel };
  return named === undefined ? state : ({ ...state, scroll: named } as WorkspaceState);
}

/** A storage whose load waits for the test, and whose saves are recorded. */
function scrollStorage(): { storage: WorkspaceStorage; saves: WorkspaceState[]; resolve: (state: WorkspaceState | null) => Promise<void> } {
  const saves: WorkspaceState[] = [];
  let release: (state: WorkspaceState | null) => void = () => undefined;
  const loaded = new Promise<WorkspaceState | null>((resolve) => {
    release = resolve;
  });
  return {
    storage: { load: () => loaded, save: (state) => void saves.push(structuredClone(state)) },
    saves,
    resolve: (state) =>
      act(async () => {
        release(state);
      }),
  };
}

/** The row mounted with `entries` as its seed (History only, so the file supplies the rest) and the storage given. */
const loadedRow = (storage: WorkspaceStorage, tuning: Parameters<typeof mountScrollRow>[2], width = 1000, seed: PanelWindow[] = [rootEntry()]): MountedRow => mountScrollRow(seed, width, { storage, workspaceDefaults: {}, ...tuning });

test('a wheel before a marker restores settles leaves the row where the wheel put it', async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning());
  act(() => void m.container.dispatchEvent(new Event('wheel', { bubbles: true })));
  await resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  assert.equal(rowOffsetOf(m.container), 0);
});

test('a malformed marker is dropped with a note, not thrown, and the restore reads as with no marker', async () => {
  for (const scroll of [{ panel: 7, offset: 0 }, { panel: 'p3', offset: 'far' }]) {
    const { storage, resolve } = scrollStorage();
    const m = loadedRow(storage, stepTuning());
    await resolve(savedOf(stepping(), scroll));
    assert.equal(m.latest().entries.length, 11, 'the file still restores its ten panels beside History');
    assert.equal(rowOffsetOf(m.container), 0, JSON.stringify(scroll));
    assert.ok(m.notes.some((n) => n.code === 'invalid-saved-setting' && n.key === 'scroll'), JSON.stringify(m.notes));
    cleanup();
  }
});

test('a window resized between launches lands on a stop that shows the marker panel', async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning(), 1100);
  await resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  const n = m.latest().rowNumbers;
  const k = n.stops.indexOf(rowOffsetOf(m.container));
  assert.ok(k >= 0, 'on a stop');
  const idx = n.ids.indexOf(idOfTitle(m, 'p3'));
  assert.ok(n.stopSpans[k]!.first <= idx && idx < n.stopSpans[k]!.end, 'the stop shows panel 3');
});

/** The id a panel of `m` has this launch, found by the title `made` gives it (restored panels get fresh ids). */
const idOfTitle = (m: MountedRow, title: string): string => m.latest().entries.find((p) => p.title === title)!.id;

/** The stop of `m` nearest to where the panel titled `title` starts, among the stops that show it. */
function nearestShowing(m: MountedRow, title: string): number {
  const n = m.latest().rowNumbers;
  const idx = n.ids.indexOf(idOfTitle(m, title));
  const left = n.rowMarginLeft + n.leftOffsets[idx]!;
  let best = Number.NaN;
  for (const [k, stop] of n.stops.entries()) {
    if (idx < n.stopSpans[k]!.first || idx >= n.stopSpans[k]!.end) continue;
    if (Number.isNaN(best) || Math.abs(stop - left) < Math.abs(best - left)) best = stop;
  }
  return best;
}

