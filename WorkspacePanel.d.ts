/**
 * `WorkspacePanel`: a ready-made panel view that lists the workspace's panels as a grid of tiles, grouped as pinned, viewing and hidden.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */
import * as React from 'react';
import { type WorkspaceTileCounts, type WorkspaceTileSize } from './workspacePanelModel.js';
/**
 * The options a `WorkspacePanel` takes. Each is optional; a left-out one keeps the library default.
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
    /** A class name for the root element, so the developer can set its spacing, type and colours. */
    readonly className?: string;
}
/**
 * The workspace's panels as tiles, with a search field above them. Activating a tile shows that panel. The panel lists the
 * panels that are live or parked and `listed`; set `listed: false` on the template that renders it to leave it out of its own grid.
 *
 * It draws its structure only: the search field, a heading per non-empty group, the tile grid, and each tile's picture and
 * caption. It draws no padding, no gap, no type size and no scroll region. The developer sets those by wrapping the panel
 * or through `className`. Every visible string comes from the host's `labels` (the `workspace*` keys).
 * Tile pictures come from the host's snapshots (`useViewSnapshot`); a tile with no picture shows an empty placeholder.
 *
 * @throws RangeError when a tile count is not a positive integer.
 * @public
 */
export declare function WorkspacePanel({ tileCounts, tileSize, className }: WorkspacePanelProps): React.JSX.Element;
