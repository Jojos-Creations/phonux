/**
 * The one pure function that turns a saved file, the registered templates and the code's declarations into the
 * panels a launch starts with. It holds no React: the persistence hook calls it once, inside the load's success
 * handler, and appends what it returns in a single `setPanels`. DESIGN.md ("Workspace state persistence") holds the rules.
 */
import type { JsonValue } from './hostApi.js';
import type { AddPlacement, PanelSettings, PanelSettingsResolution, ResolvedPanelSettings, SettingNote } from './panelSettings.js';
import type { PanelTemplate } from './panelTemplate.js';
import { type PanelWindow } from './panelWindow.js';
/** A panel code declares: created at every launch unless the person dismissed it, and rebuilt from the file when the file has it. */
export type DeclaredPanel = {
    id: string;
    templateId: string;
    settings?: PanelSettings;
    params?: JsonValue;
    url?: string;
};
/** What `reconcileWorkspace` reads. */
export interface ReconcileInput {
    /** What `load()` resolved, unchecked. */
    saved: unknown;
    /** The templates a saved entry's `view` or a declaration's `templateId` may name. */
    templates: readonly PanelTemplate[];
    /** The panels code declares, in declaration order. */
    declared: readonly DeclaredPanel[] | undefined;
    /** The workspace's panel settings; with neither these, templates nor declarations a restored panel is a 0.1.0 entry with no settings. */
    workspaceDefaults?: PanelSettings;
    /** The row's root id. */
    rootId: string;
    /** The panels already in the row, which a restored entry is placed beside and never duplicates. */
    current: readonly PanelWindow[];
    /** Fresh ids for the new entries; every one is drawn before this returns. */
    freshId(): string;
    /** A new panel uid; default `newPanelUid`. Injectable so a test can supply the bytes. */
    newUid?: () => string;
    /** The developer's panel order, read by every placement whose value is `'order'`. */
    order?: () => readonly string[];
    /** The title a declared panel gets when no settings layer names one, from its fresh id; left out, such a panel has the empty title. */
    panelTitle?: (id: string) => string;
}
/** What `reconcileWorkspace` returns. */
export interface ReconcileResult {
    /** The new entries only (restored and declared), in row order, with their anchors settled against `current`. */
    entries: PanelWindow[];
    /** What the restore dropped, ignored or could not place. */
    notes: SettingNote[];
    /** The tombstones to keep, as the file held them. */
    dismissed: string[];
    /** Panels already in the row whose uid the file holds for them: each takes the file's uid in place of the one it minted at creation. */
    adopted: {
        id: string;
        uid: string;
    }[];
    /** Whether the file lacks a uid some saved entry needs (absent or dropped), so the caller must save once even though the restored list projects to the baseline. */
    minted: boolean;
}
/**
 * Rebuilds the row's new entries. Draws every fresh id first; rebuilds a saved entry of a registered template by the
 * cascade (or of a plain view when the row has settings) and hydrates any other as 0.1.0 did; creates each
 * declared panel the file has no entry for unless its key is dismissed; lets `restoreVisibility` decide each `live`;
 * orders the row once. A saved entry owns what its `overrides` hold, and an entry without `overrides` (a 0.1.0 entry)
 * owns its anchor and slot count. An untouched entry keeps its saved place only while its resolved `placeOnAdd` equals
 * the one that placed it. Permission settings gate gestures, never a restore.
 */
export declare function reconcileWorkspace(i: ReconcileInput): ReconcileResult;
/**
 * `row`, which holds a just-built entry `id`, with that entry resolved by `settings`: carrying its `instance` layer,
 * empty `overrides` and the `placeOnAdd` that places it, and placed there unless the caller gave an anchor itself.
 * `name` is a template panel's key; absent, the entry's key is its id.
 */
export declare function finishCreated(i: {
    row: PanelWindow[];
    id: string;
    settings: ResolvedPanelSettings;
    instance: PanelSettings;
    name: string | undefined;
    callerPlaced: boolean;
    rootId: string;
    order?: () => readonly string[];
    place?: AddPlacement;
}): PanelWindow[];
/** The notes a host-bag create's conflicts raise, one per setting the cascade overrode or refused. */
export declare function conflictNotes(panelId: string, conflicts: PanelSettingsResolution['conflicts']): SettingNote[];
