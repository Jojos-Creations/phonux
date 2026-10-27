/**
 * The workspace behind `createWorkspace`: React-free state that the provider hook attaches to. Declarative intents
 * (`addPanel` before the workspace is ready) are replayed at every settle; after ready `addPanel` asks the attached
 * engine to create the panel. The engine's controls reach this module through `publish` and are used only here,
 * through the handles and the reader built over `ReadSource`; DESIGN.md, "The workspace core", says why.
 */
import type { PhonuxTheme } from './defaultTheme.js';
import type { ComponentType, ReactNode } from 'react';
import type { JsonValue } from './hostApi.js';
import { type ConfigureOutcome } from './panelConfigure.js';
import { type PanelHandle } from './panelHandles.js';
import { type ConfigureResult, type PanelManager, type PanelOpSource, type PanelResult, type ResetResult } from './panelManager.js';
import { type PanelRefusal } from './panelManagerError.js';
import type { AddPlacement, PanelId, PanelSettings, PanelSettingsResolution, ResolvedPanelSettings, ResolvedWorkspaceTuning, ScrollAlign, SettingNote, WorkspaceTuning } from './panelSettings.js';
import type { PanelTemplate, AnyPanelTemplate, WorkspaceStatus } from './panelTemplate.js';
import { type PanelWindow } from './panelWindow.js';
import type { PanelViewContext } from './panelViewContext.js';
import type { DeclaredPanel } from './workspacePlan.js';
import type { WorkspaceStorage } from './workspaceState.js';
import { type PlaceOpen } from './openPlacement.js';
import { type LiveStore, type WorkspaceLive } from './workspaceLive.js';
/** The id of the marker entry a workspace without a root keeps. */
export declare const ROOT_MARKER_ID = "__root__";
/** The next id for an engine entry. A module counter, bumped only from handlers and the restore callback, never from a state initialiser. */
export declare const nextEngineId: () => string;
/** Moves the counter past the number after the first `~` of every restored key, which `nextEngineId` restarted below at launch and would otherwise hand out again. The counter only rises, so calling this twice, or from two workspaces, is harmless. */
export declare function seedEngineIdsPast(keys: Iterable<string | undefined>): void;
/** What `wrap` renders: the workspace's row as `children`, and the workspace it belongs to. @public */
export interface WorkspaceWrapProps {
    /** The row, inside the host and the panels API. */
    children: ReactNode;
    /** The workspace being mounted: a hook in `wrap` reads it and calls `update` on it. */
    workspace: WorkspaceHandle;
}
/**
 * What `createWorkspace` takes; every member is optional. The members of `WorkspaceLive` are its starting values and
 * `workspace.update` changes them later; everything else is fixed for the workspace's life.
 * @public
 */
export type WorkspaceOptions = WorkspaceLive & {
    /** The workspace's stable id, the key a column stores its panels under. Unset: a counter id. */
    id?: string;
    /** The workspace's name, shown by a column. Unset: `'Workspace'`. Trimmed and cut to `MAX_WORKSPACE_NAME` characters; an empty one is ignored. */
    name?: string;
    /** Called with the new name after `workspace.rename` changed it, never for the name the workspace started with. */
    onRename?: (name: string) => void;
    /** Where the workspace is kept between launches. Unset: nothing is loaded or saved. */
    storage?: WorkspaceStorage;
    /** The workspace's panel settings, the layer under every template. */
    defaults?: PanelSettings;
    /** The root panel's template. Unset: the row has an invisible marker entry as its root. */
    root?: AnyPanelTemplate;
    /** The templates panels of this workspace may be made from. */
    templates?: readonly AnyPanelTemplate[];
    /** The developer's panel order, read by every placement whose value is `'order'`. */
    order?: () => readonly PanelId[];
    /** The workspace's tuning leaves; each one left out or out of range takes the library default. */
    tuning?: WorkspaceTuning;
    /** What a template asking for a forced setting does: `'warn'` (default) logs once per panel and setting, `'throw'` throws a PanelManagerError, `'off'` is silent. */
    conflicts?: 'warn' | 'throw' | 'off';
    /** Draws the ids of new panels, for the engine and for the suffix of an anonymous instance; must return a different string each call. Default: a counter. */
    newId?: () => string;
    /** Receives an error the workspace swallows, such as a storage whose save fails. Unset: `console.error`. */
    onError?: (e: unknown) => void;
    /**
     * Where the workspace renders itself. Unset: a full-window element the workspace creates, appends to `document.body` and
     * removes on `dispose()`. An element: rendered inside it, which is never emptied. `false`: nothing is mounted, for an app
     * that renders the workspace through `HostProvider`, `Workspace` and `PanelRow` itself. Without a `document` nothing is mounted either.
     */
    mount?: HTMLElement | false;
    /**
     * The theme the mount draws for the color scheme the window prefers (`prefers-color-scheme`, the only mode source), with
     * one `CssBaseline`. Unset: `createDefaultTheme`. A `wrap` must not draw its own `ThemeProvider` or `CssBaseline`. It runs once
     * per mode; a throw or a value that is not a theme goes to `onError` and the default theme is drawn. A workspace in a column
     * takes the column's theme. Ignored when `mount` is `false`.
     */
    theme?: (mode: 'light' | 'dark') => PhonuxTheme;
    /**
     * A component rendered around the auto-mounted row, inside the host: the theme, the capture registry and the app's own
     * contexts go here, and a hook in it may read `useHost()` and call `workspace.update`. Fixed at creation, so it keeps
     * one identity for the workspace's life and never remounts. Ignored when `mount` is `false`.
     */
    wrap?: ComponentType<WorkspaceWrapProps>;
};
/**
 * A workspace: the panels of one row, the templates they are made from and their saved state.
 * @public
 */
