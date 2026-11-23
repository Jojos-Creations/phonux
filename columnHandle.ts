/**
 * The column behind `createWorkspaceColumn`: React-free state that the `WorkspaceColumn` component draws. It owns the ordered
 * list of workspaces, their names and the current one, and saves the list through one optional storage. DESIGN.md, "The workspace column".
 */
import { createWorkspace, transferPanel, type MovePanelOptions, type MovePanelResult, type WorkspaceHandle, type WorkspaceOptions } from './workspaceCore.js';
import { PanelManagerError } from './panelManagerError.js';
import { checkPatch, planTuning, unchanged } from './panelConfigure.js';
import type { ConfigureResult, PanelManager } from './panelManager.js';
import type { PanelId } from './panelSettings.js';
import { cleanWorkspaceName } from './workspaceName.js';
import { refusedLiveKeys, type WorkspaceLive } from './workspaceLive.js';
import type { PhonuxTheme } from './defaultTheme.js';
import type { WorkspaceStorage } from './workspaceState.js';
import type { ColumnBands } from './columnBands.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { evenRows, minRowSlots, planSides, splitProblem, type SideCell, type SideSpace } from './columnSplit.js';
import type { StickyCandidate } from './rowNumbers.js';

/** The saved list of a column: which workspaces exist, in order, under which name, and which one was current. @public */
export interface ColumnState {
  /**
   * The shape of this record. A column made with `sideBySide` writes 2 and reads 1 or 2; any other column writes and reads 1, and
   * a different version reads as nothing saved. A record of version 1 has no `side` and reads as only the current workspace shown.
   */
  version: 1 | 2;
  /** The workspaces from top to bottom. */
  workspaces: { id: string; name: string }[];
  /** The id of the current workspace, or null for none. */
  current: string | null;
  /**
   * Version 2 only: the workspaces the window shows side by side, left to right, and the row slots each is given. The two lists are as
   * long as each other, every split entry is a whole number of at least 1, and the current workspace is among the shown.
   */
  side?: { shown: string[]; split: number[] };
}

/**
 * Where a column keeps its list and the panels of every workspace. Both halves are optional in effect: a column without
 * `workspace` saves no panels and one without `storage` saves nothing.
 * @public
 */
export interface ColumnStorage {
  /** The saved list, or null when nothing is saved. A rejection or a record that is not a `ColumnState` reads as nothing saved. */
  load(): Promise<ColumnState | null>;
  /** Saves the list after it changed. A rejection is reported once through `onError`. */
  save(state: ColumnState): void | Promise<void>;
  /**
   * The panel storage of the workspace `id`, the one place a workspace's panels are kept; its key is the id, which never changes
   * when the workspace is renamed. Asked for each workspace added and each one rebuilt from the saved list. Returning `undefined`
   * gives that workspace no storage: its panels are not saved or restored.
   */
  workspace?(id: string): WorkspaceStorage | undefined;
}

/**
 * What `createWorkspaceColumn` takes. The members of `WorkspaceOptions` that describe a workspace's content (`root`, `templates`,
 * `defaults`, `order`) are the content of every workspace in the column; `addWorkspace` cannot change them for one. `wrap`, `device`,
 * `tuning`, `labels` and the other shared members belong to the column and apply to every workspace in it. `theme` is drawn once for
 * the whole column, and a workspace in it takes that theme.
 * @public
 */
export type ColumnOptions = Omit<WorkspaceOptions, 'id' | 'name' | 'onRename' | 'storage' | 'mount'> & {
  /** Where the column is kept between launches. Unset: nothing is loaded or saved. */
  storage?: ColumnStorage;
  /** Where the column renders itself, as `WorkspaceOptions.mount` says for a workspace. */
  mount?: HTMLElement | false;
  /**
   * What every cell draws above and below its row, fixed for the column's life. Unset: `DEFAULT_COLUMN_BANDS`. Build a variant with
   * `withSlotChanges`; the row keeps `columnBandRoom(bands)` clear of them.
   */
  bands?: ColumnBands;
  /**
   * Whether a window wide enough shows several workspaces side by side, each with its own row and its own sticky panels: `showSide`,
   * `hideSide`, `setSplit` and `focusSide` then act, the saved list carries the shown spaces and their split, and the cells divide the
   * window by whole slots with a draggable divider between them. Unset or false: one workspace shows, as it always did.
   * @defaultValue false
   */
  sideBySide?: boolean;
};

/** One workspace the window shows: where it stands and how many slots it has. @public */
export interface ColumnShown {
  /** The workspace. */
  workspace: WorkspaceHandle;
  /** The whole slots its cell takes: its scrolling row and its sticky panels. */
  slots: number;
  /** The whole slots of its scrolling row, a sticky panel that went back into the row counted. Each is at least 1 while spaces share the window. */
  rowSlots: number;
}

