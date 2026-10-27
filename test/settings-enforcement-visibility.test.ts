/**
 * The engine's reading of the visibility settings it owns: startVisibility, hideStickiness, capacityReturn and the
 * four timing keys. One differential per name through the real hook or pure function, then literal rows for the hold
 * map, the until-room threshold and the park and return orders, and a seeded property over measured rows.
 * Rows are built the way a creation path will build them: appendPanel's skeleton, then applyTemplate over a
 * resolved layer. Widths: W(n) is the container width whose capacity beside History is n phone panels.
 */
import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import './support/jsdom-globals.js';
import * as React from 'react';
import { act } from 'react';
import { useProvidePanels } from '../index.js';
import type { PanelSettings, PanelWindow, ProvidedPanels, ResolvedPanelSettings, SettingNote, WorkspaceTuning } from '../index.js';
import { applyTemplate, resolvePanelSettings } from '../panelSettings.js';
import { computeMaxLiveWidth, computeRowLayout } from '../panelRowLayout.js';
import { deriveAnchorsFromOrder } from '../panelRowOrder.js';
import { frameClock } from '../testingClock.js';
import { panelWidthOf } from '../panelTiers.js';
import { appendPanel, createRootPanel, leastRecentlyTouchedId, parkLevers, promoteToLive } from '../panelWindow.js';
import { fewestParksThatSettle, type UsePanelManagerResult } from '../panels/usePanelManager.js';
import { usePanelClosing, type UsePanelClosingResult } from '../panels/usePanelClosing.js';
import { projectWorkspaceState, type WorkspaceState, type WorkspaceStorage } from '../workspaceState.js';
import { differential, differentialsCovered } from './support/differential.js';
import { cleanup, mount, usePanelManagerWith, useSeededInput, type SeededOver } from './support/mount-harness.js';

const ROOT = 'root';
const OWNED = [
  'startVisibility',
  'hideStickiness',
  'capacityReturn',
  'tuning.saveQuietMs',
  'tuning.gestureLockMs',
  'tuning.gestureQuietMs',
  'tuning.returnTieBreak',
  'tuning.dropTieBreak',
];

/** The container width whose capacity beside the root column is `n` phone panels: 390 + n * (390 + 16) + 2 * 16. */
const W = (n: number): number => 422 + 406 * n;

const resolve = (layer: PanelSettings = {}): ResolvedPanelSettings => resolvePanelSettings({ template: layer }).value;

