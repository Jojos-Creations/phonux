/**
 * The scroll requests and the initial scroll, through a mounted provider and Workspace. The container's width is the
 * host's measurement (1000), so the window is 968 and a row of n phone panels has strip 406n - 16 and, flush at both ends,
 * maxScroll 406n - 984: 1452 at six panels, 1858 at seven and 3482 at eleven. The executor is observed through the
 * container's own scrollLeft once the glide has run, and through a spy on glideTo where a call count is the point. The row rests on
 * the one-phone grid, each inner rest moved back 86 to center the two whole panels it shows (0, 320, 726, 1132, then 1452 at six
 * panels), so a request lands on the stop nearest its raw target that shows the panel.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelSettings, PanelWindow, ProvidedPanels, WorkspaceTuning } from '../index.js';
import { LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { rowScrollerFor } from '../rowScroller.js';
import { projectWorkspaceState, type WorkspaceState, type WorkspaceStorage } from '../workspaceState.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow as mountScrollRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

/** The row [root a b c d e]: panel k starts at 16 + 406k (the gap, with no margin), and the stops are 0, 320, 726, 1132 and 1452. */
const sixPanels = (layer: PanelSettings = {}): PanelWindow[] => row(rootEntry(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id, layer)));

const mountRow = (o: { entries?: PanelWindow[]; over?: Parameters<typeof mountScrollRow>[2]; width?: number }): MountedRow => mountScrollRow(o.entries ?? sixPanels(), o.width ?? 1000, o.over);

/** Spies on the container's glideTo and returns the targets asked for since. */
function glides(container: HTMLElement) {
  const spy = mock.method(rowScrollerFor(container), 'glideTo');
  return () => spy.mock.calls.map((c) => c.arguments[0] as number);
}

/** Runs the glide in flight to its end. */
const settle = (): Promise<void> => advanceFrames(900);

test('scrollTo at each align scrolls to the stop nearest the literal target: panel c (left 1234) into view 640 -> 726, at the start 1218 -> 1132, centered 929 -> 726 (a tie with 1132, the earlier wins)', async () => {
  const expected = { 'into-view': 726, start: 1132, center: 726 } as const;
  for (const align of ['into-view', 'start', 'center'] as const) {
    const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'none' }) });
    const asked = glides(m.container);
    let recorded = false;
    act(() => {
      recorded = m.latest().scrollTo('c', align);
    });
    assert.equal(recorded, true);
    await settle();
    assert.deepEqual(asked(), [expected[align]], align);
    assert.equal(m.container.scrollLeft, expected[align]);
    cleanup();
  }
});

test('scrollTo with no align reads the panel scrollOnOpen, and into-view when that is none', async () => {
  const startAligned = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }) });
  act(() => void startAligned.latest().scrollTo('c'));
  await settle();
  assert.equal(startAligned.container.scrollLeft, 1132);
  cleanup();
  const none = mountRow({ entries: sixPanels({ scrollOnOpen: 'none' }) });
  act(() => void none.latest().scrollTo('c'));
  await settle();
  assert.equal(none.container.scrollLeft, 726, 'into-view targets 640, and 726 is the nearer stop that shows c');
});

test('a Host-bag create scrolls to the new panel at each scrollOnOpen, and none leaves scrollLeft where it is', async () => {
  for (const align of ['into-view', 'start', 'center'] as const) {
    const m = mountRow({ over: { workspaceDefaults: { scrollOnOpen: align } } });
    const asked = glides(m.container);
    act(() => m.latest().create({ view: 'scroll-row-view' }));
    await settle();
    assert.deepEqual(asked(), [1858], `${align}: the seventh panel is the strip end whatever the align`);
    assert.equal(m.container.scrollLeft, 1858);
    cleanup();
  }
  const none = mountRow({ over: { workspaceDefaults: { scrollOnOpen: 'none' } } });
  const asked = glides(none.container);
  act(() => none.latest().create({ view: 'scroll-row-view' }));
  await settle();
  assert.deepEqual(asked(), []);
  assert.equal(none.container.scrollLeft, 0);
});

