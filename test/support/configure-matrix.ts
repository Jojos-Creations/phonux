/**
 * What the configure matrix reads: the class table as data, the rig every cell and probe mounts, the one helper each of
 * the catalog-name probes and 36 class cells goes through, and the catalog's names.
 *
 * The table is written by hand from the status letters and defaults of the configure design and from each catalog
 * row's `on_configure` cell. Nothing in it is derived from the code under test.
 */
import assert from 'node:assert/strict';
import * as React from 'react';
import { createElement, useEffect } from 'react';
import { act } from 'react';
import { mock } from 'node:test';
import { DragToClose, LIBRARY_TUNING_DEFAULTS, PANEL_SETTINGS_CATALOG, PanelRow, Workspace, createWorkspace, definePanel, useProvidePanels, useViewState, usePanelCapabilities, usePanelNeighborWidths, usePanelReorderSteps } from '../../index.js';
import type { CaptureTrigger, ConfigureResult, PanelHandle, PanelResult, PanelSettings, PanelState, PanelTemplate, PanelWindow, PanelsInput, ProvidedPanels, WorkspaceHandle, WorkspaceOptions } from '../../index.js';
import { useFrameClaim } from '../../panelFrameClaim.js';
import { panelKey } from '../../panelSettings.js';
import { createFakeHost } from '../../fakeHost.js';
import { rowOffsetOf } from './strip.js';
import { advanceFrames, mount, panelsInput, withHost } from './mount-harness.js';
import { FRAME_MS } from './jsdom-globals.js';
import { flush, mountWorkspace, rowEntries, type MountedWorkspace } from './workspace-row.js';

export const CLASSES = ['NOW', 'NEXT', 'STATE', 'SCOPE'] as const;
export type Cls = (typeof CLASSES)[number];

/**
 * The nine statuses of the configure design: P pending, L live, K parked by the engine, H hidden (held), T the panel a turn's
 * action protects from being parked, C closed declared past the undo window, A closed anonymous, U closed inside the
 * undo window, F a second operation on the same panel in the same turn.
 */
export const STATUSES = ['pending', 'live', 'parked', 'hidden', 'protected', 'closed-declared', 'closed-anonymous', 'undo-window', 'same-turn'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * What the call answers and where the change lands.
 * - refused: the engine is untouched (entries reference-equal, no commit, same snapshot version); `code` names why.
 * - applied-now: the observable the class names changes in this commit and `now` lists the key.
 * - stored: the value is kept for the first event that reads it; `later` lists the key and nothing moves.
 * - stored-on-record: a closed panel's record takes the edit (used by the next open() or by the pending undo); `later` lists the key.
 */
export type Outcome =
  | { kind: 'refused'; code: 'is-pending' | 'busy' | 'is-closed' | 'not-ready' }
  | { kind: 'applied-now' }
  | { kind: 'stored' }
  | { kind: 'stored-on-record' };

export interface Cell {
  outcome: Outcome;
  /** Host `evict` calls the configure causes, or null when the design does not say. */
  evicts: number | null;
  /** View unmounts the configure causes, or null when the design does not say. */
  unmounts: number | null;
  /**
   * 'none': the call writes no file and the next projection is unchanged. null: not part of this class's rows.
   */
  projection: 'none' | null;
  /**
   * SCOPE only: whether an instance in this status counts when configureTemplate lowers a limit. Closed-declared and
   * undo-window instances count for the `multiple` on-to-off check only; `maxInstances` counts row entries.
   */
  counted?: boolean;
  /** Protected only: the acted-on panel stays live whatever the configured value says. */
  staysLive?: boolean;
}

const refused = (code: 'is-pending' | 'busy' | 'is-closed' | 'not-ready'): Cell => ({ outcome: { kind: 'refused', code }, evicts: 0, unmounts: 0, projection: 'none' });

/** The 36 cells. Keys are written out; no row is computed from another. */
export const CLASS_TABLE: Readonly<Record<Cls, Readonly<Record<Status, Cell>>>> = {
  // NOW: a button, a History row, a z-index or the row's price changes at this commit; nothing else moves.
  NOW: {
    pending: refused('is-pending'),
    live: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    parked: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    hidden: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    protected: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null, staysLive: true },
    'closed-declared': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'closed-anonymous': refused('is-closed'),
    'undo-window': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'same-turn': refused('busy'),
  },
  // NEXT: stored; the first event that reads it comes later; nothing parks, shows, moves or scrolls at configure.
  NEXT: {
    pending: refused('is-pending'),
    live: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none' },
    parked: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none' },
    hidden: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none' },
    protected: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', staysLive: true },
    'closed-declared': { outcome: { kind: 'stored-on-record' }, evicts: null, unmounts: 0, projection: null },
    'closed-anonymous': refused('is-closed'),
    'undo-window': { outcome: { kind: 'stored-on-record' }, evicts: null, unmounts: 0, projection: null },
    'same-turn': refused('busy'),
  },
  // STATE: a cap that applies at this commit to every panel still in the row, with no row effect.
  STATE: {
    pending: refused('is-pending'),
    live: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    parked: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    hidden: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null },
    protected: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 0, projection: null, staysLive: true },
    'closed-declared': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'closed-anonymous': refused('is-closed'),
    'undo-window': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'same-turn': refused('busy'),
  },
  // SCOPE: configureTemplate names no panel, so a panel's status only decides whether an instance counts against a lowered
  // limit: a closed record counts for `multiple: false`, never for `maxInstances`.
  SCOPE: {
    pending: refused('not-ready'),
    live: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
    parked: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
    hidden: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
    protected: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true, staysLive: true },
    'closed-declared': { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
    'closed-anonymous': { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: false },
    'undo-window': { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
    'same-turn': { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: 'none', counted: true },
  },
};

