import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title header above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { PanelHeaderRow } from './PanelFrame.js';
import { usePhoneSize } from './phoneFit.js';
import { useFrameClaim } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { PANEL_ROOT_ATTRIBUTE } from './rowDom.js';
import { HEADER_ROW_ATTRIBUTE, PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
import { PanelSizeControl, drawsSizeControl } from './panelSizeControl.js';
import { CaptureRegistryContext } from './snapshots.js';
import { useInsideSizeBox } from './PanelRowSlot.js';
import { GRAB_HANDLE_PX } from './rowConstants.js';
import { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, DRAGGING_ATTRIBUTE, PanelChromeVisibleContext, useChromeFade, useChromeVisibility, usePanelActive, usePanelDragging } from './panelChrome.js';
export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
export { DRAG_CLOSE, DragToClose } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z } from './windowOverlay.js';
/**
 * The shell every column in the row renders through: a relatively positioned box the width of the panel, with an
 * optional header above it, an optional grab handle and an optional overlay.
 * @public
 */
export function Panel({ title, actions, headerProps, headerButtons = true, sizeControl = true, grabProps, overlay, sx, children, viewId, capture = 'auto', size, ...rest }) {
    const phoneSize = usePhoneSize();
    useFrameClaim('panel');
    const registry = React.useContext(CaptureRegistryContext);
    const rootRef = React.useRef(null);
    const slot = React.useContext(PanelSlotContext);
    // Below a size box the panel fills it on both axes, so it eases with the box and its frame's 100% has a height to resolve against.
    const boxed = useInsideSizeBox();
    const declared = slot?.headerButtonSlots;
    const buttons = usePanelHeaderButtons();
    const drawn = headerButtons && declared !== undefined && title !== undefined && buttons.some((b) => !b.hidden);
    const untitled = headerButtons && declared !== undefined && title === undefined && buttons.some((b) => !b.hidden);
    const sized = sizeControl && title !== undefined && drawsSizeControl(slot);
    const active = usePanelActive();
    const dragging = usePanelDragging();
    const { visible, handlers } = useChromeVisibility();
    const fadeHeader = useChromeFade(visible);
    const fadeGrab = useChromeFade(visible);
    const warned = React.useRef(false);
    // One element, either way: inside the header it fades with the header, so only the header-less one fades itself.
    const grabHandleProps = {
        'data-panel-grab-bar': '',
        [CHROME_ATTRIBUTE]: CHROME_PARTS.grabBar,
        ...grabProps,
        sx: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            width: `${GRAB_HANDLE_PX}px`,
            height: `${GRAB_HANDLE_PX}px`,
            ...grabProps?.sx,
        },
    };
    const grabIcon = _jsx(DragIndicatorIcon, { "aria-hidden": "true", fontSize: "small" });
    const grabHandle = grabProps && title !== undefined ? _jsx(Box, { ...grabHandleProps, children: grabIcon }) : undefined;
    React.useEffect(() => {
        if (!untitled || warned.current || typeof process === 'undefined' || process.env.NODE_ENV === 'production')
            return;
        warned.current = true;
        console.warn('Panel: header buttons are declared but the panel has no title, so no header row is drawn and they are not shown.');
    }, [untitled]);
    React.useEffect(() => {
        // No registry (a bare <HostProvider>, as in most tests) or opted out: registering is a no-op, never a throw.
        if (!registry || !viewId || capture === 'never' || !rootRef.current)
            return undefined;
        return registry.register(viewId, rootRef.current, 'viewport');
    }, [registry, viewId, capture]);
    return (_jsx(PanelChromeVisibleContext.Provider, { value: visible, children: _jsxs(Box, { sx: { position: 'relative', width: boxed ? '100%' : (size?.width ?? slot?.drawn?.width ?? phoneSize.width), height: boxed ? '100%' : undefined, ...sx }, [PANEL_ROOT_ATTRIBUTE]: '', ...rest, ...(active ? { [ACTIVE_ATTRIBUTE]: '' } : {}), ...(dragging ? { [DRAGGING_ATTRIBUTE]: '' } : {}), onPointerEnter: (e) => {
                handlers.onPointerEnter(e);
                rest.onPointerEnter?.(e);
            }, onPointerLeave: (e) => {
                handlers.onPointerLeave(e);
                rest.onPointerLeave?.(e);
            }, onFocus: (e) => {
                handlers.onFocus(e);
                rest.onFocus?.(e);
            }, onBlur: (e) => {
                handlers.onBlur(e);
                rest.onBlur?.(e);
            }, ref: rootRef, children: [title !== undefined && (_jsx(PanelHeaderRow, { ref: fadeHeader, [CHROME_ATTRIBUTE]: CHROME_PARTS.header, title: title, actions: drawn || sized ? (_jsxs(_Fragment, { children: [sized ? _jsx(PanelSizeControl, {}) : null, actions, drawn ? _jsx(PanelHeaderButtons, { side: "end" }) : null] })) : actions, ...headerProps, ...(grabHandle ? { sx: { '& > [data-panel-grab-bar] + *': { mr: 'auto' }, ...headerProps?.sx } } : {}), ...(drawn ? { tabIndex: -1, role: 'toolbar', 'aria-orientation': 'horizontal', ...(typeof title === 'string' ? { 'aria-label': title } : {}), [HEADER_ROW_ATTRIBUTE]: declared.handle.id } : {}), leading: grabHandle || drawn ? (_jsxs(_Fragment, { children: [grabHandle, drawn ? _jsx(PanelHeaderButtons, { side: "start" }) : headerProps?.leading] })) : headerProps?.leading })), grabProps && title === undefined && (_jsx(Box, { ...grabHandleProps, ref: fadeGrab, sx: { ...grabHandleProps.sx, position: 'absolute', bottom: '100%', left: 0 }, children: grabIcon })), children, overlay] }) }));
}
export default Panel;