/** An entry as a creation path builds it: appendPanel's skeleton, then the 'create' writer over `layer`. */
function made(id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow {
  const skeleton = appendPanel([], { view: 'web', url: `https://${id}.example`, title: id.toUpperCase() }, id, ROOT)[0]!;
  return applyTemplate({ ...skeleton, instance: layer, ...over }, resolve(layer), 'create');
}
/** A panel the row may park for room. */
const park = (id: string, layer: PanelSettings = {}, over: Partial<PanelWindow> = {}): PanelWindow => made(id, { overflow: 'park', ...layer }, over);
const rootEntry = (): PanelWindow =>
  applyTemplate(createRootPanel(ROOT), resolvePanelSettings({ template: { title: 'History', layer: 'raised', enterFrom: 'anchor' } }, { root: true }).value, 'create');
/** The row in array order with every anchor read from it, as the engine keeps it. */
const row = (...entries: PanelWindow[]): PanelWindow[] => deriveAnchorsFromOrder(entries, ROOT);
const idsOf = (panels: readonly PanelWindow[]): string[] => panels.map((p) => p.id);
const liveOf = (panels: readonly PanelWindow[]): string[] => panels.filter((p) => p.collapsible && p.live).map((p) => p.id);
const parkedOf = (panels: readonly PanelWindow[]): string[] => panels.filter((p) => p.collapsible && !p.live).map((p) => p.id);

interface EngineView {
  panels: PanelWindow[];
  setPanels: React.Dispatch<React.SetStateAction<PanelWindow[]>>;
  manager: UsePanelManagerResult;
  closing: UsePanelClosingResult;
}

/**
 * usePanelManager and usePanelClosing wired the way useProvidePanels wires them, over a measured or unmeasured row
 * (`setWidth`); every method runs inside act() so a call returns only after the row has settled.
 */
function mountEngine(initial: PanelWindow[], width = 0) {
  let latest: EngineView | undefined;
  function Probe({ containerWidth }: { containerWidth: number }): React.ReactElement {
    const [panels, setPanels] = React.useState<PanelWindow[]>(initial);
    const manager = usePanelManagerWith({ panels, setPanels, phoneWidth: 390, containerWidth, fixedColumnCount: panels.filter((p) => !p.collapsible).length, rootId: ROOT });
    const closing = usePanelClosing(
      panels,
      setPanels,
      manager.revealPanelProactively,
      ROOT,
      (id, remaining) => {
        manager.forgetCollapsed(id);
        manager.releaseHold(id);
        manager.revealMostRecentlyCollapsed(remaining);
      },
      (id) => {
        manager.clearEnterSide(id);
        manager.markEnteringViaAnchor(id);
      },
    );
    latest = { panels, setPanels, manager, closing };
    return React.createElement('output');
  }
  const mounted = mount(React.createElement(Probe, { containerWidth: width }));
  const view = (): EngineView => {
    assert.ok(latest, 'the probe never rendered, so there is no manager to read');
    return latest;
  };
  const call = <T>(fn: (v: EngineView) => T): T => {
    let out: T | undefined;
    act(() => {
      out = fn(view());
    });
    return out as T;
  };
  return {
    view,
    call,
    unmount: () => mounted.unmount(),
    ids: () => idsOf(view().panels),
    live: () => liveOf(view().panels),
    parked: () => parkedOf(view().panels),
    held: () => [...view().manager.heldIds].map(([id, hold]) => `${id}:${hold === 'sticky' ? 'sticky' : hold.freeAfterPark}`),
    heldIds: () => view().manager.heldIds,
    hold: (id: string, kind: 'sticky' | 'until-room' = 'sticky') => call((v) => v.manager.holdPanel(id, kind)),
    open: (entry: PanelWindow) => call((v) => v.manager.revealPanelProactively(v.panels, (prev) => deriveAnchorsFromOrder([...prev, entry], ROOT))),
    close: (id: string) => call((v) => v.closing.close(id)),
    undo: () => call((v) => v.closing.undoClose()),
    wipe: () => call((v) => v.setPanels((prev) => prev.filter((p) => !p.collapsible))),
    activate: (id: string) => call((v) => v.manager.handleActivatePanel(id)),
    scroll: (direction: 'left' | 'right') => call((v) => v.manager.scrollRow(direction)),
    resize: (id: string, slots: number) => call((v) => v.manager.resizePanel(id, slots)),
    setWidth: (next: number) => mounted.rerender(React.createElement(Probe, { containerWidth: next })),
  };
}
type Engine = ReturnType<typeof mountEngine>;

interface ProvideOptions {
  width?: number;
  over?: Partial<SeededOver>;
}

/** useProvidePanels over `initialEntries`; `setWidth` and `setOver` re-render the same provider with a new row width or new inputs. */
function provide(initialEntries: PanelWindow[], options: ProvideOptions = {}) {
  let latest: ProvidedPanels | undefined;
  function Probe({ containerWidth, over }: { containerWidth: number; over: Partial<SeededOver> }): React.ReactElement {
    latest = useProvidePanels(useSeededInput({ initialEntries, containerWidth, ...over }));
    return React.createElement('output');
  }
  let width = options.width ?? 0;
  let over = options.over ?? {};
  const mounted = mount(React.createElement(Probe, { containerWidth: width, over }));
  const now = (): ProvidedPanels => {
    assert.ok(latest, 'the probe never rendered, so there is no provider value to read');
    return latest;
  };
  return {
    now,
    ids: () => idsOf(now().entries),
    live: () => liveOf(now().entries),
    parked: () => parkedOf(now().entries),
    setWidth: (next: number) => {
      width = next;
      mounted.rerender(React.createElement(Probe, { containerWidth: width, over }));
    },
    setOver: (next: Partial<SeededOver>) => {
      over = next;
      mounted.rerender(React.createElement(Probe, { containerWidth: width, over }));
    },
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
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;

afterEach(() => {
  mock.timers.reset();
  cleanup();
});

// ---------------------------------------------------------------------------
// One differential per owned name
// ---------------------------------------------------------------------------

test('differential startVisibility: a panel opened into a full row parks the oldest under live, and is created parked under parked', () => {
  const outcome = (startVisibility: 'live' | 'parked'): string => {
    const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
    e.open(park('c', { startVisibility }));
    return `live ${e.live().join(',')} parked ${e.parked().join(',')}`;
  };
  differential('startVisibility', (run) => {
    run('live', () => outcome('live'));
    run('parked', () => outcome('parked'));
  });
});

test('differential hideStickiness: a panel created parked stays parked when room opens under sticky and returns under until-room', () => {
  const afterRoomOpens = (hideStickiness: 'sticky' | 'until-room'): string[] => {
    const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
    e.open(park('c', { startVisibility: 'parked', hideStickiness }));
    e.close('b');
    return e.live();
  };
  differential('hideStickiness', (run) => {
    run('sticky', () => afterRoomOpens('sticky'));
    run('until-room', () => afterRoomOpens('until-room'));
  });
});

test('differential capacityReturn: a panel parked for room comes back when room opens under auto and stays parked under manual', () => {
  const afterRoomOpens = (capacityReturn: 'auto' | 'manual'): string[] => {
    const e = mountEngine(row(rootEntry(), park('a', { capacityReturn }), park('b')), W(2));
    e.open(park('c'));
    e.close('c');
    return e.live();
  };
  differential('capacityReturn', (run) => {
    run('auto', () => afterRoomOpens('auto'));
    run('manual', () => afterRoomOpens('manual'));
  });
});

/** Mounts a provider with a storage, lets the load settle under mock timers, advances `ms` and counts the saves. */
async function savesAfter(ms: number, tuning?: WorkspaceTuning): Promise<number> {
  const saves: WorkspaceState[] = [];
  const storage: WorkspaceStorage = { load: async () => null, save: (state) => void saves.push(state) };
  mock.timers.enable({ apis: ['setTimeout'] });
  provide([rootEntry(), made('a')], { over: { storage, ...(tuning === undefined ? {} : { tuning }) } });
  await act(async () => {});
  act(() => mock.timers.tick(ms));
  mock.timers.reset();
  return saves.length;
}

test('differential tuning.saveQuietMs: the workspace is saved at the configured quiet time, not before', async () => {
  const outcomes = new Map<number, number>([
    [200, await savesAfter(300, { saveQuietMs: 200 })],
    [800, await savesAfter(300, { saveQuietMs: 800 })],
  ]);
  differential('tuning.saveQuietMs', (run) => {
    run(200, () => outcomes.get(200));
    run(800, () => outcomes.get(800));
  });
});

/**
 * Runs `steps` against a provider over [a b live, c d e parked at the right] with a wheel listener and a clock the test moves; returns
 * the live ids after. A wheel of one phone width plus the row gap (406) is exactly one step of travel; the clock moves performance.now
 * only, so the quiet timer never fires and the events stay one gesture.
 */
function clocked(tuning: { gestureLockMs: number }, steps: (wheel: (deltaX: number) => void, advance: (ms: number) => void, setLock: (ms: number) => void, live: () => string[]) => void, extra: (container: HTMLElement) => void = () => undefined): string[] {
  const container = document.createElement('div');
  document.body.appendChild(container);
  extra(container);
  // One ref object across renders, as a host's useRef gives: a new one would re-subscribe the listeners.
  const ref = { current: container };
  let clock = 1000;
  mock.method(performance, 'now', () => clock);
  const p = provide(row(rootEntry(), park('a'), park('b'), park('c', {}, { live: false }), park('d', {}, { live: false }), park('e', {}, { live: false })), { width: W(2), over: { overflowContainerRef: ref, tuning: { ...tuning, rowGesture: 'step' } } });
  mock.timers.enable({ apis: ['setTimeout'] });
  const wheel = (deltaX: number): void => void act(() => void container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
  steps(wheel, (ms) => void (clock += ms), (ms) => p.setOver({ overflowContainerRef: ref, tuning: { gestureLockMs: ms, rowGesture: 'step' } }), p.live);
  const seen = p.live();
  mock.timers.reset();
  mock.restoreAll();
  container.remove();
  return seen;
}

function swipes(gestureLockMs: number): string[] {
  return clocked({ gestureLockMs }, (wheel, advance) => {
    wheel(406);
    advance(50);
    wheel(406);
  });
}

test('differential tuning.gestureLockMs: a second step of travel 50 ms after the first acts under a 20 ms lock and is held back under an 80 ms lock', () => {
  differential('tuning.gestureLockMs', (run) => {
    run(20, () => swipes(20));
    run(80, () => swipes(80));
  });
});

/** Two same-direction swipes 120 ms apart, the second smaller: the live ids after both. The first starts a step; whether the second does too depends on whether 120 ms of silence ended the gesture. */
function quietSwipes(gestureQuietMs: number): string[] {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const p = provide(row(rootEntry(), park('a'), park('b'), park('c', {}, { live: false }), park('d', {}, { live: false })), { width: W(2), over: { overflowContainerRef: { current: container }, tuning: { gestureQuietMs, rowGesture: 'step' } } });
  mock.timers.enable({ apis: ['setTimeout'] });
  const wheel = (deltaX: number): void => void act(() => void container.dispatchEvent(new WheelEvent('wheel', { deltaX, cancelable: true, bubbles: true })));
  wheel(100);
  act(() => mock.timers.tick(120));
  wheel(50);
  const seen = p.live();
  mock.timers.reset();
  container.remove();
  return seen;
}

test('differential tuning.gestureQuietMs: a smaller swipe 120 ms after the first is a decaying tail under a 150 ms quiet time and a fresh gesture under 100 ms', () => {
  differential('tuning.gestureQuietMs', (run) => {
    run(150, () => quietSwipes(150));
    run(100, () => quietSwipes(100));
  });
});

/** The id among q, x and p that the room returns, once they are parked one after another (q, then x, then p). */
function returnedWith(tieBreak: 'latest-first' | 'earliest-first' | 'row-order'): string[] {
  return threeParked(tieBreak).live().filter((id) => id === 'q' || id === 'x' || id === 'p');
}

test('differential tuning.returnTieBreak: with equal priorities the room returns the latest parked under latest-first and the oldest under earliest-first', () => {
  differential('tuning.returnTieBreak', (run) => {
    run('latest-first', () => returnedWith('latest-first'));
    run('earliest-first', () => returnedWith('earliest-first'));
  });
});

function droppedWith(dropTieBreak: 'leftmost' | 'rightmost'): string[] {
  const p = provide(row(rootEntry(), park('a'), park('b'), park('c')), { width: W(3), over: { tuning: { dropTieBreak } } });
  p.setWidth(W(2));
  return p.parked();
}

test('differential tuning.dropTieBreak: a capacity drop among equal ranks parks the leftmost under leftmost and the rightmost under rightmost', () => {
  differential('tuning.dropTieBreak', (run) => {
    run('leftmost', () => droppedWith('leftmost'));
    run('rightmost', () => droppedWith('rightmost'));
  });
});

test('differential coverage: the names the differentials above completed are exactly the eight this entry owns', () => {
  assert.ok(differentialsCovered().length > 0, 'no differential completed, so the equality below would prove nothing');
  assert.deepEqual(differentialsCovered(), [...OWNED].sort());
});

// ---------------------------------------------------------------------------
// The hold API
// ---------------------------------------------------------------------------

test('holdPanel sticky: the panel is parked, marked held, and a roomy measured row does not return it', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(4));
  assert.equal(e.hold('b'), true);
  assert.deepEqual(e.live(), ['a', 'c']);
  assert.deepEqual(e.held(), ['b:sticky']);
  e.close('c');
  assert.deepEqual(e.live(), ['a'], 'room opened and the held panel stayed parked');
});

test('holdPanel: an unknown id, a fixed column and an id already parked and held answer false and change nothing', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  assert.equal(e.hold('nope'), false, 'unknown id');
  assert.equal(e.hold(ROOT), false, 'a fixed column');
  assert.equal(e.hold('a'), true, 'control: a live panel takes the hold');
  assert.equal(e.hold('a'), false, 'already parked and held');
  assert.equal(e.hold('a', 'until-room'), false, 'a second kind does not replace the first');
  assert.deepEqual(e.held(), ['a:sticky']);
  assert.deepEqual(e.live(), ['b']);
});

test('holdPanel takes a second hold in the same turn only for another id', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  const results = e.call((v) => [v.manager.holdPanel('a', 'sticky'), v.manager.holdPanel('a', 'sticky'), v.manager.holdPanel('b', 'sticky')]);
  assert.deepEqual(results, [true, false, true]);
  assert.deepEqual(e.live(), ['c']);
});

