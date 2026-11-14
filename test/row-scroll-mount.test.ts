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
import { setRowOffset, rowOffsetOf, rowGlideTargetOf, stubSlotBoxes, advanceUntilRowRests } from './support/strip.js';
import { emblaStripOf } from '../emblaRow.js';
import { act } from 'react';
import type { PanelSettings, PanelWindow, ProvidedPanels, WorkspaceTuning } from '../index.js';
import { LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
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
  const m = mountRow({ over: { workspaceDefaults: { startVisibility: 'parked' } } });
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

const SCROLLING = {};
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

/** The Embla row of `m` laid out by the stub (its window at 16 on screen) and given time to start and draw. */
async function layOut(m: MountedRow): Promise<void> {
  stubSlotBoxes(m.container, 16);
  await advanceFrames(32);
}

/** A launch from the file `state`, laid out at `width`: `before` runs between the mount and the load's answer. */
async function launch(state: WorkspaceState, o: { initialScroll?: NonNullable<WorkspaceTuning['initialScroll']>; width?: number; before?: (m: MountedRow) => void } = {}): Promise<{ m: MountedRow; saves: WorkspaceState[] }> {
  const { storage, saves, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning(o.initialScroll ?? 'start'), o.width ?? 1000);
  o.before?.(m);
  await resolve(state);
  await layOut(m);
  return { m, saves };
}

test('a wheel before a marker restores settles leaves the row where the wheel put it', async () => {
  const file = savedOf(stepping(), { panel: 'p3', offset: 0 });
  const wheeled = await launch(file, { before: (m) => void m.container.dispatchEvent(new Event('wheel', { bubbles: true })) });
  assert.equal(rowOffsetOf(wheeled.m.container), 0);
  cleanup();
  // Control: the same file with no wheel first starts the laid-out row at the marker.
  const plain = await launch(file);
  assert.ok(rowOffsetOf(plain.m.container) > 0, `control: the marker moves the row (${rowOffsetOf(plain.m.container)})`);
});

test('a malformed marker is dropped with a note, not thrown, and the restore reads as with no marker', async () => {
  for (const scroll of [{ panel: 7, offset: 0 }, { panel: 'p3', offset: 'far' }]) {
    const { m } = await launch(savedOf(stepping(), scroll));
    assert.equal(m.latest().entries.length, 11, 'the file still restores its ten panels beside History');
    assert.equal(rowOffsetOf(m.container), 0, JSON.stringify(scroll));
    assert.ok(m.notes.some((n) => n.code === 'invalid-saved-setting' && n.key === 'scroll'), JSON.stringify(m.notes));
    cleanup();
  }
  // Control: a well-formed marker on the same laid-out row does move it.
  const { m } = await launch(savedOf(stepping(), { panel: 'p3', offset: 0 }));
  assert.ok(rowOffsetOf(m.container) > 0, 'control: a good marker starts the row past 0');
  assert.ok(!m.notes.some((n) => n.code === 'invalid-saved-setting'), 'control: and raises no note');
});

/** Whether the slot of the panel titled `title` is drawn whole inside the Embla row's window (at 16 on screen). */
function wholeOnScreen(m: MountedRow, title: string): boolean {
  const slot = m.container.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${idOfTitle(m, title)}"]`)!.getBoundingClientRect();
  const width = emblaStripOf(m.container)!.windowWidth;
  return slot.left >= 16 - 0.5 && slot.right <= 16 + width + 0.5;
}

test('a window resized between launches lands on a stop that shows the marker panel', async () => {
  const { m } = await launch(savedOf(stepping(), { panel: 'p3', offset: 0 }), { width: 1100 });
  assert.equal(rowGlideTargetOf(m.container), null, 'on a stop, not on its way');
  assert.ok(wholeOnScreen(m, 'p3'), `p3 is shown whole at ${rowOffsetOf(m.container)}`);
  cleanup();
  // Control: with no marker the row starts at 0, where p3 is not shown whole.
  const none = await launch(savedOf(stepping()), { width: 1100 });
  assert.ok(!wholeOnScreen(none.m, 'p3'), 'control: at the start p3 is out of view');
});

test('a person who moves the row has its rest saved, and a relaunch from the stored file starts there', async () => {
  const first = await launch(savedOf(stepping()));
  assert.equal(rowOffsetOf(first.m.container), 0, 'the row starts at 0');
  for (let n = 0; n < 3; n += 1) first.m.key('ArrowRight');
  await advanceUntilRowRests(first.m.container);
  await advanceFrames(300);
  await flushSaves();
  const at = rowOffsetOf(first.m.container);
  assert.ok(at > 0, `the keys moved the row: ${at}`);
  const stored = first.saves.at(-1);
  assert.ok(stored?.scroll !== undefined, `the rest is saved: ${JSON.stringify(first.saves.map((s) => s.scroll))}`);
  const shown = first.m.latest().entries.filter((p) => p.title !== undefined && wholeOnScreen(first.m, p.title)).map((p) => p.title);
  cleanup();
  const again = await launch(stored!);
  assert.equal(rowOffsetOf(again.m.container), at, 'the relaunch starts at the stop the person left it on');
  assert.equal(rowGlideTargetOf(again.m.container), null, 'drawn there, not gliding to it');
  assert.deepEqual(again.m.latest().entries.filter((p) => p.title !== undefined && wholeOnScreen(again.m, p.title)).map((p) => p.title), shown, 'the same panels are in view');
  cleanup();
  // Control: the same file without its rest starts at 0.
  const { scroll: _dropped, ...bare } = stored!;
  const none = await launch(bare as WorkspaceState);
  assert.equal(rowOffsetOf(none.m.container), 0, 'control: with no saved rest the row starts at 0');
});

test('a press on the row that moves nothing saves no rest', async () => {
  const { m, saves } = await launch(savedOf(stepping()));
  const win = m.container.querySelector<HTMLElement>('[data-row-embla-window]')!;
  act(() => void win.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  act(() => void win.ownerDocument.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 })));
  await advanceFrames(400);
  await flushSaves();
  assert.ok(saves.every((s) => s.scroll === undefined), JSON.stringify(saves.map((s) => s.scroll)));
  // Control: a key step on the same row is saved.
  m.key('ArrowRight');
  await advanceUntilRowRests(m.container);
  await advanceFrames(300);
  await flushSaves();
  assert.ok(saves.at(-1)?.scroll !== undefined, 'control: a step that moved the row is saved');
});

