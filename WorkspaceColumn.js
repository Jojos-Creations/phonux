import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The column component: every workspace of a `WorkspaceColumnHandle` in a cell of its own, one above the other, with the current
 * one in view. The person moves by ArrowUp/ArrowDown and by the buttons at the top and bottom centre, which name the neighbour
 * or offer to create one; the column itself never scrolls under a wheel or a trackpad. DESIGN.md, "The workspace column".
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputBase from '@mui/material/InputBase';
import { slideToTransition } from './directionalTransition.js';
import { resolveLabels } from './labels.js';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { columnCoreOf } from './columnHandle.js';
import { MAX_WORKSPACE_NAME } from './workspaceName.js';
/** The room above a workspace's row for the name of the workspace above and the name input, in px, below the column's `topInset`. @public */
export const COLUMN_TOP_BAND = 76;
/** The room below a workspace's row for the name of the workspace below, in px. @public */
export const COLUMN_BOTTOM_BAND = 26;
/** The height of a workspace name input and of the column's neighbour buttons, in px. @public */
export const WORKSPACE_NAME_CONTROL_HEIGHT = 24;
/** The attribute the workspace name input carries, so a stylesheet can select it without a class name. @public */
export const WORKSPACE_NAME_INPUT_ATTRIBUTE = 'data-workspace-name-input';
const TARGET = WORKSPACE_NAME_CONTROL_HEIGHT;
const DefaultCell = React.lazy(() => import('./autoMount.js').then((m) => ({ default: m.AutoRoot })));
function NameInput({ workspace, label, inset }) {
    const [draft, setDraft] = React.useState(null);
    const commit = () => {
        if (draft !== null)
            workspace.rename(draft);
        setDraft(null);
    };
    return (_jsx(InputBase, { value: draft ?? workspace.name, onChange: (e) => setDraft(e.target.value), onBlur: commit, onKeyDown: (e) => {
            if (e.key === 'Enter')
                e.currentTarget.blur();
            if (e.key === 'Escape') {
                setDraft(null);
                e.currentTarget.blur();
            }
        }, inputProps: { 'aria-label': label, maxLength: MAX_WORKSPACE_NAME, [WORKSPACE_NAME_INPUT_ATTRIBUTE]: '', style: { textAlign: 'center', padding: 0, height: TARGET } }, sx: { position: 'absolute', top: 24 + inset, left: '50%', transform: 'translateX(-50%)', width: 280, maxWidth: 'calc(100% - 32px)', height: TARGET, fontSize: 14, zIndex: 1 } }));
}
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
    React.useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')
                return;
            // A held key repeats: the column steps once per press, where the row keeps stepping while a key is held.
            if (e.repeat || arrowKeyBelongsElsewhere(e, document))
                return;
            if (column.step(e.key === 'ArrowUp' ? 'up' : 'down'))
                e.preventDefault();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [column]);
    // An inert cell drops the focus inside it; the arrow keys keep working only if focus lands somewhere in the column again.
    React.useLayoutEffect(() => {
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
    return (_jsxs(Box, { "data-workspace-column": "", sx: { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }, children: [_jsx("div", { style: { height: '100%', transform: `translateY(${-Math.max(snap.current, 0) * 100}%)`, transition: reduced || !placed ? 'none' : `transform ${move.duration}s cubic-bezier(${move.ease.join(',')})` }, children: snap.workspaces.map((ws, i) => {
                    const active = i === snap.current;
                    const above = snap.workspaces[i - 1];
                    const below = snap.workspaces[i + 1];
                    return (_jsxs(Box, { ref: (el) => {
                            if (el === null)
                                cells.current.delete(ws.id);
                            else
                                cells.current.set(ws.id, el);
                        }, "data-workspace-cell": "", "data-workspace-id": ws.id, "data-workspace-active": active ? '' : undefined, tabIndex: -1, "aria-hidden": active ? undefined : true, inert: !active, sx: { position: 'relative', height: '100%', outline: 'none' }, children: [_jsx(Button, { "data-workspace-neighbour": "above", size: "small", onClick: () => (above === undefined ? create(i) : column.scrollTo(above)), "aria-label": above === undefined ? labels.newWorkspace : labels.goToWorkspace(above.name), sx: { position: 'absolute', top: snap.topInset, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', height: TARGET, minHeight: 0, py: 0, zIndex: 1, textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }, children: above === undefined ? labels.newWorkspace : above.name }), _jsx(NameInput, { workspace: ws, label: labels.workspaceName, inset: snap.topInset }), children === undefined ? (_jsx(React.Suspense, { fallback: null, children: _jsx(DefaultCell, { workspace: ws, columnTop: COLUMN_TOP_BAND, themed: false }) })) : (children(ws)), _jsx(Button, { "data-workspace-neighbour": "below", size: "small", onClick: () => (below === undefined ? create(i + 1) : column.scrollTo(below)), "aria-label": below === undefined ? labels.newWorkspace : labels.goToWorkspace(below.name), sx: { position: 'absolute', bottom: COLUMN_BOTTOM_BAND - TARGET, left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100% - 32px)', height: TARGET, minHeight: 0, py: 0, zIndex: 1, textTransform: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }, children: below === undefined ? labels.newWorkspace : below.name })] }, ws.id));
                }) }), snap.workspaces.length === 0 ? (_jsx(Button, { "data-workspace-neighbour": "empty", size: "small", onClick: () => create(0), sx: { position: 'absolute', top: snap.topInset, left: '50%', transform: 'translateX(-50%)', height: TARGET, minHeight: 0, textTransform: 'none' }, children: labels.newWorkspace })) : null] }));
}