test('holdPanel on a panel parked for room takes it off the collapse stack: it stays parked when room opens, where an unheld one returns', () => {
  const after = (held: boolean): string[] => {
    const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
    e.open(park('c'));
    assert.deepEqual(e.parked(), ['a'], 'control: opening c parked the oldest, a, and put it on the stack');
    if (held) assert.equal(e.hold('a'), true);
    e.close('c');
    return e.live();
  };
  assert.deepEqual(after(false), ['a', 'b'], 'control: unheld, a returns when c closes');
  assert.deepEqual(after(true), ['b'], 'held, a stays parked after the close');
});

test('releaseHold drops the mark only: the panel stays parked, and a second call answers false', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  e.hold('a');
  assert.equal(e.call((v) => v.manager.releaseHold('a')), true);
  assert.deepEqual(e.held(), []);
  assert.deepEqual(e.parked(), ['a'], 'live is untouched');
  assert.equal(e.call((v) => v.manager.releaseHold('a')), false);
  assert.equal(e.call((v) => v.manager.releaseHold('nope')), false);
});

test('activate releases the hold: the panel is live, unmarked, and parked for room later it returns when room opens', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
  e.hold('a');
  assert.deepEqual(e.held(), ['a:sticky']);
  e.activate('a');
  assert.deepEqual(e.held(), [], 'show released the mark');
  assert.deepEqual(e.live(), ['a', 'b']);
  e.open(park('c'));
  assert.deepEqual(e.parked(), ['a'], 'control: opening c parked a for room, as any park for room does');
  e.close('c');
  assert.deepEqual(e.live(), ['a', 'b'], 'a returned: a stale hold would have kept it parked');
});

