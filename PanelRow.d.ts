/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */
import * as React from 'react';
import { type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import { type EnterDirection } from './panelRowOrder.js';
import type { EnterFrom, ExitTo, ResolvedPanelSettings, ResolvedWorkspaceTuning } from './panelSettings.js';
import { type SlotEntrance, type SlotExit } from './PanelRowSlot.js';
import { type RowNumbers } from './rowNumbers.js';
import { type WorkspaceHandle } from './workspaceCore.js';
/**
 * How an entry enters. The panel's own `enterFrom` (or the `anchoredEnter` flag, read as 'anchor') wins over the
 * workspace's `tuning.defaultEnterFrom` unless it is 'auto'. A side or 'fade' is a constant that beats every mark; 'expand'
 * grows out of the edge on the side a reveal comes in from (its mark, else the anchor formula) and from its center otherwise.
 * Otherwise an explicit mark from the engine wins, then the anchor formula for an entry that always uses it ('anchor')
 * or is entering via an anchor, then the right.
 */
export declare function enterDirectionOf(from: EnterFrom, anchoredEnter: boolean, mark: EnterDirection | undefined, viaAnchor: boolean, formula: () => EnterDirection, workspace?: EnterFrom): SlotEntrance;
/**
 * How an entry leaves. The panel's own `exitTo` wins over the workspace's `tuning.defaultExitTo` unless it is 'auto'; when
 * both are 'auto' a close drops down on the close timing and a park leaves by the side the row marked, else the left. A
 * 'shrink' park shrinks toward that same side; a 'shrink' close shrinks into its center.
 */
export declare function exitStyleOf(own: ExitTo, workspace: ExitTo, closing: boolean, parkRight: boolean): SlotExit;
/**
 * What this panel lets a person do with it by gesture: close it (`closable`), move it (`movable`) and resize it
 * (`resizable`), and the most slots it may take. `closable` is false for an always-shown column even when its
 * setting is true, since the row's close gesture never offers one. These limit only the person's gestures, never the
 * developer's own calls. Outside a row: the library defaults.
 * @public
 */
export declare const usePanelCapabilities: () => Pick<ResolvedPanelSettings, "closable" | "movable" | "resizable" | "maxSlots">;
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export declare const usePanelNeighborWidths: () => NeighborWidths;
/**
 * The workspace's row-wide `rowGap`, `dragToClose`, `slide`, `hopFraction` and `edgeScroll`: every panel reads the same
 * values, since a panel carries no tuning of its own. Outside a row: the library defaults.
 * @public
 */
export declare const usePanelTuning: () => Pick<ResolvedWorkspaceTuning, "rowGap" | "dragToClose" | "slide" | "hopFraction" | "edgeScroll">;
/**
 * The hops a horizontal drag of this panel asks for: `steps(offsetX)` is reorderStepsForOffset over this slot's
 * neighbors, the row's gap and this panel's hop fraction. Outside a row there are no neighbors, so it is 0.
 * @public
 */
export declare const usePanelReorderSteps: () => ((offsetX: number) => number);
/**
 * The row: every present entry in its own animated slot, in the array's order, each rendered by its template's view.
 * @public
 */
export declare function PanelRow({ entries, rootId, closingIds, enteringViaAnchorIds, exitRightIds, enterSideById, maxLiveWidth, rowNumbers, workspace, }: {
    /** The raw one-list array (PanelRowEntry, not PanelSummary): `view` alone picks the component (an unknown key renders a
     * placeholder, never nothing), independent of `layer` (stacking) and `anchoredEnter` (enter direction). */
    entries: readonly PanelRowEntry[];
    /** The row's root entry: an entry with no anchor orients against it. */
    rootId: string;
    /** Ids being closed: each exits DOWN while its `exitTo` resolves to 'auto'. Kept off PanelsAPI on purpose. */
    closingIds: ReadonlySet<string>;
    /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. Any other entry
     * enters from the right unless its own `anchoredEnter` says otherwise. */
    enteringViaAnchorIds: ReadonlySet<string>;
    /** Ids parking with an exit to the RIGHT; every other park exits LEFT. Read only while the panel's `exitTo` resolves to 'auto'. */
    exitRightIds?: ReadonlySet<string>;
    /** An explicit enter side per id, winning over the anchor formula: a scroll gesture knows which side a reveal
     * must enter from, which the boolean anchor formula cannot express. */
    enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
    /** The widest one live panel can be in this row (ProvidedPanels.maxLiveWidth). Omitted: no cap. */
    maxLiveWidth?: number;
    /** The row's numbers (ProvidedPanels.rowNumbers): every width and rest is read from them, and a park exits relative to its rest when `rowScroll` is true. Omitted: the row computes its own from `maxLiveWidth`. */
    rowNumbers?: RowNumbers;
    /** The workspace this row renders: each template view receives its own handle and the reader of every panel, and the row's tuning is the workspace's. */
    workspace: WorkspaceHandle;
}): React.ReactElement;
