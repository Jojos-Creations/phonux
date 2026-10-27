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
 * What an app hands the host and can hand it again with `workspace.update`: the phone size, the snapshot capture, the label overrides, the clearance above the row and the behaviour `useProvidePanels` takes.
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
/** The keys a `WorkspaceLive` names that `update` cannot change, or that are no key of it at all. */
export declare function refusedLiveKeys(input: object): string[];
/**
 * Whether the values carry the same data: functions compare equal whatever their identity (an app that builds its objects
 * with fresh closures every render must not wake every reader every render), a function against no function does not,
 * and plain objects and arrays compare by their members, to a few levels.
 */
export declare function sameLiveData(a: unknown, b: unknown, depth?: number): boolean;
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
export declare function createLiveStore(initial: WorkspaceLive): LiveStore;