export const CATALOG_NAMES: readonly string[] = PANEL_SETTINGS_CATALOG.map((d) => d.name);

/** The thirteen catalog names whose instance-door call is wrong-scope: three template keys, ten workspace-only tuning keys. */
export const WRONG_SCOPE_NAMES: readonly string[] = ['hostCreatable', 'multiple', 'maxInstances', 'tuning.rowGap', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.gestureQuietMs', 'tuning.resizeSettleSlides', 'tuning.returnTieBreak', 'tuning.dropTieBreak', 'tuning.rowGesture', 'tuning.fastScroll', 'tuning.initialScroll', 'tuning.maxLivePanels'];

const probesRun = new Set<string>();
const cellsRun = new Set<string>();

/** Records that probe `name` started; each probe's body calls it first, so a probe that never ran is missing from the set. */
export function probe(name: string): void {
  assert.ok(CATALOG_NAMES.includes(name), `'${name}' is not a catalog name`);
  assert.equal(probesRun.has(name), false, `'${name}' has two probes`);
  probesRun.add(name);
}
export const probesExecuted = (): ReadonlySet<string> => probesRun;

/** Records that class cell (`cls`, `status`) started, counted the same way. */
export function cell(cls: Cls, status: Status): void {
  const key = `${cls}/${status}`;
  assert.equal(cellsRun.has(key), false, `cell ${key} ran twice`);
  cellsRun.add(key);
}
export const cellsExecuted = (): ReadonlySet<string> => cellsRun;

/** Views are given a panel's key; these tests name a panel by the engine id of its entry, which the rig in use maps the key to. */
const engineOf = { current: (key: string): string => rowEntries.current.find((p) => panelKey(p) === key)?.id ?? key };

const mounts = new Map<string, { mounted: number; unmounted: number }>();
const stateSetters = new Map<string, (n: number) => void>();
export const viewLog = {
  reset: (): void => {
    mounts.clear();
    stateSetters.clear();
  },
  mounted: (id: string): number => mounts.get(id)?.mounted ?? 0,
  unmounted: (id: string): number => mounts.get(id)?.unmounted ?? 0,
  setState: (id: string, n: number): void => {
    const set = stateSetters.get(id);
    if (set === undefined) throw new Error(`no mounted view for engine id ${id}`);
    act(() => set(n));
  },
};

/**
 * A view that writes what its slot tells it into data attributes, so a test reads what a person's view would act on.
 * `data-slot` is the engine id; the others are the permission hooks, the neighbor widths and the panel's title.
 */
export const matrixTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({
    id,
    view: ({ panel: summary }) => {
      const panel = { ...summary, id: engineOf.current(summary.id) };
      useFrameClaim('frame');
      const caps = usePanelCapabilities();
      const neighbors = usePanelNeighborWidths();
      const steps = usePanelReorderSteps();
      const [n, setN] = useViewState('n', 0);
      useEffect(() => {
        stateSetters.set(panel.id, setN);
        return () => void stateSetters.delete(panel.id);
      }, [panel.id, setN]);
      useEffect(() => {
        const entry = mounts.get(panel.id) ?? { mounted: 0, unmounted: 0 };
        entry.mounted += 1;
        mounts.set(panel.id, entry);
        return () => {
          const last = mounts.get(panel.id) ?? { mounted: 0, unmounted: 0 };
          last.unmounted += 1;
          mounts.set(panel.id, last);
        };
      }, [panel.id]);
      return createElement('i', {
        'data-slot': panel.id,
        'data-title': panel.title ?? '',
        'data-close': String(caps.closable),
        'data-reorder': String(caps.movable),
        'data-caps': JSON.stringify({ closable: caps.closable, movable: caps.movable, resizable: caps.resizable, maxSlots: caps.maxSlots }),
        'data-neighbors': JSON.stringify(neighbors),
        'data-n': String(n),
        'data-steps': JSON.stringify([150, 250].map(steps)),
      });
    },
    ...over,
    settings: over.settings,
  });

export const dragLog: { ends: { id: string; offset: number; hops: number }[] } = { ends: [] };

function DragBox({ id, close }: { id: string; close: () => void }): React.ReactElement {
  useFrameClaim('frame');
  const steps = usePanelReorderSteps();
  return createElement(DragToClose, {
    onClose: close,
    reorder: { onDragEnd: (offset: number) => void dragLog.ends.push({ id, offset, hops: steps(offset) }) },
    children: (handle) => createElement('div', { 'data-handle': id, 'data-slot': id, onPointerDown: handle.onPointerDown }, 'grab'),
  });
}

/** A view that is a DragToClose with a grab bar `data-handle=<engine id>`; a horizontal release is logged in dragLog. */
export const dragTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({
    id,
    view: ({ panel, handle }) => createElement(DragBox, { id: engineOf.current(panel.id), close: () => void handle.close() }),
    verticalDrag: true,
    ...over,
    settings: over.settings,
  });

export interface CaptureSpy extends CaptureTrigger {
  captured: string[];
  evicted: string[];
}
export const captureSpy = (): CaptureSpy => {
  const spy: CaptureSpy = { captured: [], evicted: [], capture: (id) => void spy.captured.push(id), evict: (id) => void spy.evicted.push(id) };
  return spy;
};

/**
 * `mountWorkspace` with the marks a real host passes the row on every render: the ids closing, the ids entering by an
 * anchor, the ids exiting right and the enter side per id. Without them a close draws no exit and an enter has no side.
 */
function mountWired(ws: WorkspaceHandle, width: number, over: Partial<PanelsInput>): MountedWorkspace {
  const ref = React.createRef<HTMLDivElement>();
  const rowRef = React.createRef<HTMLDivElement>();
  const notes: MountedWorkspace['notes'] = [];
  let latest: ProvidedPanels | undefined;
  let renders = 0;
  function Probe(): React.ReactElement {
    latest = useProvidePanels(panelsInput({ workspace: ws, containerWidth: width, overflowContainerRef: ref, onNote: (n) => void notes.push(n), ...over }));
    rowEntries.current = latest.entries;
    renders += 1;
    const provided = latest;
    return withHost(
      React.createElement(
        Workspace,
        { overflowContainerRef: ref, rowRef, containerWidth: width, rowResizeSettled: true, phoneWidth: 390, fixedColumnCount: provided.fixedViewCount, liveWidths: provided.liveWidths, rowScroll: provided.rowScroll, rowNumbers: provided.rowNumbers, workspace: ws } as never,
        React.createElement(PanelRow, {
          entries: provided.entries,
          rootId: ws.rootId,
          closingIds: provided.closingIds,
          enteringViaAnchorIds: provided.enteringViaAnchorIds,
          exitRightIds: provided.exitRightIds,
          enterSideById: provided.enterSideById,
          rowNumbers: provided.rowNumbers,
          workspace: ws,
        }),
      ),
      createFakeHost({ panels: provided }),
    );
  }
  const mounted = mount(React.createElement(Probe));
  const container = ref.current;
  assert.ok(container, 'the Workspace never attached its scroll container');
  return {
    latest: () => latest!,
    container,
    notes,
    slots: () => [...container.querySelectorAll('[data-slot]')].map((n) => (n as HTMLElement).dataset.slot!),
    renders: () => renders,
    rerender: (next) => mounted.rerender(next),
    unmount: () => mounted.unmount(),
  };
}

export interface MatrixRigOptions {
  ids?: readonly string[];
  settings?: Record<string, PanelSettings>;
  park?: boolean;
  extra?: readonly PanelTemplate[];
  root?: boolean;
  width?: number;
  workspace?: Partial<WorkspaceOptions>;
  over?: Partial<PanelsInput>;
  wired?: boolean;
  view?: 'marker' | 'drag';
  strict?: boolean;
}

export interface MatrixRig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
  h: Record<string, PanelHandle>;
  capture: CaptureSpy;
  turn: <T>(fn: () => T) => T;
  order: () => string[];
  live: () => string[];
  entry: (id: string) => PanelWindow;
  state: (id: string) => PanelState;
  provided: () => ProvidedPanels;
  settle: () => Promise<void>;
  seen: (id: string) => Record<string, string> | null;
  slot: (id: string) => HTMLElement | null;
}

