import type { ReactNode } from 'react';
import type { PhonuxLabels } from './labels.js';
/**
 * The plain model behind `WorkspacePanel`: its tile sizes and counts, its drop order, and the title a tile shows.
 * Nothing here touches React, so it can be checked without a mounted panel.
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
export type WorkspaceLabels = Pick<PhonuxLabels, 'workspaceUntitled' | 'workspaceEmpty'>;
/**
 * One entry a `WorkspacePanel` lists as a tile. The host supplies these, or the panel derives them from the workspace.
 * @public
 */
export interface WorkspacePanelEntry {
    /** The id the tile reports on activate, drop and trash. */
    readonly id: string;
    /** The title the tile shows. */
    readonly title: string;
    /** Whether the entry is in the row now; `false` means parked. The tile carries it as `data-live` for the host's styles. */
    readonly live: boolean;
    /** An image URL drawn in the tile until a picture of the panel is taken. */
    readonly placeholder?: string;
    /**
     * The panel's width in slots (a positive integer). The tile spans that many grid columns, capped at the grid's columns, and
     * is as tall as a one-column tile in its row. A tile capped at the columns shows the panel at its own ratio instead.
     * @defaultValue `1`
     */
    readonly slots?: number;
    /** The host's own element drawn before the tile's title. The panel sets no size or color on it. Left out, the caption shows the title alone. */
    readonly icon?: ReactNode;
}
/**
 * The ids in the order a drop of `movedId` onto `overId` leaves them: `movedId` takes `overId`'s place and the ids between
 * the two shift one place, as a sortable list does. Unchanged when either id is absent or they are the same.
 */
export declare function reorderWorkspaceIds(ids: readonly string[], movedId: string, overId: string): string[];
/**
 * The grid columns a tile spans: its panel's width in slots, capped at the grid's column count, and 1 when the entry gives no slots.
 * @throws RangeError when `slots` is not a positive integer.
 */
export declare function workspaceTileSpan(slots: number | undefined, columns: number): number;
/**
 * One row of tiles as `packWorkspaceTiles` lays them out: the tiles `start` up to (not including) `end`, in the order given.
 * @public
 */
export interface WorkspaceTileRow {
    /** The index of the row's first tile. */
    readonly start: number;
    /** One past the index of the row's last tile. */
    readonly end: number;
    /** The grid columns the row's tiles take together. */
    readonly used: number;
    /**
     * Whether the row is drawn across the whole grid width: true only for a row cut short because the next tile did not fit
     * in what was left of it. Its tiles share the width as if the grid had `used` columns. A last row is never stretched.
     */
    readonly stretched: boolean;
}
/**
 * Packs tiles into rows of `columns` columns, in the order given: a tile that does not fit in what is left of a row starts
 * the next row, and the row it left is stretched. No tile moves ahead of another to fill a hole. A tile wider than
 * `columns` takes a row of its own, whose `used` is then more than `columns`; a single-row strip reads the first row and
 * shows none of it when it is that wide.
 * @param spans - Each tile's width in columns: 1 for a phone page, 2 for a Fold page.
 * @param columns - The columns a row holds: the grid's column count, or the phones that fit across a strip.
 * @throws RangeError when `columns` is not a positive integer, or a span is not a positive integer.
 * @public
 */
export declare function packWorkspaceTiles(spans: readonly number[], columns: number): WorkspaceTileRow[];
/**
 * A tile's picture ratio: `span` phone widths by one phone height. A tile wider than the grid's columns draws at this
 * ratio, so it shows the whole panel shorter instead of cropped.
 */
export declare function workspaceTileRatio(span: number, size: {
    width: number;
    height: number;
}): string;
/** The title a tile shows: the panel's title, else its url, else `untitled`. */
export declare function workspaceTileTitle(title: string | undefined, url: string | undefined, untitled: string): string;
/**
 * The tiles per row at `size`, from the defaults overlaid with `counts`.
 * @throws RangeError when the count for `size` is not a positive integer.
 */
export declare function workspaceTileColumns(size: WorkspaceTileSize, counts: Partial<WorkspaceTileCounts> | undefined): number;