test('the default scrollOnOpen is read from LIBRARY_PANEL_DEFAULTS', async () => {
  const m = mountRow({ entries: sixPanels(), over: { workspaceDefaults: {} } });
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  await settle();
  // The new panel starts at 2452; into-view targets 1858, the row's end and the only stop that shows it.
  assert.equal(LIBRARY_PANEL_DEFAULTS.scrollOnOpen, 'into-view');
  assert.equal(m.container.scrollLeft, 1858);
});

test('activate of a live panel out of view scrolls to it, and one already in view records nothing', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'into-view' }) });
  const asked = glides(m.container);
  act(() => m.latest().activate('a'));
  await settle();
  assert.deepEqual(asked(), [], 'a (left 422, right 812) is inside the window [16, 984]: changed false');
  act(() => m.latest().activate('d'));
  await settle();
  assert.deepEqual(asked(), [1132], 'd starts at 1640, so into-view targets 1640 + 390 - 1000 + 16 = 1046, and 1132 is the nearer stop that shows d');
  assert.equal(m.container.scrollLeft, 1132);
});

test('activate of a parked panel brings it live and scrolls to it', async () => {
  const entries = row(rootEntry(), made('a'), made('b'), made('c'), made('d'), made('e'), made('p', { overflow: 'park', scrollOnOpen: 'start' }, { live: false }));
  const m = mountRow({ entries });
  const asked = glides(m.container);
  act(() => m.latest().activate('p'));
  await settle();
  assert.deepEqual(m.latest().entries.filter((p) => p.live).map((p) => p.id), ['root', 'a', 'b', 'c', 'd', 'e', 'p']);
  assert.deepEqual(asked(), [1858], 'the seventh panel starts at 2452 and the strip ends at 1858');
});

test('an undo restoring a live panel scrolls to it; the close before it scrolls nothing', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'into-view' }) });
  const asked = glides(m.container);
  act(() => m.latest().close('c'));
  await settle();
  assert.deepEqual(asked(), []);
  act(() => m.latest().undoClose());
  await settle();
  assert.deepEqual(asked(), [726]);
  assert.equal(m.container.scrollLeft, 726);
});

test('two requests in one commit: the last wins', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'none' }) });
  const asked = glides(m.container);
  act(() => {
    m.latest().scrollTo('c', 'start');
    m.latest().scrollTo('d', 'center');
  });
  await settle();
  assert.deepEqual(asked(), [1452], 'd centered targets 1640 + 195 - 500 = 1335, and 1452 is the nearer stop that shows d (c at the start would be 1132)');
});

test('first paint and a restore record no request and raise no note', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }) });
  await settle();
  assert.equal(m.container.scrollLeft, 0);
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

test('a request for a panel the same commit adds runs at that commit', async () => {
  const m = mountRow({ over: { workspaceDefaults: { scrollOnOpen: 'none' } } });
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  const firstId = Number(m.latest().entries[m.latest().entries.length - 1]!.id);
  await settle();
  assert.equal(m.container.scrollLeft, 0, 'control: scrollOnOpen none scrolled nothing for the first create');
  act(() => {
    m.latest().create({ view: 'scroll-row-view' });
    m.latest().scrollTo(String(firstId + 1), 'start');
  });
  await settle();
  assert.equal(m.container.scrollLeft, 2264, 'the eighth panel starts past the strip end of 2264, which is the target it is clamped to');
  assert.deepEqual(m.notes, []);
});

test('while a claim is held a scrollTo returns false, a create is dropped, and both raise scroll-dropped-during-drag; the same request after the release runs', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }), over: { workspaceDefaults: {} } });
  const claim = rowScrollerFor(m.container).claim()!;
  let recorded = true;
  act(() => {
    recorded = m.latest().scrollTo('c');
  });
  assert.equal(recorded, false);
  act(() => m.latest().create({ view: 'scroll-row-view' }));
  await settle();
  assert.equal(m.container.scrollLeft, 0);
  assert.deepEqual(m.notes.map((n) => n.code), ['scroll-dropped-during-drag', 'scroll-dropped-during-drag']);
  claim.release();
  act(() => void m.latest().scrollTo('c'));
  await settle();
  assert.equal(m.container.scrollLeft, 1132);
});