export async function matrixRig(o: MatrixRigOptions = {}): Promise<MatrixRig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const capture = captureSpy();
  const ws = createWorkspace({
    mount: false,
    ...(o.root === false ? {} : { root: matrixTemplate('root', { settings: { title: 'History' } }) }),
    templates: [...ids.map((id) => (o.view === 'drag' ? dragTemplate : matrixTemplate)(id, { settings: { ...(o.park === true ? { overflow: 'park' as const } : {}), ...(o.settings?.[id] ?? {}) } })), ...(o.extra ?? [])],
    ...(o.workspace ?? {}),
    // The enter and exit rows measure the sideways slide; the expand and shrink defaults have their own tests.
    tuning: { defaultEnterFrom: 'auto', defaultExitTo: 'auto', ...(o.workspace?.tuning ?? {}) },
  });
  const h: Record<string, PanelHandle> = {};
  for (const id of ids) h[id] = ws.addPanel(id);
  const m = o.wired === true ? mountWired(ws, o.width ?? 4000, { capture, ...(o.over ?? {}) }) : mountWorkspace(ws, { width: o.width ?? 4000, over: { capture, ...(o.over ?? {}) }, ...(o.strict === true ? { strict: true } : {}) });
  await flush();
  const entries = (): readonly PanelWindow[] => m.latest().entries.filter((p) => p.marker !== true);
  const entry = (id: string): PanelWindow => {
    const found = entries().find((p) => panelKey(p) === id);
    if (found === undefined) throw new Error(`no entry '${id}' in the row: ${entries().map(panelKey).join(' ')}`);
    return found;
  };
  const slot = (id: string): HTMLElement | null => m.container.querySelector<HTMLElement>(`[data-slot="${entries().find((p) => panelKey(p) === id)?.id ?? id}"]`);
  return {
    ws,
    m,
    h,
    capture,
    turn: <T,>(fn: () => T): T => {
      let out!: T;
      act(() => {
        out = fn();
      });
      return out;
    },
    order: () => entries().map(panelKey),
    live: () => entries().filter((p) => p.live).map(panelKey),
    entry,
    state: (id) => ws.panels.get(id)!.getState(),
    provided: () => m.latest(),
    settle: () => advanceFrames(900),
    seen: (id) => {
      const el = slot(id);
      if (el === null) return null;
      return Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]));
    },
    slot,
  };
}

