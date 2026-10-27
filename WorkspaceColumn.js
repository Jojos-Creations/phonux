import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The column component: every workspace of a `WorkspaceColumnHandle` in a cell of its own, one above the other, with the current
 * one in view. The person moves by the buttons at the top and bottom centre, which name the neighbour or offer to create one, and
 * by whatever key the app binds to `step`; the column itself never scrolls under a wheel or a trackpad. DESIGN.md, "The workspace column".
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { slideToTransition } from './directionalTransition.js';
import { resolveLabels } from './labels.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { columnCoreOf } from './columnHandle.js';
import { Band, columnBandRoom, DEFAULT_COLUMN_BANDS, WORKSPACE_NAME_CONTROL_HEIGHT } from './columnBands.js';
/** The room above a workspace's row that the default bands keep, in px, below the column's `topInset`. With bands of its own, `columnBandRoom(bands).above`. @public */
export const COLUMN_TOP_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).above;
/** The room below a workspace's row that the default bands keep, in px. With bands of its own, `columnBandRoom(bands).below`. @public */
export const COLUMN_BOTTOM_BAND = columnBandRoom(DEFAULT_COLUMN_BANDS).below;
const TARGET = WORKSPACE_NAME_CONTROL_HEIGHT;
const DefaultCell = React.lazy(() => import('./autoMount.js').then((m) => ({ default: m.AutoRoot })));
// The column's own controls sit inside the device's safe areas, as the row does; env() is 0 unless the page sets viewport-fit=cover.
const belowSafeTop = (px) => `calc(${px}px + env(safe-area-inset-top, 0px))`;
/** The cell's own row, or undefined when the function is absent or returns undefined: the library's row is drawn then. */
const drawn = (children, ws) => (children === undefined ? undefined : children(ws));
/**
 * Draws a column: one cell per workspace, the current one in view, the others inert and hidden from assistive technology but
 * still mounted, so their panels keep their state. Moving to another workspace moves focus into its cell when focus was in the one left.
 * @public
 */
export function WorkspaceColumn({ column, children }) {
    const core = columnCoreOf(column);
    const snap = React.useSyncExternalStore(core.subscribe, core.snapshot, core.snapshot);
    // The system preference too, because an app's MotionConfig may not carry it.
    const systemReduced = useReducedMotion() === true;
    const reduced = useReducedMotionConfig() === true || systemReduced;
    const move = React.useMemo(() => slideToTransition(resolveWorkspaceTuning(snap.tuning).slide), [snap.tuning]);
    const labels = React.useMemo(() => resolveLabels(snap.labels), [snap.labels]);
    const bands = core.bands ?? DEFAULT_COLUMN_BANDS;
    const room = React.useMemo(() => columnBandRoom(bands), [bands]);
    const cells = React.useRef(new Map());
    const left = React.useRef(snap.current);
    // The saved workspace is selected only once the column has read it, so the move onto it is a placement, not a slide: the slide
    // comes on with the first move away from where the column was when it became ready.
    const placedAt = React.useRef(null);
    const moved = React.useRef(false);
    if (snap.status === 'ready' && placedAt.current === null)
        placedAt.current = snap.current;
    if (placedAt.current !== null && snap.current !== placedAt.current)
        moved.current = true;
    const placed = moved.current;
    // A workspace added or removed above the current one shifts its index without changing what is shown: the track jumps there.
    const currentId = snap.workspaces[snap.current]?.id;
    const shownId = React.useRef(currentId);
    const reseated = shownId.current === currentId && left.current !== snap.current;
    // An inert cell drops the focus inside it; the arrow keys keep working only if focus lands somewhere in the column again.
    React.useLayoutEffect(() => {
        shownId.current = currentId;
        const was = snap.workspaces[left.current];
        left.current = snap.current;
        const now = snap.workspaces[snap.current];
        if (was === undefined || now === undefined || was === now)
            return;
        const from = cells.current.get(was.id);
        const to = cells.current.get(now.id);
        if (from !== undefined && to !== undefined && from.contains(document.activeElement))
            to.focus({ preventScroll: true });
    }, [snap.current, snap.workspaces]);
    const create = (index) => {
        column.scrollTo(column.addWorkspace({ index }));
    };
    return (_jsxs(Box, { "data-workspace-column": "", sx: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }, children: [_jsx("div", { style: { height: '100%', transform: `translateY(${-Math.max(snap.current, 0) * 100}%)`, transition: reduced || !placed || reseated ? 'none' : `transform ${move.duration}s cubic-bezier(${move.ease.join(',')})` }, children: snap.workspaces.map((ws, i) => {
                    const active = i === snap.current;
                    const above = snap.workspaces[i - 1];
                    const below = snap.workspaces[i + 1];
                    const own = drawn(children, ws);
                    const slotProps = { workspace: ws, column, index: i, above, below, active, labels };
                    return (_jsxs(Box, { ref: (el) => {
                            if (el === null)
                                cells.current.delete(ws.id);
                            else
                                cells.current.set(ws.id, el);
                        }, "data-workspace-cell": "", "data-workspace-id": ws.id, "data-workspace-active": active ? '' : undefined, tabIndex: -1, "aria-hidden": active ? undefined : true, inert: !active, sx: { position: 'relative', height: '100%', outline: 'none' }, children: [_jsx(Band, { side: "above", band: bands.above, inset: snap.topInset, props: slotProps }), own === undefined ? (_jsx(React.Suspense, { fallback: null, children: _jsx(DefaultCell, { workspace: ws, columnTop: room.above, columnBottom: room.below - COLUMN_BOTTOM_BAND, themed: false }) })) : (own), _jsx(Band, { side: "below", band: bands.below, inset: snap.topInset, props: slotProps })] }, ws.id));
                }) }), snap.workspaces.length === 0 ? (_jsx(Button, { "data-workspace-neighbour": "empty", size: "small", onClick: () => create(0), sx: { position: 'absolute', top: belowSafeTop(snap.topInset), left: '50%', transform: 'translateX(-50%)', height: TARGET, minHeight: 0, textTransform: 'none' }, children: labels.newWorkspace })) : null] }));
}
