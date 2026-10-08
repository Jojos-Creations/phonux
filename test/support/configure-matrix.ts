/**
 * What the configure matrix reads: the class table as data, the rig every cell and probe mounts, the one helper each of
 * the 61 probes and 36 class cells goes through, and the catalog's names.
 *
 * The table is written by hand from design section 7.6 (the status letters and the defaults) and from each catalog
 * row's `on_configure` cell. Nothing in it is derived from the code under test.
 */
import assert from 'node:assert/strict';
import { createElement, useEffect } from 'react';
import { act } from 'react';
import { mock } from 'node:test';
import { PANEL_SETTINGS_CATALOG, createWorkspace, definePanel, usePanelCapabilities, usePanelCloseEligible, usePanelHidden, usePanelNeighborWidths, usePanelPinned, usePanelReorderEligible } from '../../index.js';
import type { CaptureTrigger, ConfigureResult, PanelHandle, PanelResult, PanelSettings, PanelState, PanelTemplate, PanelWindow, PanelsInput, ProvidedPanels, WorkspaceHandle, WorkspaceOptions } from '../../index.js';
import { panelKey } from '../../panelSettings.js';
import { advanceFrames } from './mount-harness.js';
import { flush, mountWorkspace, type MountedWorkspace } from './workspace-row.js';

// ---------------------------------------------------------------------------
// The class table
// ---------------------------------------------------------------------------

export const CLASSES = ['NOW', 'NEXT', 'STATE', 'SCOPE'] as const;
export type Cls = (typeof CLASSES)[number];

/**
 * The nine statuses of design 7.6: P pending, L live, K parked by the engine, H hidden (held), T the panel a turn's
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
   * 'next-save': the saved file differs only at the next projection, never at the call.
   * 'none': the call writes no file and the next projection is unchanged. null: not part of this class's rows.
   */
  projection: 'next-save' | 'none' | null;
  /** SCOPE only: whether an instance in this status counts when configureTemplate lowers a limit. */
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
    live: { outcome: { kind: 'stored' }, evicts: 1, unmounts: 0, projection: 'next-save' },
    parked: { outcome: { kind: 'stored' }, evicts: 1, unmounts: 0, projection: 'next-save' },
    hidden: { outcome: { kind: 'stored' }, evicts: 1, unmounts: 0, projection: 'next-save' },
    protected: { outcome: { kind: 'stored' }, evicts: 1, unmounts: 0, projection: 'next-save', staysLive: true },
    'closed-declared': { outcome: { kind: 'stored-on-record' }, evicts: null, unmounts: 0, projection: null },
    'closed-anonymous': refused('is-closed'),
    'undo-window': { outcome: { kind: 'stored-on-record' }, evicts: null, unmounts: 0, projection: null },
    'same-turn': refused('busy'),
  },
  // STATE: the park latches (8A) and the pin flip; keepMounted is read at the park commit, so a change reaches the next park only, except a hidden kept panel, which unmounts at this commit.
  STATE: {
    pending: refused('is-pending'),
    live: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: null },
    parked: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: null },
    hidden: { outcome: { kind: 'applied-now' }, evicts: 0, unmounts: 1, projection: null },
    protected: { outcome: { kind: 'stored' }, evicts: 0, unmounts: 0, projection: null, staysLive: true },
    'closed-declared': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'closed-anonymous': refused('is-closed'),
    'undo-window': { outcome: { kind: 'stored-on-record' }, evicts: 0, unmounts: 0, projection: null },
    'same-turn': refused('busy'),
  },
  // SCOPE: configureTemplate names no panel, so a panel's status only decides whether an instance counts against a lowered limit.
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

// ---------------------------------------------------------------------------
// The catalog's names and the one counter every cell and probe goes through
// ---------------------------------------------------------------------------

export const CATALOG_NAMES: readonly string[] = PANEL_SETTINGS_CATALOG.map((d) => d.name);

/** The ten catalog names whose instance-door call is wrong-scope: three template keys, seven workspace-only tuning keys. */
export const WRONG_SCOPE_NAMES: readonly string[] = ['hostCreatable', 'multiple', 'maxInstances', 'tuning.rowGap', 'tuning.saveQuietMs', 'tuning.gestureLockMs', 'tuning.returnTieBreak', 'tuning.dropTieBreak', 'tuning.rowGesture', 'tuning.initialScroll'];

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

// ---------------------------------------------------------------------------
// The views, the rig, the statuses
// ---------------------------------------------------------------------------