/** Why `showSide`, `hideSide` or `setSplit` changed nothing. @public */
export type SideRefusal =
  | 'disposed'
  | 'not-enabled'
  | 'not-ready'
  | 'not-measured'
  | 'unknown-workspace'
  | 'already-shown'
  | 'not-shown'
  | 'current'
  | 'no-room'
  | 'invalid-split';

/** What `showSide`, `hideSide` and `setSplit` answer: done, or nothing changed and the code says why. @public */
export type SideResult = { ok: true } | { ok: false; code: SideRefusal; message: string };

/** What `addWorkspace` takes: everything is optional. @public */
export interface ColumnWorkspaceOptions {
  /** The workspace's stable id. Unset: `workspace-<n>`. A second workspace with the same id throws `invalid-options`. */
  id?: string;
  /** The workspace's name. Unset: `Space <n>`, the smallest number no workspace in the column uses. */
  name?: string;
  /** Where in the column the workspace goes, counting from the top. Unset: at the bottom. */
  index?: number;
}

/** Where a column is in its life: `loading` until the saved list is read, then `ready`, then `disposed`. @public */
export type ColumnStatus = 'loading' | 'ready' | 'disposed';

/**
 * A column of workspaces, one above the other. It moves between them by `step`, `scrollTo` and the keys and buttons the
 * `WorkspaceColumn` draws; the person cannot scroll it.
 * @public
 */
