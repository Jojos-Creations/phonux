import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The one width control every resizable panel shows: a header button whose icon is the panel's own width, opening a menu of
 * the widths that fit the window and Fullscreen. Picking a width goes through the panel's `setSlots`, so it runs the same size
 * glide as any other resize.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { createSvgIcon } from '@mui/material/utils';
import DesktopWindowsOutlinedIcon from '@mui/icons-material/DesktopWindowsOutlined';
import FullscreenOutlinedIcon from '@mui/icons-material/FullscreenOutlined';
import SmartphoneOutlinedIcon from '@mui/icons-material/SmartphoneOutlined';
import TabletOutlinedIcon from '@mui/icons-material/TabletOutlined';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { usePanelMaximize } from './panelMaximize.js';
import { PanelSlotContext } from './panelSlotContext.js';
/** Material has no ultrawide monitor: this is its outlined desktop monitor with the screen drawn wide and short. */
const UltrawideIcon = createSvgIcon(_jsx("path", { d: "M21 5H3c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 9H3V7h18v7z" }), 'Ultrawide');
/** Material has no foldable phone: two outlined phones side by side, the fold drawn as the gap between them. */
const FoldIcon = createSvgIcon(_jsx("path", { d: "M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v12h6V6h-6z" }), 'Fold');
/** One icon per width, by slots. The outlined set throughout: the filled desktop monitor is solid beside the hollow phone and tablet. */
const SIZE_ICONS = [SmartphoneOutlinedIcon, FoldIcon, TabletOutlinedIcon, DesktopWindowsOutlinedIcon, UltrawideIcon];
const SIZE_KEYS = ['phone', 'fold', 'tablet', 'desktop', 'ultrawide'];
const ICON = { color: 'inherit' };
const ENTRY = { color: 'text.primary' };
/** Whether the control draws anything in this slot, so `Panel` leaves its header's placeholder alone when it does not. */
export const drawsSizeControl = (slot) => slot?.handle !== undefined && slot.summary !== undefined && slot.resizable && slot.maxSlots >= 2;
/**
 * The width control of the panel the call is made in, for its header. It draws nothing outside a row, nor for a panel that is
 * not resizable or may take fewer than two slots. The menu offers the widths up to five phones that `maxSlots` allows and the
 * window fits, with the panel's own width pressed, then Fullscreen. Focus goes back to the button once a width is picked.
 * @public
 */
export function PanelSizeControl({ topInset, fullscreenShortcut, fullscreenKeys, onRefused } = {}) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const announce = React.useContext(AnnounceContext);
    const slot = React.useContext(PanelSlotContext);
    const button = React.useRef(null);
    const [anchor, setAnchor] = React.useState(null);
    const refused = (what) => {
        if (onRefused !== undefined)
            onRefused(what);
        else
            announce?.(what === 'resize' ? labels.couldNotResize : labels.couldNotFullscreen);
    };
    const maximize = usePanelMaximize(button, { ...(topInset !== undefined ? { topInset } : {}), onRefused: () => refused('fullscreen') });
    const handle = slot?.handle;
    const summary = slot?.summary;
    if (!drawsSizeControl(slot) || handle === undefined || summary === undefined)
        return null;
    const maxSlots = slot?.maxSlots ?? 1;
    const limit = Math.min(SIZE_ICONS.length, maxSlots, summary.fitSlots ?? maxSlots);
    const own = summary.savedSlots ?? summary.slots ?? 1;
    const iconOf = (slots) => {
        const Icon = SIZE_ICONS[slots - 1] ?? DesktopWindowsOutlinedIcon;
        return _jsx(Icon, { fontSize: "small" });
    };
    const close = () => {
        setAnchor(null);
        button.current?.focus({ preventScroll: true });
    };
    const fullscreenLabel = fullscreenShortcut === undefined ? labels.fullscreen : `${labels.fullscreen} (${fullscreenShortcut})`;
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { title: labels.viewSize, children: _jsx(IconButton, { ref: button, size: "small", "aria-label": labels.viewSize, "aria-haspopup": "menu", "aria-expanded": anchor !== null, "data-panel-size-button": "", 
                    // A press must not move focus first: the row reads a focus change inside a panel as the person choosing it.
                    onMouseDown: (event) => event.preventDefault(), onClick: (event) => setAnchor(event.currentTarget), sx: ICON, children: maximize.maximized || own > SIZE_ICONS.length ? _jsx(FullscreenOutlinedIcon, { fontSize: "small" }) : iconOf(own) }) }), _jsx(Menu, { anchorEl: anchor, open: anchor !== null, onClose: () => setAnchor(null), disableRestoreFocus: true, children: _jsxs(Box, { role: "group", "aria-label": labels.viewSize, "data-panel-size-group": "", sx: { px: 2, pt: 1, pb: 0.5 }, children: [_jsx(Typography, { variant: "caption", component: "div", color: "text.secondary", children: labels.viewSize }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [Array.from({ length: limit }, (_, i) => i + 1).map((slots) => (_jsx(Tooltip, { title: labels.sizeName(slots), children: _jsx(IconButton, { size: "small", "data-view-size": SIZE_KEYS[slots - 1], "aria-label": labels.sizeName(slots), "aria-pressed": (summary.slots ?? 1) === slots, onClick: () => {
                                            close();
                                            if (!handle.setSlots(slots, 'person').ok)
                                                refused('resize');
                                        }, sx: ENTRY, children: iconOf(slots) }) }, slots))), _jsx(Tooltip, { title: fullscreenLabel, children: _jsx(IconButton, { size: "small", "data-view-fullscreen": "", "aria-label": labels.fullscreen, ...(fullscreenKeys !== undefined ? { 'aria-keyshortcuts': fullscreenKeys } : {}), "aria-pressed": maximize.maximized, onClick: () => {
                                            close();
                                            maximize.toggle();
                                        }, sx: ENTRY, children: _jsx(FullscreenOutlinedIcon, { fontSize: "small" }) }) })] })] }) })] }));
}
