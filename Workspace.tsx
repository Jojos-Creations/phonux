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
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import type { SlideTuning, WorkspaceTuning } from './panelSettings.js';
import { LandingContext, PhoneSizeContext, useRowHeightBudget } from './phoneFit.js';
import { RowHeightContext, WorkspaceTuningContext, resolveWorkspaceTuning } from './panelTuning.js';
import { ChromeStoreContext, createChromeStore, type DrawnPin } from './panelChrome.js';
import { ROW_GAP, ROW_GESTURE } from './rowConstants.js';
import { nearestStop, scrollHoldingEdge, snapToStop, type RowNumbers } from './rowNumbers.js';
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
  /**
   * The scroll container's horizontal overflow: 'auto' for a scrolling row whose gesture is 'free', else 'hidden'. A stepping row
   * moves only through its scroll writer, so the browser never scrolls it and its wheel listener can stay passive.
   */
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
    overflowX: scrolls && gesture === 'free' ? 'auto' : 'hidden',
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
  /**
   * The height in px of one phone slot. Given, the Workspace tells `usePhoneSize()` the size `phoneWidth` and this make, so a panel's
   * frame and its slot agree with the width the row is priced at (pass both from `usePhoneFit`). Omitted: `useHost().device.size`.
   */
  phoneHeight?: number;
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

/** Clipped, not display: none, which would hide the live region from a screen reader. */
const VISUALLY_HIDDEN = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const;

