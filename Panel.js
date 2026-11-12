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
import { CHROME_INSIDE_ATTRIBUTE, chromeInsideSx, useChromeScrollAway } from './panelChromeInside.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import { PanelHeaderRow } from './PanelFrame.js';
import { useOptionalHost } from './hostApi.js';
import { resolveIcons } from './icons.js';
import { usePhoneSize } from './phoneFit.js';
import { useFrameClaim } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { PANEL_ROOT_ATTRIBUTE } from './rowDom.js';
import { HEADER_ROW_ATTRIBUTE, PanelHeaderButtons, usePanelHeaderButtons } from './panelHeaderButtons.js';
import { PanelSizeControl, drawsSizeControl } from './panelSizeControl.js';
import { CaptureRegistryContext } from './snapshots.js';
import { useInsideSizeBox } from './PanelRowSlot.js';
import { GRAB_HANDLE_PX } from './rowConstants.js';
import { PanelTouchContext, usePanelTouch } from './panelTouch.js';
import { ACTIVE_ATTRIBUTE, CHROME_ATTRIBUTE, CHROME_PARTS, CHROME_SHOWN_ATTRIBUTE, DRAGGING_ATTRIBUTE, PanelChromeVisibleContext, useChromeFade, useChromeVisibility, usePanelActive, usePanelDragging } from './panelChrome.js';
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
    // Below a size box the panel fills it on both axes, so it glides with the box and its frame's 100% has a height to resolve against.
    const boxed = useInsideSizeBox();
    const declared = slot?.headerButtonSlots;
    const buttons = usePanelHeaderButtons();
    const drawn = headerButtons && declared !== undefined && title !== undefined && buttons.some((b) => !b.hidden);
    const untitled = headerButtons && declared !== undefined && title === undefined && buttons.some((b) => !b.hidden);
    const sized = sizeControl && title !== undefined && drawsSizeControl(slot);
    const active = usePanelActive();
    const touchProps = usePanelTouch(rootRef, React.useContext(PanelTouchContext));
    const dragging = usePanelDragging();
    const { visible, handlers } = useChromeVisibility();
    const inside = (slot?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome).where === 'inside';
    const onScrollCapture = useChromeScrollAway(rootRef, inside);
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
    const grabIcon = resolveIcons(useOptionalHost()?.icons).grab;
    const grabHandle = grabProps && title !== undefined ? _jsx(Box, { ...grabHandleProps, children: grabIcon }) : undefined;
    React.useEffect(() => {
        if (!untitled || warned.current || typeof process === 'undefined' || process.env.NODE_ENV === 'production')
            return;
        warned.current = true;
        console.warn('Panel: header buttons are declared but the panel has no title, so no header row is drawn and they are not shown.');
    }, [untitled]);
    // Hover is read from the DOM's pointer boundaries, not React's: React counts a menu portalled out of the panel as inside it, so a
    // pointer still on one as it closes would never leave the panel.
    React.useEffect(() => {
        const el = rootRef.current;
        if (el === null)
            return undefined;
        const { onPointerEnter, onPointerLeave } = handlers;
        el.addEventListener('pointerenter', onPointerEnter);
        el.addEventListener('pointerleave', onPointerLeave);
        return () => {
            el.removeEventListener('pointerenter', onPointerEnter);
            el.removeEventListener('pointerleave', onPointerLeave);
        };
    }, [handlers]);
    React.useEffect(() => {
        // No registry (a bare <HostProvider>, as in most tests) or opted out: registering is a no-op, never a throw.
        if (!registry || !viewId || capture === 'never' || !rootRef.current)
            return undefined;
        return registry.register(viewId, rootRef.current, 'viewport');
    }, [registry, viewId, capture]);
    return (_jsx(PanelChromeVisibleContext.Provider, { value: visible, children: _jsxs(Box, { sx: { position: 'relative', width: boxed ? '100%' : (size?.width ?? slot?.drawn?.width ?? phoneSize.width), height: boxed ? '100%' : undefined, ...(inside ? chromeInsideSx : {}), ...sx }, [PANEL_ROOT_ATTRIBUTE]: '', ...rest, ...(inside ? { [CHROME_INSIDE_ATTRIBUTE]: '' } : {}), onScrollCapture: (e) => {
                onScrollCapture(e);
                rest.onScrollCapture?.(e);
            }, ...(active ? { [ACTIVE_ATTRIBUTE]: '' } : {}), ...(visible || (slot?.tuning.chrome ?? LIBRARY_TUNING_DEFAULTS.chrome).mode === 'always' ? { [CHROME_SHOWN_ATTRIBUTE]: '' } : {}), ...touchProps, ...(dragging ? { [DRAGGING_ATTRIBUTE]: '' } : {}), onFocus: (e) => {
                handlers.onFocus(e);
                rest.onFocus?.(e);
            }, onBlur: (e) => {
                handlers.onBlur(e);
                rest.onBlur?.(e);
            }, ref: rootRef, children: [title !== undefined && (_jsx(PanelHeaderRow, { ref: fadeHeader, [CHROME_ATTRIBUTE]: CHROME_PARTS.header, title: title, actions: drawn || sized ? (_jsxs(_Fragment, { children: [sized ? _jsx(PanelSizeControl, {}) : null, actions, drawn ? _jsx(PanelHeaderButtons, { side: "end" }) : null] })) : actions, ...headerProps, ...(grabHandle ? { sx: { '& > [data-panel-grab-bar] + *': { mr: 'auto' }, ...headerProps?.sx } } : {}), ...(drawn ? { tabIndex: -1, role: 'toolbar', 'aria-orientation': 'horizontal', ...(typeof title === 'string' ? { 'aria-label': title } : {}), [HEADER_ROW_ATTRIBUTE]: declared.handle.id } : {}), leading: grabHandle || drawn ? (_jsxs(_Fragment, { children: [grabHandle, drawn ? _jsx(PanelHeaderButtons, { side: "start" }) : headerProps?.leading] })) : headerProps?.leading })), grabProps && title === undefined && (_jsx(Box, { ...grabHandleProps, ref: fadeGrab, sx: { ...grabHandleProps.sx, position: 'absolute', bottom: '100%', left: 0 }, children: grabIcon })), children, overlay] }) }));
}
export default Panel;