/** The id a panel of `m` has this launch, found by the title `made` gives it (restored panels get fresh ids). */
const idOfTitle = (m: MountedRow, title: string): string => m.latest().entries.find((p) => p.title === title)!.id;

/** The left on screen of the slot drawn for the panel titled `title`: the stubbed window starts at 16. */
const slotLeftOf = (m: MountedRow, title: string): number => m.container.querySelector<HTMLElement>(`[data-row-slot][data-row-id="${idOfTitle(m, title)}"]`)!.getBoundingClientRect().left;

/** A launch from the file `state` with `tuning.initialScroll` 'end', laid out at 1000: where its Embla row starts, and the file it saves. */
async function launchFrom(state: WorkspaceState): Promise<{ m: MountedRow; at: number; glide: number | null; saves: WorkspaceState[] }> {
  const { storage, saves, resolve } = scrollStorage();
  const m = loadedRow(storage, stepTuning('end'));
  await resolve(state);
  stubSlotBoxes(m.container, 16);
  await advanceFrames(32);
  await flushSaves();
  return { m, at: rowOffsetOf(m.container), glide: rowGlideTargetOf(m.container), saves };
}

test('a saved rest restores on relaunch: the Embla row starts at the panel and offset it names, with no glide, over initialScroll', async () => {
  // The previous launch left the row with w2 at the window's left edge.
  const file = savedOf(stepping(), { panel: 'w2', offset: 0 });
  const first = await launchFrom(file);
  assert.equal(first.glide, null, 'with no glide: the row is drawn there, not on its way');
  assert.ok(first.at > 0, `the row starts at the saved rest, not at 0: ${first.at}`);
  assert.equal(slotLeftOf(first.m, 'w2'), 16, 'w2 starts at the window: the stop the rest names');
  // A launch that only restores writes nothing (its baseline is the file); any save it does make keeps the rest.
  assert.ok(first.saves.every((s) => s.scroll?.offset === 0), JSON.stringify(first.saves.map((s) => s.scroll)));
  cleanup();
  // Relaunch from what the storage holds now: the row rests at the same panel again.
  const again = await launchFrom(first.saves.at(-1) ?? file);
  assert.equal(again.at, first.at, 'a relaunch from the saved file starts at the same stop');
  assert.equal(slotLeftOf(again.m, 'w2'), 16);
  assert.equal(again.glide, null);
  cleanup();
  // Control: with no saved rest, initialScroll 'end' takes the row to its end, which is not where the rest put it.
  const none = await launchFrom(savedOf(stepping()));
  assert.ok(none.at > first.at, `control: with no saved rest the row starts at its end (${none.at}), past the rest (${first.at})`);
});
