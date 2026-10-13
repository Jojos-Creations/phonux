/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */

import * as React from 'react';
import { type RefObject } from 'react';
import { motion, useReducedMotionConfig } from 'motion/react';
import Box, { type BoxProps } from '@mui/material/Box';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import type { SlideTuning, WorkspaceTuning } from './panelSettings.js';
import { RowHeightContext, WorkspaceTuningContext, resolveWorkspaceTuning } from './panelTuning.js';
import { ChromeStoreContext, createChromeStore } from './panelChrome.js';
import { ROW_GAP, ROW_GESTURE } from './rowConstants.js';
import { fadeAt, nearestStop, type RowNumbers } from './rowNumbers.js';
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
  /** The row's numbers. Given: the margin and the overflow follow them; omitted: a row with no settings. */
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
    // The margin snaps while stops exist: a gliding margin would leave the scrollable width short of where a stop sits.
    transition: i.rowResizeSettled && !(i.rowNumbers !== undefined && i.rowNumbers.stops.length > 0) ? (i.slide === undefined ? PANEL_TRANSITION : slideToTransition(i.slide)) : { duration: 0 },
    overflowX: scrolls && gesture !== 'off' ? 'auto' : 'hidden',
    hideScrollbar: scrolls && gesture === 'step',
  };
}

/** How long the container width must hold still before the row's margin glides again: `slides` slide durations. @internal */
export function resizeSettleDelayMs(slide: SlideTuning, slides: number): number {
  return Math.round(slide.durationSec * slides * 1000);
}

/**
 * Whether `width` has held still for `delayMs`; true at once when `instant`. The width a timer last confirmed is state, so a
 * width change reads unsettled in the very render that sees it.
 * @internal
 */
export function useResizeSettled(width: number, delayMs: number, instant: boolean): boolean {
  const [confirmed, setConfirmed] = React.useState(width);
  React.useEffect(() => {
    if (instant) return setConfirmed(width);
    const timer = setTimeout(() => setConfirmed(width), delayMs);
    return () => clearTimeout(timer);
  }, [width, delayMs, instant]);
  return instant || confirmed === width;
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
  /**
   * Whether the container width has held still: the row's centring margin glides once it has, and snaps otherwise.
   * Omitted: the Workspace decides, calling the width settled once it has held for `tuning.resizeSettleSlides` slide durations (1.25 by default)
   * (`tuning.slide.durationSec`), and at once while animation is off (Reduce Motion).
   */
  rowResizeSettled?: boolean;
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
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, tuning, beforeRow, children, ...rest } = props;
  const resolved = React.useMemo(() => resolveWorkspaceTuning(tuning), [tuning]);
  const gap = resolved.rowGap;
  const [chromeStore] = React.useState(createChromeStore);
  const reduced = useReducedMotionConfig() === true;
  const derived = useResizeSettled(containerWidth, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides), reduced);
  const rowResizeSettled = given ?? derived;
  // A panel being resized by hand holds the row where it is: its strip changes under the pointer, and a settle onto the
  // nearest stop would scroll the row while the person drags. The release settles once.
  const resizingId = React.useSyncExternalStore(chromeStore.subscribeResizing, chromeStore.resizing, () => null);
  const numbersRef = React.useRef(rowNumbers);
  numbersRef.current = rowNumbers;
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (resizingId === null || container === null) return undefined;
    const scroller = rowScrollerFor(container);
    const claim = scroller.claim();
    return () => {
      claim?.release();
      const n = numbersRef.current;
      if (claim === null || n === undefined || n.stops.length === 0) return;
      const to = nearestStop(n, scroller.scrollLeft());
      if (Math.abs(to - scroller.scrollLeft()) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
    };
  }, [resizingId, overflowContainerRef]);
  const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
  // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) keeps every panel at the phone height.
  const [availableHeight, setAvailableHeight] = React.useState(0);
  const topPad = topPadding ?? gap;
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return undefined;
    const measure = (): void => setAvailableHeight(Math.max(0, Math.round(container.clientHeight - topPad - gap)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [overflowContainerRef, topPad, gap]);
  // A row that stops scrolling must not keep the offset it had: the margin that centres it assumes the strip starts at 0.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (scrolls || container === null || container.scrollLeft === 0) return;
    const scroller = rowScrollerFor(container);
    scroller.stop();
    scroller.glideTo(0, { durationSec: 0, instant: true, ease: resolved.slide.glideEase });
  }, [scrolls, overflowContainerRef]);
  // `filter`, not `opacity`: the slot's own opacity belongs to its enter and exit animation. Written straight to the
  // element on every scroll event, since a state update per frame of a glide would re-render the whole row.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    const strip = rowRef.current;
    if (container === null || strip === null || rowNumbers === undefined) return;
    const apply = (): void => {
      if (rowScrollerFor(container).claimHeld()) return;
      const opacities = fadeAt(rowNumbers, container.scrollLeft);
      for (const slot of strip.querySelectorAll<HTMLElement>('[data-row-slot]')) {
        const k = rowNumbers.ids.indexOf(slot.dataset.rowId ?? '');
        const opacity = k < 0 ? 1 : opacities[k]!;
        slot.style.filter = opacity >= 1 ? '' : `opacity(${opacity})`;
        slot.style.pointerEvents = opacity <= 0 ? 'none' : '';
        // Inert too: Tab or find-in-page would otherwise scroll the row off its stop to reveal a faded panel.
        slot.toggleAttribute('inert', opacity <= 0);
      }
    };
    apply();
    container.addEventListener('scroll', apply, { passive: true });
    return () => container.removeEventListener('scroll', apply);
  });
  return (
    <WorkspaceTuningContext.Provider value={resolved}>
      <ChromeStoreContext.Provider value={chromeStore}>
      <RowHeightContext.Provider value={availableHeight}>
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
          data-row-strip=""
          style={{ display: 'flex', gap: `${gap}px`, marginTop: 'auto', marginBottom: 'auto', marginRight: 'auto', ...(scrolls ? { flexShrink: 0 } : {}) }}
          animate={{ marginLeft: style.marginLeft }}
          transition={reduced ? { duration: 0 } : style.transition}
        >
          <OverlaySlot name="dialog" />
          {children}
        </motion.div>
        {/* An element, not a margin: outside the strip so a drag's end cap stays at the last panel; WebKit may leave a flex item's end margin out of the scrollable width, which would clamp the last stop short. */}
        {rowNumbers !== undefined && rowNumbers.endPad > 0 ? <div aria-hidden data-row-end-pad="" style={{ flex: `0 0 ${rowNumbers.endPad}px`, height: 0 }} /> : null}
      </Box>
      </RowHeightContext.Provider>

      <OverlaySlot name="toast" />
      </ChromeStoreContext.Provider>
    </WorkspaceTuningContext.Provider>
  );
}