/** Mounts and unmounts of each panel's view, by engine id. */
const mounts = new Map<string, { mounted: number; unmounted: number }>();
export const viewLog = {
  reset: (): void => mounts.clear(),
  mounted: (id: string): number => mounts.get(id)?.mounted ?? 0,
  unmounted: (id: string): number => mounts.get(id)?.unmounted ?? 0,
};

/**
 * A view that writes what its slot tells it into data attributes, so a test reads what a person's view would act on.
 * `data-slot` is the engine id; the others are the permission hooks, the neighbour widths and the panel's title.
 */
export const matrixTemplate = (id: string, over: Partial<PanelTemplate> = {}): PanelTemplate =>
  definePanel({
    id,
    view: ({ panel }) => {
      const caps = usePanelCapabilities();
      const closeEligible = usePanelCloseEligible();
      const reorderEligible = usePanelReorderEligible();
      const neighbors = usePanelNeighborWidths();
      const pinned = usePanelPinned();
      const hidden = usePanelHidden();
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
        'data-close': String(closeEligible),
        'data-reorder': String(reorderEligible),
        'data-caps': JSON.stringify({ closable: caps.closable, draggable: caps.draggable, placeable: caps.placeable, resizable: caps.resizable, formFactors: caps.formFactors }),
        'data-neighbors': JSON.stringify(neighbors),
        'data-pinned': String(pinned),
        'data-hidden': String(hidden),
      });
    },
    ...over,
  });

export interface CaptureSpy extends CaptureTrigger {
  captured: string[];
  evicted: string[];
}
export const captureSpy = (): CaptureSpy => {
  const spy: CaptureSpy = { captured: [], evicted: [], capture: (id) => void spy.captured.push(id), evict: (id) => void spy.evicted.push(id) };
  return spy;
};

export interface MatrixRigOptions {
  /** Panels added in order, each from its own template of that id; default a, b, c. */
  ids?: readonly string[];
  /** The template settings per id. */
  settings?: Record<string, PanelSettings>;
  /** Every id gets overflow 'park', so a narrow row parks for room. */
  park?: boolean;
  /** Templates beside the id ones, not added. */
  extra?: readonly PanelTemplate[];
  /** A root named 'root'. Default true. */
  root?: boolean;
  width?: number;
  workspace?: Partial<WorkspaceOptions>;
  over?: Partial<PanelsInput>;
}

export interface MatrixRig {
  ws: WorkspaceHandle;
  m: MountedWorkspace;
  h: Record<string, PanelHandle>;
  capture: CaptureSpy;
  turn: <T>(fn: () => T) => T;
  /** The row in array order by name; a marker entry is left out. */
  order: () => string[];
  live: () => string[];
  entry: (id: string) => PanelWindow;
  state: (id: string) => PanelState;
  provided: () => ProvidedPanels;
  settle: () => Promise<void>;
  /** The data attributes of panel `id`'s mounted view, or null when none is mounted. */
  seen: (id: string) => Record<string, string> | null;
  /** The slot element holding panel `id`'s view. */
  slot: (id: string) => HTMLElement | null;
}

export async function matrixRig(o: MatrixRigOptions = {}): Promise<MatrixRig> {
  const ids = o.ids ?? ['a', 'b', 'c'];
  const capture = captureSpy();
  const ws = createWorkspace({
    ...(o.root === false ? {} : { root: matrixTemplate('root', { settings: { title: 'History' } }) }),
    templates: [...ids.map((id) => matrixTemplate(id, { settings: { ...(o.park === true ? { overflow: 'park' as const } : {}), ...(o.settings?.[id] ?? {}) } })), ...(o.extra ?? [])],
    ...(o.workspace ?? {}),
  });
  const h: Record<string, PanelHandle> = {};
  for (const id of ids) h[id] = ws.addPanel(id);
  const m = mountWorkspace(ws, { width: o.width ?? 4000, over: { capture, ...(o.over ?? {}) } });
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

/** The undo window a close opens, in ms. */
export const UNDO_MS = 10000;

/** Mocks setTimeout so a test can step past the undo window; the caller's afterEach resets it. */
export function mockWindow(): { pastWindow: () => void } {
  mock.timers.enable({ apis: ['setTimeout'] });
  return { pastWindow: () => act(() => mock.timers.tick(UNDO_MS + 1)) };
}

export interface Arranged {
  r: MatrixRig;
  /** The panel the call is for (a panel added in the call's own turn when pending). */
  id: string;
  /** configure(id, patch) the way the status needs it: after another operation in its turn, or on a panel added in its turn. */
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

/** A template that draws nothing special: the singleton the pending status adds. */
function markerless(id: string): PanelTemplate {
  return matrixTemplate(id);
}
