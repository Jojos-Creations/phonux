/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */
import * as React from 'react';
import { type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
/** True only for a `collapsible` entry (e.g. a plain web panel): an always-shown column (the root, or a
 * `permanent:true` custom column) is never a reorder source. Unprovided resolves to false: a view mounted
 * with no `PanelRow` above it never reorders.
 * @public */
export declare const usePanelReorderEligible: () => boolean;
/** False only for an always-shown column (`collapsible:false`): the built-in 'web' view must never wrap such
 * an entry in a framework close handle (CreatePanelOptions.permanent's 'own control only' guarantee).
 * Unprovided resolves to true: a view mounted directly (as tests do) is an ordinary collapsible panel.
 * @public */
export declare const usePanelCloseEligible: () => boolean;
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export declare const usePanelNeighborWidths: () => NeighborWidths;
/** Anchored left of the row's root, read from the anchor every render so a drag across the root changes it too. Unprovided: false.
 * @public */
export declare const usePanelPinned: () => boolean;
/**
 * The row: every present entry in its own animated slot, in the array's order, each rendered by its registered view.
 * @public
 */
export declare function PanelRow({ entries, rootId, closingIds, enteringViaAnchorIds, exitRightIds, enterSideById, maxLiveWidth, }: {
    /** The raw one-list array (PanelRowEntry, not PanelSummary): `view` alone picks the component (resolveView
     * never returns nothing), independent of `layer` (stacking) and `anchoredEnter` (enter direction). */
    entries: readonly PanelRowEntry[];
    /** The row's root entry: an entry with no anchor orients against it, and `usePanelPinned` means left of it. */
    rootId: string;
    /** Ids being closed: each exits DOWN. Kept off PanelsAPI on purpose. */
    closingIds: ReadonlySet<string>;
    /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. Any other entry
     * enters from the right unless its own `anchoredEnter` says otherwise. */
    enteringViaAnchorIds: ReadonlySet<string>;
    /** Ids parking with an exit to the RIGHT; every other park exits LEFT. */
    exitRightIds?: ReadonlySet<string>;
    /** An explicit enter side per id, winning over the anchor formula: a scroll gesture knows which side a reveal
     * must enter from, which the boolean anchor formula cannot express. */
    enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
    /** The widest one live panel can be in this row (see computeMaxLiveWidth). Omitted: no cap. */
    maxLiveWidth?: number;
}): React.ReactElement;
