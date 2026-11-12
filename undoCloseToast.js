import { jsx as _jsx } from "react/jsx-runtime";
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { UNDO_CLOSE_TOAST_ATTRIBUTE } from './rowDom.js';
import { OVERLAY_Z } from './windowOverlay.js';
/** The workspace's notice for the panels the person closed in the undo window, with its Undo. @internal */
export function UndoCloseToast({ closed, onUndo }) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    return (_jsx(Snackbar, { [UNDO_CLOSE_TOAST_ATTRIBUTE]: '', open: closed !== null, message: closed === null ? '' : labels.undoCloseMessage(closed.map((p) => p.title || labels.untitledHeader)), action: _jsx(Button, { color: "inherit", size: "small", onClick: onUndo, children: labels.undo }), anchorOrigin: { vertical: 'bottom', horizontal: 'center' }, sx: { zIndex: OVERLAY_Z.toast } }));
}
