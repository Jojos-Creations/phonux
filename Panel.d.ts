/**
 * The shared shell every column in the row renders through -- Settings, History and each live
 * panel build their own content, then hand it to Panel for the `position: relative` +
 * `width: phoneWidth` wrapper box and PanelHeaderRow's floating title header above it. Deliberately
 * a SHELL, not a content container: it does not render PanelFrame itself, so a caller's `children`
 * (already one or more PanelFrame elements) needs no change to move under Panel.
 */
import * as React from 'react';
import type { CssStyle, ElementProps } from './cssStyle.js';
import { type PanelHeaderRowProps } from './PanelFrame.js';
import { type PanelSize } from './hostApi.js';
import { type ViewId } from './snapshots.js';
export { HostMissingProviderError, HostProvider, useHost } from './hostApi.js';
export type { Host } from './hostApi.js';
export { DRAG_CLOSE, DragToClose, type DragHandleProps, type ReorderHandle } from './dragToClose.js';
export { WindowOverlay, OverlaySlot, OVERLAY_Z, type OverlaySlotName, type WindowOverlayProps } from './windowOverlay.js';
/** The props of `Panel`: every `Box` prop except `children`, `sx` and `title`, plus the header, grab handle, overlay and capture options. @public */
export interface PanelProps extends Omit<ElementProps, 'children' | 'sx' | 'title'> {
    /**
     * The header's title. Omitted entirely (not passed at all) renders
     * NO header row, rather than forcing the view into
     * PanelHeaderRow's own "Untitled" placeholder. Pass an
     * explicit falsy value (e.g. `''`) to get that placeholder on purpose.
     */
    title?: React.ReactNode;
    /** Content shown in the header row beside the title. Has no effect when `title` is omitted. */
    actions?: React.ReactNode;
    /**
     * Extra PanelHeaderRow props beyond title/actions: the drag handle of a DragToClose view (`onPointerDown`, `sx`),
     * `data-*` attributes, etc.
     */
    headerProps?: Omit<PanelHeaderRowProps, 'title' | 'actions'> & {
        [key: `data-${string}`]: string | boolean | undefined;
    };
    /**
     * The grab handle for dragging this Panel (DragToClose's `onPointerDown`/`sx`), rendered as its OWN
     * element, a grip icon left of the title in the header row -- never spread onto `headerProps` -- so a
     * click on the title text or an action icon in the header is never mistaken for a drag start. Without a
     * `title` there is no header row, and the icon sits above the frame's top-left corner instead. Omitted
     * (the usual case for a view that cannot be closed, e.g. History) renders no grab handle at all.
     */
    grabProps?: Omit<ElementProps, 'children'> & {
        [key: `data-${string}`]: string | boolean | undefined;
    };
    /**
     * Content positioned absolutely over this view (History's own "+" Fab,
     * bottom-right) -- rendered as a plain sibling of `children` inside this
     * component's own `position: relative` box, which is already the
     * positioning context an `overlay` needs.
     */
    overlay?: React.ReactNode;
    /**
     * `false` keeps the header buttons the panel declares out of its header: a view that draws them itself with
     * `usePanelHeaderButtons` or `PanelHeaderButtons` still can. Default: they are drawn with the title.
     */
    headerButtons?: boolean;
    /**
     * `false` keeps the library's width control (`PanelSizeControl`) out of the header, for a view that places it itself among
     * its own `actions`. Default: a resizable panel with a title shows it first among the actions.
     */
    sizeControl?: boolean;
    /** Extra styles for the panel's root box, merged over the width and positioning it sets itself. */
    sx?: CssStyle;
    /** The panel's content, rendered inside the root box below the header. */
    children: React.ReactNode;
    /**
     * Registers this Panel's own root element with the capture registry a `CaptureRegistryProvider` supplies, so the
     * host can later ask for a picture of it by id. Omitted: never registered.
     */
    viewId?: ViewId;
    /** 'never' opts a Panel with a viewId out of registration entirely -- default 'auto'. */
    capture?: 'auto' | 'never';
    /** This panel's own size instead of the shared phone size (`usePhoneSize()`). Omitted: inside a row the width is the slot's drawn width, else the phone size's, read live -- see DESIGN.md. */
    size?: PanelSize;
}
/**
 * The shell every column in the row renders through: a relatively positioned box the width of the panel, with an
 * optional header above it, an optional grab handle and an optional overlay.
 * @public
 */
export declare function Panel({ title, actions, headerProps, headerButtons, sizeControl, grabProps, overlay, sx, children, viewId, capture, size, ...rest }: PanelProps): React.JSX.Element;
export default Panel;
