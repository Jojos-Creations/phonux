/**
 * `WorkspacePanel`: a ready-made panel view that lists the workspace's panels as a grid of tiles, grouped as pinned, viewing and hidden.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */

import * as React from 'react';
import Box from '@mui/material/Box';
import { useViewSnapshot } from './snapshots.js';
import { useWorkspace, usePanelStates } from './panels/usePanelStates.js';
import { usePhoneSize } from './phoneFit.js';
import {
  DEFAULT_WORKSPACE_PANEL_LABELS,
  filterWorkspaceTiles,
  workspaceGroups,
  workspaceTileColumns,
  workspaceTileTitle,
  type WorkspacePanelLabels,
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
  /** The text around the tiles. A label left out keeps its English default. */
  readonly labels?: Partial<WorkspacePanelLabels>;
}

/**
 * The workspace's panels as tiles, with a search field above them. Activating a tile shows that panel. The panel lists the
 * panels that are live or parked and `listed`; set `listed: false` on the template that renders it to leave it out of its own grid.
 *
 * Tile pictures come from the host's snapshots (`useViewSnapshot`); a tile with no picture shows its title on a plain
 * placeholder. The component draws no padding and no scroll region: the panel's own frame and footer supply both.
 *
 * @throws RangeError when a tile count is not a positive integer.
 * @public
 */
export function WorkspacePanel({ tileCounts, tileSize = 'medium', labels }: WorkspacePanelProps): React.JSX.Element {
  const text = { ...DEFAULT_WORKSPACE_PANEL_LABELS, ...labels };
  const columns = workspaceTileColumns(tileSize, tileCounts);
  const states = usePanelStates({ listed: true, status: ['live', 'parked'] });
  const [search, setSearch] = React.useState('');
  const tiles: WorkspaceTile[] = states.map((state) => ({
    id: state.id,
    title: workspaceTileTitle(state.title, state.url, text.untitled),
    live: state.status === 'live',
    pinned: state.pinned,
  }));
  const shown = filterWorkspaceTiles(tiles, search);
  const groups = workspaceGroups(shown, text);
  const message = tiles.length === 0 ? text.empty : shown.length === 0 ? text.noMatches : undefined;
  return (
    <Box data-workspace-panel="" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        component="input"
        type="search"
        data-workspace-search=""
        aria-label={text.search}
        placeholder={text.search}
        value={search}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
        sx={{ width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 13, p: 1, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary' }}
      />
      {message !== undefined && (
        <Box role="status" data-workspace-empty="" sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'center' }}>
          {message}
        </Box>
      )}
      {groups.map((group) => (
        <React.Fragment key={group.key}>
          <Box role="heading" aria-level={3} data-workspace-group={group.key} sx={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'text.disabled', px: 0.5 }}>
            {group.label}
          </Box>
          <Box data-workspace-tiles="" data-columns={columns} sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1 }}>
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
      sx={{ display: 'block', minWidth: 0, p: 0, border: 0, borderRadius: 1, bgcolor: 'action.hover', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}
    >
      {snapshot ? (
        <Box component="img" src={snapshot.src} alt="" sx={{ display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        <Box aria-hidden="true" sx={{ width: '100%', aspectRatio: ratio, bgcolor: 'action.selected' }} />
      )}
      <Box sx={{ px: 0.75, py: 0.5, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.title}</Box>
    </Box>
  );
}