export interface WorkspaceHandle {
    /** The workspace's stable id: it never changes, whatever the name does. */
    readonly id: string;
    /** The workspace's current name. */
    readonly name: string;
    /**
     * Renames the workspace and returns the name it now has. The name is trimmed and cut to `MAX_WORKSPACE_NAME` characters; a name
     * empty after trimming changes nothing and the current name comes back. Two workspaces may share a name, because the id tells them apart.
     * @throws PanelManagerError with code `disposed` after `dispose()`.
     */
    rename(name: string): string;
    /** The id of the row's root entry: the root template's id, or `'__root__'` without one. */
    readonly rootId: string;
    /** Every panel by id, as operable handles, and the calls that configure the workspace. Use `PanelReader` for read-only access. */
    readonly panels: PanelManager;
    /** The workspace's tuning, resolved over the library defaults; `panels.configureTuning` changes it. */
    readonly tuning: ResolvedWorkspaceTuning;
    /** Where the workspace is in its life: `detached`, `loading`, `ready` or `disposed`. */
    readonly status: WorkspaceStatus;
    /**
     * Adds a panel of template `t` (or the registered template with that id) and returns its handle. A singleton is
     * get-or-create by id. Before the workspace is ready this records an intent replayed at every settle, and a `multiple`
     * template then needs an explicit `id`. A panel over its template's `maxInstances` comes back in status `closed`.
     * @throws PanelManagerError with code `disposed`, `unknown-template` (a string no template answers to), `invalid-template`,
     * `duplicate-template` (a different template already holds that id), `instance-id-required`, `invalid-options` (a bad or
     * foreign `id`) or `invalid-settings` (a settings conflict, when the workspace is set to throw on one).
     */
    addPanel<P extends JsonValue = JsonValue>(t: PanelTemplate<P> | string, o?: AddPanelOptions<P>): PanelHandle<P>;
    /**
     * Gives the auto-mounted host new values: only the members of `WorkspaceLive` (`device`, `settings`, `history`, `snapshots`,
     * `labels`, `topInset`, `panels`) may be named, and a member left out is not touched. Readers re-render when the data of a
     * member changed, never for a changed closure alone, so a hook may call this from an effect on every render without a loop.
     * Naming anything else (`root`, `templates`, `storage`, `mount`, `wrap`) changes nothing.
     * @throws PanelManagerError with code `disposed`, or `invalid-options` for a member that is not live.
     */
    update(live: WorkspaceLive): void;
    /**
     * Registers a template with this workspace only; returns the function that removes it.
     * @throws PanelManagerError with code `disposed`, `invalid-template`, `duplicate-template` (a different template holds the id)
     * or `invalid-settings` (a settings conflict, when the workspace is set to throw on one).
     */
    registerTemplate(t: AnyPanelTemplate): () => void;
    /** Drops the workspace's listeners and intents; a later `addPanel` throws `disposed`. */
    dispose(): void;
}
/** What `addPanel` takes besides the template. @public */
export interface AddPanelOptions<P extends JsonValue = JsonValue> {
    /** The panel's id; a `multiple` template's panel needs one before the workspace is ready. */
    id?: PanelId;
    /** The panel's own settings layer. */
    settings?: PanelSettings;
    /** Opaque data for the view. */
    params?: P;
    /** The page the panel shows. */
    url?: string;
    /**
     * Picks where a panel this call creates lands among the panels in view, and what the panel in that slot does. Without it
     * the panel lands where its `placeOnAdd` says. Ignored for a panel that already exists or is made before the workspace is ready.
     */
    place?: PlaceOpen;
}
/**
 * What a view acts through on its workspace: the panel manager, which closes, shows and configures other panels by key, and
 * `addPanel`. The workspace's own life (`dispose`, `update`, `rename`) is not here.
 * @public
 */