export interface WorkspaceColumnHandle {
  /** Where the column is in its life. */
  readonly status: ColumnStatus;
  /** The workspaces from top to bottom; a new array whenever the list changes. */
  readonly workspaces: readonly WorkspaceHandle[];
  /** The index of the current workspace, or -1 when the column is empty. */
  readonly current: number;
  /**
   * Creates a workspace from the column's options and `o`, puts it in the column and returns it. This is the only way to add one.
   * The name is stored at once. Before the saved list has been read the workspace is kept and the saved list is laid around it.
   * Throws `disposed` after `dispose()` and `invalid-options` for an id already in the column.
   */
  addWorkspace(o?: ColumnWorkspaceOptions): WorkspaceHandle;
  /** Makes `target` (a handle of this column, or an index) the current workspace. An unknown handle or an index out of range changes nothing. */
  scrollTo(target: WorkspaceHandle | number): void;
  /**
   * Moves to the workspace above or below; false at the end of the column. With `sideBySide` it changes the workspace shown in the side
   * that holds focus (the current one), skipping a workspace another side already shows, so every side shows a different workspace.
   * A workspace the window left out for lack of room is not skipped: it takes the side.
   */
  step(direction: 'up' | 'down'): boolean;
  /**
   * The workspaces the window shows, left to right, a new array whenever any of them changes. Without `sideBySide`, or while the window
   * holds one slot, or before the column has been drawn and measured, it is the current workspace alone. The current workspace is
   * always among them.
   */
  readonly shown: readonly ColumnShown[];
  /**
   * Adds `workspace` to the window as a new side, taking its room from the current workspace: the new side gets half the current one's
   * row slots, rounded down. `options.at` is where it stands among the shown, left to right, counting from 0; unset, just right of the
   * current one. It does not become the current workspace.
   *
   * Nothing changes, and the answer says why, for a column without `sideBySide` (`not-enabled`), one that is disposed or still reading
   * its saved list (`disposed`, `not-ready`), one not yet drawn and measured (`not-measured`), a workspace that is not in the column
   * (`unknown-workspace`) or is shown already (`already-shown`), and a current side with fewer than two row slots to share (`no-room`).
   */
  showSide(workspace: WorkspaceHandle | number, options?: { at?: number }): SideResult;
  /**
   * Takes `workspace` out of the window; the room it had goes to the current workspace. The workspace stays in the column and one `step` away.
   * Refuses, changing nothing, as `showSide` does for a column without `sideBySide`, a disposed, unready or unmeasured one and an unknown
   * workspace, and with `not-shown` for one the window does not show and `current` for the current workspace, which is always shown.
   */
  hideSide(workspace: WorkspaceHandle | number): SideResult;
  /**
   * Sets how many row slots each shown workspace gets, left to right, in `shown`'s order. Each is a whole number of at least 1, the
   * entries are as many as `shown` has, and together they are at most the window's slots; a split that is not is refused with
   * `invalid-split` and changes nothing, and the message says which entry is wrong. Slots the entries leave unused are dealt one at a
   * time, to the current workspace first and then to the nearest ones, and the sticky panels of a space take their own slots besides, so `shown` reports what the window really gives. The split
   * is saved with the column. Also refuses as `showSide` does for a column without `sideBySide`, a disposed or unready one, and an unmeasured one.
   */
  setSplit(rowSlots: readonly number[]): SideResult;
  /**
   * Moves which side holds focus to the shown workspace on the left or the right, making it the current workspace. False, changing
   * nothing, at the end of the shown row and for a column without `sideBySide` or with one workspace shown.
   */
  focusSide(direction: 'left' | 'right'): boolean;
  /**
   * Takes the workspace `target` (a handle of this column, or an index) out of the column and disposes it, so its panels and
   * history leave the screen. Its saved panels are not deleted: the saved list no longer names it, and deleting them is the
   * app's job. When it was the current workspace, the one below becomes current, or the one above when it was the last.
   * Returns false and changes nothing for the last workspace in the column, a workspace that is not in it, a column still
   * reading its saved list (which would bring the workspace back), and a disposed column.
   */
  removeWorkspace(target: WorkspaceHandle | number): boolean;
  /**
   * Moves the workspace `target` (a handle of this column, or an index) to `toIndex` in `workspaces`, the others closing up around
   * it, and saves the new order. The current workspace stays the same workspace; only its index follows the move. A `toIndex` past
   * either end is clamped to it. Returns false and changes nothing for a workspace that is not in the column, a `toIndex` that is
   * not a whole number, a column still reading its saved list (which would lay the saved order over the move), and a disposed
   * column; returns true with nothing changed when `target` already stands at `toIndex`.
   */
  reorderWorkspace(target: WorkspaceHandle | number, toIndex: number): boolean;
  /**
   * Moves the panel `panelId` from the workspace `from` to the end of the row of the workspace `to`, in the same column. Each
   * workspace is a handle of this column or an index into `workspaces`. The panel stays the same panel: its template, params, url,
   * title, size (slot count, and whether the person chose it) and saved identity (`uid`) all go with it; where it stood in the old row and whether the person made it parkable do not, the target saves it
   * and the source stops saving it, so it survives a reload in the workspace it ended up in and is gone from the other. The current
   * workspace does not change; to follow the panel, `scrollTo(result.workspace)`.
   *
   * Nothing moves, and the answer says why, for: a column that is disposed (`disposed`); a workspace that is not in the column
   * (`unknown-workspace`); the same workspace twice (`same-workspace`); a panel the source does not hold (`unknown-panel`); the
   * workspace's root panel (`root-fixed`); an always-shown column, a panel whose `movable` is false and a panel that code declares
   * again at every launch unless closing it is final (`not-movable`); a target whose template is not registered (`unknown-panel`) or
   * that is at the template's instance limit or already holds a panel under that id (`instance-limit`); and a panel with an operation
   * in flight (`busy`).
   *
   * Both workspaces must be drawn (by `WorkspaceColumn`, which mounts every cell, or by an app's own row) and finished loading;
   * otherwise the answer is `not-attached` or `not-ready` and nothing changed. A view's `useViewState` is held per workspace and
   * does not move: the view starts again from its `initial`. The host data the target's `panels.defaultHostData` builds is given
   * afresh, and the source's is dropped. A parked panel arrives live, as a new panel does.
   *
   * The moved panel arrives with no opener (`PanelState.openedBy` is null), and the panels it opened in the source take its old
   * opener. With `{ withFamily: true }` every panel it opened, directly or through the panels it opened, moves with it: they land
   * after it in the order they stood, keep who opened whom among them, and the same checks apply to each one, all or nothing, so
   * one refusal moves none and its message names the panel that stood in the way. The target's lack of room is never a refusal:
   * it makes room as it does for any new panel, under its cap.
   */
  movePanel(from: WorkspaceHandle | number, panelId: PanelId, to: WorkspaceHandle | number, options?: MovePanelOptions): MovePanelResult;
  /**
   * What `movePanel` with the same arguments would answer now, without moving anything: a host lists as move targets only the
   * workspaces this accepts.
   */
  canMovePanel(from: WorkspaceHandle | number, panelId: PanelId, to: WorkspaceHandle | number, options?: MovePanelOptions): MovePanelResult;
  /**
   * `WorkspaceManager.configureTuning` for the whole column: the patch reaches every workspace in it, those added later start from it,
   * and the column's own slide follows it. Kept for this session only. It works before the saved list has been read and refuses
   * only after `dispose()`. Throws `invalid-settings` for a key or value the tuning does not accept, and answers `wrong-scope` for
   * `tuning` itself, as the workspace's does. The answer is the column's own: a workspace disposed on its own keeps refusing and is not
   * reported. A workspace's own `configureTuning` after this one wins for that workspace until the column changes the key again.
   */
  configureTuning(patch: Parameters<PanelManager['configureTuning']>[0]): ConfigureResult;
  /** Gives every workspace the new live values, and every workspace added later; the same members as `WorkspaceHandle.update`. */
  update(live: WorkspaceLive): void;
  /** Disposes every workspace and takes the column off the screen. */
  dispose(): void;
}

/** The column's numbers and strings the component draws; a new object whenever any of them changes. @internal */
export interface ColumnSnapshot {
  status: ColumnStatus;
  workspaces: readonly WorkspaceHandle[];
  names: readonly string[];
  current: number;
  labels: WorkspaceLive['labels'];
  /** The clearance above the column's own controls: the `topInset` the column was given, 0 without one. */
  topInset: number;
  tuning: WorkspaceOptions['tuning'];
  /** Whether the column was made with `sideBySide`. */
  sideBySide: boolean;
  /** The cells the window shows, left to right; the current workspace alone while one space shows. */
  shown: readonly SideCell[];
  /** The phone width the slots are priced at, or undefined for the library default, and the row gap. */
  phoneWidth: number | undefined;
  rowGap: number;
  /** The least row slots a side keeps. */
  leastRows: number;
}