test('the glide takes tuning.slide.durationSec: 0.4 s is 25 frames and 0.8 s is 50', async () => {
  for (const [seconds, frames] of [[0.4, 25], [0.8, 50]] as const) {
    const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }), over: { tuning: { slide: { durationSec: seconds } } } });
    act(() => void m.latest().scrollTo('c'));
    await advanceFrames((frames - 1) * 16);
    assert.ok(m.container.scrollLeft < 1132, `${seconds}s: not there a frame early`);
    await advanceFrames(16);
    assert.equal(m.container.scrollLeft, 1132, `${seconds}s: there on the frame`);
    cleanup();
  }
});

// --- scrollOnMove --------------------------------------------------------------------------------------------

const follow = async (layer: PanelSettings, from: number, run: (p: ProvidedPanels) => void): Promise<number> => {
  const m = mountRow({ entries: sixPanels(layer) });
  m.container.scrollLeft = from;
  act(() => run(m.latest()));
  await settle();
  return m.container.scrollLeft;
};

test('setSlots on an in-view panel follows it: a to two slots from 0 targets 234, and snaps to 320, the only stop that shows it whole', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 0, (p) => p.setSlots('a', 2)), 320);
});

test('setSlots on a panel out of view scrolls nothing', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 0, (p) => p.setSlots('e', 2)), 0);
});

test('reanchor of a panel in view to the left of the root follows it: c, partly in view at 406, lands at the strip start and the row scrolls to 0', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 406, (p) => p.reanchor('c', { panel: ROOT, position: 'left', priority: 0 })), 0);
});

test('scrollOnMove none records none, and the default reads LIBRARY_PANEL_DEFAULTS', async () => {
  assert.equal(await follow({ scrollOnMove: 'none' }, 0, (p) => p.setSlots('a', 2)), 0);
  const def = LIBRARY_PANEL_DEFAULTS.scrollOnMove;
  assert.equal(await follow({}, 0, (p) => p.setSlots('a', 2)), def === 'follow' ? 320 : 0);
});

test('a drag release (move) records none', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 406, (p) => p.move('c', 'left')), 406);
});

test('while a claim is held a follow request is dropped with the note, and the one after the release runs', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnMove: 'follow' }) });
  const claim = rowScrollerFor(m.container).claim()!;
  act(() => m.latest().setSlots('a', 2));
  await settle();
  assert.equal(m.container.scrollLeft, 0);
  assert.deepEqual(m.notes.map((n) => n.code), ['scroll-dropped-during-drag']);
  claim.release();
  act(() => m.latest().setSlots('a', 1));
  act(() => m.latest().setSlots('a', 2));
  await settle();
  assert.equal(m.container.scrollLeft, 320);
});

// --- initialScroll -------------------------------------------------------------------------------------------

/** History in the middle, five pinned panels to its left and five web panels to its right: eleven panels at 1000. */
function elevenPanels(): PanelWindow[] {
  const pinned = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => made(id));
  const web = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => made(id));
  return row(...pinned, rootEntry(), ...web);
}
const initial = (initialScroll: NonNullable<WorkspaceTuning['initialScroll']>): Parameters<typeof mountScrollRow>[2] => ({ tuning: { initialScroll } });

test('initialScroll with no storage runs at the first measured commit, to literal values: start 0, root 1944, end 3482, a panel by id 3162', () => {
  const expected: [NonNullable<WorkspaceTuning['initialScroll']>, number][] = [['start', 0], ['root', 1944], ['end', 3482], [{ panel: 'w3' }, 3162]];
  for (const [value, at] of expected) {
    const m = mountRow({ entries: elevenPanels(), over: initial(value) });
    assert.equal(m.container.scrollLeft, at, JSON.stringify(value));
    cleanup();
  }
});

test('initialScroll default reads the meaning of LIBRARY_TUNING_DEFAULTS.initialScroll', () => {
  const m = mountRow({ entries: elevenPanels() });
  assert.equal(LIBRARY_TUNING_DEFAULTS.initialScroll, 'start');
  assert.equal(m.container.scrollLeft, 0);
});

test('initialScroll root on a row of only History and five pinned panels clamps to its maximum, 1452', () => {
  const m = mountRow({ entries: row(...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => made(id)), rootEntry()), over: initial('root') });
  assert.equal(m.container.scrollLeft, 1452);
});

test('initialScroll falls back to start for a missing panel id and for a root-less row', () => {
  assert.equal(mountRow({ entries: elevenPanels(), over: initial({ panel: 'nope' }) }).container.scrollLeft, 0);
  cleanup();
  const rootless = row(...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((id) => made(id)));
  assert.equal(mountRow({ entries: rootless, over: initial('root') }).container.scrollLeft, 0);
});

