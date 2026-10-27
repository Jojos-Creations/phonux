import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * `WorkspacePanel`: a ready-made panel view that lists panels as a grid of tiles.
 * It is a view, so a template opts in with `definePanel({ id, view: WorkspacePanel })`.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import { closestCenter, DndContext, DragOverlay, MouseSensor, pointerWithin, TouchSensor, useDndContext, useDndMonitor, useDraggable, useDroppable, useSensor, useSensors, } from '@dnd-kit/core';
import { resolveLabels } from './labels.js';
import { useOptionalHost } from './hostApi.js';
import { useViewSnapshot } from './snapshots.js';
import { useWorkspace, usePanelStates } from './panels/usePanelStates.js';
import { usePhoneSize } from './phoneFit.js';
import { reorderWorkspaceIds, workspaceTileRatio, workspaceTileSpan, workspaceTileColumns, workspaceTileTitle, } from './workspacePanelModel.js';
/** The droppable a `WorkspaceTrash` registers as. Namespaced so it cannot collide with a tile id. */
const TRASH_DROP_ID = 'phonux-workspace-trash';
/** Hides the announcement region from sight and keeps it for screen readers. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
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
 * empty placeholder. A tile spans as many grid columns as its entry's `slots`, capped at the grid's columns, and its picture
 * is that many phone widths wide and one phone tall, so every tile in a row has the same height.
 *
 * @throws RangeError when a tile count is not a positive integer.
 * @public
 */
export function WorkspacePanel(props) {
    if (props.entries !== undefined)
        return _jsx(WorkspaceView, { ...props, entries: props.entries });
    return _jsx(WorkspaceOwnPanel, { ...props });
}
/** `WorkspacePanel` without host entries: the workspace's own live and parked panels that are listed. */
function WorkspaceOwnPanel(props) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const states = usePanelStates({ listed: true, status: ['live', 'parked'] });
    const entries = states.map((state) => ({
        id: state.id,
        title: workspaceTileTitle(state.title, state.url, labels.workspaceUntitled),
        live: state.status === 'live',
    }));
    return _jsx(WorkspaceView, { ...props, entries: entries });
}
/** The grid itself, over the entries it is given. */
function WorkspaceView({ entries, tileCounts, tileSize = 'medium', className, onActivate, onReorder, onTrash, header }) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const workspace = useWorkspace();
    const columns = workspaceTileColumns(tileSize, tileCounts);
    const [dragging, setDragging] = React.useState(undefined);
    const [announcement, setAnnouncement] = React.useState('');
    const draggable = onReorder !== undefined || onTrash !== undefined;
    const enclosed = useEnclosingDndContext();
    // Touch waits for a hold, so a vertical swipe on a tile still scrolls the grid; the mouse waits for a few px of movement, so a click still activates.
    const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));
    const titleOf = (id) => entries.find((entry) => entry.id === String(id))?.title ?? labels.workspaceUntitled;
    const activate = (id) => {
        if (onActivate !== undefined)
            onActivate(id);
        else
            workspace?.panels.get(id)?.show('person');
    };
    const message = entries.length === 0 ? labels.workspaceEmpty : undefined;
    const hasHeader = header !== undefined && header !== null;
    // Inside a host's context the panel cannot set that context's announcements, so it writes the tile drag's own, from the labels.
    const listener = {
        onDragStart: (event) => {
            setDragging(String(event.active.id));
            if (enclosed)
                setAnnouncement(labels.pickedUp(titleOf(event.active.id)));
        },
        onDragEnd: (event) => {
            setDragging(undefined);
            const { active, over } = event;
            if (enclosed)
                setAnnouncement(labels.dropped(titleOf(active.id)));
            if (over === null)
                return;
            const id = String(active.id);
            if (over.id === TRASH_DROP_ID)
                onTrash?.(id);
            else if (over.id !== active.id && entries.some((entry) => entry.id === String(over.id)))
                onReorder?.(reorderWorkspaceIds(entries.map((entry) => entry.id), id, String(over.id)));
        },
        onDragCancel: (event) => {
            setDragging(undefined);
            if (enclosed)
                setAnnouncement(labels.dragCancelled(titleOf(event.active.id)));
        },
    };
    const body = (_jsxs(_Fragment, { children: [_jsx(WorkspaceDragListener, { listener: listener }), _jsxs(Box, { "data-workspace-panel": "", className: className, sx: { display: 'flex', flexDirection: 'column' }, children: [hasHeader && _jsx(Box, { "data-workspace-header": "", children: header }), message !== undefined && (_jsx(Box, { role: "status", "data-workspace-empty": "", sx: { color: 'text.secondary', textAlign: 'center' }, children: message })), enclosed && (_jsx(Box, { role: "status", "data-workspace-announcement": "", sx: VISUALLY_HIDDEN, children: announcement })), _jsx(Box, { "data-workspace-tiles": "", "data-columns": columns, sx: { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }, children: entries.map((tile) => (_jsx(WorkspaceTileButton, { tile: tile, span: workspaceTileSpan(tile.slots, columns), draggable: draggable, onActivate: activate }, tile.id))) })] }), typeof document !== 'undefined' &&
                createPortal(
                // Drawn in the body: a tile sits inside transformed ancestors, which would offset a fixed overlay from the pointer.
                _jsx(DragOverlay, { dropAnimation: null, children: dragging === undefined ? null : (_jsx(Box, { "data-workspace-ghost": "", sx: { bgcolor: 'background.paper', boxShadow: (theme) => theme.shadows[4], borderRadius: 1, whiteSpace: 'nowrap', cursor: 'grabbing' }, children: titleOf(dragging) })) }), document.body)] }));
    // Without a host context the grid opens its own, with the drag announcements the host's labels give; inside one the tiles join it.
    if (enclosed)
        return body;
    return (_jsx(DndContext, { sensors: sensors, collisionDetection: workspaceCollisions, accessibility: {
            announcements: {
                onDragStart: ({ active }) => labels.pickedUp(titleOf(active.id)),
                onDragOver: () => undefined,
                onDragEnd: ({ active }) => labels.dropped(titleOf(active.id)),
                onDragCancel: ({ active }) => labels.dragCancelled(titleOf(active.id)),
            },
        }, children: body }));
}
/** Listens to the drag of the context it is rendered in, so the grid's own and a host's context run the same handlers. */
function WorkspaceDragListener({ listener }) {
    useDndMonitor(listener);
    return null;
}
/**
 * Whether a dnd-kit context encloses the panel. Outside any `DndContext` dnd-kit hands every reader one shared default in
 * which `measureDroppableContainers` and `dragOverlay.setRef` are the same no-op; a real context gives each its own function.
 */