export interface ViewWorkspace {
    /** The workspace's panel manager with `addPanel`, which makes or finds a panel of a template and returns its handle. */
    readonly panels: PanelManager & {
        addPanel: WorkspaceHandle['addPanel'];
    };
}
/** What the provider hook hands the workspace after every commit. */
export interface EngineCommit {
    /** The committed panel list, root and marker included. */
    entries: readonly PanelWindow[];
    /** Engine ids of the parked panels that are held. */
    held: {
        has(engineId: string): boolean;
    };
    /** Whether the restore has settled. */
    settled: boolean;
    /** Creates a panel in the engine; the workspace has already checked its limits. */
    create(req: CreateRequest): void;
    /** Rebuilds the placeholder entries of a template registered after the restore, and creates the declared panels it was missing. */
    lateRegister(t: PanelTemplate): void;
    /** The operations on the panels the engine holds, closed over this commit's list. */
    ops: EngineOps;
}
/**
 * What the workspace asks of the engine for a panel it holds, by engine id. Each answers as the handle verb it backs
 * does, after taking its place in the turn's in-flight gate; the workspace has already refused every state a verb
 * cannot take (pending, closed, not attached).
 */
export interface EngineOps {
    show(engineId: string): PanelResult;
    hide(engineId: string): PanelResult;
    close(engineId: string, source: PanelOpSource): PanelResult;
    /** Opening a panel the engine already holds changes nothing, but it still waits its turn behind a close. */
    open(engineId: string): PanelResult;
    move(engineId: string, by: number, source: PanelOpSource): PanelResult;
    place(engineId: string, value: AddPlacement | 'in-place', source: PanelOpSource): PanelResult;
    /** Puts a parked or hidden panel where `value` says and makes it live in the same update; a live panel is placed. */
    land(engineId: string, value: AddPlacement | 'in-place', source: PanelOpSource): PanelResult;
    setSlots(engineId: string, slots: number, source: PanelOpSource): PanelResult;
    scrollTo(engineId: string, align: ScrollAlign | undefined): PanelResult;
    /** Re-adds a closed panel, as `create` does; refuses `busy` when the turn's gate says so. */
    reopen(req: CreateRequest): PanelResult;
    /** Resets the panels the engine holds under these ids, in this order, in one update. `follow` scrolls to the one panel it names. */
    reset(engineIds: readonly string[], follow: boolean): ResetResult;
    /** Whether the panel last held under `engineId` closed inside the undo window and can still be undone. */
    inUndoWindow(engineId: string): boolean;
    /** Marks the panel closed inside the undo window under `engineId` as reset, so an undo restores it by its defaults. False when it is not in the window. */
    resetClosed(engineId: string): boolean;
    /** Applies a configure to the live, parked or held panel `engineId` in one update, after the turn's in-flight gate: `plan` is called with the entry and what it is, and answers the outcome. */
    configure(engineId: string, plan: (target: PanelWindow, status: 'live' | 'parked' | 'hidden') => ConfigureOutcome): ConfigureResult;
    /** Takes the panels out of the row together for a move to another workspace: no closed-panel log, no undo window. With `run` false it only reports whether it would, as `busy` or `ok`. */
    release(engineIds: readonly string[], run: boolean): PanelResult;
    /** Takes the whole row's place in the turn's in-flight gate, runs `change`, and releases; refuses `busy` when any panel already holds a token. */
    reprice(change: () => void): PanelResult;
}
/** One panel `addPanel` asks the engine to create after the workspace is ready. */
export interface CreateRequest {
    /** The panel's id (its key). */
    id: PanelId;
    templateId: string;
    /** The engine id to draw it under, already drawn when the id is anonymous. */
    engineId: string;
    settings?: PanelSettings;
    params?: JsonValue;
    url?: string;
    /** True for a panel code declares: it is saved without an instance layer because code gives it again. */
    declared?: boolean;
    /** The engine id of the panel whose view asked for this one, recorded on the entry as its opener. */
    openedBy?: string;
    /** Where this one open lands, in place of the panel's `placeOnAdd`. */
    place?: AddPlacement;
    /** The engine id of the panel that leaves view when the open leaves the row without room. */
    leaves?: string;
    /** Set for a panel moved in from another workspace: it goes to the end of the row and keeps these fields of the entry it had; `sized` is whether the person chose its size. */
    carried?: Pick<PanelWindow, 'uid' | 'title' | 'slots'> & {
        sized: boolean;
    };
}
/** What the provider hook reads from a workspace and writes back to it. */
export interface EngineBinding {
    readonly rootId: string;
    readonly storage: WorkspaceStorage | undefined;
    readonly defaults: PanelSettings | undefined;
    readonly tuningInput: WorkspaceTuning | undefined;
    readonly tuning: ResolvedWorkspaceTuning;
    /** The instance layer `e` resolves under now: the record's for a closed entry or one code declares, the entry's own otherwise. */
    layerOf(e: PanelWindow): PanelSettings | undefined;
    /** Keeps what a view asked for at a Host-bag create of the panel drawn under `engineId` as its host layer for this session. */
    hostAsked(engineId: string, host: PanelSettings): void;
    readonly order: (() => readonly PanelId[]) | undefined;
    readonly newId: () => string;
    /** Reports an error the hook swallowed: `onError`, else `console.error`. */
    reportError(e: unknown): void;
    /** Whether this workspace renders itself (see `WorkspaceOptions.mount`). */
    readonly autoMounted: boolean;
    /** The host values the auto mount reads (see `WorkspaceLive`). */
    readonly live: LiveStore;
    /** The component the auto mount renders around the row, if the app gave one. */
    readonly wrap: ComponentType<WorkspaceWrapProps> | undefined;
    /** The theme function the auto mount draws with, if the app gave one. */
    readonly theme: ((mode: 'light' | 'dark') => PhonuxTheme) | undefined;
    /** A hand-mounted row was given this workspace; warns once in development when the workspace also mounts itself. */
    warnHandMounted(): void;
    /** Delivers a runtime note to the sink the attached hook bound, or holds it until one is bound; a sink that throws is ignored. */
    reportNote(note: SettingNote): void;
    /** The attached hook binds (or, with undefined, unbinds) where runtime notes go. */
    bindNotes(sink: ((note: SettingNote) => void) | undefined): void;
    /** The row tells the workspace the panel drawn under `engineId` was just focused or pressed, `control` when on its chrome's own controls; the attached hook counts that as a touch. Ignored while no hook is bound. */
    touch(engineId: string, control?: boolean): void;
    /** The attached hook binds (or, with undefined, unbinds) where touches go. */
    bindTouch(sink: ((engineId: string, control: boolean) => void) | undefined): void;
    /** The row tells the workspace a press landed outside every panel, so no panel is in use; ignored while no hook is bound. */
    blur(): void;
    /** The attached hook binds (or, with undefined, unbinds) what such a press runs. */
    bindBlur(sink: (() => void) | undefined): void;
    /** A drag held at the row's edge swaps the nearest hidden panel on that side in, keeping `keepId` live; false while no hook is bound or nothing came in. */
    cycle(direction: 'left' | 'right', keepId: string): boolean;
    /** The attached hook binds (or, with undefined, unbinds) what a swap at the edge runs. */
    bindCycle(sink: ((direction: 'left' | 'right', keepId: string) => boolean) | undefined): void;
    /** The workspace's own templates, the root's included. */
    templates(): readonly PanelTemplate[];
    /** The template this workspace holds under `id`, or undefined: what its row renders a panel of `id` with. */
    template(id: string): PanelTemplate | undefined;
    /** What `e` resolves to now, over the layers the workspace holds for it: the settings a closed entry is rebuilt with. */
    resolved(e: PanelWindow): ResolvedPanelSettings;
    /** What `e` resolves to over those layers with no person's layer at all: the defaults a reset applies. */
    resolveDefaults(e: PanelWindow): PanelSettingsResolution;
    /** The intents recorded so far, as declarations. */
    declared(): readonly DeclaredPanel[];
    /** The entries the first paint starts with: the root or the marker. */
    initialEntries(): PanelWindow[];
    /** A hook takes the workspace; throws `already-attached` when another holds it. */
    attach(owner: object): void;
    /** The hook that held the workspace unmounted; the panels stay answerable. */
    detach(owner: object): void;
    /** Tells the workspace the list this render draws, so a view mounting in it can read its own panel before the commit publishes. Idempotent; changes no snapshot. */
    observe(entries: readonly PanelWindow[], held: {
        has(engineId: string): boolean;
    }): void;
    /** Records a commit and publishes a new snapshot when it changed something. */
    publish(commit: EngineCommit): void;
    /** Subscribes to tuning changes for `useSyncExternalStore`. */
    subscribe(l: () => void): () => void;
}
/**
 * A workspace over `o`. It renders itself (see `WorkspaceOptions.mount`) unless `mount: false` hands that to `useProvidePanels({ workspace })`
 * in a tree the caller writes. Panels added before the row attaches are recorded and created when the restore settles.
 * @public
 */
