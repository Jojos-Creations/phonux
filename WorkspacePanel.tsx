/**
 * `WorkspacePanel`: a ready-made panel view that lists panels as a grid of tiles.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDndContext,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DndMonitorListener,
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
  packWorkspaceTiles,
  reorderWorkspaceIds,
  workspaceTileRatio,
  workspaceTileSpan,
  workspaceTileColumns,
  workspaceTileTitle,
  type WorkspacePanelEntry,
  type WorkspaceTileCounts,
  type WorkspaceTileSize,
} from './workspacePanelModel.js';

/** The droppable a `WorkspaceTrash` registers as. Namespaced so it cannot collide with a tile id. */
const TRASH_DROP_ID = 'phonux-workspace-trash';

/** Hides the announcement region from sight and keeps it for screen readers. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const;

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
   * The tiles to list, in the order they are given. Given, the host owns the list and the panel reads
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
   * Drawn above the grid and outside it, for the host's own icons. Left out, no header is drawn.
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
 * The workspace's panels as tiles. Activating a tile shows that panel, or calls the
 * host's `onActivate`. Pass `entries` to list the host's own tiles, and `onReorder` or `onTrash` to make them draggable.
 *
 * It draws its structure only: the host's header, the tile grid, and each tile's picture, icon and caption. It draws no padding, no gap, no type size and no scroll region. The developer sets those
 * by wrapping the panel or through `className`. Every visible string comes from the host's `labels` (the `workspace*`
 * keys, and the drag announcements shared with the panels).
 * Rendered inside a host's `DndContext`, the tiles join that context instead of opening their own: the host's sensors and
 * collision detection apply, and a tile can be dropped on the host's own drop targets. The panel draws its own drag preview
 * and the drag announcements from the host's labels in both cases.
 * Tile pictures come from the host's snapshots (`useViewSnapshot`); a tile with no picture shows its `placeholder`, else an
 * empty placeholder. A tile spans as many grid columns as its entry's `slots`, capped at the grid's columns, and is as tall as
 * a one-column tile in its row; a tile capped at the columns shows its panel at the panel's own ratio. Tiles fill rows in the
 * order given: a tile that does not fit in what is left of a row starts the next one, and the row it left is stretched across
 * the grid, its tiles wider and taller by the same ratio. A last row that is not full keeps the normal size.
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
  }));
  return <WorkspaceView {...props} entries={entries} />;
}

/** The grid itself, over the entries it is given. */
function WorkspaceView({ entries, tileCounts, tileSize = 'medium', className, onActivate, onReorder, onTrash, header }: WorkspacePanelProps & { entries: readonly WorkspacePanelEntry[] }): React.JSX.Element {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const workspace = useWorkspace();
  const columns = workspaceTileColumns(tileSize, tileCounts);
  const spans = entries.map((entry) => workspaceTileSpan(entry.slots, columns));
  const [dragging, setDragging] = React.useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = React.useState('');
  const draggable = onReorder !== undefined || onTrash !== undefined;
  const enclosed = useEnclosingDndContext();
  // Touch waits for a hold, so a vertical swipe on a tile still scrolls the grid; the mouse waits for a few px of movement, so a click still activates.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
  const titleOf = (id: UniqueIdentifier | undefined): string => entries.find((entry) => entry.id === String(id))?.title ?? labels.workspaceUntitled;
  const activate = (id: string): void => {
    if (onActivate !== undefined) onActivate(id);
    else workspace?.panels.get(id)?.show('person');
  };
  const message = entries.length === 0 ? labels.workspaceEmpty : undefined;
  const hasHeader = header !== undefined && header !== null;
  // Inside a host's context the panel cannot set that context's announcements, so it writes the tile drag's own, from the labels.
  const listener: DndMonitorListener = {
    onDragStart: (event: DragStartEvent) => {
      setDragging(String(event.active.id));
      if (enclosed) setAnnouncement(labels.pickedUp(titleOf(event.active.id)));
    },
    onDragEnd: (event: DragEndEvent) => {
      setDragging(undefined);
      const { active, over } = event;
      if (enclosed) setAnnouncement(labels.dropped(titleOf(active.id)));
      if (over === null) return;
      const id = String(active.id);
      if (over.id === TRASH_DROP_ID) onTrash?.(id);
      else if (over.id !== active.id && entries.some((entry) => entry.id === String(over.id))) onReorder?.(reorderWorkspaceIds(entries.map((entry) => entry.id), id, String(over.id)));
    },
    onDragCancel: (event) => {
      setDragging(undefined);
      if (enclosed) setAnnouncement(labels.dragCancelled(titleOf(event.active.id)));
    },
  };
  const body = (
    <>
      <WorkspaceDragListener listener={listener} />
      <Box data-workspace-panel="" className={className} sx={{ display: 'flex', flexDirection: 'column' }}>
        {hasHeader && <Box data-workspace-header="">{header}</Box>}
        {message !== undefined && (
          <Box role="status" data-workspace-empty="" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            {message}
          </Box>
        )}
        {enclosed && (
          <Box role="status" data-workspace-announcement="" sx={VISUALLY_HIDDEN}>
            {announcement}
          </Box>
        )}
        <Box data-workspace-tiles="" data-columns={columns} sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {packWorkspaceTiles(spans, columns).flatMap((row) => {
            const tiles = entries.slice(row.start, row.end).map((tile, i) => (
              <WorkspaceTileButton key={tile.id} tile={tile} span={spans[row.start + i] ?? 1} columns={columns} draggable={draggable} onActivate={activate} />
            ));
            if (!row.stretched) return tiles;
            // A row cut short by a wider tile is laid out as a grid of its own columns across the full width; the gap is the grid's.
            return [
              <Box key={`row:${entries[row.start]?.id ?? row.start}`} data-workspace-tile-row="" data-columns={row.used} sx={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: `repeat(${row.used}, minmax(0, 1fr))`, columnGap: 'inherit' }}>
                {tiles}
              </Box>,
            ];
          })}
        </Box>
      </Box>
      {typeof document !== 'undefined' &&
        createPortal(
          // Drawn in the body: a tile sits inside transformed ancestors, which would offset a fixed overlay from the pointer.
          <DragOverlay dropAnimation={null}>
            {dragging === undefined ? null : (
              <Box data-workspace-ghost="" sx={{ bgcolor: 'background.paper', boxShadow: (theme: Theme) => theme.shadows[4], borderRadius: 1, whiteSpace: 'nowrap', cursor: 'grabbing' }}>
                {titleOf(dragging)}
              </Box>
            )}
          </DragOverlay>,
          document.body,
        )}
    </>
  );
  // Without a host context the grid opens its own, with the drag announcements the host's labels give; inside one the tiles join it.
  if (enclosed) return body;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={workspaceCollisions}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => labels.pickedUp(titleOf(active.id)),
          onDragOver: () => undefined,
          onDragEnd: ({ active }) => labels.dropped(titleOf(active.id)),
          onDragCancel: ({ active }) => labels.dragCancelled(titleOf(active.id)),
        },
      }}
    >
      {body}
    </DndContext>
  );
}

