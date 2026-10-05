/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title pill above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */
import * as React from 'react';
import { type BoxProps } from '@mui/material/Box';
import { type PanelHeaderRowProps } from './PanelFrame.js';
import { type PanelSize } from './hostApi.js';
import { type ViewId } from './snapshots.js';
export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
export type { Host } from './hostApi.js';
/** @deprecated use HostMissingProviderError, HostProvider, useHost */
export { PhoneAPIsMissingProviderError, PhoneAPIsProvider, usePhoneAPIs } from './hostApi.js';
/** @deprecated use Host */
export type { PhoneAPIs } from './hostApi.js';
export { DRAG_CLOSE, DragToClose, shouldCloseOnRelease, type DragHandleProps, type ReleaseMeasure, type ReorderHandle } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z, OverlayProvider, OverlayStore, type OverlaySlotName, type WindowOverlayProps, type Item, type Entry } from './windowOverlay.js';
/** @public */
export interface PanelProps extends Omit<BoxProps, 'children' | 'sx' | 'title'> {
    /**
     * The header pill's title. Omitted entirely (not passed at all) renders
     * NO header row, rather than forcing the view into
     * PanelHeaderRow's own "Untitled" placeholder. Pass an
     * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
     */
    title?: React.ReactNode;
    actions?: React.ReactNode;
    /**
     * Extra PanelHeaderRow props beyond title/actions -- the drag handle
     * of a DragToClose view (`onPointerDown`, `sx`), `data-*` attributes, etc. The `data-${string}` index signature is
     * needed because TS's "data-* is always valid" leniency only applies to
     * attributes written directly on a JSX element -- it does not extend to a
     * plain object literal like this one being checked against
     * PanelHeaderRowProps before it ever reaches JSX.
     */
    headerProps?: Omit<PanelHeaderRowProps, 'title' | 'actions'> & {
        [key: `data-${string}`]: string | boolean | undefined;
    };
    /**
     * The grab handle for dragging this Panel (DragToClose's `onPointerDown`/`sx`), rendered as its OWN
     * element filling the gap between the header and the frame -- never spread onto `headerProps` -- so a
     * click on the title text or an action icon in the header is never mistaken for a drag start. Omitted
     * (the usual case for a locked view, e.g. History) renders no grab bar at all.
     */
    grabProps?: Omit<BoxProps, 'children'> & {
        [key: `data-${string}`]: string | boolean | undefined;
    };
    /**
     * Content positioned absolutely over this view (History's own "+" Fab,
     * bottom-right) -- rendered as a plain sibling of `children` inside this
     * component's own `position: relative` box, which is already the
     * positioning context an `overlay` needs.
     */
    overlay?: React.ReactNode;
    sx?: BoxProps['sx'];
    children: React.ReactNode;
    /**
     * Registers this Panel's own root element with the desktop's capture registry (see snapshots.ts's
     * CaptureRegistryContext) so the host can later ask for a picture of it by id. Omitted: never registered.
     */
    viewId?: ViewId;
    /** 'never' opts a Panel with a viewId out of registration entirely -- default 'auto'. */
    capture?: 'auto' | 'never';
    /** This panel's own size instead of the shared useHost().device.size. Omitted: the width comes from device.size, read live -- see DESIGN.md. */
    size?: PanelSize;
}
/** @public @deprecated use PanelProps */
export type PhoneViewProps = PanelProps;
/** @public */
export declare function Panel({ title, actions, headerProps, grabProps, overlay, sx, children, viewId, capture, size, ...rest }: PanelProps): React.JSX.Element;
/** @public @deprecated use Panel */
export declare const PhoneView: typeof Panel;
export default Panel;
