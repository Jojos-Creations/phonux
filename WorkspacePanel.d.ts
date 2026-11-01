/**
 * `WorkspacePanel`: a ready-made panel view that lists panels as a grid of tiles, grouped as pinned, viewing and hidden.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */
import * as React from 'react';
import { type WorkspacePanelEntry, type WorkspaceTileCounts, type WorkspaceTileSize } from './workspacePanelModel.js';
/**
 * The props of `WorkspacePanel`. Each is optional; a left-out one keeps the library default.
 * @public
 */
export interface WorkspacePanelProps {
    /**
     * How many tiles fill one row at each size.
     * @defaultValue `{ small: 5, medium: 4, large: 3 }`
     */
    readonly tileCounts?: Partial<WorkspaceTileCounts>;
    /**
     * The size the tiles draw at.
     * @defaultValue `'medium'`
     */
    readonly tileSize?: WorkspaceTileSize;
    /** A class name for the root element, so the developer can set its spacing, type and colors. */
    readonly className?: string;
    /**
     * The tiles to list, in the order they are given within each group. Given, the host owns the list and the panel reads
     * no workspace state. Left out, the panel lists the workspace's live and parked panels that are `listed`.
     */
    readonly entries?: readonly WorkspacePanelEntry[];
    /**
     * Called with the id of the tile the person chose. Left out, choosing a tile shows that panel in the workspace.
     */
    readonly onActivate?: (id: string) => void;
    /**
     * Called with the new order of every entry's id when a tile is dropped on another tile. Giving it, or `onTrash`, makes
     * the tiles draggable. The panel keeps no order of its own, so the host stores the one it is given.
     */
    readonly onReorder?: (ids: readonly string[]) => void;
    /**
     * Called with the id of a tile dropped on a `WorkspaceTrash` inside this panel. The panel removes nothing itself; the
     * host removes the entry.
     */
    readonly onTrash?: (id: string) => void;
    /**
     * Drawn above the panel's search field and outside the grid, for the host's own icons. Left out, no header is drawn.
     */
    readonly header?: React.ReactNode;
}
/**
 * The props of `WorkspaceTrash`.
 * @public
 */
export interface WorkspaceTrashProps {
    /** The host's own content, such as an icon button. */
    readonly children?: React.ReactNode;
    /** A class name for the target, so the host can style its drop state through `[data-over]`. */
    readonly className?: string;
}
/**
 * The workspace's panels as tiles, with a search field above them. Activating a tile shows that panel, or calls the
 * host's `onActivate`. Pass `entries` to list the host's own tiles, and `onReorder` or `onTrash` to make them draggable.
 *
 * It draws its structure only: the host's header, the search field, a heading per non-empty group, the tile grid, and
 * each tile's picture, icon and caption. It draws no padding, no gap, no type size and no scroll region. The developer sets those
 * by wrapping the panel or through `className`. Every visible string comes from the host's `labels` (the `workspace*`
 * keys, and the drag announcements shared with the panels).
 * Rendered inside a host's `DndContext`, the tiles join that context instead of opening their own: the host's sensors and
 * collision detection apply, and a tile can be dropped on the host's own drop targets. The panel draws its own drag preview
 * and the drag announcements from the host's labels in both cases.
 * Tile pictures come from the host's snapshots (`useViewSnapshot`); a tile with no picture shows its `placeholder`, else an
 * empty placeholder. A tile spans as many grid columns as its entry's `slots`, capped at the grid's columns, and its picture
 * is that many phone widths wide and one phone tall, so every tile in a row has the same height.
 *
 * @throws RangeError when a tile count is not a positive integer.
 * @public
 */
export declare function WorkspacePanel(props: WorkspacePanelProps): React.JSX.Element;
/**
 * The host's drop target for a tile: a tile dropped on it reports through `onTrash`. Place it inside a `WorkspacePanel`,
 * for example in its header; outside one it draws its children and takes no drops.
 * @public
 */
export declare function WorkspaceTrash({ children, className }: WorkspaceTrashProps): React.JSX.Element;
