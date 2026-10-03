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
import { GAP, PANEL_TRANSITION } from './PanelRowSlot.js';
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
}

/** @internal */
export interface WorkspaceShellStyle {
  /** The row's centring margin, px. */
  marginLeft: number;
  /** Snap while the container width is still moving, glide once it has held still. */
  transition: typeof PANEL_TRANSITION | { duration: 0 };
  /** The scroll container's horizontal overflow -- always 'hidden': the row hides its far panel instead of ever scrolling or growing past what fits. */
  overflowX: 'hidden';
}

/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export function workspaceShellStyle(i: WorkspaceShellStyleInput): WorkspaceShellStyle {
  // Calculated from known widths, never measured off the DOM. `fixedColumnCount` and `liveWidths` must come
  // from the same array the row's JSX renders (see computeRowLayout's own doc comment for why).
  const { computedRowMarginLeft } = computeRowLayout({
    containerWidth: i.containerWidth,
    phoneWidth: i.phoneWidth,
    gap: GAP,
    fixedItemCount: i.fixedColumnCount,
    liveWidths: i.liveWidths,
  });
  return {
    marginLeft: computedRowMarginLeft,
    transition: i.rowResizeSettled ? PANEL_TRANSITION : { duration: 0 },
    overflowX: 'hidden',
  };
}

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
export function Workspace(props: WorkspaceProps): React.ReactElement {
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, topPadding, beforeRow, children, ...rest } = props;
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths });
  return (
    <>
      <Box
        ref={overflowContainerRef}
        {...rest}
        sx={{
          position: 'relative',
          display: 'flex',
          height: '100%',
          minHeight: 0,
          pt: `${topPadding ?? GAP}px`,
          pb: `${GAP}px`,
          pl: `${GAP}px`,
          pr: `${GAP}px`,
          // Always hidden: the row hides its far panel instead of ever scrolling or growing past what fits.
          overflowX: style.overflowX,
          overflowY: 'auto',
        }}
      >
        {beforeRow}
        {/* margin:'auto', not the container's justify-content/align-items:center, so an overflowing row
            stays reachable by scroll. marginLeft is Motion-animated (not written directly) so the row
            recenter and each panel's own slide-in read as one motion instead of two; only left needs to
            move over time, so top/bottom/right stay plain 'auto'. */}
        <motion.div
          ref={rowRef}
          style={{ display: 'flex', gap: `${GAP}px`, marginTop: 'auto', marginBottom: 'auto', marginRight: 'auto' }}
          animate={{ marginLeft: style.marginLeft }}
          transition={style.transition}
        >
          <OverlaySlot name="dialog" />
          {children}
        </motion.div>
      </Box>

      <OverlaySlot name="toast" />
    </>
  );
}
