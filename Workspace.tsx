/**
 * The workspace shell: the scroll container that holds the centered, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centering math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */

import * as React from 'react';
import { type RefObject } from 'react';
import { motion, useReducedMotionConfig, visualElementStore } from 'motion/react';
import Box from '@mui/material/Box';
import type { ElementProps } from './cssStyle.js';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { computeRowLayout } from './panelRowLayout.js';
import { PANEL_TRANSITION } from './PanelRowSlot.js';
import { slideToTransition } from './directionalTransition.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import type { SlideTuning } from './panelSettings.js';
import { LandingContext, PhoneSizeContext, useRowHeightBudget, useWindowJump } from './phoneFit.js';
import { RowHeightContext } from './panelTuning.js';
import { bindingOf, type WorkspaceHandle } from './workspaceCore.js';
import { ChromeStoreContext, createChromeStore, isPanelPress, type DrawnPin } from './panelChrome.js';
import { arrowKeyBelongsElsewhere } from './arrowKeys.js';
import { focusEdgePanel, registerRowKeys } from './rowStep.js';
import { AwayContext, createAwayStore } from './panelAway.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { ROW_GAP, ROW_LAYER_Z } from './rowConstants.js';
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
  /** The row's centering margin, px. */
  marginLeft: number;
  /** Snap while the container width is still moving, glide once it has held still. */
  transition:
    | typeof PANEL_TRANSITION
    | {
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
export function workspaceShellStyle(i: WorkspaceShellStyleInput): WorkspaceShellStyle {
  // Calculated from known widths, never measured off the DOM. `fixedColumnCount` and `liveWidths` must come
  // from the same array the row's JSX renders (see computeRowLayout's own doc comment for why).
  const marginLeft =
    i.rowNumbers !== undefined
      ? i.rowNumbers.rowMarginLeft
      : computeRowLayout({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: i.gap ?? ROW_GAP, fixedItemCount: i.fixedColumnCount, liveWidths: i.liveWidths }).computedRowMarginLeft;
  const scrolls = i.rowNumbers?.rowScroll ?? i.rowScroll ?? false;
  // The margin snaps while stops exist, or the scrollable width would be short of where a stop sits. A panel resize glides anyway,
  // even inside the settle window: a grow that overflows the window adds its stops in the render that moves the margin, and a
  // snap there jumps every panel.
  const hasStops = i.rowNumbers !== undefined && i.rowNumbers.stops.length > 0;
  const glides = i.panelResizing === true || (i.rowResizeSettled && !hasStops);
  return {
    marginLeft,
    transition: glides ? (i.slide === undefined ? PANEL_TRANSITION : slideToTransition(i.slide)) : { duration: 0 },
    overflowX: 'hidden',
    hideScrollbar: scrolls,
  };
}

/** Whether a panel present in both has a different width in `after`: a resize, not a panel coming or going. */
function panelWidthChanged(before: RowNumbers | undefined, after: RowNumbers | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  return after.ids.some((id, k) => {
    const was = before.ids.indexOf(id);
    return was >= 0 && before.widths[was] !== after.widths[k];
  });
}

/** How long the container width must hold still before the row's margin glides again: `slides` slide durations. @internal */
export function resizeSettleDelayMs(slide: SlideTuning, slides: number): number {
  return Math.round(slide.durationSec * slides * 1000);
}

/**
 * Whether `width` has held still for `delayMs`; true at once when `instant`. The mount counts as a change, so a width change
 * inside the settle period snaps; one that comes after a full settle period of stillness glides from its first render.
 * @internal
 */
export function useResizeSettled(width: number, delayMs: number, instant: boolean): boolean {
  const [confirmed, setConfirmed] = React.useState(width);
  const [seen, setSeen] = React.useState(width);
  const [settling, setSettling] = React.useState(true);
  if (width !== seen) {
    setSeen(width);
    if (!settling) setConfirmed(width);
    setSettling(true);
  }
  React.useEffect(() => {
    if (instant) return setConfirmed(width);
    const timer = setTimeout(() => {
      setSettling(false);
      setConfirmed(width);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [width, delayMs, instant]);
  return instant || confirmed === width;
}

/** The props of `Workspace`: every `Box` prop except `children`, plus the row's refs and the host's measurements. @public */
export interface WorkspaceProps extends Omit<ElementProps, 'children'> {
  /** Attach to the scroll container: the caller's ResizeObserver measures it. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /** Attach to the row (the flex box holding the columns): the SAME ref object a caller's own
   * `beforeRow` content may need too, so both center against the one measured element. */
  rowRef: RefObject<HTMLDivElement | null>;
  /** The scroll container's measured width in px; 0 before the first measurement. */
  containerWidth: number;
  /**
   * Whether the container width has held still: the row's centering margin glides once it has, and snaps otherwise.
   * Omitted: the Workspace decides, calling the width settled once it has held for `tuning.resizeSettleSlides` slide durations (1/3 by default)
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
   * The room in px the row has to grow into, as `usePhoneFit` measures it. Given (pass `usePhoneFit`'s, with its `containerWidth`), the row's
   * margin, and with `phoneHeight` its place in that room, snap in a commit that changes `containerWidth` or this, and glide in any other,
   * such as the one that lands a new phone size. Omitted: the row is centered in the container as drawn.
   */
  heightBudget?: number;
  /** The number of always-present columns the row renders. */
  fixedColumnCount: number;
  /** Each live panel's own width in px, in row order; a parked panel is not in the row. */
  liveWidths: readonly number[];
  /** Whether the row scrolls (ProvidedPanels.rowScroll). Ignored when `rowNumbers` is given, which carries it. Default false. */
  rowScroll?: boolean;
  /** The row's numbers (ProvidedPanels.rowNumbers): the margin and the overflow follow them. Omitted: a row with no settings, centered from `liveWidths` and never scrolling. */
  rowNumbers?: RowNumbers;
  /** Clearance above the row, in px. Defaults to the row gap; a host with its own chrome above the scroll container (e.g. a drag strip) passes more. Never less than the room a panel header takes, so the header stays on screen, unless the workspace sets `tuning.rowTop`: then it is taken as given, and the workspace's `rowTop` is used when this is omitted. */
  topPadding?: number;
  /** Clearance under the row, in px. Defaults to the row gap; a host with its own chrome under the row passes more. Never less than the room a panel footer takes. */
  bottomPadding?: number;
  /** The workspace this shell draws: its tuning (`rowGap`, `slide`, `resizeSettleSlides`, `rowGesture`) sizes the row's margin and glides. Omitted: the library's tuning defaults. */
  workspace?: WorkspaceHandle;
  /** Rendered as the scroll container's first child, ahead of the row -- a slot for host content (e.g. a
   * device toast) that must sit there without being absorbed as row content via `children`. */
  beforeRow?: React.ReactNode;
  /** The row's content: the panels. */
  children: React.ReactNode;
}

/** A subscription that never fires, for a shell given no workspace. */
const NO_SUBSCRIPTION = (): (() => void) => () => {};

/** Clipped, not display: none, which would hide the live region from a screen reader. Pixel strings, because in `sx` a bare 1 is 100% and a bare -1 is a spacing unit, which would give a host's scroller a box to scroll. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const;

/**
 * The workspace shell: a scroll container holding the centered, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props: WorkspaceProps): React.ReactElement {
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, phoneHeight, heightBudget, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, bottomPadding, workspace, beforeRow, children, ...rest } = props;
  const binding = workspace === undefined ? undefined : bindingOf(workspace);
  const resolved = React.useSyncExternalStore(binding?.subscribe ?? NO_SUBSCRIPTION, () => binding?.tuning ?? LIBRARY_TUNING_DEFAULTS, () => binding?.tuning ?? LIBRARY_TUNING_DEFAULTS);
  const gap = resolved.rowGap;
  const [chromeStore] = React.useState(createChromeStore);
  const [awayStore] = React.useState(createAwayStore);
  const reduced = useReducedMotionConfig() === true;
  const labels = resolveLabels(useOptionalHost()?.labels);
  // A new element per message, so the same words said twice are announced twice.
  const [said, setSaid] = React.useState({ n: 0, text: '' });
  const announce = React.useCallback((text: string) => setSaid((prev) => ({ n: prev.n + 1, text })), []);
  const derived = useResizeSettled(containerWidth, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides), reduced);
  // Unmeasured until the container has a width: the first measurement is the commit that lands the fitted size.
  const [firstLanding, setLanding] = React.useState(containerWidth === 0);
  React.useLayoutEffect(() => {
    if (firstLanding && containerWidth > 0) setLanding(false);
  }, [firstLanding, containerWidth]);
  // A window jump lands the same way: the new size and panel count in one commit, nothing sliding or growing to reach them.
  const landing = useWindowJump(containerWidth, heightBudget ?? 0, resizeSettleDelayMs(resolved.slide, resolved.resizeSettleSlides)) || firstLanding;
  // What the last commit drew. A window step moves the row with no animation; any other change past the first measurement glides.
  const drawn = React.useRef({ numbers: rowNumbers, containerWidth, heightBudget });
  const windowStep = drawn.current.containerWidth !== containerWidth || drawn.current.heightBudget !== heightBudget;
  const rowResizeSettled = given ?? (heightBudget === undefined ? derived : !landing && !windowStep);
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
    const claim = scroller.claim({ replayScroll: true });
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
        if (claim === null || n === undefined || n.stops.length === 0) {
          scroller.replayDeferred();
          return;
        }
        const held = pin === null || edges === null ? scroller.scrollLeft() : scrollHoldingEdge(n, n.ids.indexOf(resizingId), pin, edges[pin], scroller.scrollLeft());
        // The settle lands first; a scroll the claim kept is replayed after it, so it overrides the settle.
        const to = nearestStop(n, held);
        if (Math.abs(to - scroller.scrollLeft()) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
        scroller.replayDeferred();
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
  React.useLayoutEffect(
    () => () => {
      settle.current?.run();
    },
    [],
  );
  // A press outside every panel leaves none in use: keystrokes stop going to the panel that had focus. Read in the bubble
  // phase on the window, after every slot has marked its own presses.
  React.useEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return undefined;
    const onPress = (event: PointerEvent): void => {
      if (isPanelPress(event)) return;
      chromeStore.setActive(null);
      const focused = container.ownerDocument.activeElement;
      if (focused instanceof HTMLElement && container.contains(focused) && focused.closest('[data-row-slot]') !== null) focused.blur();
      // The dot bar moves the row, and a move rests no panel: a wide one slides past at its width.
      if (!(event.target instanceof Element && event.target.closest('[data-dot-bar]') !== null)) binding?.blur();
    };
    const view = container.ownerDocument.defaultView ?? window;
    view.addEventListener('pointerdown', onPress);
    return () => view.removeEventListener('pointerdown', onPress);
  }, [overflowContainerRef, chromeStore, binding]);
  // A bare arrow while the panel in use is out of view focuses the panel at the view's far edge instead of stepping. Capture, so
  // the row's own listener sees the key taken.
  React.useEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return undefined;
    const edge = (direction: 'left' | 'right', target: EventTarget | null): boolean => focusEdgePanel(container, chromeStore.active(), direction, target);
    const onKey = (event: KeyboardEvent): void => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || arrowKeyBelongsElsewhere(event, container.ownerDocument)) return;
      if (container.closest('[inert]') !== null) return;
      if (edge(event.key === 'ArrowLeft' ? 'left' : 'right', event.target)) event.preventDefault();
    };
    const view = container.ownerDocument.defaultView ?? window;
    view.addEventListener('keydown', onKey, true);
    const unregister = registerRowKeys(container, { edge });
    return () => {
      view.removeEventListener('keydown', onKey, true);
      unregister();
    };
  }, [overflowContainerRef, chromeStore]);
  // A panel whose width differs from the last commit's under the same container width was resized on purpose; a window resize moves
  // the container width too and keeps its snap.
  const panelResizing = resizingId !== null || (drawn.current.containerWidth === containerWidth && panelWidthChanged(drawn.current.numbers, rowNumbers));
  React.useLayoutEffect(() => {
    drawn.current = { numbers: rowNumbers, containerWidth, heightBudget };
  });
  const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
  const phoneSize = React.useMemo(() => (phoneHeight === undefined ? undefined : { width: phoneWidth, height: phoneHeight }), [phoneWidth, phoneHeight]);
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, panelResizing, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
  // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) applies no height limit.
  const topPad = rowTopReservePx(topPadding, resolved.rowTop, gap);
  const bottomPad = rowBottomReservePx(gap, bottomPadding, resolved.chrome.where);
  // A settled budget stands in for the measured one, so a panel that fills the row's height grows in the same glide.
  const measuredHeight = useRowHeightBudget(overflowContainerRef, topPad, bottomPad, heightBudget === undefined);
  const availableHeight = heightBudget ?? measuredHeight;
  // Where auto margins would center the row in its room, written out so it can glide: a flex item's auto margins are 0 once it overflows.
  const marginTop = heightBudget === undefined || phoneHeight === undefined || heightBudget === 0 ? undefined : Math.max(0, (heightBudget - phoneHeight) / 2);
  // Motion writes even an instant change on a later frame: a window step's top margin is set on Motion's own value and written
  // here, so the paint after the step has it. The left margin is the row scroller's, which draws an instant change at once.
  React.useLayoutEffect(() => {
    const strip = rowRef.current;
    if (!windowStep || strip === null || marginTop === undefined) return;
    const values = visualElementStore.get(strip) as { getValue(key: string): { jump(v: number): void } | undefined } | undefined;
    values?.getValue('marginTop')?.jump(marginTop);
    strip.style.marginTop = `${marginTop}px`;
  });
  // A row that stops scrolling must not keep the offset it had: the margin that centers it assumes the strip starts at 0.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (scrolls || container === null || rowScrollerFor(container).scrollLeft() === 0) return;
    const scroller = rowScrollerFor(container);
    scroller.stop();
    scroller.glideTo(0, { durationSec: 0, instant: true, ease: resolved.slide.glideEase });
  }, [scrolls, overflowContainerRef]);
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null || rowNumbers === undefined) return;
    const n = rowNumbers;
    const scroller = rowScrollerFor(container);
    // A click or focus in a panel the grid cuts reveals it off a stop; the row settles back onto one.
    const onFocus = (event: FocusEvent): void => {
      // A held panel is in view at every scroll, so focusing it moves nothing.
      if ((event.target as Element | null)?.closest('[data-row-edge]') != null) return;
      if (n.stops.length === 0) return;
      const id = (event.target as Element | null)?.closest<HTMLElement>('[data-row-slot]')?.dataset.rowId;
      const k = n.ids.indexOf(id ?? '');
      requestAnimationFrame(() => {
        if (scroller.claimHeld()) return;
        const at = scroller.glideTarget() ?? scroller.scrollLeft();
        const near = nearestStop(n, at);
        const span = n.stopSpans[n.stops.indexOf(near)];
        // A panel the nearest stop already shows stays put, even cut: a click in a wide panel half under a held one must not jump it whole.
        const to = k < 0 || (span !== undefined && k >= span.first && k < span.end) ? near : snapToStop(n, k, at);
        if (Math.abs(to - at) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
      });
    };
    container.addEventListener('focusin', onFocus);
    return () => container.removeEventListener('focusin', onFocus);
  });
  // Each edge element is a plain spacer as wide as its group, so the strip starts after the left one and ends before the right one.
  // The held panels themselves sit in the strip and are positioned by the row's drawing pass (rowDraw.ts), so these hold no content.
  // An edge element exists only while a panel is held there, so a row that holds nothing renders exactly as it did.
  const holdsLeft = rowNumbers?.held.some((h) => h.side === 'left') === true;
  const holdsRight = rowNumbers?.held.some((h) => h.side === 'right') === true;
  const marginTransition = style.transition;
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return;
    const glides = !reduced && marginTransition.duration > 0;
    const ease = 'ease' in marginTransition ? marginTransition.ease : resolved.slide.ease;
    rowScrollerFor(container).reorigin(style.marginLeft, { durationSec: marginTransition.duration, instant: !glides, ease: [ease[0], ease[1], ease[2], ease[3]] });
  });
  const leftEdgeStyle = { width: `${rowNumbers?.leftInset ?? 0}px`, flexShrink: 0 } as const;
  const rightEdgeStyle = { width: `${rowNumbers?.rightInset ?? 0}px`, flexShrink: 0 } as const;
  return (
    <AnnounceContext.Provider value={announce}>
    <PhoneSizeContext.Provider value={phoneSize}>
    <LandingContext.Provider value={landing}>
      <ChromeStoreContext.Provider value={chromeStore}>
      <AwayContext.Provider value={awayStore}>
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
          // The row sits inside the device's top and bottom safe areas. The inset is a margin, not padding, so the box the row
          // measures for its height shrinks by it. env() is 0 unless the page's viewport meta sets viewport-fit=cover.
          marginTop: 'env(safe-area-inset-top, 0px)',
          height: 'calc(100% - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
          minHeight: 0,
          pt: `${topPad}px`,
          pb: `${bottomPad}px`,
          pl: `${gap}px`,
          // A scrolling row's range ends at its numbers, not this padding; a right edge hold counts its inset from the row's edge.
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
        {/* Outside the strip: the strip's transform would make a fixed overlay inside it fixed to the strip. */}
        <OverlaySlot name="dialog" />
        {holdsLeft ? <div data-row-edge="left" style={leftEdgeStyle} /> : null}
        {/* The row's scroller owns the strip's transform: its centering margin and its offset are one translate. The transform
            makes the strip one stacking context, so it takes the slots' own base layer, or a later positioned sibling would cover them. */}
        <div data-row-window="" style={{ display: 'flex', marginRight: 'auto', zIndex: ROW_LAYER_Z.BASE, flexShrink: scrolls ? 0 : 1 }}>
        <motion.div
          ref={rowRef}
          data-row-strip=""
          style={{ display: 'flex', gap: `${gap}px`, position: 'relative', zIndex: ROW_LAYER_Z.BASE, ...(marginTop === undefined ? { marginTop: 'auto' } : {}), marginBottom: 'auto', ...(scrolls ? { flexShrink: 0 } : {}) }}
          animate={marginTop === undefined ? {} : { marginTop }}
          transition={reduced || !rowResizeSettled ? { duration: 0 } : slideToTransition(resolved.slide)}
        >
          {children}
        </motion.div>
        </div>
        {holdsRight ? <div data-row-edge="right" style={rightEdgeStyle} /> : null}
      </Box>
      </RowHeightContext.Provider>

      <Box role="status" aria-live="polite" aria-atomic="true" data-workspace-announcer="" sx={VISUALLY_HIDDEN}>
        <span key={said.n}>{said.text}</span>
      </Box>
      <OverlaySlot name="toast" />
      </AwayContext.Provider>
      </ChromeStoreContext.Provider>
    </LandingContext.Provider>
    </PhoneSizeContext.Provider>
    </AnnounceContext.Provider>
  );
}
