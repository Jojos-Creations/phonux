import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title pill above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import { PANEL_HEADER_GAP_PX, PanelHeaderRow } from './PanelFrame.js';
import { useHost } from './hostApi.js';
import { CaptureRegistryContext } from './snapshots.js';
// One import path for a view author: the contracts, the provider and the hook.
export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
/** @deprecated use HostMissingProviderError, HostProvider, useHost */
export { PhoneAPIsMissingProviderError, PhoneAPIsProvider, usePhoneAPIs } from './hostApi.js';
export { DRAG_CLOSE, DragToClose, shouldCloseOnRelease } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z, OverlayProvider, OverlayStore } from './windowOverlay.js';
/** @public */
export function Panel({ title, actions, headerProps, grabProps, overlay, sx, children, viewId, capture = 'auto', size, ...rest }) {
    const { device } = useHost();
    const registry = React.useContext(CaptureRegistryContext);
    const rootRef = React.useRef(null);
    React.useEffect(() => {
        // No registry (a bare <HostProvider>, as in most tests) or opted out: registering is a no-op, never a throw.
        if (!registry || !viewId || capture === 'never' || !rootRef.current)
            return undefined;
        return registry.register(viewId, rootRef.current, 'viewport');
    }, [registry, viewId, capture]);
    return (_jsxs(Box, { sx: { position: 'relative', width: size?.width ?? device.size.width, ...sx }, ...rest, ref: rootRef, children: [title !== undefined && _jsx(PanelHeaderRow, { title: title, actions: actions, ...headerProps }), grabProps && (_jsx(Box, { "data-panel-grab-bar": "", ...grabProps, sx: {
                    position: 'absolute',
                    bottom: '100%',
                    left: 0,
                    right: 0,
                    height: `${PANEL_HEADER_GAP_PX}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    ...grabProps.sx,
                }, children: _jsx(Box, { "aria-hidden": "true", sx: { width: 32, height: 4, borderRadius: 2, bgcolor: 'divider' } }) })), children, overlay] }));
}
/** @public @deprecated use Panel */
export const PhoneView = Panel;
export default Panel;