export type Answer = ConfigureResult | PanelResult;
/** An answer as a short literal: T accepted and changed, F accepted with nothing to do, or the refusal code. */
export const letter = (a: Answer): string => (a.ok ? (a.changed ? 'T' : 'F') : a.code);

export type Done = Extract<ConfigureResult, { ok: true }>;
export type Refused = Extract<ConfigureResult, { ok: false }>;
export const done = (r: ConfigureResult): Done => {
  assert.equal(r.ok, true, r.ok ? '' : `${r.code}: ${r.message}`);
  return r as Done;
};
export const refusedWith = (r: ConfigureResult, code: string): Refused => {
  assert.equal(r.ok, false, 'expected a refusal');
  assert.equal((r as Refused).code, code, (r as Refused).message);
  return r as Refused;
};

export const UNDO_MS = 10000;

/** Mocks setTimeout so a test can step past the undo window; the caller's afterEach resets it. */
export function mockWindow(): { pastWindow: () => void } {
  mock.timers.enable({ apis: ['setTimeout'] });
  return { pastWindow: () => act(() => mock.timers.tick(UNDO_MS + 1)) };
}

export interface Arranged {
  r: MatrixRig;
  id: string;
  configure: (patch: Record<string, unknown>) => ConfigureResult;
}

/** Five park-mode panels in a row that holds one beside the root: b is the one the engine has parked. */
const PARK_IDS = ['a', 'b', 'c', 'd', 'e'] as const;

