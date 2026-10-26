/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */
import * as React from 'react';
import { type RefObject } from 'react';
import type { ElementProps } from './cssStyle.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import type { SlideTuning } from './panelSettings.js';
import { type WorkspaceHandle } from './workspaceCore.js';
import { type RowNumbers } from './rowNumbers.js';
/** The pure half of the row shell's input: the two measured fields the host's row measurement produces,
 * flattened here (not a nested `shell` object) so this file never imports a host measurement type.
 * @internal */
export interface WorkspaceShellStyleInput {
    /** The scroll container's measured width. 0 before the first measurement. */
    containerWidth: number;
    /** The margin glides once this has held still; it snaps otherwise (see the caller's own settle timer). */
    rowResizeSettled: boolean;
    /** True in the render of a deliberate panel resize: the margin then glides even while the row has stops. Default false. */
    panelResizing?: boolean;
    /** The width every fixed column renders at (PhoneDeviceAPI size). */
    phoneWidth: number;
    /** The number of always-present columns the row renders. */
    fixedColumnCount: number;
    /** Each LIVE panel's own width, in row order (useProvidePanels's `liveWidths`): a parked one is not in the row. */
    liveWidths: readonly number[];
    /** The row's gap. Default ROW_GAP. */
    gap?: number;
    /** The slide the margin glides with. Default: the shared panel transition. */
    slide?: SlideTuning;
    /** The row's numbers. Given: the margin and the overflow follow them; omitted: a row with no settings. */
    rowNumbers?: RowNumbers;
    /** Whether the row scrolls, for a caller with no `rowNumbers`. Ignored when `rowNumbers` is given. Default false. */
    rowScroll?: boolean;
    /** What the row's own scroll input does. Default: the library's `rowGesture`. */
    rowGesture?: 'step' | 'off';
}
/** The values the row shell renders with, derived by `workspaceShellStyle`. @internal */
export interface WorkspaceShellStyle {
    /** The row's centring margin, px. */
    marginLeft: number;
    /** Snap while the container width is still moving, glide once it has held still. */
    transition: typeof PANEL_TRANSITION | {
        /** Zero: the margin snaps with no animation. */
        duration: 0;
    };
    /**
     * The scroll container's horizontal overflow, always 'hidden': the row moves only through its scroll writer, so the browser
     * never scrolls it and its wheel listener can stay passive.
     */
    overflowX: 'hidden';
    /** True when the row scrolls: the row never shows a native scrollbar. Panel bodies keep their own. */
    hideScrollbar: boolean;
}
/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export declare function workspaceShellStyle(i: WorkspaceShellStyleInput): WorkspaceShellStyle;
/** How long the container width must hold still before the row's margin glides again: `slides` slide durations. @internal */
export declare function resizeSettleDelayMs(slide: SlideTuning, slides: number): number;
/**
 * Whether `width` has held still for `delayMs`; true at once when `instant`. The mount counts as a change, so a width change
 * inside the settle period snaps; one that comes after a full settle period of stillness glides from its first render.
 * @internal
 */
export declare function useResizeSettled(width: number, delayMs: number, instant: boolean): boolean;
/** The props of `Workspace`: every `Box` prop except `children`, plus the row's refs and the host's measurements. @public */
export interface WorkspaceProps extends Omit<ElementProps, 'children'> {
    /** Attach to the scroll container: the caller's ResizeObserver measures it. */
    overflowContainerRef: RefObject<HTMLDivElement | null>;
    /** Attach to the row (the flex box holding the columns): the SAME ref object a caller's own
     * `beforeRow` content may need too, so both centre against the one measured element. */
    rowRef: RefObject<HTMLDivElement | null>;
    /** The scroll container's measured width in px; 0 before the first measurement. */
    containerWidth: number;
    /**
     * Whether the container width has held still: the row's centring margin glides once it has, and snaps otherwise.
     * Omitted: the Workspace decides, calling the width settled once it has held for `tuning.resizeSettleSlides` slide durations (1.25 by default)
     * (`tuning.slide.durationSec`), and at once while animation is off (Reduce Motion); with `heightBudget` given, settled from the second
     * measurement on.
     */
    rowResizeSettled?: boolean;
    /** The width in px every fixed column renders at. */
    phoneWidth: number;
    /**
     * The height in px of one phone slot. Given, the Workspace tells `usePhoneSize()` the size `phoneWidth` and this make, so a panel's
     * frame and its slot agree with the width the row is priced at (pass both from `usePhoneFit`). Omitted: `useHost().device.size`.
     */
    phoneHeight?: number;
    /**
     * The room in px the row has to grow into, as `usePhoneFit` settles it. Given, `containerWidth` is taken as settled too (pass
     * `usePhoneFit`'s): past the first measurement the row's margin, and with `phoneHeight` its place in that room, glide on every change,
     * so a resized window moves the row once. Omitted: the row is centred in the container as drawn.
     */
    heightBudget?: number;
    /** The number of always-present columns the row renders. */
    fixedColumnCount: number;
    /** Each live panel's own width in px, in row order; a parked panel is not in the row. */
    liveWidths: readonly number[];
    /** Whether the row scrolls (ProvidedPanels.rowScroll). Ignored when `rowNumbers` is given, which carries it. Default false. */
    rowScroll?: boolean;
    /** The row's numbers (ProvidedPanels.rowNumbers): the margin and the overflow follow them. Omitted: a row with no settings, centred from `liveWidths` and never scrolling. */
    rowNumbers?: RowNumbers;
    /** Clearance above the row, in px. Defaults to the row gap; a host with its own chrome above the scroll container (e.g. a drag strip) passes more. Never less than the room a panel header takes, so the header stays on screen, unless the workspace sets `tuning.rowTop`: then it is taken as given, and the workspace's `rowTop` is used when this is omitted. */
    topPadding?: number;
    /** The workspace this shell draws: its tuning (`rowGap`, `slide`, `resizeSettleSlides`, `rowGesture`) sizes the row's margin and glides. Omitted: the library's tuning defaults. */
    workspace?: WorkspaceHandle;
    /** Rendered as the scroll container's first child, ahead of the row -- a slot for host content (e.g. a
     * device toast) that must sit there without being absorbed as row content via `children`. */
    beforeRow?: React.ReactNode;
    /** The row's content: the panels. */
    children: React.ReactNode;
}
/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export declare function Workspace(props: WorkspaceProps): React.ReactElement;