test('the row gesture releases the hold of the panel it brings back', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
  e.hold('b');
  assert.deepEqual(e.held(), ['b:sticky']);
  e.scroll('right');
  assert.deepEqual(e.held(), [], 'the gesture dropped the mark');
  assert.ok(e.live().includes('b'), 'b came back');
});

test('a close drops the hold of the closed panel, and nothing else', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('a');
  e.hold('b');
  e.close('a');
  assert.deepEqual(e.held(), ['b:sticky']);
});

test('heldIds is a snapshot per render: an earlier render keeps the map it saw', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  const before = e.heldIds();
  e.hold('a');
  assert.equal(before.size, 0, 'the old snapshot did not change');
  assert.equal(e.heldIds().size, 1);
});

test('markHeld records the hold of a parked id and answers false for a live, a fixed or an unknown id', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b', {}, { live: false })), W(3));
  assert.equal(e.call((v) => v.manager.markHeld('a', 'sticky')), false, 'live');
  assert.equal(e.call((v) => v.manager.markHeld(ROOT, 'sticky')), false, 'fixed');
  assert.equal(e.call((v) => v.manager.markHeld('nope', 'sticky')), false, 'unknown');
  assert.deepEqual(e.held(), []);
  assert.equal(e.call((v) => v.manager.markHeld('b', 'until-room')), true);
  assert.deepEqual(e.held(), ['b:2'], 'capacity 3 less the one live panel');
});

// ---------------------------------------------------------------------------
// hideStickiness until-room, literally
// ---------------------------------------------------------------------------

test('until-room: [A B C] at capacity 3, hide B records one free slot and leaves it parked', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  assert.equal(e.hold('b', 'until-room'), true);
  assert.deepEqual(e.held(), ['b:1']);
  assert.deepEqual(e.live(), ['a', 'c']);
});

test('until-room: open D then close D, free slots back at the threshold, leaves B parked', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('b', 'until-room');
  e.open(park('d'));
  assert.deepEqual(e.live(), ['a', 'c', 'd']);
  e.close('d');
  assert.deepEqual(e.live(), ['a', 'c'], 'one free slot is not more than the one the park left');
  assert.deepEqual(e.parked(), ['b']);
});

test('until-room: closing C opens a second free slot and B returns', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('b', 'until-room');
  e.close('c');
  assert.deepEqual(e.live(), ['a', 'b']);
  assert.deepEqual(e.held(), [], 'the hold is gone with the return');
});

test('until-room: a capacity rise returns B', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('b', 'until-room');
  e.setWidth(W(4));
  assert.deepEqual(e.live(), ['a', 'b', 'c']);
});

test('until-room: a panel returned by a capacity rise keeps no hold', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('b', 'until-room');
  e.setWidth(W(4));
  assert.deepEqual(e.live(), ['a', 'b', 'c']);
  assert.deepEqual(e.held(), [], 'the return released the hold');
});

test('a wipe that removes held panels without a close leaves no hold behind', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('a');
  e.hold('b', 'until-room');
  assert.deepEqual(e.held().length, 2);
  e.wipe();
  assert.deepEqual(e.ids(), ['root']);
  assert.deepEqual(e.held(), []);
});

test('until-room: a capacity drop and a rise back to the old capacity leaves the free slots at the threshold, and B stays parked', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), W(3));
  e.hold('b', 'until-room');
  e.setWidth(W(2));
  assert.deepEqual(e.live(), ['a', 'c']);
  e.setWidth(W(3));
  assert.deepEqual(e.live(), ['a', 'c'], 'one free slot again, which is not more than the one the park left');
  assert.deepEqual(e.parked(), ['b']);
});

test('until-room on an unmeasured row holds like sticky, then takes the threshold at the first measurement', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c')), 0);
  e.hold('b', 'until-room');
  assert.deepEqual(e.held(), ['b:Infinity'], 'no measurement, no threshold yet');
  e.close('c');
  assert.deepEqual(e.live(), ['a'], 'unmeasured, closing C frees nothing it can count: B holds like sticky');
  e.setWidth(W(3));
  assert.deepEqual(e.held(), ['b:2'], 'the first measurement took capacity 3 less the one live panel');
  assert.deepEqual(e.live(), ['a'], 'two free slots are not more than the threshold of two');
  e.close('a');
  assert.deepEqual(e.live(), ['b'], 'three free slots exceed it');
});

// ---------------------------------------------------------------------------
// wouldEmptyRow
// ---------------------------------------------------------------------------

test('wouldEmptyRow: a root-less row of [A B] would empty only when both are named or one is already in flight', () => {
  const e = mountEngine(row(park('a'), park('b')), W(2));
  assert.equal(e.call((v) => v.manager.wouldEmptyRow(['a'])), false);
  assert.equal(e.call((v) => v.manager.wouldEmptyRow(['a', 'b'])), true);
  assert.equal(e.call((v) => v.manager.wouldEmptyRow([])), false);
});

