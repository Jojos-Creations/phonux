/**
 * Workspace state as a saved file: the JSON shape, its guard, and the pure pair that turns the panel list into
 * that shape and back. DESIGN.md ("Workspace state persistence") holds the rules; this file holds no React and
 * no host code.
 */
import type { JsonValue } from './hostApi.js';
import type { AddPlacement } from './panelSettings.js';
import { type PanelWindow } from './panelWindow.js';
/**
 * One saved panel. An `anchor` or `scroll` names another entry by its `uid` (its `key` when it has no uid). Never saved: `hostData`, `size`, `collapsible`, `anchoredEnter`, the settings
 * themselves and the host's root column. The keys from `key` on are written only for a panel that carries settings;
 * a file without them restores unchanged.
 * @public
 */
export type WorkspacePanelState = {
    /** Read only from a file saved before a panel was named by its `uid`: the name other entries' `anchor.panel` use there. A save never writes it, and a restore ignores it for naming the panel. */
    id?: string;
    /** Id of the template that renders the panel. */
    view: string;
    /** The URL the panel shows; a file without one restores a panel with none. */
    url?: string;
    /** The panel's title, when it had one. */
    title?: string;
    /** Opaque per-panel data, as `CreatePanelOptions.params`. */
    params?: JsonValue;
    /** Whether the panel appears in `PanelsAPI.panelList`, as `CreatePanelOptions.listed`. */
    listed?: boolean;
    /** Whether the panel was mounted in the row (true) or parked (false). */
    live: boolean;
    /** Where the panel sits: on `position`'s side of the entry whose `uid` (or `key`) is `panel`, or of the host's root column, ordered by `priority`. */
    anchor: {
        panel: string;
        position: 'left' | 'right';
        priority: number;
    };
    /** The panel's slot count, written only when it is more than one. */
    slots?: number;
    /** Whether the panel is a permanent column, as `CreatePanelOptions.permanent`. */
    permanent?: boolean;
    /** The stacking tier of the panel's row slot, as `CreatePanelOptions.layer`. */
    layer?: 'base' | 'raised';
    /** An opaque identity that survives save, restore and a copy of the file to another device, so two copies can match panels. Not a name code can ask for; a file or a library without it restores unchanged and mints one. */
    uid?: string;
    /** The panel's stable name: a declared panel's id, a template's id for a singleton, or `templateId~suffix`. */
    key?: string;
    /** The instance settings layer the panel was created under; absent for a panel code declares again at every launch. */
    instance?: {
        [key: string]: JsonValue;
    };
    /** What the person changed: where the panel sits, its slot count, whether it is parkable. Present (possibly empty) means the panel owns only the keys it holds. */
    overrides?: {
        /** Where the person put the panel; `panel` names another entry of this file as `anchor.panel` does. */
        anchor?: {
            panel: string;
            position: 'left' | 'right';
            priority: number;
        };
        /** The slot count the person chose. */
        slots?: number;
        /** Whether the person made the panel parkable. */
        parkable?: boolean;
    };
    /** The `placeOnAdd` that placed the panel; the saved place is kept only while the resolved `placeOnAdd` still equals it. */
    applied?: {
        placeOnAdd: AddPlacement;
    };
    /** Written as `false` for a panel that cannot be closed. */
    closable?: false;
};
/**
 * The saved workspace: a version and one entry per saved panel, in row order. The host's root column is not in it.
 * @public
 */
export type WorkspaceState = {
    /** The file format version; always 1. */
    version: 1;
    /** The saved panels, in row order. */
    panels: WorkspacePanelState[];
    /** Keys of declared panels the person closed and that must not be recreated, at most 256, oldest first. */
    dismissed?: string[];
    /** The key of the root panel, when it has one. */
    root?: string;
    /** How many slots wide the root panel (History) was, when more than one. A file saved before slots has none. */
    rootSlots?: number;
    /**
     * Where the row rested, once a person moved it: `panel` is the `uid` of the first panel the window showed at that stop (the root's id for the root),
     * and `offset` how many phone widths the stop lies from that panel's left edge (negative left of it). A reload
     * restores the same stop; a panel that is gone, or a row with no stops, restores as if there were none.
     */
    scroll?: {
        panel: string;
        offset: number;
    };
};
/**
 * What a host implements to keep the workspace between launches. `load` resolves the saved state, or `null` when
 * there is none. `save` may return nothing or a promise; a rejection or a throw is reported, and the next change saves again.
 * @public
 */