test('initialScroll runs once: a later re-measure does not scroll', () => {
  const m = mountRow({ entries: elevenPanels(), over: initial('end') });
  assert.equal(m.container.scrollLeft, 3482);
  m.container.scrollLeft = 0;
  m.rerender(1100);
  assert.equal(m.container.scrollLeft, 0);
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

test('initialScroll root waits for the restore: scrollLeft stays 0 while only History exists, then rests on the stop nearest the start of History that shows it (1944)', async () => {
  const { m, resolve } = deferredRow('root');
  assert.equal(m.container.scrollLeft, 0);
  assert.equal(m.latest().entries.length, 1);
  await act(async () => {
    resolve();
  });
  assert.equal(m.latest().entries.length, 11);
  assert.equal(m.container.scrollLeft, 1944);
});

test('initialScroll end after the restore ends at 3482 with the two newest web panels in the window and History outside it', async () => {
  const { m, resolve } = deferredRow('end');
  assert.equal(m.container.scrollLeft, 0);
  await act(async () => {
    resolve();
  });
  const at = m.container.scrollLeft;
  assert.equal(at, 3482);
  const numbers = m.latest().rowNumbers;
  const left = (id: string): number => 16 + numbers.rowMarginLeft + numbers.leftOffsets[numbers.ids.indexOf(id)]!;
  const ids = numbers.ids;
  const newest = [ids[9]!, ids[10]!];
  assert.deepEqual(newest.map(left), [3670, 4076]);
  for (const id of newest) assert.ok(left(id) >= at && left(id) + 390 <= at + 1000, `${id} is inside [3482, 4482]`);
  assert.ok(left(ROOT) + 390 <= at, 'History (right edge 2436) is outside it');
});

test('initialScroll is skipped when a wheel or a pointer-down reached the row before the restore settled', async () => {
  for (const kind of ['wheel', 'pointerdown'] as const) {
    const { m, resolve } = deferredRow('end');
    act(() => void m.container.dispatchEvent(new Event(kind, { bubbles: true })));
    await act(async () => {
      resolve();
    });
    assert.equal(m.container.scrollLeft, 0, kind);
    cleanup();
  }
});

// --- a reload keeps the row's rest ---------------------------------------------------------------------------
//
// The row here scrolls in steps (overflow 'scroll', rowGesture 'step'): the eleven panels rest on the grid 0, 406, 812, ...,
// each inner rest moved back 86 to center the panels it shows, so a stop does not sit on a panel's left edge.
// The end is 3482. A panel as wide as the window (a two-slot panel at container 828) is the wide case.

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

test('a saved marker mounts the row at the stop that shows its panel whole, in one instant glide, and beats initialScroll', async () => {
  const { storage, saves, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning('end'));
  const spy = mock.method(rowScrollerFor(m.container), 'glideTo');
  await resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  assert.deepEqual(saves, [], 'control: opening saves nothing');
  // Panel 3 starts at 812; 726 is the stop nearest it that shows it.
  assert.equal(m.container.scrollLeft, 726);
  assert.equal(spy.mock.callCount(), 1, 'one glide, not one per step');
  assert.equal((spy.mock.calls[0]!.arguments[1] as { durationSec: number }).durationSec, 0);
});

test('a rest the person moved to saves a marker naming the first panel the window shows, and a reload restores the same stop', async () => {
  const first = scrollStorage();
  const m = loadedRow(first.storage, stepTuning());
  await first.resolve(savedOf(stepping()));
  m.wheel({ deltaX: 300 });
  await settle();
  await flushSaves();
  const rest = m.container.scrollLeft;
  assert.ok(rest > 0, 'control: the wheel moved the row off the first stop');
  const n = m.latest().rowNumbers;
  const k = n.stops.indexOf(rest);
  assert.ok(k >= 0, 'the row rests on a stop');
  const saved = first.saves.at(-1);
  assert.ok(saved?.scroll, 'a marker is saved once the row is at rest');
  const shown = n.stopSpans[k]!.first;
  assert.equal(saved.scroll!.panel, m.latest().entries.find((p) => p.id === n.ids[shown])?.uid, 'the marker names the panel by its uid');
  assert.ok(Math.abs(saved.scroll!.offset - (rest - (n.rowMarginLeft + n.leftOffsets[shown]!)) / 406) < 1e-9);

  const second = scrollStorage();
  const reloaded = loadedRow(second.storage, stepTuning());
  await second.resolve(saved);
  assert.equal(reloaded.container.scrollLeft, rest, 'the saved panel uid is mapped to the id it has in this launch');
});

test('opening a file with a marker, and one without, saves nothing past the quiet period', async () => {
  for (const scroll of [{ panel: 'p3', offset: 0 }, undefined]) {
    const { storage, saves, resolve } = scrollStorage();
    const m = loadedRow(storage, stepTuning());
    await resolve(savedOf(stepping(), scroll));
    await settle();
    await flushSaves();
    assert.deepEqual(saves, [], JSON.stringify(scroll));
    assert.equal(m.container.scrollLeft, scroll === undefined ? 0 : 726);
    cleanup();
  }
});

test('a marker whose panel is gone falls back to initialScroll', async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning('end'));
  await resolve(savedOf(stepping(), { panel: 'nope', offset: 0 }));
  assert.equal(m.container.scrollLeft, 3482, 'the end of the strip');
});

