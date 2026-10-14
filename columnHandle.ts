/**
 * The column behind `createWorkspaceColumn`: React-free state that the `WorkspaceColumn` component draws. It owns the ordered
 * list of workspaces, their names and the current one, and saves the list through one optional storage. DESIGN.md, "The workspace column".
 */
import { createWorkspace, type WorkspaceHandle, type WorkspaceOptions } from './workspaceCore.js';
import { PanelManagerError } from './panelManagerError.js';
import { cleanWorkspaceName } from './workspaceName.js';
import { refusedLiveKeys, type WorkspaceLive } from './workspaceLive.js';
import type { WorkspaceStorage } from './workspaceState.js';
import type { PanelId } from './panelSettings.js';
import type { PanelTemplate } from './panelTemplate.js';
import type { PanelSettings } from './panelSettings.js';

/** The saved list of a column: which workspaces exist, in order, under which name, and which one was current. @public */
export interface ColumnState {
  /** The shape of this record; a different version reads as nothing saved. */
  version: 1;
  /** The workspaces from top to bottom. */
  workspaces: { id: string; name: string }[];
  /** The id of the current workspace, or null for none. */
  current: string | null;
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
  /** The panel storage of the workspace `id`; its key is the id, which never changes when the workspace is renamed. */
  workspace?(id: string): WorkspaceStorage | undefined;
}

/**
 * What `createWorkspaceColumn` takes. The members of `WorkspaceOptions` that describe a workspace's content (`root`, `templates`,
 * `defaults`, `order`) are the starting point of every workspace; `addWorkspace` may replace them for one. `wrap`, `device`,
 * `tuning`, `labels` and the other shared members belong to the column and apply to every workspace in it.
 * @public
 */
export type ColumnOptions = Omit<WorkspaceOptions, 'id' | 'name' | 'onRename' | 'storage' | 'mount'> & {
  /** Where the column is kept between launches. Unset: nothing is loaded or saved. */
  storage?: ColumnStorage;
  /** Where the column renders itself, as `WorkspaceOptions.mount` says for a workspace. */
  mount?: HTMLElement | false;
};

/** What `addWorkspace` takes: everything is optional. @public */
export interface ColumnWorkspaceOptions {
  /** The workspace's stable id. Unset: `workspace-<n>`. A second workspace with the same id throws `invalid-options`. */
  id?: string;
  /** The workspace's name. Unset: `Workspace <n>`, the smallest number no workspace in the column uses. */
  name?: string;
  /** Where in the column the workspace goes, counting from the top. Unset: at the bottom. */
  index?: number;
  /** This workspace's root template instead of the column's. */
  root?: PanelTemplate;
  /** This workspace's templates instead of the column's. */
  templates?: readonly PanelTemplate[];
  /** This workspace's panel settings instead of the column's. */
  defaults?: Omit<PanelSettings, 'tuning'>;
  /** This workspace's panel order instead of the column's. */
  order?: () => readonly PanelId[];
  /** This workspace's panel storage instead of the column storage's `workspace(id)`. */
  storage?: WorkspaceStorage;
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
  /** Moves to the workspace above or below; false at the end of the column. */
  step(direction: 'up' | 'down'): boolean;
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
  tuning: WorkspaceOptions['tuning'];
}

interface ColumnCore {
  subscribe(l: () => void): () => void;
  snapshot(): ColumnSnapshot;
  /** Whether the column renders itself (see `ColumnOptions.mount`). */
  readonly autoMounted: boolean;
}

const CORES = new WeakMap<WorkspaceColumnHandle, ColumnCore>();

/** What the component reads from a column. Throws `invalid-options` for anything `createWorkspaceColumn` did not make. @internal */
export function columnCoreOf(column: WorkspaceColumnHandle): ColumnCore {
  const core = CORES.get(column);
  if (core === undefined) throw new PanelManagerError('invalid-options', 'expected a column made by createWorkspaceColumn');
  return core;
}