test('wouldEmptyRow: a fixed column keeps the row from emptying, whatever is named', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  assert.equal(e.call((v) => v.manager.wouldEmptyRow(['a', 'b'])), false);
  assert.equal(e.call((v) => v.manager.wouldEmptyRow(['a', 'b', ROOT])), false, 'a fixed column cannot be parked, so naming it removes nothing');
});

test('wouldEmptyRow: a parked panel is not present, so the last live one would empty the row', () => {
  const e = mountEngine(row(park('a'), park('b', {}, { live: false })), W(2));
  assert.equal(e.call((v) => v.manager.wouldEmptyRow(['a'])), true);
});

test('hiding A and B on a row of [A B] with no fixed column empties it', () => {
  const e = mountEngine(row(park('a'), park('b')), W(2));
  const out = e.call((v) => [v.manager.holdPanel('a', 'sticky'), v.manager.holdPanel('b', 'sticky')]);
  assert.deepEqual(out, [true, true]);
  assert.deepEqual(e.live(), []);
});

// ---------------------------------------------------------------------------
// startVisibility: created parked
// ---------------------------------------------------------------------------

test("applyTemplate('create') writes live from startVisibility: parked parks the entry, live leaves a live one live", () => {
  const skeleton = appendPanel([], { view: 'web', url: 'https://x.example' }, 'x', ROOT)[0]!;
  assert.equal(skeleton.live, true, 'control: the skeleton is live');
  assert.equal(applyTemplate(skeleton, resolve({ startVisibility: 'parked' }), 'create').live, false);
  assert.equal(applyTemplate(skeleton, resolve({ startVisibility: 'live' }), 'create').live, true);
  assert.equal(applyTemplate({ ...skeleton, live: false }, resolve({ startVisibility: 'live' }), 'create').live, false, 'a skeleton handed in parked is not revived');
});

test("applyTemplate('reconfigure') never writes live: a later startVisibility change moves nothing", () => {
  const skeleton = appendPanel([], { view: 'web', url: 'https://x.example' }, 'x', ROOT)[0]!;
  assert.equal(applyTemplate(skeleton, resolve({ startVisibility: 'parked' }), 'reconfigure').live, true);
});

test('startVisibility parked on a fixed column is forced live by C1, so the panel is created live', () => {
  const entry = made('f', { parkable: false, startVisibility: 'parked' });
  assert.equal(entry.collapsible, false);
  assert.equal(entry.live, true);
});

test('a panel created parked and sticky is in panelList, held, parked, and not on the stack: room opening does not reveal it', () => {
  const p = provide(row(rootEntry(), park('a')), { width: W(3) });
  assert.deepEqual(p.live(), ['a']);
  const e = mountEngine(row(rootEntry(), park('a')), W(3));
  e.open(park('c', { startVisibility: 'parked', hideStickiness: 'sticky' }));
  assert.deepEqual(e.parked(), ['c']);
  assert.deepEqual(e.held(), ['c:sticky']);
  e.setWidth(W(5));
  assert.deepEqual(e.parked(), ['c'], 'the first commit and a capacity rise do not reveal it');
  assert.equal(e.view().panels.find((q) => q.id === 'c')?.listed, true, 'it is listed, so it is in panelList');
});

test('a panel created parked under until-room is on the stack: it returns once the free slots exceed what its creation left', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  e.open(park('c', { startVisibility: 'parked', hideStickiness: 'until-room' }));
  assert.deepEqual(e.held(), ['c:1']);
  assert.deepEqual(e.parked(), ['c'], 'not revealed by the first commit');
  e.close('a');
  assert.deepEqual(e.live(), ['b', 'c']);
});

test('created parked through useProvidePanels: a parked entry that a restore adds is held, so a roomy row leaves it parked', async () => {
  const saved: WorkspaceState = {
    version: 1,
    panels: [{ id: 's1', view: 'web', url: 'https://s1.example', title: 'S1', live: false, anchor: { panel: ROOT, position: 'right', priority: 0 } }],
  };
  const storage: WorkspaceStorage = { load: async () => saved, save: () => {} };
  const p = provide([rootEntry()], { width: W(4), over: { storage } });
  await act(async () => {});
  assert.equal(p.ids().length, 2, 'control: the restore added the saved panel');
  assert.deepEqual(p.live(), [], 'the restored parked panel stays parked in a row with room');
  assert.equal(p.now().panelList.length, 1);
});

// ---------------------------------------------------------------------------
// capacityReturn manual
// ---------------------------------------------------------------------------

test('capacityReturn manual: a panel parked for room is held like a sticky hide and does not return when room opens', () => {
  const e = mountEngine(row(rootEntry(), park('a', { capacityReturn: 'manual' }), park('b')), W(2));
  e.open(park('c'));
  assert.deepEqual(e.held(), ['a:sticky']);
  e.close('c');
  assert.deepEqual(e.live(), ['b'], 'room opened and a stayed parked');
});

test('capacityReturn manual: showing the panel returns it and drops the mark', () => {
  const e = mountEngine(row(rootEntry(), park('a', { capacityReturn: 'manual' }), park('b')), W(2));
  e.open(park('c'));
  e.activate('a');
  assert.deepEqual(e.held(), []);
  assert.deepEqual(e.live(), ['a', 'c'], 'a is live and b, the lower index of the two tied, was parked for it');
});

test('capacityReturn auto is the default and the stack returns the panel when room opens', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
  e.open(park('c'));
  assert.deepEqual(e.held(), []);
  e.close('c');
  assert.deepEqual(e.live(), ['a', 'b']);
});

test('capacityReturn on a panel whose overflow is scroll is inert: it is parked and returned as an auto panel', () => {
  const lever = parkLevers(made('s', { overflow: 'scroll', capacityReturn: 'manual' }));
  assert.equal(lever.capacityReturn, 'auto');
  assert.equal(parkLevers(park('p', { capacityReturn: 'manual' })).capacityReturn, 'manual');
});

// ---------------------------------------------------------------------------
// The park order
// ---------------------------------------------------------------------------