/**
 * A mounted workspace with panel `b` (or the panel pending in the call) in `status`. `settings` is b's template layer.
 * Closed-past-the-window mocks setTimeout; the caller's afterEach resets it.
 */
export async function arrange(status: Status, settings: PanelSettings = {}, workspace: Partial<WorkspaceOptions> = {}): Promise<Arranged> {
  const singleton = markerless('p');
  const anonymous = matrixTemplate('m', { settings: { multiple: true } });
  const roomy = (): Promise<MatrixRig> => matrixRig({ settings: { b: settings }, extra: [singleton, anonymous], workspace });
  const call = (r: MatrixRig, id: string, before?: () => unknown) => (patch: Record<string, unknown>): ConfigureResult =>
    r.turn(() => {
      before?.();
      return r.h[id]!.configure(patch as never);
    });
  if (status === 'parked' || status === 'protected') {
    const r = await matrixRig({ ids: PARK_IDS, park: true, width: 1000, settings: { b: settings }, extra: [singleton, anonymous], workspace });
    await r.settle();
    assert.equal(r.state('b').status, 'parked', 'the engine parked b for room');
    assert.equal(r.state('b').held, false, 'and it holds no hide');
    return { r, id: 'b', configure: call(r, 'b') };
  }
  const r = await roomy();
  switch (status) {
    case 'live':
      return { r, id: 'b', configure: call(r, 'b') };
    case 'hidden':
      r.turn(() => r.h.b!.hide());
      await r.settle();
      assert.deepEqual([r.state('b').status, r.state('b').held], ['parked', true]);
      return { r, id: 'b', configure: call(r, 'b') };
    case 'closed-declared': {
      const w = mockWindow();
      r.turn(() => r.h.b!.close());
      w.pastWindow();
      assert.equal(r.state('b').status, 'closed');
      assert.equal((r.provided().recentlyClosed ?? []).length, 0, 'the window has ended');
      return { r, id: 'b', configure: call(r, 'b') };
    }
    case 'undo-window':
      r.turn(() => r.h.b!.close());
      assert.equal(r.state('b').status, 'closed');
      assert.equal((r.provided().recentlyClosed ?? []).length, 1, 'the window is open');
      return { r, id: 'b', configure: call(r, 'b') };
    case 'closed-anonymous': {
      const x = r.turn(() => r.ws.addPanel('m'));
      await r.settle();
      r.h[x.id] = x;
      r.turn(() => x.close());
      assert.equal(x.getState().status, 'closed');
      return { r, id: x.id, configure: call(r, x.id) };
    }
    case 'same-turn':
      return { r, id: 'b', configure: call(r, 'b', () => r.h.b!.hide()) };
    case 'pending':
      return {
        r,
        id: 'p',
        configure: (patch) =>
          r.turn(() => {
            const added = r.ws.addPanel('p');
            r.h.p = added;
            assert.equal(added.getState().status, 'pending');
            return added.configure(patch as never);
          }),
      };
  }
}

