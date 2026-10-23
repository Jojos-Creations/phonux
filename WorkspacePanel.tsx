/**
 * `WorkspacePanel`: a ready-made panel view that lists panels as a grid of tiles, grouped as pinned, viewing and hidden.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { resolveLabels } from './labels.js';
import { useOptionalHost } from './hostApi.js';
import { useViewSnapshot } from './snapshots.js';
import { useWorkspace, usePanelStates } from './panels/usePanelStates.js';
import { usePhoneSize } from './phoneFit.js';
import {
  filterWorkspaceTiles,
  reorderWorkspaceIds,
  workspaceTileRatio,
  workspaceTileSpan,
  workspaceGroups,
  workspaceTileColumns,
  workspaceTileTitle,
  type WorkspacePanelEntry,
  type WorkspaceTileCounts,
  type WorkspaceTileSize,
} from './workspacePanelModel.js';

/** The droppable a `WorkspaceTrash` registers as. Namespaced so it cannot collide with a tile id. */
const TRASH_DROP_ID = 'phonux-workspace-trash';

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
  /** A class name for the root element, so the developer can set its spacing, type and colours. */
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
 * each tile's picture and caption. It draws no padding, no gap, no type size and no scroll region. The developer sets those
 * by wrapping the panel or through `className`. Every visible string comes from the host's `labels` (the `workspace*`
 * keys, and the drag announcements shared with the panels).
 * Tile pictures come from the host's snapshots (`useViewSnapshot`); a tile with no picture shows its `placeholder`, else an
 * empty placeholder. A tile spans as many grid columns as its entry's `slots`, capped at the grid's columns, and its picture
 * is that many phone widths wide and one phone tall, so every tile in a row has the same height.
 *
 * @throws RangeError when a tile count is not a positive integer.
 * @public
 */
export function WorkspacePanel(props: WorkspacePanelProps): React.JSX.Element {
  if (props.entries !== undefined) return <WorkspaceView {...props} entries={props.entries} />;
  return <WorkspaceOwnPanel {...props} />;
}

/** `WorkspacePanel` without host entries: the workspace's own live and parked panels that are listed. */
function WorkspaceOwnPanel(props: WorkspacePanelProps): React.JSX.Element {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const states = usePanelStates({ listed: true, status: ['live', 'parked'] });
  const entries: WorkspacePanelEntry[] = states.map((state) => ({
    id: state.id,
    title: workspaceTileTitle(state.title, state.url, labels.workspaceUntitled),
    live: state.status === 'live',
    pinned: state.pinned,
  }));
  return <WorkspaceView {...props} entries={entries} />;
}