test('a scroll panel is never parked for room: the park panel touched longest ago goes', () => {
  const e = mountEngine(row(rootEntry(), park('a'), made('b', { overflow: 'scroll' }), park('c')), W(3));
  e.open(park('d'));
  assert.deepEqual(e.parked(), ['a']);
});

test('activating p parks the live panel touched longest ago, a tie going to the lower index', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c'), park('p', {}, { live: false }), park('d')), W(4));
  e.activate('p');
  assert.deepEqual(e.parked(), ['a']);
});

test('activating p parks the one panel left untouched while the others were touched, wherever it sits', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('p', {}, { live: false }), park('c'), park('d'), park('e')), W(4));
  frameClock.skip(10);
  for (const id of ['a', 'c', 'd']) e.call((v) => v.manager.touchPanel(id));
  e.activate('p');
  assert.deepEqual(e.parked(), ['e']);
});

test('touching the oldest panel spares it from the next park', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c'), park('p', {}, { live: false })), W(3));
  frameClock.skip(10);
  e.call((v) => v.manager.touchPanel('a'));
  e.activate('p');
  assert.deepEqual(e.parked(), ['b'], 'a was touched after b and c were created, so b is the oldest');
});

test('leastRecentlyTouchedId: the smallest touch time goes, a tie goes to the lower index, and an excluded panel is spared', () => {
  const panels = row(rootEntry(), park('a'), park('b'), park('c'), park('d'));
  const at: Record<string, number> = { a: 5, b: 2, c: 2, d: 9 };
  assert.equal(leastRecentlyTouchedId(panels, (id) => at[id]!), 'b', 'b and c are tied at 2, and b is first in the row');
  assert.equal(leastRecentlyTouchedId(panels, (id) => at[id]!, new Set(['b'])), 'c');
  assert.equal(leastRecentlyTouchedId(panels, () => 0), 'a', 'all tied: the lowest index');
  assert.equal(leastRecentlyTouchedId(panels, () => 0, new Set(['a', 'b', 'c', 'd'])), null, 'nothing left to park');
});

test('a panel in the acted-on set is never parked by its own action', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(2));
  e.open(park('c'));
  assert.deepEqual(e.live(), ['b', 'c'], 'the one parked is a, the oldest of the rest, not c');
  const f = mountEngine(row(rootEntry(), park('a'), park('b'), park('p', {}, { live: false })), W(2));
  f.activate('p');
  assert.ok(f.live().includes('p'), 'activation never parks the panel it activates');
});

test('promoteToLive never parks a panel in the keep set', () => {
  const panels = row(rootEntry(), park('a'), park('b'), park('p', {}, { live: false }));
  const out = promoteToLive(panels, 'p', 2, () => 0, new Set(['a']))!;
  assert.deepEqual(parkedOf(out), ['b'], 'a is the oldest, but it is kept');
});

test('a capacity drop parks the leftmost excess', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b'), park('c'), park('d'), park('e')), W(5));
  e.setWidth(W(3));
  assert.deepEqual(e.parked(), ['a', 'b']);
});

/** A copy of the park choice without tie-breaks: the oracle fewestParksThatSettle is held to. */
function referenceFewest(live: readonly PanelWindow[], widthOf: (p: PanelWindow) => number, settles: (set: readonly PanelWindow[]) => boolean, keepIds: readonly string[] = []): string[] {
  const narrowestFirst = (set: readonly PanelWindow[]): PanelWindow[] => [...set].sort((a, b) => widthOf(a) - widthOf(b));
  const inRowOrder = (set: readonly PanelWindow[]): PanelWindow[] => live.filter((p) => set.includes(p));
  const mustKeep: PanelWindow[] = [];
  for (const id of keepIds) {
    const p = live.find((q) => q.id === id);
    if (p && !mustKeep.includes(p) && settles(inRowOrder([...mustKeep, p]))) mustKeep.push(p);
  }
  const candidates = live.filter((p) => !mustKeep.includes(p));
  let keep = candidates.length;
  while (keep > 0 && mustKeep.length + keep > 1 && !settles(inRowOrder([...mustKeep, ...narrowestFirst(candidates).slice(0, keep)]))) keep--;
  const kept: PanelWindow[] = [...mustKeep];
  const toPark: string[] = [];
  candidates.forEach((p, i) => {
    const stillToKeep = keep - (kept.length - mustKeep.length);
    const rest = candidates.slice(i + 1);
    const canPark = toPark.length < candidates.length - keep && rest.length >= stillToKeep && settles(inRowOrder([...kept, ...narrowestFirst(rest).slice(0, stillToKeep)]));
    if (canPark) toPark.push(p.id);
    else kept.push(p);
  });
  return toPark;
}

test('fewestParksThatSettle returns what the reference choice returns, over 200 seeded rows', () => {
  let rowsThatParked = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    const rng = mulberry32(seed);
    const count = 2 + Math.floor(rng() * 7);
    const live = Array.from({ length: count }, (_, i) => park(`p${i}`));
    const widths = new Map(live.map((p) => [p.id, pick(rng, [390, 390, 500, 768])]));
    const widthOf = (p: PanelWindow): number => widths.get(p.id)!;
    const budget = 600 + Math.floor(rng() * 2400);
    const cap = 1 + Math.floor(rng() * count);
    const settles = (set: readonly PanelWindow[]): boolean => set.length <= cap && set.reduce((sum, p) => sum + widthOf(p), 0) <= budget;
    const keepIds = rng() < 0.4 ? [pick(rng, live).id] : [];
    const expected = referenceFewest(live, widthOf, settles, keepIds);
    assert.deepEqual(fewestParksThatSettle(live, widthOf, settles, keepIds), expected, `seed ${seed}`);
    assert.deepEqual(fewestParksThatSettle(live, widthOf, settles, keepIds, 'leftmost'), expected, `seed ${seed} with the tie-break named`);
    if (expected.length > 0) rowsThatParked += 1;
  }
  assert.ok(rowsThatParked >= 50, `only ${rowsThatParked} of the 200 rows parked anything, so the comparison proved little`);
});