function markerless(id: string): PanelTemplate {
  return matrixTemplate(id);
}

/**
 * Runs the status exceptions a probe lists one by one, so a red one does not hide the rest: every failed expectation is
 * named, and `end()` fails the probe once with all of them.
 */
export function soft(): { run: (label: string, fn: () => Promise<void> | void) => Promise<void>; end: () => void } {
  const failures: string[] = [];
  return {
    run: async (label, fn) => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${label}: ${(e as Error).message.split('\n').slice(0, 4).join(' | ')}`);
      }
    },
    end: () => assert.deepEqual(failures, [], 'expectations that failed'),
  };
}

export const EDGE_WINDOW = 1000;

/** A pointer event of the kind jsdom lacks: a MouseEvent of the pointer type name carrying the fields motion reads. */
export function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y = 100): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1 });
  for (const [key, value] of Object.entries({ pointerId: 1, pointerType: 'mouse', isPrimary: true })) Object.defineProperty(event, key, { value });
  return event;
}

/** Ten drag panels s1 to s10 and the root in a 1000 px window: the strip is 4450 wide, so the farthest legal scrollLeft is 3482. */
export async function dragRig(o: MatrixRigOptions = {}): Promise<MatrixRig> {
  const ids = Array.from({ length: 10 }, (_, k) => `s${k + 1}`);
  const r = await matrixRig({ ids, width: EDGE_WINDOW, view: 'drag', ...o });
  Object.defineProperty(r.m.container, 'clientWidth', { value: EDGE_WINDOW, configurable: true });
  r.m.container.getBoundingClientRect = () => ({ left: 0, right: EDGE_WINDOW, top: 0, bottom: 700, width: EDGE_WINDOW, height: 700, x: 0, y: 0, toJSON: () => ({}) });
  await r.settle();
  return r;
}

const grabBar = (r: MatrixRig, id: string): Element => {
  const handle = r.m.container.querySelector(`[data-handle="${r.entry(id).id}"]`);
  assert.ok(handle, `${id}'s grab bar rendered`);
  return handle;
};

/** Presses `id`'s grab bar 40 px left of `x`, moves the pointer to `x` and lets the direction lock take. The pointer stays down. */
export async function pressAndMove(r: MatrixRig, id: string, x: number): Promise<void> {
  await act(async () => void grabBar(r, id).dispatchEvent(pointerEvent('pointerdown', x - 40)));
  await act(async () => void document.dispatchEvent(pointerEvent('pointermove', x)));
  await advanceFrames(FRAME_MS);
}

/** Releases the pointer at `x` and lets the box land. */
export async function lift(x: number): Promise<void> {
  await act(async () => void document.dispatchEvent(pointerEvent('pointerup', x)));
  await advanceFrames(30 * FRAME_MS);
}

export const hold = (n: number): Promise<void> => advanceFrames(n * FRAME_MS);

export async function heldScroll(r: MatrixRig, id: string, x: number): Promise<number> {
  const from = rowOffsetOf(r.m.container);
  await pressAndMove(r, id, x);
  await hold(50);
  const gained = rowOffsetOf(r.m.container) - from;
  await lift(x);
  // A release settles the row onto a stop; a press does not stop that glide, so the next measure waits for it to land.
  await hold(120);
  return gained;
}

export const HALF_ZONE_POINTER = EDGE_WINDOW - LIBRARY_TUNING_DEFAULTS.edgeScroll.zonePx / 2;
export { LIBRARY_TUNING_DEFAULTS };
