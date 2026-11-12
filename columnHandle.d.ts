/**
 * The column behind `createWorkspaceColumn`: React-free state that the `WorkspaceColumn` component draws. It owns the ordered
 * list of workspaces, their names and the current one, and saves the list through one optional storage. DESIGN.md, "The workspace column".
 */
import { type MovePanelOptions, type MovePanelResult, type WorkspaceHandle, type WorkspaceOptions } from './workspaceCore.js';
import type { ConfigureResult, PanelManager } from './panelManager.js';
import type { PanelId } from './panelSettings.js';
import { type WorkspaceLive } from './workspaceLive.js';
import type { PhonuxTheme } from './defaultTheme.js';
import type { WorkspaceStorage } from './workspaceState.js';
import type { ColumnBands } from './columnBands.js';
/** The saved list of a column: which workspaces exist, in order, under which name, and which one was current. @public */
export interface ColumnState {
    /** The shape of this record; a different version reads as nothing saved. */
    version: 1;
    /** The workspaces from top to bottom. */
    workspaces: {
        id: string;
        name: string;
    }[];
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
};
/** What `addWorkspace` takes: everything is optional. @public */
export interface ColumnWorkspaceOptions {
    /** The workspace's stable id. Unset: `workspace-<n>`. A second workspace with the same id throws `invalid-options`. */
    id?: string;
    /** The workspace's name. Unset: `Workspace <n>`, the smallest number no workspace in the column uses. */
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
    /** Moves to the workspace above or below; false at the end of the column. */
    step(direction: 'up' | 'down'): boolean;
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
}
/** What the component reads from a column. Throws `invalid-options` for anything `createWorkspaceColumn` did not make. @internal */
export declare function columnCoreOf(column: WorkspaceColumnHandle): ColumnCore;
/**
 * A column of workspaces that renders itself (see `ColumnOptions.mount`) unless `mount: false` hands that to a `WorkspaceColumn`
 * the app draws. Add workspaces with `addWorkspace`.
 * @public
 */
export declare function createWorkspaceColumn(o?: ColumnOptions): WorkspaceColumnHandle;
export {};