test('fewestParksThatSettle: rightmost parks the right end', () => {
  const live = [park('a'), park('b'), park('c'), park('d')];
  const equalWidth = (): number => 390;
  const atMost2 = (set: readonly PanelWindow[]): boolean => set.length <= 2;
  assert.deepEqual(fewestParksThatSettle(live, equalWidth, atMost2, [], 'leftmost'), ['a', 'b']);
  assert.deepEqual(fewestParksThatSettle(live, equalWidth, atMost2, [], 'rightmost'), ['c', 'd']);
});

test('fewestParksThatSettle never parks a kept id unless the earlier ones already fill the row', () => {
  const live = [park('a'), park('b'), park('c')];
  const atMost2 = (set: readonly PanelWindow[]): boolean => set.length <= 2;
  assert.deepEqual(fewestParksThatSettle(live, () => 390, atMost2, ['a']), ['b'], 'a would park first, but it is kept');
  const atMost1 = (set: readonly PanelWindow[]): boolean => set.length <= 1;
  assert.deepEqual(fewestParksThatSettle(live, () => 390, atMost1, ['a', 'b']), ['b', 'c'], 'a fills the one slot, so the second kept id gives way');
});

// ---------------------------------------------------------------------------
// The return tie-break
// ---------------------------------------------------------------------------

/** Five panels where q, then x, then p are parked, in that order, then room for one: the park order differs from the row order and from its reverse. */
function threeParked(tieBreak: 'latest-first' | 'earliest-first' | 'row-order' | undefined) {
  const tuning = (dropTieBreak: 'leftmost' | 'rightmost') => ({ tuning: { dropTieBreak, ...(tieBreak === undefined ? {} : { returnTieBreak: tieBreak }) } });
  const p = provide(row(rootEntry(), park('x'), park('y'), park('z'), park('p'), park('q')), { width: W(5), over: tuning('rightmost') });
  p.setWidth(W(4));
  p.setOver(tuning('leftmost'));
  p.setWidth(W(3));
  p.setOver(tuning('rightmost'));
  p.setWidth(W(2));
  assert.deepEqual(p.parked(), ['x', 'p', 'q'], 'control: parked q, then x, then p');
  p.setWidth(W(3));
  return p;
}

test('returnTieBreak latest-first: of three parked the most recently parked, p, returns', () => {
  assert.deepEqual(threeParked('latest-first').parked(), ['x', 'q']);
});
test('returnTieBreak earliest-first: the oldest parked, q, returns', () => {
  assert.deepEqual(threeParked('earliest-first').parked(), ['x', 'p']);
});
test('returnTieBreak row-order: the panel earliest in the row, x, returns', () => {
  assert.deepEqual(threeParked('row-order').parked(), ['p', 'q']);
});
test('returnTieBreak unset is latest-first', () => {
  assert.deepEqual(threeParked(undefined).parked(), ['x', 'q']);
});

// ---------------------------------------------------------------------------
// Notes and session-only holds
// ---------------------------------------------------------------------------

test('a hold on an unlisted panel raises one hold-unlisted note through onNote, and a throwing onNote changes nothing', () => {
  const notes: SettingNote[] = [];
  const hidden = (): PanelWindow => park('hid', { listed: false }, { live: false });
  const p = provide(row(rootEntry(), hidden(), park('a')), { width: W(3), over: { onNote: (note) => void notes.push(note) } });
  act(() => p.now().close('hid'));
  act(() => p.now().undoClose());
  assert.equal(p.ids().includes('hid'), true, 'control: the undo restored the parked panel');
  assert.deepEqual(
    notes.map((n) => [n.code, n.panelId, n.key]),
    [['hold-unlisted', 'hid', 'listed']],
  );
  const loud = provide(row(rootEntry(), hidden()), {
    width: W(3),
    over: {
      onNote: () => {
        throw new Error('a reporter that throws');
      },
    },
  });
  act(() => loud.now().close('hid'));
  assert.doesNotThrow(() => act(() => loud.now().undoClose()), 'a note never throws into the engine');
  assert.equal(loud.ids().includes('hid'), true);
});

test('held ids are session only: projectWorkspaceState output carries no held key and equals the row\'s projection without the hold', () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(3));
  const before = projectWorkspaceState(e.view().panels, ROOT);
  e.hold('a');
  const after = projectWorkspaceState(e.view().panels, ROOT);
  assert.equal(JSON.stringify(after).includes('held'), false);
  assert.deepEqual(
    after.panels.map((p) => Object.keys(p).sort()),
    before.panels.map((p) => Object.keys(p).sort()),
    'the same keys per panel, held or not',
  );
  assert.deepEqual(after.panels.map((p) => p.live), [false, true], 'only the live flag differs');
});

test('a remount restores a parked panel parked, with no hold carried over', async () => {
  const e = mountEngine(row(rootEntry(), park('a'), park('b')), W(4));
  e.hold('a');
  const saved = projectWorkspaceState(e.view().panels, ROOT);
  e.unmount();
  const storage: WorkspaceStorage = { load: async () => saved, save: () => {} };
  const p = provide([rootEntry()], { width: W(4), over: { storage } });
  await act(async () => {});
  assert.equal(p.ids().length, 3);
  assert.equal(p.live().length, 1, 'one live and one parked, as saved');
  assert.equal(p.parked().length, 1);
});

// ---------------------------------------------------------------------------
// Timing tuning
// ---------------------------------------------------------------------------

test('the timing defaults are 500 ms and 30 ms, and a tuning left out takes them', async () => {
  const { LIBRARY_TUNING_DEFAULTS } = await import('../panelSettings.js');
  assert.equal(LIBRARY_TUNING_DEFAULTS.saveQuietMs, 500);
  assert.equal(LIBRARY_TUNING_DEFAULTS.gestureLockMs, 30);
  assert.equal(await savesAfter(499), 0, 'not saved at 499 ms');
  assert.equal(await savesAfter(500), 1, 'saved at 500 ms');
});

