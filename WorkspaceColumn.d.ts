/**
 * The column component: every workspace of a `WorkspaceColumnHandle` in a cell of its own, one above the other, with the current
 * one in view. The person moves by the buttons at the top and bottom center, which name the neighbor or offer to create one, and
 * by whatever key the app binds to `step`; the column itself never scrolls under a wheel or a trackpad. DESIGN.md, "The workspace column".
 */
import * as React from 'react';
import { type WorkspaceColumnHandle } from './columnHandle.js';
import type { WorkspaceHandle } from './workspaceCore.js';
/** The room above a workspace's row that the default bands keep, in px, below the column's `topInset`. With bands of its own, `columnBandRoom(bands).above`. @public */
export declare const COLUMN_TOP_BAND: number;
/** The room below a workspace's row that the default bands keep, in px. With bands of its own, `columnBandRoom(bands).below`. @public */
export declare const COLUMN_BOTTOM_BAND: number;
/** The props of `WorkspaceColumn`. @public */
export interface WorkspaceColumnProps {
    /** The column to draw. */
    column: WorkspaceColumnHandle;
    /**
     * What fills a workspace's cell: the app's own hand-wired row for that workspace. Omitted: the row the library mounts itself, as
     * `createWorkspace` does. A returned row puts the column's `topInset` plus its bands' room above (`columnBandRoom`) plus its row gap above its panels.
     */
    children?: (workspace: WorkspaceHandle) => React.ReactNode | undefined;
}
/**
 * Draws a column: one cell per workspace, the current one in view, the others inert and hidden from assistive technology but
 * still mounted, so their panels keep their state. Moving to another workspace moves focus into its cell when focus was in the one left.
 * @public
 */
export declare function WorkspaceColumn({ column, children }: WorkspaceColumnProps): React.ReactElement;