export declare function createWorkspace(o?: WorkspaceOptions): WorkspaceHandle;
/** What a provider hook reads from and writes to `ws`. Throws `invalid-options` for anything `createWorkspace` did not make. */
export declare const bindingOf: (ws: WorkspaceHandle) => EngineBinding;
/**
 * Puts the parked or hidden panel public under `key` where `value` says and makes it live, as one gated update; a live panel is placed. The row-drop hook ends a
 * drag of a panel that is not in view with it. Throws `invalid-options` for anything `createWorkspace` did not make.
 */
export declare const landPanelIn: (ws: WorkspaceHandle, key: PanelId, value: AddPlacement | "in-place", src: PanelOpSource) => PanelResult;
/** What a row tells its template views about `ws`. */
export declare const viewContextOf: (ws: WorkspaceHandle) => PanelViewContext;
/**
 * What `WorkspaceColumnHandle.movePanel` and `canMovePanel` take.
 * @public
 */
export interface MovePanelOptions {
    /**
     * True moves the panel together with every panel it opened, directly or through the panels it opened (`PanelManager.familyOf`),
     * all or none. False or left out moves the panel alone.
     */
    readonly withFamily?: boolean;
    /**
     * With `withFamily`, members of the family that stay in the source; the panel itself always moves. A member that moves while its
     * opener stays takes its nearest moving ancestor as opener; one that stays while its opener moves takes that opener's old opener.
     * The all-or-nothing checks cover only the panels that move.
     */
    readonly leave?: readonly PanelId[];
}
/**
 * What `WorkspaceColumnHandle.movePanel` answers: the panel's id and workspace after the move, or why it stayed where it was.
 * `canMovePanel` answers the same without moving anything.
 * @public
 */
