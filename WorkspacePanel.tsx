/**
 * `WorkspacePanel`: a ready-made panel view that lists the workspace's panels as a grid of tiles, grouped as pinned, viewing and hidden.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */

import * as React from 'react';
import Box from '@mui/material/Box';
import { resolveLabels } from './labels.js';
import { useOptionalHost } from './hostApi.js';
import { useViewSnapshot } from './snapshots.js';
import { useWorkspace, usePanelStates } from './panels/usePanelStates.js';
import { usePhoneSize } from './phoneFit.js';
import {
  filterWorkspaceTiles,
  workspaceGroups,
  workspaceTileColumns,
  workspaceTileTitle,
  type WorkspaceTile,
  type WorkspaceTileCounts,
  type WorkspaceTileSize,
} from './workspacePanelModel.js';

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
export function WorkspacePanel({ tileCounts, tileSize = 'medium', className }: WorkspacePanelProps): React.JSX.Element {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const columns = workspaceTileColumns(tileSize, tileCounts);
  const states = usePanelStates({ listed: true, status: ['live', 'parked'] });
  const [search, setSearch] = React.useState('');
  const tiles: WorkspaceTile[] = states.map((state) => ({
    id: state.id,
    title: workspaceTileTitle(state.title, state.url, labels.workspaceUntitled),
    live: state.status === 'live',
    pinned: state.pinned,
  }));
  const shown = filterWorkspaceTiles(tiles, search);
  const groups = workspaceGroups(shown, labels);
  const message = tiles.length === 0 ? labels.workspaceEmpty : shown.length === 0 ? labels.workspaceNoMatches : undefined;
  return (
    <Box data-workspace-panel="" className={className} sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box
        component="input"
        type="search"
        data-workspace-search=""
        aria-label={labels.workspaceSearch}
        placeholder={labels.workspaceSearch}
        value={search}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        sx={{ width: '100%', boxSizing: 'border-box', font: 'inherit', color: 'text.primary' }}
      />
      {message !== undefined && (
        <Box role="status" data-workspace-empty="" sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {message}
        </Box>
      )}
      {groups.map((group) => (
        <React.Fragment key={group.key}>
          <Box role="heading" aria-level={3} data-workspace-group={group.key} sx={{ color: 'text.disabled', textTransform: 'uppercase' }}>
            {group.label}
          </Box>
          <Box data-workspace-tiles="" data-columns={columns} sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {group.tiles.map((tile) => (
              <WorkspaceTileButton key={tile.id} tile={tile} />
            ))}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

function WorkspaceTileButton({ tile }: { tile: WorkspaceTile }): React.JSX.Element {
  const snapshot = useViewSnapshot(tile.id);
  const workspace = useWorkspace();
  const size = usePhoneSize();
  const ratio = `${size.width} / ${size.height}`;
  return (
    <Box
      component="button"
      type="button"
      data-workspace-tile={tile.id}
      data-live={tile.live ? 'true' : undefined}
      aria-label={tile.title}
      onClick={() => {
        workspace?.panels.get(tile.id)?.show('person');
      }}
      sx={{ display: 'block', minWidth: 0, border: 0, bgcolor: 'action.hover', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
    >
      {snapshot ? (
        <Box component="img" src={snapshot.src} alt="" sx={{ display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        <Box aria-hidden="true" sx={{ width: '100%', aspectRatio: ratio, bgcolor: 'action.selected' }} />
      )}
      <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.title}</Box>
    </Box>
  );
}
