/**
 * The values an auto-mounted workspace takes from its app and can be given again while it runs: what a hand-wired flow
 * passes to `HostProvider`, `Workspace` and `useProvidePanels`. React-free, so `createWorkspace` keeps its import path.
 * DESIGN.md, "Workspace options, wrap and update".
 */
import type { PhoneDeviceAPI } from './hostApi.js';
import type { PhonuxLabels } from './labels.js';
import type { PanelsInput } from './panels/useProvidePanels.js';
import type { SnapshotsAPI } from './snapshots.js';

/**
 * What the `panels` option takes: every `useProvidePanels` input except the ones the mount measures
 * (`phoneWidth`, `containerWidth`, `overflowContainerRef`), the workspace itself (`workspace`) and `labels`, which is its own option.
 * @public
 */
export type WorkspacePanelsInput = Partial<Omit<PanelsInput, 'workspace' | 'phoneWidth' | 'containerWidth' | 'overflowContainerRef' | 'labels'>>;

/**
 * What an app hands the host and can hand it again with `workspace.update`: the phone size, the snapshot capture, the label overrides, the clearance above the row and the behavior `useProvidePanels` takes.
 * `createWorkspace` accepts the same members as its starting values.
 * @public
 */
export type WorkspaceLive = {
  /** The phone size every panel renders at and the model choice. Left out: the default phone size and no model choice. */
  device?: PhoneDeviceAPI;
  /** The picture capture views read through `useViewSnapshot`. Left out: no pictures. */
  snapshots?: SnapshotsAPI;
  /** Overrides of the library's visible strings; a key left out keeps its English default. */
  labels?: Partial<PhonuxLabels>;
  /** Clearance above the row, in px, for chrome the app draws over a column's cell. Standalone, it does not set the row's room: `tuning.rowTop` does. Left out: the row gap. */
  topInset?: number;
  /** What `useProvidePanels` takes beyond what the workspace and the mount supply. */
  panels?: WorkspacePanelsInput;
};

const LIVE_KEYS: readonly string[] = ['device', 'snapshots', 'labels', 'topInset', 'panels'];

/** The keys a `WorkspaceLive` names that `update` cannot change, or that are no key of it at all. */
export function refusedLiveKeys(input: object): string[] {
  return Object.keys(input).filter((k) => !LIVE_KEYS.includes(k));
}

/**
 * Whether the values carry the same data: functions compare equal whatever their identity (an app that builds its objects
 * with fresh closures every render must not wake every reader every render), a function against no function does not,
 * and plain objects and arrays compare by their members, to a few levels.
 */
export function sameLiveData(a: unknown, b: unknown, depth = 4): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (depth === 0 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && sameLiveData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1));
}

/** What a workspace holds of its `WorkspaceLive`: the latest values, a counter that moves when the data changed, and the readers to tell. */
export interface LiveStore {
  /** The latest values: every update lands here, so a closure an app rebuilt is the one a later render hands on. */
  latest(): WorkspaceLive;
  /** Moves when an update changed some data, never for a changed closure alone. */
  version(): number;
  /** Takes `change`; returns whether the data changed and the readers were told. */
  update(change: WorkspaceLive): boolean;
  subscribe(listener: () => void): () => void;
  clear(): void;
}

export function createLiveStore(initial: WorkspaceLive): LiveStore {
  let latest: WorkspaceLive = { ...initial };
  let version = 0;
  const listeners = new Set<() => void>();
  return {
    latest: () => latest,
    version: () => version,
    update: (change) => {
      const next: Record<string, unknown> = { ...latest };
      let changed = false;
      for (const key of LIVE_KEYS) {
        if (!Object.hasOwn(change, key)) continue;
        const value = (change as Record<string, unknown>)[key];
        if (!sameLiveData(next[key], value)) changed = true;
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      latest = next as WorkspaceLive;
      if (!changed) return false;
      version += 1;
      for (const l of [...listeners]) l();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    clear: () => listeners.clear(),
  };
}