interface ColumnCore {
  subscribe(l: () => void): () => void;
  snapshot(): ColumnSnapshot;
  /** Whether the column renders itself (see `ColumnOptions.mount`). */
  readonly autoMounted: boolean;
  /** The theme function every cell is drawn under, if the app gave one. */
  readonly theme: ((mode: 'light' | 'dark') => PhonuxTheme) | undefined;
  /** The bands every cell draws, if the app gave them. */
  readonly bands: ColumnBands | undefined;
  /** Reports an error the column swallowed: `onError`, else `console.error`. */
  reportError(e: unknown): void;
  /** The drawn width of the column in px, which the slots of the window are counted from at `phoneWidth`; 0 while it is not drawn. */
  setWindowWidth(px: number, phoneWidth: number): void;
  /** Sets the split to the one with every shown side as even as whole slots allow. */
  evenSplit(): SideResult;
}

const CORES = new WeakMap<WorkspaceColumnHandle, ColumnCore>();

/** What the component reads from a column. Throws `invalid-options` for anything `createWorkspaceColumn` did not make. @internal */
export function columnCoreOf(column: WorkspaceColumnHandle): ColumnCore {
  const core = CORES.get(column);
  if (core === undefined) throw new PanelManagerError('invalid-options', 'expected a column made by createWorkspaceColumn');
  return core;
}

const isSide = (v: unknown): v is NonNullable<ColumnState['side']> => {
  if (typeof v !== 'object' || v === null) return false;
  const { shown, split } = v as Record<string, unknown>;
  if (!Array.isArray(shown) || !Array.isArray(split) || shown.length !== split.length) return false;
  return new Set(shown).size === shown.length && shown.every((id) => typeof id === 'string' && id !== '') && split.every((n) => Number.isInteger(n) && (n as number) >= 1);
};

