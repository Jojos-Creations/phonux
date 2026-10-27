import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The built-in controls of a panel's header: a move menu whose one entry pins or unpins the panel, and an X that closes
 * it. Each control is drawn only when the panel allows its gesture, and nothing is drawn in the panel's body. The grab
 * handle is not drawn here: `Panel` draws it from `grabProps`, so a second one would appear beside it.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import CloseIcon from '@mui/icons-material/Close';
import ControlCameraIcon from '@mui/icons-material/ControlCamera';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { usePanelCapabilities, usePanelPinned } from './PanelRow.js';
import { usePanelDragProps } from './panelChrome.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { focusMoveWhenBack, quietly } from './quietMove.js';
const INHERIT = { color: 'inherit' };
const isGroup = (entry) => 'actions' in entry;
const NO_ENTRIES = [];
/**
 * The header controls of the panel the call is made in, meant for the header slot (the `actions` of `Panel`, or of
 * `PanelHeaderRow`). It draws nothing outside a panel row.
 *
 * The move menu shows when the panel is movable or pinned and holds one entry, Pin or Unpin, which reads the panel's pinned
 * state; the X shows when the panel is closable. The pin never scrolls the row, and focus returns to the move button without
 * the row reading it as a choice. A refused pin or unpin is announced through the workspace's live region.
 * @public
 */
export function PanelHeaderMenu({ onPinChange, entries = NO_ENTRIES, triggerIcon } = {}) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const announce = React.useContext(AnnounceContext);
    const { onClose } = usePanelDragProps();
    const { movable } = usePanelCapabilities();
    const pinned = usePanelPinned();
    const handle = React.useContext(PanelSlotContext)?.handle;
    const [anchor, setAnchor] = React.useState(null);
    const moveRef = React.useRef(null);
    const [returnFocus, setReturnFocus] = React.useState(false);
    // Focus goes back in the layout effect of the render that closes the menu: its focus trap is off by then, and the row is quiet.
    React.useLayoutEffect(() => {
        if (!returnFocus)
            return;
        setReturnFocus(false);
        quietly(() => moveRef.current?.focus({ preventScroll: true }));
    }, [returnFocus]);
    // A pinned panel reads as not movable, and its Unpin entry must stay reachable.
    const showMove = movable || pinned || entries.length > 0;
    if (handle === undefined || (onClose === undefined && !showMove))
        return null;
    const closeMenu = () => {
        setAnchor(null);
        setReturnFocus(true);
    };
    const togglePin = () => {
        closeMenu();
        const verb = pinned ? 'unpin' : 'pin';
        const rowId = moveRef.current?.closest('[data-row-id]')?.dataset.rowId;
        const result = quietly(() => handle[verb]('person'));
        // A pin can drop the header slot for a render, so the move button is found again over the next frames.
        if (rowId !== undefined)
            focusMoveWhenBack(rowId);
        if (!result.ok)
            announce?.(pinned ? labels.unpinFailed : labels.pinFailed);
        onPinChange?.(verb, result.ok);
    };
    return (_jsxs(Box, { "data-panel-header-menu": "", sx: { display: 'flex', alignItems: 'center', gap: 0.25 }, children: [showMove ? (_jsxs(_Fragment, { children: [_jsx(IconButton, { ref: moveRef, size: "small", "aria-label": labels.move, "aria-haspopup": "menu", "aria-expanded": anchor !== null, "data-panel-move": "", onClick: (event) => setAnchor(event.currentTarget), sx: INHERIT, children: triggerIcon ?? _jsx(ControlCameraIcon, { fontSize: "small" }) }), _jsxs(Menu, { open: anchor !== null, anchorEl: anchor, onClose: closeMenu, disableRestoreFocus: true, children: [movable || pinned ? (_jsxs(MenuItem, { "data-panel-pin-toggle": "", onClick: togglePin, children: [_jsx(ListItemIcon, { children: pinned ? _jsx(PushPinIcon, { fontSize: "small" }) : _jsx(PushPinOutlinedIcon, { fontSize: "small" }) }), pinned ? labels.unpin : labels.pin] })) : null, entries.map((entry) => isGroup(entry) ? (_jsxs(Box, { "data-panel-menu-group": entry.id, role: "group", "aria-label": entry.title, sx: { px: 2, py: 1 }, children: [_jsx(Typography, { variant: "caption", component: "div", sx: { mb: 0.5 }, children: entry.title }), _jsx(Box, { sx: { display: 'flex', gap: 0.25 }, children: entry.actions.map((action) => (_jsx(Tooltip, { title: action.shortcut === undefined ? action.label : `${action.label} (${action.shortcut})`, children: _jsx(IconButton, { size: "small", "aria-label": action.label, "data-panel-menu-entry": action.id, onClick: () => {
                                                    closeMenu();
                                                    action.onSelect();
                                                }, children: action.icon }) }, action.id))) })] }, entry.id)) : (_jsxs(MenuItem, { "data-panel-menu-entry": entry.id, onClick: () => {
                                    closeMenu();
                                    entry.onSelect();
                                }, children: [entry.icon === undefined ? null : _jsx(ListItemIcon, { children: entry.icon }), entry.label] }, entry.id)))] })] })) : null, onClose !== undefined ? (_jsx(IconButton, { size: "small", "aria-label": labels.close, "data-panel-close": "", onClick: onClose, sx: INHERIT, children: _jsx(CloseIcon, { fontSize: "small" }) })) : null] }));
}
