import type { PhonuxLabels } from './labels.js';
/**
 * The plain model behind `WorkspacePanel`: its tile sizes and counts, its three groups, its search, and the title a tile shows.
 * Nothing here touches React, so the grouping and filtering can be checked without a mounted panel.
 */
/** The tile size a `WorkspacePanel` draws at. @public */
export type WorkspaceTileSize = 'small' | 'medium' | 'large';
/** How many tiles fill one row at each size. @public */
export interface WorkspaceTileCounts {
    /** Tiles per row at the small size. */
    readonly small: number;
    /** Tiles per row at the medium size. */
    readonly medium: number;
    /** Tiles per row at the large size. */
    readonly large: number;
}
/** The tiles per row a `WorkspacePanel` uses when `tileCounts` leaves a size out. */
export declare const DEFAULT_WORKSPACE_TILE_COUNTS: WorkspaceTileCounts;
/** The labels a workspace grid draws, read from the host's `PhonuxLabels`. */
export type WorkspaceLabels = Pick<PhonuxLabels, 'workspacePinned' | 'workspaceViewing' | 'workspaceHidden' | 'workspaceUntitled' | 'workspaceEmpty' | 'workspaceNoMatches'>;
/** One panel as the grid lists it. */
export interface WorkspaceTile {
    /** The panel's id, which activating the tile shows. */
    readonly id: string;
    /** The title the tile shows and the search matches. */
    readonly title: string;
    /** Whether the panel is in the row now (`false` means parked). */
    readonly live: boolean;
    /** Whether the panel is pinned. */
    readonly pinned: boolean;
}
/** A heading and the tiles under it. */
export interface WorkspaceGroup {
    /** Which group this is; the order of the groups is pinned, viewing, hidden. */
    readonly key: 'pinned' | 'viewing' | 'hidden';
    /** The heading the group shows. */
    readonly label: string;
    /** The group's tiles, in the order they were given. */
    readonly tiles: readonly WorkspaceTile[];
}
/**
 * The groups that have at least one tile, in the order pinned, viewing, hidden. A pinned panel is in the pinned group only,
 * whatever its live state; each group keeps the order its tiles were given in.
 */
export declare function workspaceGroups(tiles: readonly WorkspaceTile[], labels: Pick<WorkspaceLabels, 'workspacePinned' | 'workspaceViewing' | 'workspaceHidden'>): WorkspaceGroup[];
/** The tiles whose title holds `text`, ignoring case and outer spaces; blank text keeps them all. */
export declare function filterWorkspaceTiles(tiles: readonly WorkspaceTile[], text: string): readonly WorkspaceTile[];
/** The title a tile shows: the panel's title, else its url, else `untitled`. */
export declare function workspaceTileTitle(title: string | undefined, url: string | undefined, untitled: string): string;
/**
 * The tiles per row at `size`, from the defaults overlaid with `counts`.
 * @throws RangeError when the count for `size` is not a positive integer.
 */
export declare function workspaceTileColumns(size: WorkspaceTileSize, counts: Partial<WorkspaceTileCounts> | undefined): number;