/** The grid itself, over the entries it is given. */
function WorkspaceView({ entries, tileCounts, tileSize = 'medium', className, onActivate, onReorder, onTrash, header }: WorkspacePanelProps & { entries: readonly WorkspacePanelEntry[] }): React.JSX.Element {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const workspace = useWorkspace();
  const columns = workspaceTileColumns(tileSize, tileCounts);
  const [search, setSearch] = React.useState('');
  const [dragging, setDragging] = React.useState<string | undefined>(undefined);
  const draggable = onReorder !== undefined || onTrash !== undefined;
  // Touch waits for a hold, so a vertical swipe on a tile still scrolls the grid; the mouse waits for a few px of movement, so a click still activates.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const titleOf = (id: UniqueIdentifier | undefined): string => entries.find((entry) => entry.id === String(id))?.title ?? labels.workspaceUntitled;
  const activate = (id: string): void => {
    if (onActivate !== undefined) onActivate(id);
    else workspace?.panels.get(id)?.show('person');
  };
  const tiles = filterWorkspaceTiles(entries, search);
  const groups = workspaceGroups(tiles, labels);
  const message = entries.length === 0 ? labels.workspaceEmpty : tiles.length === 0 ? labels.workspaceNoMatches : undefined;
  const hasHeader = header !== undefined && header !== null;
  const onDragEnd = (event: DragEndEvent): void => {
    setDragging(undefined);
    const { active, over } = event;
    if (over === null) return;
    const id = String(active.id);
    if (over.id === TRASH_DROP_ID) onTrash?.(id);
    else if (over.id !== active.id) onReorder?.(reorderWorkspaceIds(entries.map((entry) => entry.id), id, String(over.id)));
  };
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={workspaceCollisions}
      onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(undefined)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => labels.pickedUp(titleOf(active.id)),
          onDragOver: () => undefined,
          onDragEnd: ({ active }) => labels.dropped(titleOf(active.id)),
          onDragCancel: ({ active }) => labels.dragCancelled(titleOf(active.id)),
        },
      }}
    >
      <Box data-workspace-panel="" className={className} sx={{ display: 'flex', flexDirection: 'column' }}>
        {hasHeader && <Box data-workspace-header="">{header}</Box>}
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
                <WorkspaceTileButton key={tile.id} tile={tile} span={workspaceTileSpan(tile.slots, columns)} draggable={draggable} onActivate={activate} />
              ))}
            </Box>
          </React.Fragment>
        ))}
      </Box>
      {typeof document !== 'undefined' &&
        createPortal(
          // Drawn in the body: a tile sits inside transformed ancestors, which would offset a fixed overlay from the pointer.
          <DragOverlay dropAnimation={null}>
            {dragging === undefined ? null : (
              <Box data-workspace-ghost="" sx={{ bgcolor: 'background.paper', boxShadow: 4, borderRadius: 1, whiteSpace: 'nowrap', cursor: 'grabbing' }}>
                {titleOf(dragging)}
              </Box>
            )}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** A tile is picked up, and dropped onto, when the grid is draggable. */
function WorkspaceTileButton({ tile, span, draggable, onActivate }: { tile: WorkspacePanelEntry; span: number; draggable: boolean; onActivate: (id: string) => void }): React.JSX.Element {
  const snapshot = useViewSnapshot(tile.id);
  const ratio = workspaceTileRatio(span, usePhoneSize());
  const drag = useDraggable({ id: tile.id, disabled: !draggable });
  const drop = useDroppable({ id: tile.id, disabled: !draggable });
  const over = drop.isOver && !drag.isDragging;
  return (
    <Box
      component="button"
      type="button"
      ref={(node: HTMLElement | null) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...drag.listeners}
      data-workspace-tile={tile.id}
      data-live={tile.live ? 'true' : undefined}
      data-span={span}
      data-over={over ? 'true' : undefined}
      aria-label={tile.title}
      onClick={() => onActivate(tile.id)}
      sx={{
        display: 'block',
        minWidth: 0,
        gridColumn: `span ${span}`,
        border: 0,
        bgcolor: 'action.hover',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: draggable ? 'grab' : 'pointer',
        overflow: 'hidden',
        opacity: drag.isDragging ? 0.3 : undefined,
        outline: over ? '2px solid' : undefined,
        outlineColor: 'primary.main',
      }}
    >
      {snapshot ? (
        <Box component="img" src={snapshot.src} alt="" sx={{ display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' }} />
      ) : tile.placeholder !== undefined ? (
        <Box component="img" data-workspace-placeholder="" src={tile.placeholder} alt="" sx={{ display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' }} />
      ) : (
        <Box aria-hidden="true" sx={{ width: '100%', aspectRatio: ratio, bgcolor: 'action.selected' }} />
      )}
      <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tile.title}</Box>
    </Box>
  );
}

/**
 * The host's drop target for a tile: a tile dropped on it reports through `onTrash`. Place it inside a `WorkspacePanel`,
 * for example in its header; outside one it draws its children and takes no drops.
 * @public
 */
export function WorkspaceTrash({ children, className }: WorkspaceTrashProps): React.JSX.Element {
  const drop = useDroppable({ id: TRASH_DROP_ID });
  return (
    <Box ref={drop.setNodeRef} data-workspace-trash="" data-over={drop.isOver ? 'true' : undefined} className={className}>
      {children}
    </Box>
  );
}

/** A drop on the trash wins over the tiles it overlaps; anywhere else the nearest tile is the target. */
const workspaceCollisions: CollisionDetection = (args) => {
  const trash = pointerWithin(args).find((hit) => hit.id === TRASH_DROP_ID);
  return trash ? [trash] : closestCenter(args);
};
