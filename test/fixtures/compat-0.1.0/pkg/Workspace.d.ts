/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */
import * as React from 'react';
import { type RefObject } from 'react';
import { type BoxProps } from '@mui/material/Box';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
/** The pure half of the row shell's input: the two measured fields the host's row measurement produces,
 * flattened here (not a nested `shell` object) so this file never imports a host measurement type.
 * @internal */
export interface WorkspaceShellStyleInput {
    /** The scroll container's measured width. 0 before the first measurement. */
    containerWidth: number;
    /** The margin glides once this has held still; it snaps otherwise (see the caller's own settle timer). */
    rowResizeSettled: boolean;
    /** The width every fixed column renders at (PhoneDeviceAPI size). */
    phoneWidth: number;
    /** The number of always-present columns the row renders. */
    fixedColumnCount: number;
    /** Each LIVE panel's own width, in row order (useProvidePanels's `liveWidths`): a parked one is not in the row. */
    liveWidths: readonly number[];
}
/** @internal */
export interface WorkspaceShellStyle {
    /** The row's centring margin, px. */
    marginLeft: number;
    /** Snap while the container width is still moving, glide once it has held still. */
    transition: typeof PANEL_TRANSITION | {
        duration: 0;
    };
    /** The scroll container's horizontal overflow -- always 'hidden': the row hides its far panel instead of ever scrolling or growing past what fits. */
    overflowX: 'hidden';
}
/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export declare function workspaceShellStyle(i: WorkspaceShellStyleInput): WorkspaceShellStyle;
/** @public */
export interface WorkspaceProps extends Omit<BoxProps, 'children'> {
    /** Attach to the scroll container: the caller's ResizeObserver measures it. */
    overflowContainerRef: RefObject<HTMLDivElement | null>;
    /** Attach to the row (the flex box holding the columns): the SAME ref object a caller's own
     * `beforeRow` content may need too, so both centre against the one measured element. */
    rowRef: RefObject<HTMLDivElement | null>;
    containerWidth: number;
    rowResizeSettled: boolean;
    phoneWidth: number;
    fixedColumnCount: number;
    liveWidths: readonly number[];
    /** Clearance above the row, in px. Defaults to GAP; a host with its own chrome above the scroll container (e.g. a drag strip) passes more. */
    topPadding?: number;
    /** Rendered as the scroll container's first child, ahead of the row -- a slot for host content (e.g. a
     * device toast) that must sit there without being absorbed as row content via `children`. */
    beforeRow?: React.ReactNode;
    children: React.ReactNode;
}
/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export declare function Workspace(props: WorkspaceProps): React.ReactElement;
