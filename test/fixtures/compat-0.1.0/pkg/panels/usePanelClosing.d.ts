import { type Dispatch, type SetStateAction } from 'react';
import type { JsonValue } from '../hostApi.js';
import { type PanelWindow } from '../panelWindow.js';
import type { UsePanelManagerResult } from './usePanelManager.js';
/** The undo toast stays up for 10 seconds, one window, restarted by every close. */
export declare const UNDO_WINDOW_MS = 10000;
export interface UsePanelClosingResult {
    /** Closes a view completely and opens (or restarts) the 10 s undo window. Unknown or already-closed id: does nothing. */
    close: (id: string) => void;
    /** Restores every view closed inside the window, last closed first, each at its old index; a live one comes back live. */
    undoClose: () => void;
    /** The views closed inside the window, oldest first; non-null exactly while the window is open. */
    recentlyClosed: PanelWindow[] | null;
    /**
     * Ids leaving through THIS hook's `close()`, never usePanelManager's auto-collapse (which only flips `live`):
     * PanelRow reads it for each exiting PanelRowSlot's `exitDirection` (down for a close, left for a park).
     * See `close()` for why an id must land here BEFORE the panel leaves `panels`.
     */
    closingIds: ReadonlySet<string>;
}
/**
 * A close (drag down, or History's trash) removes the view COMPLETELY, reports it through `onPanelsClosed` and offers
 * Undo for 10 s. Takes the CURRENT render's values, so nothing here may be memoised, and `close` reads the index from
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
 */
onRestoreLive?: (id: string) => void, 
/**
 * Called with the ids the undo window's NATURAL elapse just finalized (Undo calls stopWindow() instead), so a
 * caller can tell a restored close from one nothing will ever undo.
 */
onWindowElapsed?: (ids: string[]) => void, 
/** Called once per successful close with the log entry: `id` is the log id, `title` already falls back to the url, then 'Untitled panel'. */
onPanelsClosed?: (entry: {
    id: string;
    title: string;
    url: string;
    closedAt: string;
}) => void, 
/** Called once per `undoClose` batch with the log ids of every close the batch restores, in close order. */
onPanelsRestored?: (logIds: string[]) => void, 
/**
 * Called once per restored panel with the `hostData` it closed carrying; its return value is what the panel comes
 * back with (`undefined` drops the key). Unset leaves `hostData` exactly as it closed: only the host knows what
 * the opaque blob pointed at, and whether that outlived the close.
 */
resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined): UsePanelClosingResult;
