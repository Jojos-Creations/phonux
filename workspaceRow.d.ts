import * as React from 'react';
import type { RowNumbers } from './rowNumbers.js';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
/** The part of a panel a row's wrap reads: its id, its saved uid, whether it is drawn, its width and whether its dot is hollow. @public */
export interface WorkspaceRowEntry {
    /** The panel's id. */
    readonly id: string;
    /**
     * The panel's saved uid, the same across relaunches of a restored workspace, unlike `id`, which is new each launch.
     * Absent on a hand-built entry.
     */
    readonly uid?: string;
    /** False while the panel is parked: in the row's order but not drawn. Absent reads as drawn. */
    readonly live?: boolean;
    /** True only for the row's reserved anchor entry, which is never drawn and has no dot. */
    readonly marker?: true;
    /** How many phone widths wide the panel is set to. Absent reads as one. */
    readonly slots?: number;
    /** The panel's settings, when they are set: `hollowDot` is whether its dot is hollow, and a `revealOnScroll` of `'never'` keeps a parked panel out of the dot bar, since no scroll can bring it in. */
    readonly settings?: {
        readonly hollowDot: boolean;
        readonly revealOnScroll?: 'edges' | 'any' | 'never';
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
