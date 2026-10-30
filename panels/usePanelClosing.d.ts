import { type Dispatch, type SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import type { AddPlacement, SettingNote } from '../panelSettings.js';
import { type PanelWindow } from '../panelWindow.js';
import type { UsePanelManagerResult } from './usePanelManager.js';
/** What `undoClose` restores in place of the entry that closed: the entry as the workspace would build it now, and where it goes. */
export type Reapplied = {
    panel: PanelWindow;
    placeAs: 'old-slot' | AddPlacement;
};
export interface UsePanelClosingResult {
    /** Closes a view completely and opens the undo window, or extends it to at least the panel's `undoWindowMs` from now (a panel with 0 is final at once). Unknown, root or already-closed id: does nothing and answers false. */
    close: (id: string, byPerson?: boolean) => boolean;
    /** Drops the views closed inside the window whose key is `key`, so an undo has nothing to skip or report for them. True when one was dropped. */
    forgetClosed: (key: string) => boolean;
    /** The ids of the views closed inside the window now, even when no render has seen the close yet. */
    closedIds: () => string[];
    /** Restores every view closed inside the window, last closed first, each at its old index; a live one comes back live. */
    undoClose: () => void;
    /** Marks the view closed inside the window under `id` as reset: `reset` rewrites its entry to the cascade's defaults, and an undo places it by its `placeOnAdd`. False when no such view is in the window. */
    markReset: (id: string, reset: (panel: PanelWindow) => PanelWindow) => boolean;
    /** The views closed inside the window, oldest first; non-null exactly while the window is open. */
    recentlyClosed: PanelWindow[] | null;
    /** The views in `recentlyClosed` the person closed, oldest first; null when there are none. */
    closedByPerson: PanelWindow[] | null;
    /**
     * Ids leaving through THIS hook's `close()`, never usePanelManager's auto-collapse (which only flips `live`):
     * PanelRow reads it for each exiting PanelRowSlot's `exitDirection` (down for a close, left for a park).
     * See `close()` for why an id must land here BEFORE the panel leaves `panels`.
     */
    closingIds: ReadonlySet<string>;
}
/**
 * A close (drag down, or History's trash) removes the view COMPLETELY, reports it through `onPanelsClosed` unless its
 * `reportClose` is false, and offers Undo until the one shared window ends: it ends at the latest of the closes' own
 * `undoWindowMs` after each close, and no close shortens it. Takes the CURRENT render's values, so nothing here may be memoised, and `close` reads the index from
 * that render: two closes before one re-render would undo in the wrong order (discrete gestures re-render between
 * events), so a caller that batches closes needs one setPanels for the lot. Log ids are `<closedAt>#<panel id>`: panel
 * ids restart each launch, and a host undoing by id would otherwise also delete an older launch's entry.
 */
export declare function usePanelClosing(panels: PanelWindow[], setPanels: Dispatch<SetStateAction<PanelWindow[]>>, revealPanelProactively: UsePanelManagerResult['revealPanelProactively'], rootId: string, 
/**
 * Called once per successful close with the id that just left and `closePanel`'s `remaining`, the array right
 * after it, computed from THIS render's `panels` like everything else in `close()`.
 */
onAfterClose?: (id: string, remaining: PanelWindow[]) => void, 
/**
 * Called per panel `undoClose` restores LIVE (the branch that calls `revealPanelProactively`): with
 * usePanelManager.ts's `revealMostRecentlyCollapsed`, one of the two paths that enter from the anchor's side.
 * `side` is set when its `undoPlacement` moved it: the side of the row it landed on, which the anchor cannot say.
 */
onRestoreLive?: (id: string, side?: 'left' | 'right') => void, 
/**
 * Called with the panels the undo window's NATURAL elapse just finalized (Undo calls stopWindow() instead), and
 * at once with a panel whose `undoWindowMs` is 0, so a caller can tell a restored close from one nothing will
 * ever undo.
 */
onWindowElapsed?: (panels: PanelWindow[]) => void, 
/** Called once per successful close with the log entry: `id` is the log id, `title` is the panel's own, the empty string when it has none: the host decides what to show for that. */
onPanelsClosed?: (entry: {
    id: string;
    title: string;
    url: string;
    closedAt: string;
}) => void, 
/** Called once per `undoClose` batch with the log ids of the closes it restores that were reported, in close order; not called when there are none. */
onPanelsRestored?: (logIds: string[]) => void, 
/**
 * Called once per restored panel with the `hostData` it closed carrying; its return value is what the panel comes
 * back with (`undefined` drops the key). Unset leaves `hostData` exactly as it closed: only the host knows what
 * the opaque blob pointed at, and whether that outlived the close.
 */
resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined, 
/** Receives each note an undo raises (a placement that fell back); whatever it throws is swallowed. */
onNote?: (note: SettingNote) => void, 
/** The developer's panel order, read by an undo whose `undoPlacement` is `'order'`. */
order?: () => readonly string[], 
/**
 * Rebuilds a closed entry at undo: the entry to restore and where to put it. Unset, the entry comes back as it
 * closed and `undoPlacement` is the one it carries, which for an entry with no settings is 'old-slot'.
 */
reapply?: (panel: PanelWindow) => Reapplied): UsePanelClosingResult;
