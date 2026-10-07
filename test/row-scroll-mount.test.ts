/**
 * The scroll requests and the initial scroll, through a mounted provider and Workspace. The container's width is the
 * host's measurement (1000), so the window is 968 and a row of n phone panels has strip 406n - 16: maxScroll is
 * 1452 at six panels, 1858 at seven and 3482 at eleven. The executor is observed through the container's own
 * scrollLeft once the glide has run, and through a spy on glideTo where a call count is the point.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import { act } from 'react';
import type { PanelSettings, PanelWindow, PanelsInput, ProvidedPanels } from '../index.js';
import { LIBRARY_PANEL_DEFAULTS, LIBRARY_TUNING_DEFAULTS } from '../panelSettings.js';
import { rowScrollerFor } from '../rowScroller.js';
import { scrollTargetFor } from '../scrollTargets.js';
import { projectWorkspaceState, type WorkspaceState, type WorkspaceStorage } from '../workspaceState.js';
import { advanceFrames, cleanup } from './support/mount-harness.js';
import { ROOT, made, mountRow as mountScrollRow, rootEntry, row, type MountedRow } from './support/scroll-row.js';

afterEach(() => cleanup());

/** The row [root a b c d e]: panel k starts at 16 + 406k. */
const sixPanels = (layer: PanelSettings = {}): PanelWindow[] => row(rootEntry(), ...['a', 'b', 'c', 'd', 'e'].map((id) => made(id, layer)));

const mountRow = (o: { entries?: PanelWindow[]; over?: Partial<PanelsInput>; width?: number }): MountedRow => mountScrollRow(o.entries ?? sixPanels(), o.width ?? 1000, o.over);

/** Spies on the container's glideTo and returns the targets asked for since. */
function glides(container: HTMLElement) {
  const spy = mock.method(rowScrollerFor(container), 'glideTo');
  return () => spy.mock.calls.map((c) => c.arguments[0] as number);
}

/** Runs the glide in flight to its end. */
const settle = (): Promise<void> => advanceFrames(900);

test('scrollTo at each align scrolls to the literal target: panel c (left 1234) into view 640, at the start 1218, centred 929', async () => {
  const expected = { 'into-view': 640, start: 1218, center: 929 } as const;
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
  assert.equal(startAligned.container.scrollLeft, 1218);
  cleanup();
  const none = mountRow({ entries: sixPanels({ scrollOnOpen: 'none' }) });
  act(() => void none.latest().scrollTo('c'));
  await settle();
  assert.equal(none.container.scrollLeft, 640);
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
  const k = 6;
  const expected = scrollTargetFor({ left: 16 + 406 * k, width: 390, scrollLeft: 0, clientWidth: 1000, maxScroll: 1858, gap: 16, align: LIBRARY_PANEL_DEFAULTS.scrollOnOpen as 'into-view' });
  assert.equal(m.container.scrollLeft, expected);
});

test('activate of a live panel out of view scrolls to it, and one already in view records nothing', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'into-view' }) });
  const asked = glides(m.container);
  act(() => m.latest().activate('a'));
  await settle();
  assert.deepEqual(asked(), [], 'a (left 422, right 812) is inside the window [16, 984]: changed false');
  act(() => m.latest().activate('d'));
  await settle();
  assert.deepEqual(asked(), [1046], 'd starts at 1640: 1640 + 390 - 1000 + 16');
  assert.equal(m.container.scrollLeft, 1046);
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
  assert.deepEqual(asked(), [640]);
  assert.equal(m.container.scrollLeft, 640);
});

test('two requests in one commit: the last wins', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'none' }) });
  const asked = glides(m.container);
  act(() => {
    m.latest().scrollTo('c', 'start');
    m.latest().scrollTo('d', 'center');
  });
  await settle();
  assert.deepEqual(asked(), [1640 + 195 - 500]);
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
  assert.equal(m.container.scrollLeft, 2264, 'the eighth panel starts past the strip end of 2264');
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
  assert.equal(m.container.scrollLeft, 1218);
});

test('instant under animated:false: the target is reached with no frame advanced', () => {
  const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start', animated: false }) });
  act(() => void m.latest().scrollTo('c'));
  assert.equal(m.container.scrollLeft, 1218);
});

