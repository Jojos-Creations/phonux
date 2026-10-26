/**
 * The workspace shell: the scroll container that holds the centred, animated row, plus the pure
 * `workspaceShellStyle` derivation behind its centring math (computed synchronously on every render,
 * never through state or an effect -- see DESIGN.md). The host measures the row itself, before building its
 * own panels API in the same render, and passes the measurement in as props.
 */

import * as React from 'react';
import { type RefObject } from 'react';
import { motion, useReducedMotionConfig } from 'motion/react';
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
import { LandingContext, PhoneSizeContext, useRowHeightBudget } from './phoneFit.js';
import { RowHeightContext } from './panelTuning.js';
import { bindingOf, type WorkspaceHandle } from './workspaceCore.js';
import { ChromeStoreContext, createChromeStore, type DrawnPin } from './panelChrome.js';
import { AwayContext, createAwayStore } from './panelAway.js';
import { rowBottomReservePx, rowTopReservePx } from './panelChromeSize.js';
import { ROW_GAP } from './rowConstants.js';
import { maxScrollOf, nearestStop, scrollHoldingEdge, snapToStop, type RowNumbers } from './rowNumbers.js';
import { isQuietly } from './quietMove.js';
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

// Browsers round layout to fractions of a pixel, so a slot flush with the window edge can read a hair over it.
const EDGE_TOLERANCE_PX = 1;

/** True when `next` places or sizes a drawn entry differently from `prev`. */
function slotsMoved(prev: RowNumbers, next: RowNumbers): boolean {
  if (prev.rowMarginLeft !== next.rowMarginLeft || prev.ids.length !== next.ids.length) return true;
  return next.ids.some((id, k) => id !== prev.ids[k] || next.leftOffsets[k] !== prev.leftOffsets[k] || next.widths[k] !== prev.widths[k]);
}

/** A subscription that never fires, for a shell given no workspace. */
const NO_SUBSCRIPTION = (): (() => void) => () => {};

/** Clipped, not display: none, which would hide the live region from a screen reader. Pixel strings, because in `sx` a bare 1 is 100% and a bare -1 is a spacing unit, which would give a host's scroller a box to scroll. */
const VISUALLY_HIDDEN = { position: 'absolute', width: '1px', height: '1px', margin: '-1px', padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 } as const;