const isColumnState = (v: unknown): v is ColumnState => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if ((s.version !== 1 && s.version !== 2) || !Array.isArray(s.workspaces)) return false;
  if (s.current !== null && typeof s.current !== 'string') return false;
  // A malformed `side` is read as none, so the workspaces it sits beside are not lost with it.
  const seen = new Set<string>();
  return s.workspaces.every((w) => {
    if (typeof w !== 'object' || w === null) return false;
    const { id, name } = w as Record<string, unknown>;
    if (typeof id !== 'string' || id === '' || typeof name !== 'string' || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * A column of workspaces that renders itself (see `ColumnOptions.mount`) unless `mount: false` hands that to a `WorkspaceColumn`
 * the app draws. Add workspaces with `addWorkspace`.
 * @public
 */
export function createWorkspaceColumn(o: ColumnOptions = {}): WorkspaceColumnHandle {
  const { storage, mount, bands, ...shared } = o;
  let tuningInput = o.tuning;
  let live: WorkspaceLive = {
    ...(o.device !== undefined ? { device: o.device } : {}),
    ...(o.snapshots !== undefined ? { snapshots: o.snapshots } : {}),
    ...(o.labels !== undefined ? { labels: o.labels } : {}),
    ...(o.icons !== undefined ? { icons: o.icons } : {}),
    ...(o.topInset !== undefined ? { topInset: o.topInset } : {}),
    ...(o.panels !== undefined ? { panels: o.panels } : {}),
  };
  const reportError = (e: unknown): void => {
    if (o.onError === undefined) console.error(e);
    else {
      try {
        o.onError(e);
      } catch {
        // A reporter that throws must not break the work that raised the error.
      }
    }
  };
  let status: ColumnStatus = storage === undefined ? 'ready' : 'loading';
  let list: WorkspaceHandle[] = [];
  let current = -1;
  const listeners = new Set<() => void>();
  const removers: Array<() => void> = [];
  let snap: ColumnSnapshot | undefined;
  let restoring = false;
  const sideBySide = o.sideBySide === true;
  // The saved split: the workspaces the window is asked to show, left to right, and the row slots each is given. What the window can
  // hold decides how much of it is drawn (`planNow`); a space it cannot hold stays here and comes back when the window widens.
  let sides: { id: string; rows: number }[] = [];
  let windowWidth = 0;
  let pricedAt = 0;
  // Bumped by anything the plan reads, so a plan is worked out once per change.
  let version = 0;
  let planned: { at: number; cells: SideCell[]; sig: string } | undefined;
  const panelSubs = new Map<string, () => void>();

  const rowGap = (): number => resolveWorkspaceTuning(tuningInput).rowGap;
  const leastRows = (): number => minRowSlots(resolveWorkspaceTuning(tuningInput).minScrollSlots);
  /** The whole slots the window holds at the phone size it was measured with: the room less one gap, in phones and gaps. 0 while it is not measured. */
  const windowSlots = (): number => (windowWidth > 0 && pricedAt > 0 ? Math.max(1, Math.floor((windowWidth - rowGap()) / (pricedAt + rowGap()))) : 0);
  const stickyOf = (ws: WorkspaceHandle): { sticky: StickyCandidate[]; panels: number } => {
    const present = ws.panels
      .getSnapshot()
      .panels.filter((p) => p.status === 'live')
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const sticky = present.flatMap((p, k) => (p.settings.sticky === 'off' ? [] : [{ k, slots: Math.max(1, p.slots ?? 1), rank: p.settings.stickyRank }]));
    return { sticky, panels: present.length };
  };
  const spacesNow = (): { spaces: SideSpace[]; at: number } => {
    const cur = list[current];
    if (cur === undefined) return { spaces: [], at: -1 };
    const rows = sideBySide ? sides.filter((e) => list.some((w) => w.id === e.id)) : [];
    const entries = rows.some((e) => e.id === cur.id) ? rows : [{ id: cur.id, rows: 1 }];
    const spaces = entries.map((e) => ({ id: e.id, rows: e.rows, ...stickyOf(list.find((w) => w.id === e.id)!) }));
    return { spaces, at: spaces.findIndex((x) => x.id === cur.id) };
  };
  const planNow = (): { cells: SideCell[]; sig: string } => {
    if (planned !== undefined && planned.at === version) return planned;
    const { spaces, at } = spacesNow();
    const cells = planSides({ spaces, current: at, windowSlots: windowSlots(), minScrollSlots: resolveWorkspaceTuning(tuningInput).minScrollSlots });
    planned = { at: version, cells, sig: cells.map((c) => `${c.id}:${c.slots}:${c.rowSlots}`).join('|') };
    return planned;
  };
  /** Something the plan reads changed outside the column's own methods: tell the readers only when what the window shows is not what it showed. */
  const replan = (): void => {
    if (status === 'disposed') return;
    const before = planNow().sig;
    version++;
    if (planNow().sig === before) return;
    snap = undefined;
    for (const l of [...listeners]) l();
  };

  const changed = (): void => {
    version++;
    snap = undefined;
    for (const l of [...listeners]) l();
  };
  const snapshot = (): ColumnSnapshot =>
    (snap ??= { status, workspaces: list, names: list.map((w) => w.name), current, labels: live.labels, topInset: live.topInset ?? 0, tuning: tuningInput, sideBySide, shown: planNow().cells, phoneWidth: live.device?.size.width, rowGap: rowGap(), leastRows: leastRows() });

  const state = (): ColumnState => {
    const base = { workspaces: list.map((w) => ({ id: w.id, name: w.name })), current: list[current]?.id ?? null };
    if (!sideBySide) return { version: 1, ...base };
    const kept = sides.filter((e) => list.some((w) => w.id === e.id));
    return { version: 2, ...base, side: { shown: kept.map((e) => e.id), split: kept.map((e) => e.rows) } };
  };
  // Saves go one after another so a slow one cannot land after the one that followed it.
  let saving: Promise<void> = Promise.resolve();
  const persist = (): void => {
    if (storage === undefined || status !== 'ready' || restoring) return;
    const next = state();
    saving = saving.then(async () => {
      try {
        await storage.save(next);
      } catch (e) {
        reportError(e);
      }
    });
  };
  const commit = (): void => {
    changed();
    persist();
  };

  /** `movePanel`, or with `run` false `canMovePanel`. */
  const move = (from: WorkspaceHandle | number, panelId: PanelId, to: WorkspaceHandle | number, options: MovePanelOptions | undefined, run: boolean): MovePanelResult => {
    const stay = (code: Extract<MovePanelResult, { ok: false }>['code'], message: string): MovePanelResult => ({ ok: false, code, message });
    if (status === 'disposed') return stay('disposed', 'the column was disposed');
    const at = (w: WorkspaceHandle | number): number => (typeof w === 'number' ? (Number.isInteger(w) && w >= 0 && w < list.length ? w : -1) : list.indexOf(w));
    const source = at(from);
    const target = at(to);
    if (source < 0 || target < 0) return stay('unknown-workspace', `${source < 0 ? 'the source' : 'the target'} workspace is not in this column`);
    if (source === target) return stay('same-workspace', `panel '${panelId}' is already in workspace '${list[source]!.name}'`);
    const moved = transferPanel(list[source]!, panelId, list[target]!, options ?? {}, run);
    if (!moved.ok) return moved;
    return { ok: true, workspace: list[target]!, index: target, panelId, panelIds: moved.panelIds };
  };

  const freeName = (): string => {
    const used = new Set(list.map((w) => w.name));
    // Saved names are kept as they were: a "Workspace N" never matches "Space N", so it neither blocks nor shifts the next number.
    for (let n = list.length + 1; ; n++) if (!used.has(`Space ${n}`)) return `Space ${n}`;
  };
  const freeId = (): string => {
    const ids = new Set(list.map((w) => w.id));
    for (let n = list.length + 1; ; n++) if (!ids.has(`workspace-${n}`)) return `workspace-${n}`;
  };

  const make = (id: string, name: string): WorkspaceHandle => {
    const panels = storage?.workspace?.(id);
    const ws = createWorkspace({
      ...shared,
      ...live,
      ...(tuningInput !== undefined ? { tuning: tuningInput } : {}),
      ...(panels !== undefined ? { storage: panels } : {}),
      id,
      name,
      mount: false,
      onRename: () => {
        if (!restoring) commit();
      },
    });
    removers.push(() => ws.dispose());
    // The window's plan reads each space's sticky panels, so it is worked out again when a workspace's panels change.
    panelSubs.set(id, ws.panels.subscribe(replan));
    return ws;
  };

  const insert = (ws: WorkspaceHandle, index: number | undefined): void => {
    const at = index === undefined || !Number.isFinite(index) ? list.length : Math.max(0, Math.min(list.length, Math.trunc(index)));
    const cur = list[current];
    list = [...list.slice(0, at), ws, ...list.slice(at)];
    current = cur === undefined ? at : list.indexOf(cur);
  };

  const find = (target: WorkspaceHandle | number): WorkspaceHandle | undefined => (typeof target === 'number' ? (Number.isInteger(target) ? list[target] : undefined) : list.includes(target) ? target : undefined);
  const visibleIds = (): string[] => planNow().cells.map((c) => c.id);
  const stay = (code: SideRefusal, message: string): SideResult => ({ ok: false, code, message });
  /** What every side verb checks first: null when the column can take it. */
  const sideGate = (): SideResult | null => {
    if (status === 'disposed') return stay('disposed', 'the column was disposed');
    if (!sideBySide) return stay('not-enabled', 'the column was not made with sideBySide');
    if (status !== 'ready') return stay('not-ready', 'the column is still reading its saved list');
    if (windowSlots() === 0) return stay('not-measured', 'the column has not been drawn and measured yet');
    return null;
  };
  /** The saved split with every space the window shows taking the row slots it shows now, so a change to one side leaves the others as drawn. */
  const frozenSides = (): { id: string; rows: number }[] => {
    const cells = planNow().cells;
    const out = sides.filter((e) => list.some((w) => w.id === e.id)).map((e) => ({ id: e.id, rows: cells.find((c) => c.id === e.id)?.rowSlots ?? e.rows }));
    for (const c of cells) if (!out.some((e) => e.id === c.id)) out.push({ id: c.id, rows: c.rowSlots });
    return out;
  };
  /**
   * Makes list[i] the current workspace. A workspace the window shows takes the focus and nothing else changes. One it does not show
   * takes the current one's place in the window, and no saved side is discarded: a space that left the window for lack of room keeps its
   * entry, so a wider window brings the saved order and split back. Only a space with no entry takes the current one's.
   */
  const moveTo = (i: number): void => {
    const was = list[current];
    const now = list[i];
    const showing = new Set(visibleIds());
    current = i;
    if (!sideBySide || was === undefined || now === undefined || showing.has(now.id) || sides.some((e) => e.id === now.id)) return;
    sides = sides.map((e) => (e.id === was.id ? { ...e, id: now.id } : e));
    if (!sides.some((e) => e.id === now.id)) sides.push({ id: now.id, rows: 1 });
  };
  let shownMemo: { sig: string; list: readonly ColumnShown[] } | undefined;

  const column: WorkspaceColumnHandle = {
    get status() {
      return status;
    },
    get workspaces() {
      return list;
    },
    get current() {
      return current;
    },
    addWorkspace: (a = {}) => {
      if (status === 'disposed') throw new PanelManagerError('disposed', 'the column was disposed');
      const id = a.id ?? freeId();
      if (list.some((w) => w.id === id)) throw new PanelManagerError('invalid-options', `the column already has a workspace '${id}'`);
      const ws = make(id, cleanWorkspaceName(a.name) ?? freeName());
      insert(ws, a.index);
      commit();
      return ws;
    },
    scrollTo: (target) => {
      if (status === 'disposed') return;
      const i = typeof target === 'number' ? target : list.indexOf(target);
      if (!Number.isInteger(i) || i < 0 || i >= list.length || i === current) return;
      moveTo(i);
      commit();
    },
    step: (direction) => {
      const by = direction === 'up' ? -1 : 1;
      const showing = new Set(sideBySide ? visibleIds() : []);
      let next = current + by;
      while (list[next] !== undefined && showing.has(list[next]!.id)) next += by;
      if (status === 'disposed' || next < 0 || next >= list.length) return false;
      moveTo(next);
      commit();
      return true;
    },
    get shown() {
      const cells = planNow().cells;
      if (shownMemo?.sig !== planNow().sig) shownMemo = { sig: planNow().sig, list: cells.map((c) => ({ workspace: list.find((w) => w.id === c.id)!, slots: c.slots, rowSlots: c.rowSlots })) };
      return shownMemo.list;
    },
    showSide: (target, options) => {
      const refused = sideGate();
      if (refused !== null) return refused;
      const ws = find(target);
      if (ws === undefined) return stay('unknown-workspace', 'the workspace is not in this column');
      const cells = planNow().cells;
      if (cells.some((c) => c.id === ws.id)) return stay('already-shown', `'${ws.name}' is shown already`);
      const here = cells.find((c) => c.id === list[current]!.id)!;
      const least = leastRows();
      if (here.rowSlots < 2 * least) return stay('no-room', `'${list[current]!.name}' has ${here.rowSlots} row slot${here.rowSlots === 1 ? '' : 's'} and a side needs at least ${least} each, so it cannot share`);
      const give = Math.floor(here.rowSlots / 2);
      const own = stickyOf(ws).sticky.reduce((sum, c) => sum + c.slots, 0);
      const entries = frozenSides().filter((e) => e.id !== ws.id);
      const mine = entries.find((e) => e.id === here.id)!;
      mine.rows -= give;
      const ids = cells.map((c) => c.id);
      const asked = options?.at;
      const place = asked === undefined || !Number.isFinite(asked) ? ids.indexOf(here.id) + 1 : Math.max(0, Math.min(ids.length, Math.trunc(asked)));
      const before = ids[place];
      const index = before === undefined ? entries.findIndex((e) => e.id === ids[ids.length - 1]) + 1 : entries.findIndex((e) => e.id === before);
      entries.splice(index, 0, { id: ws.id, rows: Math.max(least, give - own) });
      sides = entries;
      commit();
      return { ok: true };
    },
    hideSide: (target) => {
      const refused = sideGate();
      if (refused !== null) return refused;
      const ws = find(target);
      if (ws === undefined) return stay('unknown-workspace', 'the workspace is not in this column');
      if (!sides.some((e) => e.id === ws.id) && !visibleIds().includes(ws.id)) return stay('not-shown', `'${ws.name}' is not shown`);
      if (ws === list[current]) return stay('current', `'${ws.name}' is the current workspace, which is always shown`);
      const cells = planNow().cells;
      const freed = cells.find((c) => c.id === ws.id)?.slots ?? 0;
      const entries = frozenSides().filter((e) => e.id !== ws.id);
      const mine = entries.find((e) => e.id === list[current]!.id);
      if (mine !== undefined) mine.rows += freed;
      sides = entries;
      commit();
      return { ok: true };
    },
    setSplit: (rows) => {
      const refused = sideGate();
      if (refused !== null) return refused;
      const cells = planNow().cells;
      const problem = splitProblem(rows, cells.length, windowSlots(), leastRows());
      if (problem !== null) return stay('invalid-split', problem);
      const entries = frozenSides();
      cells.forEach((c, k) => {
        entries.find((e) => e.id === c.id)!.rows = rows[k]!;
      });
      const same = entries.length === sides.length && entries.every((e, k) => e.id === sides[k]!.id && e.rows === sides[k]!.rows);
      if (same) return { ok: true };
      sides = entries;
      commit();
      return { ok: true };
    },
    focusSide: (direction) => {
      if (status === 'disposed' || !sideBySide) return false;
      const ids = visibleIds();
      const to = ids[ids.indexOf(list[current]?.id ?? '') + (direction === 'left' ? -1 : 1)];
      const i = to === undefined ? -1 : list.findIndex((w) => w.id === to);
      if (i < 0) return false;
      moveTo(i);
      commit();
      return true;
    },
    removeWorkspace: (target) => {
      const i = typeof target === 'number' ? target : list.indexOf(target);
      if (status !== 'ready' || list.length < 2 || !Number.isInteger(i) || i < 0 || i >= list.length) return false;
      const removed = list[i]!;
      const cur = list[current];
      const place = sides.findIndex((e) => e.id === removed.id);
      const rows = sides[place]?.rows ?? 1;
      panelSubs.get(removed.id)?.();
      panelSubs.delete(removed.id);
      removed.dispose();
      list = list.filter((w) => w !== removed);
      current = cur === removed ? Math.min(i, list.length - 1) : cur === undefined ? -1 : list.indexOf(cur);
      // The workspace that becomes current takes the side the removed one held, unless another side shows it already.
      sides = sides.filter((e) => e.id !== removed.id);
      const now = list[current];
      if (sideBySide && now !== undefined && !sides.some((e) => e.id === now.id)) sides.splice(Math.max(0, place), 0, { id: now.id, rows });
      commit();
      return true;
    },
    reorderWorkspace: (target, toIndex) => {
      const i = typeof target === 'number' ? target : list.indexOf(target);
      if (status !== 'ready' || !Number.isInteger(i) || i < 0 || i >= list.length || !Number.isInteger(toIndex)) return false;
      const to = Math.max(0, Math.min(list.length - 1, toIndex));
      if (to === i) return true;
      const moved = list[i]!;
      const cur = list[current];
      const rest = list.filter((w) => w !== moved);
      list = [...rest.slice(0, to), moved, ...rest.slice(to)];
      current = cur === undefined ? -1 : list.indexOf(cur);
      commit();
      return true;
    },
    movePanel: (from, panelId, to, options) => move(from, panelId, to, options, true),
    canMovePanel: (from, panelId, to, options) => move(from, panelId, to, options, false),
    configureTuning: (patch) => {
      if (status === 'disposed') return { ok: false, code: 'disposed', message: 'the column was disposed' };
      const checked = checkPatch('tuning', patch);
      if ('refusal' in checked) return { ok: false, ...checked.refusal };
      const plan = planTuning(tuningInput, patch as Record<string, unknown>);
      if (!plan.changed) return unchanged();
      tuningInput = plan.input;
      for (const w of list) w.panels.configureTuning(patch);
      changed();
      return { ok: true, changed: true, shown: false, now: plan.now, later: plan.later, shadowed: [], notes: [] };
    },
    update: (change) => {
      if (status === 'disposed') throw new PanelManagerError('disposed', 'the column was disposed');
      const refused = refusedLiveKeys(change);
      if (refused.length > 0) throw new PanelManagerError('invalid-options', `update cannot change ${refused.join(', ')}: only device, settings, history, snapshots, labels, icons, topInset and panels are live`);
      live = { ...live, ...change };
      for (const w of list) w.update(change);
      changed();
    },
    dispose: () => {
      if (status === 'disposed') return;
      status = 'disposed';
      for (const off of panelSubs.values()) off();
      panelSubs.clear();
      for (const remove of removers.splice(0)) remove();
      list = [];
      current = -1;
      changed();
      listeners.clear();
    },
  };

  CORES.set(column, {
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    snapshot,
    autoMounted: mount !== false && typeof document !== 'undefined',
    theme: o.theme,
    bands,
    reportError,
    setWindowWidth: (px, phone) => {
      const width = Number.isFinite(px) ? Math.max(0, Math.floor(px)) : 0;
      if (width === windowWidth && phone === pricedAt) return;
      windowWidth = width;
      pricedAt = Number.isFinite(phone) && phone > 0 ? phone : 0;
      replan();
    },
    evenSplit: () => {
      const refused = sideGate();
      if (refused !== null) return refused;
      const cells = planNow().cells;
      return column.setSplit(
        evenRows(
          cells.map((c) => c.sticky),
          windowSlots(),
          leastRows(),
        ),
      );
    },
  });

  if (storage !== undefined) {
    // The saved list is laid around the workspaces code added before it arrived: saved ones keep their saved order and name.
    void Promise.resolve()
      .then(() => storage.load())
      .catch(() => null)
      .then((saved) => {
        if (status === 'disposed') return;
        restoring = true;
        try {
          if (isColumnState(saved)) {
            const keep = list[current]?.id;
            const byId = new Map(list.map((w) => [w.id, w]));
            const ordered: WorkspaceHandle[] = [];
            for (const s of saved.workspaces) {
              const have = byId.get(s.id);
              if (have === undefined) ordered.push(make(s.id, cleanWorkspaceName(s.name) ?? freeName()));
              else {
                have.rename(s.name);
                ordered.push(have);
                byId.delete(s.id);
              }
            }
            list = [...ordered, ...byId.values()];
            const id = saved.current ?? keep;
            const at = list.findIndex((w) => w.id === id);
            current = at >= 0 ? at : list.length > 0 ? Math.min(Math.max(current, 0), list.length - 1) : -1;
            // A record of version 1, or one with no readable `side`, shows only the current workspace.
            const side = sideBySide && saved.version === 2 && isSide(saved.side) ? saved.side : undefined;
            const known = new Set(list.map((w) => w.id));
            sides = side === undefined ? [] : side.shown.flatMap((sid, k) => (known.has(sid) ? [{ id: sid, rows: side.split[k]! }] : []));
            const now = list[current];
            if (sideBySide && now !== undefined && !sides.some((e) => e.id === now.id)) sides = side === undefined ? [{ id: now.id, rows: 1 }] : [...sides, { id: now.id, rows: 1 }];
          }
        } finally {
          restoring = false;
        }
        status = 'ready';
        changed();
        persist();
      });
  }

  if (CORES.get(column)?.autoMounted === true) {
    // Loaded on demand so a column that never mounts keeps `react-dom/client` off its import path; a mount that outlives a dispose is undone at once.
    void import('./autoMount.js')
      .then((m) => {
        if (status === 'disposed') return;
        removers.push(m.mountColumn(column, mount === false ? undefined : mount, reportError));
      })
      .catch(reportError);
  }
  return column;
}