const isColumnState = (v: unknown): v is ColumnState => {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.version !== 1 || !Array.isArray(s.workspaces)) return false;
  if (s.current !== null && typeof s.current !== 'string') return false;
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
  const { storage, mount, ...shared } = o;
  let live: WorkspaceLive = {
    ...(o.device !== undefined ? { device: o.device } : {}),
    ...(o.settings !== undefined ? { settings: o.settings } : {}),
    ...(o.history !== undefined ? { history: o.history } : {}),
    ...(o.snapshots !== undefined ? { snapshots: o.snapshots } : {}),
    ...(o.labels !== undefined ? { labels: o.labels } : {}),
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

  const changed = (): void => {
    snap = undefined;
    for (const l of [...listeners]) l();
  };
  const snapshot = (): ColumnSnapshot => (snap ??= { status, workspaces: list, names: list.map((w) => w.name), current, labels: live.labels, tuning: o.tuning });

  const state = (): ColumnState => ({ version: 1, workspaces: list.map((w) => ({ id: w.id, name: w.name })), current: list[current]?.id ?? null });
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

  const freeName = (): string => {
    const used = new Set(list.map((w) => w.name));
    for (let n = list.length + 1; ; n++) if (!used.has(`Workspace ${n}`)) return `Workspace ${n}`;
  };
  const freeId = (): string => {
    const ids = new Set(list.map((w) => w.id));
    for (let n = list.length + 1; ; n++) if (!ids.has(`workspace-${n}`)) return `workspace-${n}`;
  };

  const make = (a: ColumnWorkspaceOptions, id: string, name: string): WorkspaceHandle => {
    const panels = a.storage ?? storage?.workspace?.(id);
    const ws = createWorkspace({
      ...shared,
      ...live,
      ...(a.root !== undefined ? { root: a.root } : {}),
      ...(a.templates !== undefined ? { templates: a.templates } : {}),
      ...(a.defaults !== undefined ? { defaults: a.defaults } : {}),
      ...(a.order !== undefined ? { order: a.order } : {}),
      ...(panels !== undefined ? { storage: panels } : {}),
      id,
      name,
      mount: false,
      onRename: () => {
        if (!restoring) commit();
      },
    });
    removers.push(() => ws.dispose());
    return ws;
  };

  const insert = (ws: WorkspaceHandle, index: number | undefined): void => {
    const at = index === undefined || !Number.isFinite(index) ? list.length : Math.max(0, Math.min(list.length, Math.trunc(index)));
    const cur = list[current];
    list = [...list.slice(0, at), ws, ...list.slice(at)];
    current = cur === undefined ? at : list.indexOf(cur);
  };

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
      const ws = make(a, id, cleanWorkspaceName(a.name) ?? freeName());
      insert(ws, a.index);
      commit();
      return ws;
    },
    scrollTo: (target) => {
      if (status === 'disposed') return;
      const i = typeof target === 'number' ? target : list.indexOf(target);
      if (!Number.isInteger(i) || i < 0 || i >= list.length || i === current) return;
      current = i;
      commit();
    },
    step: (direction) => {
      const next = current + (direction === 'up' ? -1 : 1);
      if (status === 'disposed' || next < 0 || next >= list.length) return false;
      current = next;
      commit();
      return true;
    },
    update: (change) => {
      if (status === 'disposed') throw new PanelManagerError('disposed', 'the column was disposed');
      const refused = refusedLiveKeys(change);
      if (refused.length > 0) throw new PanelManagerError('invalid-options', `update cannot change ${refused.join(', ')}: only device, settings, history, snapshots, labels, topInset and panels are live`);
      live = { ...live, ...change };
      for (const w of list) w.update(change);
      changed();
    },
    dispose: () => {
      if (status === 'disposed') return;
      status = 'disposed';
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
              if (have === undefined) ordered.push(make({}, s.id, cleanWorkspaceName(s.name) ?? freeName()));
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
