import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The one width control every resizable panel shows: a header button whose icon is the panel's own width, opening a menu of
 * the widths that fit the window and Fullscreen. Picking a width goes through the panel's `setSlots`, so it runs the same size
 * glide as any other resize.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { AnnounceContext } from './announce.js';
import { PHONE_FRAME_ATTRIBUTE } from './PanelFrame.js';
import { useOptionalHost } from './hostApi.js';
import { resolveIcons } from './icons.js';
import { resolveLabels } from './labels.js';
import { usePanelMaximize } from './panelMaximize.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { panelRootOf } from './rowDom.js';
/** The menu's inset from the panel's sides, in px. */
const MENU_INSET_PX = 8;
/** A bar across the top of the panel's frame, a pill inset the same from its top and sides, so the menu never covers the next panel. */
function insidePanel(button) {
    const root = button ? panelRootOf(button) : null;
    const frame = root?.querySelector(`[${PHONE_FRAME_ATTRIBUTE}]`) ?? root;
    const panel = frame?.getBoundingClientRect();
    return {
        top: panel ? panel.top + MENU_INSET_PX : (button?.getBoundingClientRect().bottom ?? 0),
        left: (panel?.left ?? 0) + MENU_INSET_PX,
        width: panel ? panel.width - 2 * MENU_INSET_PX : undefined,
    };
}
const SIZE_KEYS = ['phone', 'fold', 'tablet', 'desktop', 'ultrawide'];
const ICON = { color: 'inherit' };
const STOP_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
/** Arrow keys, Home and End step focus along all of the group's buttons without wrapping, the current size included. */
function stepFocus(event) {
    if (!STOP_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
    const stops = [...event.currentTarget.querySelectorAll('button')];
    const at = stops.indexOf(event.target);
    if (at < 0)
        return;
    event.preventDefault();
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : at + (event.key === 'ArrowRight' ? 1 : -1);
    stops[Math.min(Math.max(to, 0), stops.length - 1)]?.focus({ preventScroll: true });
}
// The current size keeps focus, so a screen reader can say which size it is, but takes no press: it is marked aria-disabled, not
// disabled, and drawn highlighted the same whether hovered or not.
const ENTRY = {
    color: 'text.primary',
    '&[aria-disabled="true"], &[aria-disabled="true"]:hover': { color: 'primary.contrastText', bgcolor: 'primary.main', cursor: 'default' },
};
/** The props that mark an entry as the size the panel has now: reachable and read as current, but not pressable. */
const currentProps = (current) => current ? { 'aria-pressed': true, 'aria-current': true, 'aria-disabled': true, disableTouchRipple: true } : { 'aria-pressed': false };
/** Whether the control draws anything in this slot, so `Panel` leaves its header's placeholder alone when it does not. */
export const drawsSizeControl = (slot) => slot?.handle !== undefined && slot.summary !== undefined && slot.resizable && slot.maxSlots >= 2;
/**
 * The width control of the panel the call is made in, for its header. It draws nothing outside a row, nor for a panel that is
 * not resizable or may take fewer than two slots. The menu offers the widths up to five phones that `maxSlots` allows and the
 * window fits, with the panel's current size highlighted, then Fullscreen. The current size (Fullscreen while the panel is fullscreen)
 * takes focus and reads as pressed, current and unavailable, and picking it does nothing. Focus lands on the first width that is not the current size when it opens, the arrow keys, Home and End move along every entry, and focus goes back to the button when Escape closes it or a width is picked.
 * @public
 */
export function PanelSizeControl({ topInset, fullscreenShortcut, fullscreenKeys, onRefused } = {}) {
    const host = useOptionalHost();
    const labels = resolveLabels(host?.labels);
    const icons = resolveIcons(host?.icons);
    const announce = React.useContext(AnnounceContext);
    const slot = React.useContext(PanelSlotContext);
    const button = React.useRef(null);
    const [anchor, setAnchor] = React.useState(null);
    const place = insidePanel(anchor);
    const refused = (what) => {
        if (onRefused !== undefined)
            onRefused(what);
        else
            announce?.(what === 'resize' ? labels.couldNotResize : labels.couldNotFullscreen);
    };
    const maximize = usePanelMaximize(button, { ...(topInset !== undefined ? { topInset } : {}), onRefused: () => refused('fullscreen') });
    const handle = slot?.handle;
    const summary = slot?.summary;
    // Focus goes back to the button only once the menu has closed: while open, its focus trap pulls focus back into the menu, which then
    // unmounts holding it with no blur React can see, and the panel would read itself as focused, its chrome shown, from then on.
    const refocus = React.useRef(false);
    React.useEffect(() => {
        if (anchor !== null || !refocus.current)
            return;
        refocus.current = false;
        button.current?.focus({ preventScroll: true });
    }, [anchor]);
    if (!drawsSizeControl(slot) || handle === undefined || summary === undefined)
        return null;
    const maxSlots = slot?.maxSlots ?? 1;
    const limit = Math.min(SIZE_KEYS.length, maxSlots, summary.fitSlots ?? maxSlots);
    const own = summary.savedSlots ?? summary.slots ?? 1;
    const isCurrent = (slots) => !maximize.maximized && (summary.slots ?? 1) === slots;
    const widths = Array.from({ length: limit }, (_, i) => i + 1);
    // Focus opens on the first width that is not the current size, and with no other width on Fullscreen.
    const firstWidth = widths.find((slots) => !isCurrent(slots));
    const close = () => {
        refocus.current = true;
        setAnchor(null);
    };
    const fullscreenLabel = fullscreenShortcut === undefined ? labels.fullscreen : `${labels.fullscreen} (${fullscreenShortcut})`;
    return (_jsxs(_Fragment, { children: [_jsx(Tooltip, { title: labels.viewSize, children: _jsx(IconButton, { ref: button, size: "small", "aria-label": labels.viewSize, "aria-haspopup": "dialog", "aria-expanded": anchor !== null, "data-panel-size-button": "", 
                    // A press must not move focus first: the row reads a focus change inside a panel as the person choosing it.
                    onMouseDown: (event) => event.preventDefault(), onClick: (event) => setAnchor(event.currentTarget), sx: ICON, children: maximize.maximized || own > SIZE_KEYS.length ? icons.fullscreen : icons.size(own) }) }), _jsx(Popover, { anchorEl: anchor, open: anchor !== null, onClose: (_event, reason) => (reason === 'escapeKeyDown' ? close() : setAnchor(null)), disableRestoreFocus: true, anchorReference: "anchorPosition", anchorPosition: { top: place.top, left: place.left }, marginThreshold: 0, slotProps: { paper: { role: 'dialog', 'aria-label': labels.viewSize, sx: { width: place.width, maxWidth: place.width, maxHeight: 'calc(100% - 96px)', borderRadius: 999 } } }, children: _jsxs(Box, { role: "group", "aria-label": labels.viewSize, "data-panel-size-group": "", onKeyDown: stepFocus, sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, px: 2, py: 1 }, children: [_jsx(Typography, { variant: "caption", component: "div", color: "textSecondary", sx: { whiteSpace: 'nowrap' }, children: labels.viewSize }), _jsxs(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.5 }, children: [widths.map((slots) => {
                                    const current = isCurrent(slots);
                                    return (_jsx(Tooltip, { title: labels.sizeName(slots), children: _jsx(IconButton, { size: "small", "data-view-size": SIZE_KEYS[slots - 1], autoFocus: slots === firstWidth, "aria-label": labels.sizeName(slots), ...currentProps(current), onClick: () => {
                                                // The size the panel has already: a press, Enter or Space changes nothing and leaves the menu open.
                                                if (current)
                                                    return;
                                                close();
                                                if (maximize.maximized)
                                                    maximize.toggle();
                                                if (!handle.setSlots(slots, 'person').ok)
                                                    refused('resize');
                                            }, sx: ENTRY, children: icons.size(slots) }) }, slots));
                                }), _jsx(Tooltip, { title: fullscreenLabel, children: _jsx(IconButton, { size: "small", "data-view-fullscreen": "", autoFocus: firstWidth === undefined, "aria-label": fullscreenLabel, ...(fullscreenKeys !== undefined ? { 'aria-keyshortcuts': fullscreenKeys } : {}), ...currentProps(maximize.maximized), onClick: () => {
                                            if (maximize.maximized)
                                                return;
                                            close();
                                            maximize.toggle();
                                        }, sx: ENTRY, children: icons.fullscreen }) })] })] }) })] }));
}