test("a marker in a row with no stops (rowGesture 'off', which keeps no grid) falls back to initialScroll", async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, { tuning: { rowGesture: 'off', initialScroll: 'end' } });
  await resolve(savedOf(elevenPanels(), { panel: 'p3', offset: 0 }));
  assert.equal(m.container.scrollLeft, 3482);
});

test('a wheel before a marker restores settles leaves the row where the wheel put it', async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning());
  act(() => void m.container.dispatchEvent(new Event('wheel', { bubbles: true })));
  await resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  assert.equal(m.container.scrollLeft, 0);
});

test('a malformed marker is dropped with a note, not thrown, and the restore reads as with no marker', async () => {
  for (const scroll of [{ panel: 7, offset: 0 }, { panel: 'p3', offset: 'far' }]) {
    const { storage, resolve } = scrollStorage();
    const m = loadedRow(storage, stepTuning());
    await resolve(savedOf(stepping(), scroll));
    assert.equal(m.latest().entries.length, 11, 'the file still restores its ten panels beside History');
    assert.equal(m.container.scrollLeft, 0, JSON.stringify(scroll));
    assert.ok(m.notes.some((n) => n.code === 'invalid-saved-setting' && n.key === 'scroll'), JSON.stringify(m.notes));
    cleanup();
  }
});

test('a window resized between launches lands on a stop that shows the marker panel', async () => {
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning(), 1100);
  await resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  const n = m.latest().rowNumbers;
  const k = n.stops.indexOf(m.container.scrollLeft);
  assert.ok(k >= 0, 'on a stop');
  const idx = n.ids.indexOf(idOfTitle(m, 'p3'));
  assert.ok(n.stopSpans[k]!.first <= idx && idx < n.stopSpans[k]!.end, 'the stop shows panel 3');
});

test('two rows each restore their own marker', async () => {
  const a = scrollStorage();
  const b = scrollStorage();
  const first = loadedRow(a.storage, stepTuning());
  const second = loadedRow(b.storage, stepTuning());
  await a.resolve(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  await b.resolve(savedOf(stepping(), { panel: 'w2', offset: 0 }));
  assert.equal(first.container.scrollLeft, 726);
  assert.equal(second.container.scrollLeft, nearestShowing(second, 'w2'), 'the second row lands on a stop showing w2, not the first row\'s stop');
  assert.notEqual(second.container.scrollLeft, first.container.scrollLeft);
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

test('a panel as wide as the window: a marker one phone width into it restores inside the panel, not at its left edge', async () => {
  const S = SCROLLING;
  const entries = row(made('p1', S), made('desk', { ...S, slots: 2 }), made('p2', S), made('p3', S), rootEntry());
  const { storage, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning(), 828);
  // The desk starts at 406 (one phone, with no margin) and is 796 wide, the window's width. One phone width in is 812, a stop.
  await resolve(savedOf(entries, { panel: 'desk', offset: 1 }));
  assert.equal(m.container.scrollLeft, 812);
  assert.ok(m.container.scrollLeft > 406, 'the rest is inside the desk, past its left edge');
});