export type MovePanelResult = {
    /** The panel moved. */
    readonly ok: true;
    /** The workspace the panel is in now: the one to `scrollTo` to follow it. */
    readonly workspace: WorkspaceHandle;
    /** That workspace's index in the column. */
    readonly index: number;
    /** The panel's id in that workspace, with which `workspace.panels.get` finds it; it is the id the panel had. */
    readonly panelId: PanelId;
    /** Every panel that moved, in the order they now stand at the end of the target's row: `panelId` alone unless the family moved. */
    readonly panelIds: readonly PanelId[];
} | {
    /** The panel did not move and nothing changed. */
    readonly ok: false;
    /** Why it stayed. */
    readonly code: PanelRefusal | 'unknown-workspace' | 'same-workspace';
    /** A sentence saying which panel and what stood in the way. */
    readonly message: string;
};
/**
 * Moves the panel `key` of `from`, with its family less `leave` when asked, to the end of `to`'s row; both must belong to one column
 * and the caller has checked they differ. Every moving member is checked on both sides before anything acts. With `run` false it
 * only answers.
 */
export declare function transferPanel(from: WorkspaceHandle, key: PanelId, to: WorkspaceHandle, options: MovePanelOptions, run: boolean): {
    ok: true;
    panelIds: PanelId[];
} | Extract<MovePanelResult, {
    ok: false;
}>;