function useEnclosingDndContext() {
    const context = useDndContext();
    const measure = context.measureDroppableContainers;
    const setRef = context.dragOverlay.setRef;
    return measure !== setRef;
}
/** A tile is picked up, and dropped onto, when the grid is draggable. */
function WorkspaceTileButton({ tile, span, draggable, onActivate }) {
    const snapshot = useViewSnapshot(tile.id);
    const ratio = workspaceTileRatio(span, usePhoneSize());
    const drag = useDraggable({ id: tile.id, disabled: !draggable });
    const drop = useDroppable({ id: tile.id, disabled: !draggable });
    const over = drop.isOver && !drag.isDragging;
    const caption = _jsx(Box, { sx: { minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: tile.title });
    return (_jsxs(Box, { component: "button", type: "button", ref: (node) => {
            drag.setNodeRef(node);
            drop.setNodeRef(node);
        }, ...drag.listeners, "data-workspace-tile": tile.id, "data-live": tile.live ? 'true' : undefined, "data-span": span, "data-over": over ? 'true' : undefined, "aria-label": tile.title, onClick: () => onActivate(tile.id), sx: {
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
            opacity: drag.isDragging ? (theme) => theme.palette.action.disabledOpacity : undefined,
            outline: over ? (theme) => `${theme.spacing(0.25)} solid ${theme.palette.primary.main}` : undefined,
        }, children: [snapshot ? (_jsx(Box, { component: "img", src: snapshot.src, alt: "", sx: { display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' } })) : tile.placeholder !== undefined ? (_jsx(Box, { component: "img", "data-workspace-placeholder": "", src: tile.placeholder, alt: "", sx: { display: 'block', width: '100%', aspectRatio: ratio, objectFit: 'cover', objectPosition: 'top' } })) : (_jsx(Box, { "aria-hidden": "true", sx: { width: '100%', aspectRatio: ratio, bgcolor: 'action.selected' } })), tile.icon === undefined ? (caption) : (_jsxs(Box, { sx: { display: 'flex', alignItems: 'center', minWidth: 0 }, children: [_jsx(Box, { "data-workspace-tile-icon": "", sx: { display: 'flex', flexShrink: 0 }, children: tile.icon }), caption] }))] }));
}
/**
 * The host's drop target for a tile: a tile dropped on it reports through `onTrash`. Place it inside a `WorkspacePanel`,
 * for example in its header; outside one it draws its children and takes no drops.
 * @public
 */
export function WorkspaceTrash({ children, className }) {
    const drop = useDroppable({ id: TRASH_DROP_ID });
    return (_jsx(Box, { ref: drop.setNodeRef, "data-workspace-trash": "", "data-over": drop.isOver ? 'true' : undefined, className: className, children: children }));
}
/** A drop on the trash wins over the tiles it overlaps; anywhere else the nearest tile is the target. */
const workspaceCollisions = (args) => {
    const trash = pointerWithin(args).find((hit) => hit.id === TRASH_DROP_ID);
    return trash ? [trash] : closestCenter(args);
};