/** Listens to the drag of the context it is rendered in, so the grid's own and a host's context run the same handlers. */
function WorkspaceDragListener({ listener }: { listener: DndMonitorListener }): null {
  useDndMonitor(listener);
  return null;
}

/**
 * Whether a dnd-kit context encloses the panel. Outside any `DndContext` dnd-kit hands every reader one shared default in
 * which `measureDroppableContainers` and `dragOverlay.setRef` are the same no-op; a real context gives each its own function.
 */
function useEnclosingDndContext(): boolean {
  const context = useDndContext();
  const measure: unknown = context.measureDroppableContainers;
  const setRef: unknown = context.dragOverlay.setRef;
  return measure !== setRef;
}

/** A tile is picked up, and dropped onto, when the grid is draggable. */
function WorkspaceTileButton({ tile, span, columns, draggable, onActivate }: { tile: WorkspacePanelEntry; span: number; columns: number; draggable: boolean; onActivate: (id: string) => void }): React.JSX.Element {
  const snapshot = useViewSnapshot(tile.id);
  const phone = usePhoneSize();
  const slots = tile.slots ?? 1;
  // A wide tile that fits takes its height from a one-column gauge on the grid's own tracks, so it lines up with its row whatever the gap.
  const gauged = span > 1 && slots <= columns;
  const ratio = workspaceTileRatio(gauged ? 1 : slots, phone);
  const drag = useDraggable({ id: tile.id, disabled: !draggable });
  const drop = useDroppable({ id: tile.id, disabled: !draggable });
  const over = drop.isOver && !drag.isDragging;
  const strip = gauged ? { gridRow: 2, gridColumn: '1 / -1' } : {};
  const caption = <Box sx={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(tile.icon === undefined ? strip : {}) }}>{tile.title}</Box>;
  const picture = snapshot ? (
    <Box component="img" src={snapshot.src} alt="" sx={pictureSx(ratio, gauged)} />
  ) : tile.placeholder !== undefined ? (
    <Box component="img" data-workspace-placeholder="" src={tile.placeholder} alt="" sx={pictureSx(ratio, gauged)} />
  ) : (
    <Box aria-hidden="true" sx={{ ...pictureSx(ratio, gauged), bgcolor: 'action.selected' }} />
  );
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
        display: gauged ? 'grid' : 'block',
        ...(gauged ? { gridTemplateColumns: 'subgrid', gridTemplateRows: 'auto auto' } : {}),
        minWidth: 0,
        gridColumn: `span ${span}`,
        border: 0,
        bgcolor: 'action.hover',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: draggable ? 'grab' : 'pointer',
        overflow: 'hidden',
        opacity: drag.isDragging ? (theme: Theme) => theme.palette.action.disabledOpacity : undefined,
        outline: over ? (theme: Theme) => `${theme.spacing(0.25)} solid ${theme.palette.primary.main}` : undefined,
      }}
    >
      {gauged && <Box aria-hidden="true" data-workspace-tile-gauge="" sx={{ gridRow: 1, gridColumn: 1, alignSelf: 'start', aspectRatio: ratio }} />}
      {picture}
      {tile.icon === undefined ? (
        caption
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, ...strip }}>
          <Box data-workspace-tile-icon="" sx={{ display: 'flex', flexShrink: 0 }}>
            {tile.icon}
          </Box>
          {caption}
        </Box>
      )}
    </Box>
  );
}

/**
 * A tile picture's style. A gauged picture fills the gauge's row and gives no size of its own, so its image cannot make the
 * tile taller than its row.
 */
function pictureSx(ratio: string, gauged: boolean) {
  if (gauged) return { display: 'block', gridRow: 1, gridColumn: '1 / -1', width: '100%', height: '100%', contain: 'size', objectFit: 'cover', objectPosition: 'top' } as const;
  return { display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' } as const;
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