test('the glide takes tuning.slide.durationSec: 0.4 s is 25 frames and 0.8 s is 50', async () => {
  for (const [seconds, frames] of [[0.4, 25], [0.8, 50]] as const) {
    const m = mountRow({ entries: sixPanels({ scrollOnOpen: 'start' }), over: { tuning: { slide: { durationSec: seconds } } } });
    act(() => void m.latest().scrollTo('c'));
    await advanceFrames((frames - 1) * 16);
    assert.ok(m.container.scrollLeft < 1218, `${seconds}s: not there a frame early`);
    await advanceFrames(16);
    assert.equal(m.container.scrollLeft, 1218, `${seconds}s: there on the frame`);
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

test('setFormFactor on an in-view panel scrolls the least distance that shows it whole: b to tablet from 0 ends at 206', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 0, (p) => p.setFormFactor('a', 'tablet')), 206);
});

test('setFormFactor on a panel out of view scrolls nothing', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 0, (p) => p.setFormFactor('e', 'tablet')), 0);
});

test('reanchor of a panel in view to the left of the root follows it: c, half in view at 406, lands at the strip start and the row scrolls to 0', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 406, (p) => p.reanchor('c', { panel: ROOT, position: 'left', priority: 0 })), 0);
});

test('scrollOnMove none records none, and the default reads LIBRARY_PANEL_DEFAULTS', async () => {
  assert.equal(await follow({ scrollOnMove: 'none' }, 0, (p) => p.setFormFactor('a', 'tablet')), 0);
  const def = LIBRARY_PANEL_DEFAULTS.scrollOnMove;
  assert.equal(await follow({}, 0, (p) => p.setFormFactor('a', 'tablet')), def === 'follow' ? 206 : 0);
});

test('a drag release (move) records none', async () => {
  assert.equal(await follow({ scrollOnMove: 'follow' }, 406, (p) => p.move('c', 'left')), 406);
});

test('while a claim is held a follow request is dropped with the note, and the one after the release runs', async () => {
  const m = mountRow({ entries: sixPanels({ scrollOnMove: 'follow' }) });
  const claim = rowScrollerFor(m.container).claim()!;
  act(() => m.latest().setFormFactor('a', 'tablet'));
  await settle();
  assert.equal(m.container.scrollLeft, 0);
  assert.deepEqual(m.notes.map((n) => n.code), ['scroll-dropped-during-drag']);
  claim.release();
  act(() => m.latest().setFormFactor('a', 'phone'));
  act(() => m.latest().setFormFactor('a', 'tablet'));
  await settle();
  assert.equal(m.container.scrollLeft, 206);
});

// --- initialScroll -------------------------------------------------------------------------------------------

/** History in the middle, five pinned panels to its left and five web panels to its right: eleven panels at 1000. */
function elevenPanels(): PanelWindow[] {
  const pinned = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => made(id));
  const web = ['w1', 'w2', 'w3', 'w4', 'w5'].map((id) => made(id));
  return row(...pinned, rootEntry(), ...web);
}
const initial = (initialScroll: NonNullable<PanelsInput['tuning']>['initialScroll']): Partial<PanelsInput> => ({ tuning: { initialScroll } });

test('initialScroll with no storage runs at the first measured commit, to literal values: start 0, root 2030, end 3482, a panel by id 3248', () => {
  const expected: [NonNullable<PanelsInput['tuning']>['initialScroll'], number][] = [['start', 0], ['root', 2030], ['end', 3482], [{ panel: 'w3' }, 3248]];
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

const deferredRow = (initialScroll: NonNullable<PanelsInput['tuning']>['initialScroll']) => {
  const { storage, resolve } = deferredStorage();
  const m = mountRow({ entries: [rootEntry()], over: { storage, workspaceDefaults: {}, tuning: { initialScroll } } });
  return { m, resolve };
};

test('initialScroll root waits for the restore: scrollLeft stays 0 while only History exists, then puts History at the window start (2030)', async () => {
  const { m, resolve } = deferredRow('root');
  assert.equal(m.container.scrollLeft, 0);
  assert.equal(m.latest().entries.length, 1);
  await act(async () => {
    resolve();
  });
  assert.equal(m.latest().entries.length, 11);
  assert.equal(m.container.scrollLeft, 2030);
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
