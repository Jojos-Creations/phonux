/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */

import * as React from 'react';
import { type RefObject } from 'react';
import { motion } from 'motion/react';
import Box, { type BoxProps } from '@mui/material/Box';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import type { SlideTuning, WorkspaceTuning } from './panelSettings.js';
import { WorkspaceTuningContext, resolveWorkspaceTuning } from './panelTuning.js';
import { ROW_GAP, ROW_GESTURE } from './rowConstants.js';
import type { RowNumbers } from './rowNumbers.js';
import { rowScrollerFor } from './rowScroller.js';
import { OverlaySlot } from './windowOverlay.js';

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
  /** The row's gap. Default ROW_GAP. */
  gap?: number;
  /** The slide the margin glides with. Default: the shared panel transition. */
  slide?: SlideTuning;
  /** The row's numbers. Given: the margin and the overflow follow them; omitted: a row with no settings, as before. */
  rowNumbers?: RowNumbers;
  /** Whether the row scrolls, for a caller with no `rowNumbers`. Ignored when `rowNumbers` is given. Default false. */
  rowScroll?: boolean;
  /** What the row's own scroll input does. Default: the library's `rowGesture`. */
  rowGesture?: 'step' | 'free' | 'off';
}

/** The values the row shell renders with, derived by `workspaceShellStyle`. @internal */
export interface WorkspaceShellStyle {
  /** The row's centring margin, px. */
  marginLeft: number;
  /** Snap while the container width is still moving, glide once it has held still. */
  transition:
    | typeof PANEL_TRANSITION
    | {
        /** Zero: the margin snaps with no animation. */
        duration: 0;
      };
  /** The scroll container's horizontal overflow: 'auto' for a scrolling row whose gesture is not 'off', else 'hidden'. */
  overflowX: 'hidden' | 'auto';
  /** True when the container scrolls but shows no scrollbar: a scrolling row whose gesture is 'step'. */
  hideScrollbar: boolean;
}

/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export function workspaceShellStyle(i: WorkspaceShellStyleInput): WorkspaceShellStyle {
  // Calculated from known widths, never measured off the DOM. `fixedColumnCount` and `liveWidths` must come
  // from the same array the row's JSX renders (see computeRowLayout's own doc comment for why).
  const marginLeft =
    i.rowNumbers !== undefined
      ? i.rowNumbers.rowMarginLeft
      : computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap ?? ROW_GAP, fixedItemCount: i.fixedColumnCount, liveWidths: i.liveWidths }).computedRowMarginLeft;
  const scrolls = i.rowNumbers?.rowScroll ?? i.rowScroll ?? false;
  const gesture = i.rowGesture ?? ROW_GESTURE;
  return {
    marginLeft,
    transition: i.rowResizeSettled ? (i.slide === undefined ? PANEL_TRANSITION : slideToTransition(i.slide)) : { duration: 0 },
    overflowX: scrolls && gesture !== 'off' ? 'auto' : 'hidden',
    hideScrollbar: scrolls && gesture === 'step',
  };
}

/** The props of `Workspace`: every `Box` prop except `children`, plus the row's refs and the host's measurements. @public */
export interface WorkspaceProps extends Omit<BoxProps, 'children'> {
  /** Attach to the scroll container: the caller's ResizeObserver measures it. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /** Attach to the row (the flex box holding the columns): the SAME ref object a caller's own
   * `beforeRow` content may need too, so both centre against the one measured element. */
  rowRef: RefObject<HTMLDivElement | null>;
  /** The scroll container's measured width in px; 0 before the first measurement. */
  containerWidth: number;
  /** Whether the container width has held still: the row's centring margin glides once it has, and snaps otherwise. */
  rowResizeSettled: boolean;
  /** The width in px every fixed column renders at. */
  phoneWidth: number;
  /** The number of always-present columns the row renders. */
  fixedColumnCount: number;
  /** Each live panel's own width in px, in row order; a parked panel is not in the row. */
  liveWidths: readonly number[];
  /** Whether the row scrolls (ProvidedPanels.rowScroll). Ignored when `rowNumbers` is given, which carries it. Default false. */
  rowScroll?: boolean;
  /** The row's numbers (ProvidedPanels.rowNumbers): the margin and the overflow follow them. Omitted: a row with no settings, centred from `liveWidths` and never scrolling. */
  rowNumbers?: RowNumbers;
  /** Clearance above the row, in px. Defaults to the row gap; a host with its own chrome above the scroll container (e.g. a drag strip) passes more. */
  topPadding?: number;
  /** The row's look tuning; each leaf left out takes the library default. Hand the same value to useProvidePanels, which prices the row's capacity from its rowGap. */
  tuning?: WorkspaceTuning;
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
export function Workspace(props: WorkspaceProps): React.ReactElement {
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, tuning, beforeRow, children, ...rest } = props;
  const resolved = React.useMemo(() => resolveWorkspaceTuning(tuning), [tuning]);
  const gap = resolved.rowGap;
  const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
  // A row that stops scrolling must not keep the offset it had: the margin that centres it assumes the strip starts at 0.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (scrolls || container === null || container.scrollLeft === 0) return;
    const scroller = rowScrollerFor(container);
    scroller.stop();
    scroller.glideTo(0, { durationSec: 0, instant: true });
  }, [scrolls, overflowContainerRef]);
  return (
    <WorkspaceTuningContext.Provider value={resolved}>
      <Box
        ref={overflowContainerRef}
        {...rest}
        data-row-scroller=""
        sx={{
          position: 'relative',
          display: 'flex',
          height: '100%',
          minHeight: 0,
          pt: `${topPadding ?? gap}px`,
          pb: `${gap}px`,
          pl: `${gap}px`,
          pr: `${gap}px`,
          overflowX: style.overflowX,
          overflowY: 'auto',
          ...(style.hideScrollbar ? { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } } : {}),
        }}
      >
        {beforeRow}
        {/* margin:'auto', not the container's justify-content/align-items:center, so an overflowing row
            stays reachable by scroll. marginLeft is Motion-animated (not written directly) so the row
            recenter and each panel's own slide-in read as one motion instead of two; only left needs to
            move over time, so top/bottom/right stay plain 'auto'. */}
        <motion.div
          ref={rowRef}
          style={{ display: 'flex', gap: `${gap}px`, marginTop: 'auto', marginBottom: 'auto', marginRight: 'auto', ...(scrolls ? { flexShrink: 0 } : {}) }}
          animate={{ marginLeft: style.marginLeft }}
          transition={style.transition}
        >
          <OverlaySlot name="dialog" />
          {children}
        </motion.div>
      </Box>

      <OverlaySlot name="toast" />
    </WorkspaceTuningContext.Provider>
  );
}
