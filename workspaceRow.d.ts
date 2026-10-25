import * as React from 'react';
import type { RowNumbers } from './rowNumbers.js';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
/** The part of a panel the row's dot bar reads: its id, and whether its dot is hollow. @public */
export interface WorkspaceRowEntry {
    /** The panel's id. */
    readonly id: string;
    /** The panel's settings, when they are set; `hollowDot` is whether its dot is hollow. */
    readonly settings?: {
        readonly hollowDot: boolean;
    };
}
/** What a mounted workspace's row exposes to `wrap` through `useWorkspaceRow()`. @public */
export interface WorkspaceRow {
    /** The row's one set of numbers: the shell, the row and the capacity are priced from it. */
    readonly rowNumbers: RowNumbers;
    /** The panels in row order, as the row draws them. */
    readonly entries: readonly WorkspaceRowEntry[];
    /** The most panels that fit the phone width, or null when the row is not fitted. */
    readonly maxFitPanels: number | null;
    /** The row's scroll container, or null before it mounts. */
    readonly scroller: React.RefObject<HTMLElement | null>;
    /** The workspace's slide values, which a dot bar reads. */
    readonly tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
    /** The phone size the row is fitted to, in px. */
    readonly phoneSize: {
        readonly width: number;
        readonly height: number;
    };
}
/** @internal */
export declare const WorkspaceRowContext: React.Context<WorkspaceRow | null>;
/**
 * The mounted row's numbers, entries and fit, for a component `wrap` renders around the row. Only valid inside `wrap`.
 * @public
 */
export declare function useWorkspaceRow(): WorkspaceRow;