export type WorkspaceStorage = {
    /** Resolves the saved state, or `null` when there is none. */
    load(): Promise<WorkspaceState | null>;
    /**
     * Stores `state`. Returning nothing, or a promise that resolves, tells the workspace the state is saved. A throw or a
     * rejection is reported once through `WorkspaceOptions.onError` (`console.error` when it is unset), and the next
     * change to the panels saves the full current state again; nothing retries on a timer.
     */
    save(state: WorkspaceState): void | Promise<void>;
};
/** The most tombstones a file keeps; the oldest go first. */
export declare const DISMISSED_LIMIT = 256;
/**
 * Whether `value` is a workspace file this version understands: version 1, a `panels` array of well-typed entries
 * with unique ids where they hold one. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 */
export declare function isWorkspaceState(value: unknown): value is WorkspaceState;
/** What the sanitizer dropped from a saved entry and why. */
export type Dropped = {
    key: string;
    message: string;
};
/**
 * The saved rest of a file: its `scroll` when well formed, otherwise undefined with a drop note for anything but an absent one.
 */
export declare function cleanSavedScroll(value: unknown, dropped: Dropped[]): NonNullable<WorkspaceState['scroll']> | undefined;
/** The additive keys of a saved entry once cleaned. The person's changes are `owned` here, so only the functions that own the panel field named `overrides` ever write one. */
export type SavedExtras = Pick<WorkspacePanelState, 'key' | 'instance' | 'applied' | 'closable'> & {
    owned?: WorkspacePanelState['overrides'];
};
/**
 * The additive keys of one saved entry, each kept only when well formed; what is not is reported in `dropped` and
 * the entry restores without it. `seen` holds the keys earlier entries claimed: a repeat is dropped.
 */
/**
 * The entry's `uid` when it is well formed and no earlier entry holds it; otherwise undefined, with a drop note for
 * anything but an absent one. `seen` collects the uids kept so far.
 */
export declare function cleanSavedUid(entry: WorkspacePanelState, seen: Set<string>, dropped: Dropped[]): string | undefined;
export declare function cleanSavedExtras(entry: WorkspacePanelState, seen: Set<string>, dropped: Dropped[]): SavedExtras;
/** The tombstone list of `value`: strings only, each once, the newest 256. Anything that is not an array reads as empty. */
export declare function cleanDismissed(value: unknown, dropped: Dropped[]): string[];
/**
 * The saved form of `panels`: every entry but the root, with only the documented keys. `permanent` is derived
 * (`!collapsible`) because PanelWindow has no such field, and an absent optional stays absent so no key holds
 * `undefined`. An entry that carries settings also writes `key`, `instance` (unless code declares it again),
 * `overrides`, `applied` and `closable`. `dismissed` is the tombstone list the caller holds.
 */
export declare function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string, dismissed?: readonly string[], scroll?: NonNullable<WorkspaceState['scroll']>): WorkspaceState;
/**
 * The settings-free skeleton of one saved entry under `id`: appendPanel owns the creation rules (permanent forces listed
 * false and one slot, size comes from the slots), and a permanent column is never parked, so one saved as parked is live.
 * `anchor` is the entry's saved anchor with its target already mapped.
 */
export declare function entryFromSaved(s: WorkspacePanelState, id: string, anchor: PanelWindow['anchor'], rootId: string, uid?: string): PanelWindow;
/**
 * What each name an entry answers to maps to in `values` (parallel to the entries): its `uid`, its `key`, and the `id`
 * a file saved before panels were named by uid holds. A name claimed twice goes to the first, and a uid outranks
 * an id outranks a key, so a name an older file gave a counter id is read as that id.
 */
export declare function savedNames<T>(entries: readonly {
    id?: string;
    uid?: unknown;
    key?: unknown;
}[], values: readonly T[]): Map<string, T>;
/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export declare function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[];