test('saveQuietMs from the workspace tuning moves the save to the configured value, to the millisecond', async () => {
  assert.equal(await savesAfter(199, { saveQuietMs: 200 }), 0);
  assert.equal(await savesAfter(200, { saveQuietMs: 200 }), 1);
  assert.equal(await savesAfter(0, { saveQuietMs: 0 }), 1, 'zero is a valid quiet time');
});

test('an unusable saveQuietMs falls back to the default', async () => {
  assert.equal(await savesAfter(499, { saveQuietMs: -5 }), 0);
  assert.equal(await savesAfter(500, { saveQuietMs: Number.NaN }), 1);
});

test('saveQuietMs is read at each arm: changing it between two changes retimes the second', async () => {
  const saves: WorkspaceState[] = [];
  const storage: WorkspaceStorage = { load: async () => null, save: (state) => void saves.push(state) };
  mock.timers.enable({ apis: ['setTimeout'] });
  const p = provide([rootEntry(), made('a')], { over: { storage, tuning: { saveQuietMs: 100 } } });
  await act(async () => {});
  act(() => mock.timers.tick(100));
  assert.equal(saves.length, 1, 'the first save fired at 100');
  p.setOver({ storage, tuning: { saveQuietMs: 700 } });
  act(() => p.now().close('a'));
  act(() => mock.timers.tick(699));
  assert.equal(saves.length, 1, 'the second save waits the new 700');
  act(() => mock.timers.tick(1));
  assert.equal(saves.length, 2);
});

test('gestureLockMs is read at each wheel event: changing it keeps the listeners and applies to the next step', () => {
  let removed = 0;
  const live = clocked(
    { gestureLockMs: 100 },
    (wheel, advance, setLock, now) => {
      wheel(406);
      advance(150);
      wheel(406);
      assert.deepEqual(now(), ['c', 'd'], 'two steps, 150 ms apart under a 100 ms lock');
      setLock(600);
      assert.equal(removed, 0, 'the new value did not tear the listeners down');
      advance(150);
      wheel(406);
      assert.deepEqual(now(), ['c', 'd'], '150 ms after a step is inside the new 600 ms lock');
      advance(450);
      wheel(406);
    },
    (container) => {
      const original = container.removeEventListener.bind(container);
      container.removeEventListener = ((...args: Parameters<typeof original>) => {
        removed += 1;
        return original(...args);
      }) as typeof container.removeEventListener;
    },
  );
  assert.deepEqual(live, ['d', 'e'], '600 ms after the last step the lock is over');
});

// ---------------------------------------------------------------------------
// S1: a seeded property over measured rows
// ---------------------------------------------------------------------------

/** The capacity computeRowLayout gives a row whose live set is `live`, with the same inputs the engine prices it from. */
function capacityOf(live: readonly PanelWindow[], containerWidth: number): number {
  const maxLiveWidth = computeMaxLiveWidth({ containerWidth, phoneWidth: 390, gap: 16, fixedItemCount: 1 });
  const fit = computeRowLayout({ containerWidth, phoneWidth: 390, gap: 16, fixedItemCount: 1, liveWidths: live.map((p) => panelWidthOf(p, 390, maxLiveWidth)) }).maxLiveThatFit;
  return Math.max(1, fit);
}

test('S1: over 500 seeded sequences on measured rows of park panels, the live parkable count never exceeds the capacity after a settled commit', () => {
  const stickiness = ['sticky', 'until-room'] as const;
  const slotCounts = [1, 1, 1, 2] as const;
  let sequences = 0;
  let checks = 0;
  let operations = 0;
  for (let seed = 1; seed <= 500; seed += 1) {
    const rng = mulberry32(seed * 7919);
    let counter = 0;
    const fresh = (): PanelWindow =>
      park(`s${counter++}`, {
        capacityReturn: rng() < 0.25 ? 'manual' : 'auto',
        hideStickiness: pick(rng, stickiness),
        startVisibility: rng() < 0.15 ? 'parked' : 'live',
        slots: pick(rng, slotCounts),
      });
    let width = W(1 + Math.floor(rng() * 5));
    const e = mountEngine(row(rootEntry(), ...Array.from({ length: 2 + Math.floor(rng() * 4) }, fresh)), width);
    const settled = (): void => {
      const live = e.view().panels.filter((p) => p.collapsible && p.live);
      assert.ok(live.length <= capacityOf(live, width), `seed ${seed}: ${live.length} live parkable panels exceed capacity ${capacityOf(live, width)} at width ${width}`);
      checks += 1;
    };
    settled();
    for (let step = 0; step < 8; step += 1) {
      const panels = e.view().panels.filter((p) => p.collapsible);
      const target = panels.length === 0 ? undefined : pick(rng, panels);
      const op = pick(rng, ['open', 'open', 'close', 'activate', 'hold', 'release', 'scroll', 'width', 'resize'] as const);
      if (op === 'open') e.open(fresh());
      else if (op === 'width') {
        width = W(1 + Math.floor(rng() * 5));
        e.setWidth(width);
      } else if (op === 'scroll') e.scroll(rng() < 0.5 ? 'left' : 'right');
      else if (target !== undefined) {
        if (op === 'close') e.close(target.id);
        else if (op === 'activate') e.activate(target.id);
        else if (op === 'hold') e.hold(target.id, pick(rng, stickiness));
        else if (op === 'release') e.call((v) => v.manager.releaseHold(target.id));
        else e.resize(target.id, pick(rng, [1, 2, 64] as const));
      }
      operations += 1;
      settled();
    }
    e.unmount();
    sequences += 1;
  }
  console.log(`sequences run: ${sequences}`);
  assert.ok(sequences >= 500, `sequences run: ${sequences}`);
  assert.ok(checks >= 500 * 9, `only ${checks} settled commits were checked`);
  assert.ok(operations >= 500 * 8, `only ${operations} operations ran`);
});