/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props: WorkspaceProps): React.ReactElement {
  const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled: given, phoneWidth, phoneHeight, fixedColumnCount, liveWidths, rowScroll, rowNumbers, topPadding, workspace, beforeRow, children, ...rest } = props;
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
  const settleTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
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
        scroller.setSettling(false);
        const n = numbersRef.current;
        if (claim === null || n === undefined || n.stops.length === 0) {
          scroller.replayDeferred();
          return;
        }
        const held = pin === null || edges === null ? scroller.scrollLeft() : scrollHoldingEdge(n, n.ids.indexOf(resizingId), pin, edges[pin], scroller.scrollLeft());
        // The settle lands first; a scroll the claim kept is replayed after it, so it overrides the settle.
        const glide = (from: RowNumbers): void => {
          const to = nearestStop(from, held);
          if (Math.abs(to - scroller.scrollLeft()) >= 0.5) scroller.glideTo(to, { durationSec: resolved.slide.durationSec, instant: reduced, ease: resolved.slide.glideEase });
          scroller.replayDeferred();
        };
        clearTimeout(settleTimer.current);
        if (reduced || n.rowMarginLeft === began?.rowMarginLeft) {
          glide(n);
          return;
        }
        // The margin glides to the release's numbers first: a scroll glide beside it moves every panel by both, and the scrollable width is
        // short of the target until the margin lands. Whoever moves the row during that wait has chosen where it rests, so the settle only
        // runs for a row nobody asked to move or moved, onto the stops the row has by then. A step the row refuses (at either end)
        // moves nothing, so it is counted as an ask of its own.
        const releasedAt = scroller.scrollLeft();
        const asked = scroller.inputs();
        scroller.setSettling(true);
        settleTimer.current = setTimeout(() => {
          scroller.setSettling(false);
          const now = numbersRef.current;
          if (now === undefined || now.stops.length === 0 || scroller.inputs() !== asked) return scroller.replayDeferred();
          if (Math.abs((scroller.glideTarget() ?? scroller.scrollLeft()) - releasedAt) >= 0.5) return scroller.replayDeferred();
          glide(now);
        }, resolved.slide.durationSec * 1000);
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
      clearTimeout(settleTimer.current);
    },
    [],
  );
  // A press on the row is a person choosing where it rests, even if it moves nothing.
  React.useEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return undefined;
    const note = (): void => rowScrollerFor(container).noteInput();
    container.addEventListener('pointerdown', note, { passive: true });
    return () => container.removeEventListener('pointerdown', note);
  }, [overflowContainerRef]);
  // What the last commit drew. A panel whose width differs from it under the same container width was resized on purpose; a window
  // resize moves the container width too and keeps its snap.
  const drawn = React.useRef({ numbers: rowNumbers, containerWidth });
  const panelResizing = resizingId !== null || (drawn.current.containerWidth === containerWidth && panelWidthChanged(drawn.current.numbers, rowNumbers));
  React.useLayoutEffect(() => {
    drawn.current = { numbers: rowNumbers, containerWidth };
  });
  const scrolls = rowNumbers?.rowScroll ?? rowScroll ?? false;
  const phoneSize = React.useMemo(() => (phoneHeight === undefined ? undefined : { width: phoneWidth, height: phoneHeight }), [phoneWidth, phoneHeight]);
  const style = workspaceShellStyle({ containerWidth, rowResizeSettled, panelResizing, phoneWidth, fixedColumnCount, liveWidths, gap, slide: resolved.slide, rowScroll, rowNumbers, rowGesture: resolved.rowGesture });
  // The room the row has to grow into: the container's height less its padding. 0 (unmeasured) applies no height limit.
  const topPad = rowTopReservePx(topPadding, resolved.rowTop, gap);
  const bottomPad = rowBottomReservePx(gap);
  const availableHeight = useRowHeightBudget(overflowContainerRef, topPad, bottomPad);
  // A row that stops scrolling must not keep the offset it had: the margin that centres it assumes the strip starts at 0.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (scrolls || container === null || container.scrollLeft === 0) return;
    const scroller = rowScrollerFor(container);
    scroller.stop();
    scroller.glideTo(0, { durationSec: 0, instant: true, ease: resolved.slide.glideEase });
  }, [scrolls, overflowContainerRef]);
  // A close, reopen or move slides slots without moving scrollLeft, so the row counts as moving until that slide has landed.
  const slideRef = React.useRef({ numbers: rowNumbers, endsAt: 0 });
  if (rowNumbers !== undefined && slideRef.current.numbers !== undefined && slotsMoved(slideRef.current.numbers, rowNumbers)) {
    slideRef.current = { numbers: rowNumbers, endsAt: performance.now() + resolved.slide.durationSec * 1000 + 100 };
  } else if (slideRef.current.numbers !== rowNumbers) slideRef.current = { numbers: rowNumbers, endsAt: slideRef.current.endsAt };
  // Reach is written straight to the slots on every scroll event, since a state update per frame of a glide would re-render the whole row.
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    const strip = rowRef.current;
    if (container === null || strip === null || rowNumbers === undefined) return;
    const apply = (): void => {
      const scroller = rowScrollerFor(container);
      const held = scroller.claimHeld();
      const view = container.getBoundingClientRect();
      const atRest = !held && scroller.glideTarget() === null && performance.now() >= slideRef.current.endsAt && rowNumbers.stops.some((stop) => Math.abs(stop - container.scrollLeft) <= EDGE_TOLERANCE_PX);
      const seen = new Set<string>();
      for (const slot of strip.querySelectorAll<HTMLElement>('[data-row-slot]')) {
        // A stepping row cuts the neighbour of a stop at the window edge, so only a panel the window does not reach at all is out of reach of Tab.
        const rect = slot.getBoundingClientRect();
        const away = rowNumbers.stops.length > 0 && (rect.right <= view.left || rect.left >= view.right);
        // Published here, not in PanelRow: this loop is the only place that measures a slot against the window.
        const id = slot.dataset.rowId;
        if (id !== undefined) {
          seen.add(id);
          awayStore.set(id, away);
        }
        // A peek narrower than the gap shows only the frame's edge, a hairline that reads as a stray bar rather than a panel.
        // Judged during a drag too, since the drag's preview slides panels into view while the claim holds reach still.
        const shown = Math.min(rect.right, view.right) - Math.max(rect.left, view.left);
        // At rest only whole slots draw; a panel wider than a phone may show partly. In motion a slot crossing an edge keeps drawing,
        // or a panel leaving the window would vanish at its first pixel instead of sliding out.
        const cut = rect.left < view.left - EDGE_TOLERANCE_PX || rect.right > view.right + EDGE_TOLERANCE_PX;
        const wholeOnly = atRest && cut && rect.width <= phoneWidth + EDGE_TOLERANCE_PX;
        slot.style.visibility = !away && rowNumbers.stops.length > 0 && (shown < gap || wholeOnly) ? 'hidden' : '';
        if (held) continue;
        slot.style.pointerEvents = away ? 'none' : '';
        // Inert too: Tab or find-in-page would otherwise scroll the row off its stop to reveal a panel the window does not reach.
        slot.toggleAttribute('inert', away);
      }
      awayStore.retain(seen);
    };
    apply();
    // A close, a move or a drag's preview slides the slots without a scroll event, so the hide is judged again on every frame of
    // that slide, and for as long as a drag holds the row. A drag's preview renders only the row, so its pointer or key restarts this.
    let frame = 0;
    let until = 0;
    const follow = (): void => {
      until = performance.now() + resolved.slide.durationSec * 1000 + 100;
      if (frame !== 0) return;
      frame = requestAnimationFrame(function tick(): void {
        apply();
        frame = performance.now() < Math.max(until, slideRef.current.endsAt) || rowScrollerFor(container).claimHeld() ? requestAnimationFrame(tick) : 0;
      });
    };
    follow();
    container.addEventListener('scroll', apply, { passive: true });
    container.addEventListener('pointermove', follow, { passive: true });
    container.addEventListener('keydown', follow);
    // A click or focus in the cut-off neighbour makes the browser scroll it into view off a stop; the row settles back onto one.
    const onFocus = (event: FocusEvent): void => {
      const n = rowNumbers;
      // A held panel is in view at every scroll, so focusing it moves nothing.
      if ((event.target as Element | null)?.closest('[data-row-edge]') != null) return;
      if (n.stops.length === 0 || isQuietly()) return;
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
      cancelAnimationFrame(frame);
      container.removeEventListener('pointermove', follow);
      container.removeEventListener('keydown', follow);
      container.removeEventListener('scroll', apply);
    };
  });
  // A close or a narrower window can end the row left of where it is scrolled. The browser would clamp the scroll in the same frame,
  // a jump, so the end element keeps the old range in that commit and gives it back frame by frame as the row's glide carries it home.
  const scrolledRef = React.useRef(0);
  const endPadRef = React.useRef<HTMLDivElement>(null);
  const before = drawn.current.numbers;
  // Measured from where the row's end is drawn, which for a row that fits is left of 0 (`maxScrollOf` would floor it there), and
  // the strip's margin glides, so until it lands the row ends short of the numbers by the margin still to come.
  const drawnEnd = rowNumbers === undefined ? 0 : rowNumbers.stripStart + rowNumbers.stripWidth + rowNumbers.rightInset + rowNumbers.endPad - rowNumbers.windowWidth - Math.max(0, rowNumbers.rowMarginLeft - (before?.rowMarginLeft ?? rowNumbers.rowMarginLeft));
  const endHold = scrolls && rowNumbers !== undefined && resolved.rowGesture === 'step' && scrolledRef.current > maxScrollOf(rowNumbers) ? scrolledRef.current - drawnEnd : 0;
  React.useLayoutEffect(() => {
    const container = overflowContainerRef.current;
    if (container === null) return undefined;
    const scroller = rowScrollerFor(container);
    const follow = (): void => {
      scrolledRef.current = container.scrollLeft;
      const pad = endPadRef.current;
      if (pad === null || pad.style.minWidth === '') return;
      const need = container.scrollLeft + container.clientWidth - pad.offsetLeft;
      pad.style.minWidth = scroller.glideTarget() !== null && need > 0 ? `${need}px` : '';
    };
    scrolledRef.current = container.scrollLeft;
    return scroller.subscribe(follow);
  }, [overflowContainerRef]);
  // Nothing glided the row home (a drag holds it, or motion is off): the range is given back at once.
  React.useEffect(() => {
    const container = overflowContainerRef.current;
    const pad = endPadRef.current;
    if (endHold > 0 && container !== null && pad !== null && rowScrollerFor(container).glideTarget() === null) pad.style.minWidth = '';
  });
  // Each edge element is a plain spacer as wide as its group, so the strip starts after the left one and ends before the right one.
  // The held panels themselves sit in the strip and are positioned from here (see PanelRow's PanelHold), so these hold no content.
  // An edge element exists only while a panel is held there, so a row that holds nothing renders exactly as it did.
  const holdsLeft = rowNumbers?.held.some((h) => h.side === 'left') === true;
  const holdsRight = rowNumbers?.held.some((h) => h.side === 'right') === true;
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
        {holdsLeft ? <div data-row-edge="left" style={leftEdgeStyle} /> : null}
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
        {holdsRight ? <div data-row-edge="right" style={rightEdgeStyle} /> : null}
        {scrolls ? <div ref={endPadRef} aria-hidden data-row-end-pad="" style={{ flex: `0 0 ${(rowNumbers?.endPad ?? 0) + gap}px`, ...(endHold > 0 ? { minWidth: `${(rowNumbers?.endPad ?? 0) + gap + endHold}px` } : {}) }} /> : null}
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