/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props: WorkspaceProps): React.ReactElement {
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, phoneHeight, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, tuning, beforeRow, children, ...rest } = props;
  const resolved = React.useMemo(() => resolveWorkspaceTuning(tuning), [tuning]);
  const gap = resolved.rowGap;
  const [chromeStore] = React.useState(createChromeStore);
  const reduced = useReducedMotionConfig() === true;
  const labels = resolveLabels(useOptionalHost()?.labels);
  // A new element per message, so the same words said twice are announced twice.
  const [said, setSaid] = React.useState({ n: 0, text: '' });
  const announce = React.useCallback((text: string) => setSaid((prev) => ({ n: prev.n + 1, text })), []);
  const derived = useResizeSettled(containerWidth, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides), reduced);
  // Unmeasured until the container has a width: the first measurement is the commit that lands the fitted size.
  const [landing, setLanding] = React.useState(containerWidth === 0);
  React.useLayoutEffect(() => {
    if (landing && containerWidth > 0) setLanding(false);
  }, [landing, containerWidth]);
  const rowResizeSettled = given ?? derived;
  // A panel being resized by hand holds the row where it is: its strip changes under the pointer, and a settle onto the
  // nearest stop would scroll the row while the person drags. The release settles once.
  const resizingId = React.useSyncExternalStore(chromeStore.subscribeResizing, chromeStore.resizing, () => null);
  const numbersRef = React.useRef(rowNumbers);
  numbersRef.current = rowNumbers;
  // The release settles after the numbers carry the new slot count: it waits for them, or one frame, while the claim is held.
  const settle = React.useRef<{ run: () => void; grown: () => boolean } | null>(null);
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (resizingId === null || container === null) return undefined;
    const scroller = rowScrollerFor(container);
    const claim = scroller.claim();
    // Where the panel's edges are in the window now, read from the element once the claim has stopped any glide: the numbers
    // can be ahead of what is drawn (a margin or a slide still gliding, a panel drawn shrunk).
    const slot = container.querySelector<HTMLElement>(`[data-row-id="${resizingId}"]`);
    const rect = slot?.getBoundingClientRect();
    const pad = Number.parseFloat(getComputedStyle(container).paddingLeft) || 0;
    const left = rect === undefined || rect.width === 0 ? null : rect.left - container.getBoundingClientRect().left - pad;
    const edges = rect === undefined || left === null ? null : { start: left, end: left + rect.width };
    const began = numbersRef.current;
    const width = (n: RowNumbers | undefined): number | undefined => n?.widths[n.ids.indexOf(resizingId)];
    // The pin is latched while it is drawn: the host clears the width before it ends the mark.
    let pin: DrawnPin | null = null;
    const unsubscribe = chromeStore.subscribeDrawn(() => {
      const drawn = chromeStore.drawn();
      if (drawn !== null) pin = drawn.pin;
    });
    return () => {
      unsubscribe();
      const run = (): void => {
        settle.current = null;
        claim?.release();
        const n = numbersRef.current;
        if (claim === null || n === undefined || n.stops.length === 0) return;
        const held = pin === null || edges === null ? scroller.scrollLeft() : scrollHoldingEdge(n, n.ids.indexOf(resizingId), pin, edges[pin], scroller.scrollLeft());
        const to = nearestStop(n, held);
        if (Math.abs(to - scroller.scrollLeft()) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
      };
      if (width(numbersRef.current) !== width(began) || pin === null) return run();
      const pending = { run, grown: () => width(numbersRef.current) !== width(began) };
      settle.current = pending;
      requestAnimationFrame(() => settle.current === pending && run());
    };
  }, [resizingId, overflowContainerRef]);
  React.useLayoutEffect(() => {
    if (resizingId === null && settle.current?.grown() === true) settle.current.run();
  }, [rowNumbers, resizingId]);
  React.useLayoutEffect(() => () => void settle.current?.run(), []);
  const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
  const phoneSize = React.useMemo(() => (phoneHeight === undefined ? undefined : { width: phoneWidth, height: phoneHeight }), [phoneWidth, phoneHeight]);
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
  // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) applies no height limit.
  const topPad = topPadding ?? gap;
  const availableHeight = useRowHeightBudget(overflowContainerRef, topPad, gap);
  // A row that stops scrolling must not keep the offset it had: the margin that centres it assumes the strip starts at 0.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (scrolls || container === null || container.scrollLeft === 0) return;
    const scroller = rowScrollerFor(container);
    scroller.stop();
    scroller.glideTo(0, { durationSec: 0, instant: true, ease: resolved.slide.glideEase });
  }, [scrolls, overflowContainerRef]);
  // Reach is written straight to the slots on every scroll event, since a state update per frame of a glide would re-render the whole row.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    const strip = rowRef.current;
    if (container === null || strip === null || rowNumbers === undefined) return;
    const apply = (): void => {
      if (rowScrollerFor(container).claimHeld()) return;
      const view = container.getBoundingClientRect();
      for (const slot of strip.querySelectorAll<HTMLElement>('[data-row-slot]')) {
        // A stepping row cuts the neighbour of a stop at the window edge, so only a panel the window does not reach at all is out of reach of Tab.
        const rect = slot.getBoundingClientRect();
        const away = rowNumbers.stops.length > 0 && (rect.right <= view.left || rect.left >= view.right);
        slot.style.pointerEvents = away ? 'none' : '';
        // Inert too: Tab or find-in-page would otherwise scroll the row off its stop to reveal a panel the window does not reach.
        slot.toggleAttribute('inert', away);
      }
    };
    apply();
    container.addEventListener('scroll', apply, { passive: true });
    // A click or focus in the cut-off neighbour makes the browser scroll it into view off a stop; the row settles back onto one.
    const onFocus = (event: FocusEvent): void => {
      const n = rowNumbers;
      if (n.stops.length === 0) return;
      const id = (event.target as Element | null)?.closest<HTMLElement>('[data-row-slot]')?.dataset.rowId;
      const k = n.ids.indexOf(id ?? '');
      requestAnimationFrame(() => {
        const scroller = rowScrollerFor(container);
        if (scroller.claimHeld() || n.stops.length === 0) return;
        const to = k < 0 ? nearestStop(n, container.scrollLeft) : snapToStop(n, k, container.scrollLeft);
        if (Math.abs(to - container.scrollLeft) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
      });
    };
    container.addEventListener('focusin', onFocus);
    return () => {
      container.removeEventListener('focusin', onFocus);
      container.removeEventListener('scroll', apply);
    };
  });
  return (
    <AnnounceContext.Provider value={announce}>
    <PhoneSizeContext.Provider value={phoneSize}>
    <LandingContext.Provider value={landing}>
    <WorkspaceTuningContext.Provider value={resolved}>
      <ChromeStoreContext.Provider value={chromeStore}>
      <RowHeightContext.Provider value={availableHeight}>
      <Box
        ref={overflowContainerRef}
        role="region"
        aria-label={labels.row}
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
          // A scrolling row's end space is the end element's (below); a row that does not scroll centres in this padding.
          pr: scrolls ? 0 : `${gap}px`,
          overflowX: style.overflowX,
          // The row never scrolls vertically: a panel scrolls its own content, and a wheel over the row must not move it off its workspace.
          overflowY: 'hidden',
          ...(style.hideScrollbar ? { scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } } : {}),
          // A sideways swipe at the row's end must not chain to the page, where a browser reads it as back or forward.
          ...(scrolls ? { overscrollBehaviorX: 'none' } : {}),
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
        {/* A non-empty element is in every engine's scroll range; WebKit leaves a flex item's end margin out and Firefox an empty box,
            which clamps the last stop short. Outside the strip so a drag's end cap stays at the last panel. */}
        {scrolls ? <div aria-hidden data-row-end-pad="" style={{ flex: `0 0 ${(rowNumbers?.endPad ?? 0) + gap}px` }} /> : null}
      </Box>
      </RowHeightContext.Provider>

      <Box role="status" aria-live="polite" aria-atomic="true" data-workspace-announcer="" sx={VISUALLY_HIDDEN}>
        <span key={said.n}>{said.text}</span>
      </Box>
      <OverlaySlot name="toast" />
      </ChromeStoreContext.Provider>
    </WorkspaceTuningContext.Provider>
    </LandingContext.Provider>
    </PhoneSizeContext.Provider>
    </AnnounceContext.Provider>
  );
}
