import * as React from 'react';
import { animate, motion, useIsPresent, useReducedMotion, useReducedMotionConfig, visualElementStore, type TargetAndTransition } from 'motion/react';
import { SLOT_TRANSITION, directionalTransition, slideToTransition } from './directionalTransition.js';
import { CHROME_ATTRIBUTE, ChromeStoreContext, PANEL_SLIDE_EVENT, createRectReporter, markPanelPress, usePanelDragging, type PanelRectReporter } from './panelChrome.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import type { SlideTuning } from './panelSettings.js';
import { ROW_GAP, ROW_LAYER_Z } from './rowConstants.js';
import { HostMissingProviderError } from './hostApi.js';
import { useOptionalPhoneSize } from './phoneFit.js';
import { closestRowScroller, rowScrollerFor } from './rowScroller.js';

/**
 * The library's default row gap, 16 px; the gap a workspace draws with is its `tuning.rowGap`, which this does not follow.
 * @public
 * @deprecated Read the gap with `usePanelTuning().rowGap`, and the default with `LIBRARY_TUNING_DEFAULTS.rowGap`.
 */
export const GAP = ROW_GAP;
/** The timing/easing every panel slide uses. The SAME object as SLOT_TRANSITION, not a copy: a host animates
 * its own row "the same as a panel" by this reference (test/row-shell-style.test.ts pins it).
 * @public */
export const PANEL_TRANSITION = SLOT_TRANSITION;

/**
 * One live panel's animated slot, absolutely positioned at its own `leftOffset` so adding,
 * removing or resizing a panel never disturbs the ones to its left; `x`, not `left`, so the
 * browser composites it. Motion drives enter/exit (AnimatePresence keeps an outgoing node
 * mounted through its own unmount commit, unlike a plain CSS transition), and its Web Animations
 * API is immune to a theme's transition/animation:none reset, which must stay scoped there and never reach
 * transform/opacity, or it would kill this silently.
 */
export interface PanelRowSlotMotion {
  /** Where the slot starts when it mounts: one span beyond its resting place, faded out. */
  readonly initial: TargetAndTransition;
  /** The slot's resting position. */
  readonly animate: TargetAndTransition;
  /** Where the slot goes when it leaves: off the edge it was hidden past, or down for a close. */
  readonly exit: TargetAndTransition;
  /** The timing the slot moves with. */
  readonly transition: typeof PANEL_TRANSITION;
}

/** Whether `target` is a button or grab bar in a panel's own header, grab bar or footer: using one is not using the panel's content. */
function isChromeControl(target: EventTarget): boolean {
  const control = target instanceof Element ? target.closest('button, [role="button"], [data-panel-grab-bar]') : null;
  return control?.closest(`[${CHROME_ATTRIBUTE}]`) != null || control?.hasAttribute('data-panel-grab-bar') === true;
}

/** The same targets, no time taken: for Reduce Motion, snapping and width tracking. */
const INSTANT_TRANSITION = { duration: 0 } as const;

let commitClock: number | undefined;
/**
 * The time a slide counts from: this task's commit. Motion counts from the moment the keyframes resolve when that is over 40 ms
 * later, which would start the slot and the size box's scale at different moments.
 */
function slideStart(): number {
  if (commitClock === undefined) {
    commitClock = performance.now();
    queueMicrotask(() => {
      commitClock = undefined;
    });
  }
  return commitClock;
}

/**
 * How a slot enters: a slide from one side, a fade where it rests, or a scale up from 0: about its center for 'expand'
 * (an open), and about the edge on the side it comes in from for 'expand-left' / 'expand-right' (a reveal).
 * @internal
 */
export type SlotEntrance = 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'expand' | 'expand-left' | 'expand-right';

/** The transform origin each side expand grows about, as a fraction of the slot's width. */
const EXPAND_ORIGIN_X: Readonly<Partial<Record<SlotEntrance, number>>> = { 'expand-left': 0, 'expand-right': 1 };

/**
 * How a slot leaves: 'down' is the close exit on the close timing; the others take the slide timing. 'shrink' (a close)
 * scales it to 0 about its center, and 'shrink-left' / 'shrink-right' (a park) about the edge on the side it leaves by.
 * @internal
 */
export type SlotExit = 'down' | 'left' | 'right' | 'top' | 'bottom' | 'fade' | 'shrink' | 'shrink-left' | 'shrink-right';

/** The transform origin each shrink scales about, as a fraction of the slot's width. */
const SHRINK_ORIGIN_X: Readonly<Partial<Record<SlotExit, number>>> = { shrink: 0.5, 'shrink-left': 0, 'shrink-right': 1 };

/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export function panelRowSlotMotion(
  leftOffset: number,
  width: number,
  phoneHeight: number,
  enterDirection: SlotEntrance,
  exitDirection: SlotExit,
  gap: number = ROW_GAP,
  slide: SlideTuning = LIBRARY_TUNING_DEFAULTS.slide,
  rowScroll = false,
): PanelRowSlotMotion {
  // This panel's OWN footprint (its width plus one gap) is how far it must travel to clear the row edge,
  // so the distance is per panel: a wider one travels further.
  const ownSpan = width + gap;
  const rest = leftOffset;
  // Positive distance enters from the right (directionalTransition.ts's own sign convention); a negative
  // one enters from the left -- see panelRowOrder.ts for who decides which.
  const enterDistance = enterDirection === 'left' ? -ownSpan : ownSpan;
  const sideways = directionalTransition('x', rest, enterDistance, slideToTransition(slide));
  const { transition } = sideways;
  // A vertical slide travels the row's height, so the slot clears the row's top or bottom edge.
  const { initial, animate } =
    enterDirection === 'left' || enterDirection === 'right'
      ? sideways
      : enterDirection === 'top' || enterDirection === 'bottom'
        ? { initial: { x: rest, y: enterDirection === 'top' ? -phoneHeight : phoneHeight, opacity: 0 }, animate: { x: rest, y: 0, opacity: 1 } }
        : enterDirection === 'expand'
          ? // Starts half a span left, where its neighbours part from, so the center rides the opening gap.
            { initial: { x: rest - ownSpan / 2, scale: 0, opacity: 0 }, animate: { x: rest, scale: 1, opacity: 1 } }
          : enterDirection === 'expand-left' || enterDirection === 'expand-right'
            ? // Stays at its rest: moving the slot would move the edge it grows out of.
              { initial: { x: rest, scale: 0, opacity: 0 }, animate: { x: rest, scale: 1, opacity: 1 } }
          : { initial: { x: rest, opacity: 0 }, animate: { x: rest, opacity: 1 } };
  // 'down': a close, timed to DragToClose's exit so trash and drag closes read as one motion (DragToClose calls
  // `onClose` after its own `y` animation, so this ramps in under a box already off-screen). 'left'/'right': a
  // park, off the edge it was hidden past, so a close never looks like a park.
  const exit: TargetAndTransition =
    exitDirection === 'down'
      ? { x: rest, y: phoneHeight, opacity: 0, transition: { duration: slide.closeExitSeconds, ease: slide.closeExitEase } }
      : exitDirection === 'right'
        ? { x: rest + ownSpan, opacity: 0 }
        : exitDirection === 'left'
          ? { ...parkExitTarget(rest, ownSpan, 'left', rowScroll) }
          : exitDirection === 'top' || exitDirection === 'bottom'
            ? { x: rest, y: exitDirection === 'top' ? -phoneHeight : phoneHeight, opacity: 0 }
            : exitDirection === 'shrink'
              ? // The mirror of 'expand': half a span left keeps the center where the neighbours meet as they close up.
                { x: rest - ownSpan / 2, scale: 0, opacity: 0 }
              : exitDirection === 'shrink-left' || exitDirection === 'shrink-right'
                ? // Stays at its rest: moving the slot would move the edge it shrinks into.
                  { x: rest, scale: 0, opacity: 0 }
                : { x: rest, opacity: 0 };
  return { initial, animate, exit, transition };
}

/** The `x` and `opacity` a slot moves between. */
interface SlotValues {
  readonly x: number;
  readonly opacity: number;
}

/**
 * Where a slot goes when its panel parks: off the edge it was hidden past, faded out. In a scrolling row the strip
 * extends far past the window, so the exit is one span from the slot's own rest on either side; in a row that never
 * scrolls the left edge is the row's own origin.
 * @internal
 */
export function parkExitTarget(rest: number, ownSpan: number, side: 'left' | 'right', rowScroll: boolean): SlotValues {
  if (side === 'right') return { x: rest + ownSpan, opacity: 0 };
  return { x: rowScroll ? rest - ownSpan : -ownSpan, opacity: 0 };
}

/**
 * The imperative moves a slot makes on its own element. An object so a test can wrap them and read the order of the
 * calls; `set` writes the motion values at once, which a zero-duration animation would not.
 * @internal
 */
export const slotDriver = {
  set(el: HTMLElement, values: SlotValues): void {
    const visual = visualElementStore.get(el);
    visual?.getValue('x')?.set(values.x);
    visual?.getValue('opacity')?.set(values.opacity);
  },
  /** Starts the slide the element's `animate` prop already asks for, now, in the commit: Motion would start it in a passive effect. */
  startPending(el: HTMLElement): void {
    (visualElementStore.get(el) as { animationState?: { animateChanges(): void } } | undefined)?.animationState?.animateChanges();
  },
  animate(el: HTMLElement, values: SlotValues, transition: TargetAndTransition['transition']): void {
    // Scale too: a restart that stopped an expand part way would otherwise leave the panel small.
    animate(el, { x: values.x, opacity: values.opacity, scale: 1 }, transition as never);
  },
};

/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export function PanelRowSlot({
  panelId,
  label,
  leftOffset,
  width,
  phoneHeight,
  top,
  height,
  enterDirection,
  exitDirection,
  zIndex,
  tracking = false,
  gap,
  slide,
  rowScroll = false,
  previewing = false,
  onActivate,
  dragged = false,
  children,
}: {
  /** The panel this slot draws; the row's edge fade finds the slot by it. */
  panelId?: string;
  /** The slot's accessible name, set on its group: the panel's title and its place among the panels drawn. */
  label?: string;
  /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
  leftOffset: number;
  /** This panel's own width (`panelWidthOf`), also this slot's enter/exit travel distance (`panelRowSlotMotion`'s `ownSpan`). */
  width: number;
  /** The height in px a closing slot drops by. */
  phoneHeight: number;
  /** Where the slot's top edge sits in the row box, and its own height: a panel shorter than the row is aligned inside it. Omitted: the slot fills the row's height. */
  top?: number;
  height?: number;
  /** Computed by the caller (panelRowOrder.ts's `resolveEnterDirection`, or an explicit gesture side).
   * Must be correct on this component's FIRST render after the item (re)appears -- AnimatePresence
   * has no later render of a fresh mount to fix a wrong guess. */
  enterDirection: SlotEntrance;
  /** Must be correct on this component's LAST render before it leaves the `live`-filtered array --
   * AnimatePresence has no later render of a removed child to fix a wrong guess. */
  exitDirection: SlotExit;
  /**
   * Each slot's `motion.div` carries a `transform`, so it is its OWN stacking context and a child's `zIndex`
   * cannot compare against a SIBLING slot: stacking between slots (e.g. a raised column above a panel sliding
   * left behind it) must be set HERE, on the slot, not on what renders inside it. Defaults to 0.
   */
  zIndex?: number;
  /** True while a host holds a width on a panel of the row: the slot's moves take no time, so a width that follows a pointer moves it the same frame. Default false. */
  tracking?: boolean;
  /** The row's gap and this panel's slide; the library defaults when omitted. */
  gap?: number;
  slide?: SlideTuning;
  /** Whether the row scrolls: a park then exits relative to this slot's rest. Default false. */
  rowScroll?: boolean;
  /** True while a sideways drag previews the reorder: under Reduce Motion the slot's own moves then snap, since a preview-time slide carries no information. */
  previewing?: boolean;
  /** Called when a press or focus lands anywhere inside the slot, a portaled descendant included (React capture handlers follow the React tree); `control` is true when it lands on a control of the panel's own chrome. */
  onActivate?: (control: boolean) => void;
  /** True for the slot whose box is being dragged: its rest moving during the preview is the drop, which lands at once whatever the motion setting. */
  dragged?: boolean;
  /** The panel rendered inside the slot. */
  children: React.ReactNode;
}) {
  // The entrance is read once, as the slot mounts: an enter in progress keeps its style whatever the settings say later.
  const [entrance] = React.useState(enterDirection);
  // A reveal grows where the neighbour it replaces is still sliding away, so it is drawn on top until it has grown, on either side.
  const [growing, setGrowing] = React.useState(EXPAND_ORIGIN_X[entrance] !== undefined);
  const { initial, animate: animateTarget, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, entrance, exitDirection, gap, slide, rowScroll);
  const el = React.useRef<HTMLDivElement>(null);
  // What a report and the frame loop read: the row's store and this slot's panel id, as of this render.
  const chrome = React.useContext(ChromeStoreContext);
  const live = React.useRef({ chrome, panelId });
  live.current = { chrome, panelId };
  const reporter = React.useRef<PanelRectReporter | null>(null);
  // True between Motion's own start and completion of this slot's animation; the store mirrors it for usePanelSliding.
  const sliding = React.useRef(false);
  const kickRect = React.useCallback((): void => reporter.current?.kick(), []);
  const setSliding = (on: boolean): void => {
    sliding.current = on;
    const { chrome: store, panelId: id } = live.current;
    if (store !== undefined && id !== undefined) store.setSliding(id, on);
  };
  const framed = useHoldsFrame(el);
  // This slot's own copy of the transition, so the moment its slide counts from can be set for the one call that starts it.
  const startable: { duration: number; ease?: unknown; startTime?: number } = React.useMemo(() => ({ ...transition }), [transition]);
  const reducedMotion = useReducedMotionConfig();
  // The drag box reads the system preference itself, so the neighbours that make room for it must too, whatever the app's MotionConfig says.
  const systemReduced = useReducedMotion();
  // A press or key inside an iframe never reaches the page's own handlers; the page's window loses focus to the iframe element instead.
  const activate = React.useRef(onActivate);
  activate.current = onActivate;
  React.useEffect(() => {
    const onWindowBlur = (): void => {
      const focused = document.activeElement;
      if (focused instanceof HTMLIFrameElement && el.current?.contains(focused)) activate.current?.(false);
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, []);
  const slideTransition = reducedMotion ? INSTANT_TRANSITION : transition;
  const snapping = previewing && (reducedMotion || systemReduced || dragged);
  // A drag of any axis lifts its slot above the row's others until it has settled; the slot is its own stacking context, so only its z can do it.
  const lifted = usePanelDragging();
  // React 19.2 re-runs effect cleanup and setup for a keyed child a reorder moves, and Motion's cleanup stops the slide this
  // slot was making toward its new rest; nothing then starts it again, so the slot stays where it was.
  // A drop under Reduce Motion lands here too: the moved slot's own slide is re-started with the preview's instant transition.
  const restNow = React.useRef({ leftOffset, transition: snapping || tracking ? INSTANT_TRANSITION : slideTransition });
  restNow.current = { leftOffset, transition: snapping || tracking ? INSTANT_TRANSITION : slideTransition };
  const setUpBefore = React.useRef(false);
  const present = useIsPresent();
  // Neighbours close up over a shrinking slot, so it is drawn on top to be seen shrinking away.
  const shrinkOrigin = present ? undefined : SHRINK_ORIGIN_X[exitDirection];
  const shrinking = shrinkOrigin !== undefined;
  // Motion starts an exit in its own layout effect, before this slot's: the clock must be on the transition by render, so a
  // shrink and the neighbours closing up over it count from the same moment however late the commit runs.
  if (shrinking) startable.startTime = slideStart();
  React.useLayoutEffect(() => {
    if (!present) delete startable.startTime;
  });
  // The drop's new rest lands in the commit that changes it, in the same frame as the dragged box's own offset going to 0: a snap that waited
  // for Motion's next frame would draw the box a frame at the old slot.
  const lastRest = React.useRef(leftOffset);
  React.useLayoutEffect(() => {
    const moved = lastRest.current !== leftOffset;
    lastRest.current = leftOffset;
    if (moved && (snapping || tracking) && el.current !== null && present) slotDriver.set(el.current, { x: leftOffset, opacity: 1 });
    else if (moved && el.current !== null && present) {
      // Before the slide starts: a listener reads the box the panel still shows.
      if (panelId !== undefined) {
        const Ctor = el.current.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
        el.current.dispatchEvent(new Ctor(PANEL_SLIDE_EVENT, { bubbles: true, detail: { id: panelId } }));
      }
      startable.startTime = slideStart();
      slotDriver.startPending(el.current);
      delete startable.startTime;
    }
  });
  // An expand's scale and its neighbours' parting must share one clock, or the gap it grows into lags it by a frame.
  React.useLayoutEffect(() => {
    if ((entrance !== 'expand' && EXPAND_ORIGIN_X[entrance] === undefined) || snapping || tracking || el.current === null) return;
    startable.startTime = slideStart();
    slotDriver.startPending(el.current);
    delete startable.startTime;
  }, []);
  React.useEffect(() => {
    if (!setUpBefore.current) {
      setUpBefore.current = true;
      return;
    }
    if (el.current === null || !present) return;
    slotDriver.animate(el.current, { x: restNow.current.leftOffset, opacity: 1 }, restNow.current.transition);
  }, []);
  // A box that moves by its own motion, a drag, a resize or a row scroll is reported until it stops. A slot that mounts
  // reports its rest once; its reporter is recreated under StrictMode's second setup, so nothing here is shared.
  React.useLayoutEffect(() => {
    const node = el.current;
    if (node === null) return;
    const row = closestRowScroller(node);
    const rowMoving = (): boolean => row !== null && (rowScrollerFor(row).glideTarget() !== null || rowScrollerFor(row).claimHeld());
    const rep = createRectReporter(node, {
      id: () => live.current.panelId,
      moving: () => {
        const { chrome: store, panelId: id } = live.current;
        const held = store !== undefined && id !== undefined && (store.dragging() === id || store.resizing() === id);
        return sliding.current || held || rowMoving();
      },
    });
    reporter.current = rep;
    const unsubscribeRow = row === null ? () => {} : rowScrollerFor(row).subscribe(kickRect);
    rep.kick();
    return () => {
      unsubscribeRow();
      rep.stop();
      reporter.current = null;
      if (sliding.current) setSliding(false);
    };
  }, [kickRect]);
  React.useEffect(() => {
    if (chrome === undefined || panelId === undefined) return;
    const offs = [chrome.subscribePanel(panelId, kickRect), chrome.subscribeResizing(kickRect), chrome.subscribeDrawn(kickRect)];
    return () => {
      for (const off of offs) off();
    };
  }, [chrome, panelId, kickRect]);
  return (
    <motion.div
      ref={el}
      // Enters from one own-width-plus-gap span beyond its destination, right or left per `enterDirection` above.
      initial={snapping || tracking ? animateTarget : initial}
      animate={snapping || tracking ? { ...animateTarget, transition: INSTANT_TRANSITION } : animateTarget}
      exit={exit}
      transition={startable as typeof transition}
      onAnimationStart={() => {
        setSliding(true);
        kickRect();
      }}
      onAnimationComplete={() => {
        setSliding(false);
        if (growing) setGrowing(false);
        reporter.current?.settle();
      }}
      {...(label === undefined ? {} : { role: 'group', 'aria-label': label })}
      data-row-slot={leftOffset}
      data-row-id={panelId}
      onPointerDownCapture={(e) => {
        markPanelPress(e.nativeEvent);
        onActivate?.(isChromeControl(e.target));
      }}
      onFocusCapture={(e) => onActivate?.(isChromeControl(e.target))}
      style={{
        position: 'absolute',
        top: top ?? 0,
        ...(height === undefined ? { bottom: 0 } : { height }),
        left: 0,
        // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
        width,
        zIndex: lifted ? Math.max(zIndex ?? 0, ROW_LAYER_Z.DRAGGED) : shrinking || (growing && present) ? Math.max(zIndex ?? 0, ROW_LAYER_Z.RAISED) : (zIndex ?? 0),
        ...(shrinking ? { originX: shrinkOrigin } : EXPAND_ORIGIN_X[entrance] !== undefined ? { originX: EXPAND_ORIGIN_X[entrance] } : {}),
      }}
    >
      {framed && <TabSentinel end={false} />}
      {children}
      {framed && <TabSentinel end />}
    </motion.div>
  );
}

// No aria-hidden (a focusable element must not carry it) and no role: presentation is ignored on a focusable element anyway.
// Zero-size, not display:none, so the browser still gives it a tab stop.
// A tab stop on a non-interactive element is the point: it exists only to catch the browser's step out of an iframe.
const SENTINEL_STOP = { tabIndex: 0 };

function TabSentinel({ end }: { end: boolean }): React.ReactElement {
  return <span {...SENTINEL_STOP} data-row-sentinel={end ? 'end' : 'start'} style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'hidden', outline: 'none' }} />;
}

const FRAMES = 'iframe,frame,embed,object';

// Only a cross-document element can swallow a Tab press, so a slot gets sentinels only while it holds one.
function useHoldsFrame(slot: React.RefObject<HTMLElement | null>): boolean {
  const [holds, setHolds] = React.useState(false);
  React.useLayoutEffect(() => {
    const node = slot.current;
    if (node === null) return;
    const sync = () => setHolds(node.querySelector(FRAMES) !== null);
    sync();
    // Only an added or removed frame changes the answer; the sentinels this very state adds must not re-run the query.
    const touchesFrame = (nodes: NodeList): boolean => [...nodes].some((n) => n instanceof Element && (n.matches(FRAMES) || n.querySelector(FRAMES) !== null));
    const observer = new MutationObserver((records) => {
      if (records.some((r) => touchesFrame(r.addedNodes) || touchesFrame(r.removedNodes))) sync();
    });
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [slot]);
  return holds;
}

/**
 * The box a resize animates. Its real width and height ease from the size on screen to the new one over the slide, in step with
 * the neighbouring slots, so its content reflows as it goes and is never stretched. A row already draws one around every panel,
 * which follows the panel's `resize` setting; a `PanelSizeBox` inside it is a plain div that fills it. Under Reduce Motion, or
 * while a host holds a width, the resize snaps.
 * @public
 */
export function PanelSizeBox({
  width,
  height,
  reveal,
  children,
}: {
  /** The box's width in px; a change animates. Omitted: the slot's drawn width inside a row, else the phone width. */
  width?: number;
  /** The box's height in px; a change animates. Omitted: the slot's drawn height inside a row, else the phone height. */
  height?: number;
  /**
   * True: while the box glides, its content is laid out once at the larger of the start and end widths and the eased box clips it
   * at its sides, so the content is resized when a grow starts and when a shrink ends, not on every frame. The height follows the
   * box, and anything drawn above or below the box, such as a frame's header and footer, is never clipped. Default false.
   */
  reveal?: boolean;
  /** The content, laid out at the box's size on every frame, or under `reveal` at the glide's larger width. */
  children: React.ReactNode;
}) {
  return (
    <SizeBox width={width} height={height} reveal={reveal}>
      {children}
    </SizeBox>
  );
}

/** A size glide of a panel's box: where it started and where it lands. A height of `'100%'` is the slot's own. @public */
export interface PanelSizeGlide {
  /** The box's size when the glide started. */
  from: { width: number; height: number | '100%' };
  /** The size the glide lands on. */
  to: { width: number; height: number | '100%' };
}

const SizeGlideContext = React.createContext<PanelSizeGlide | null>(null);

/**
 * The size glide of the panel box this is called in, from its start until it lands; null while the box is still, under Reduce
 * Motion, and outside a box. A window that draws no frames does not advance a glide, so a host that waits on its end caps the wait.
 * @public
 */
export function usePanelSizeGlide(): PanelSizeGlide | null {
  return React.useContext(SizeGlideContext);
}

const missingHost = (): never => {
  throw new HostMissingProviderError();
};

/** True below a `SizeBox`: a box inside another is a plain div filling it, because two glides of one size would fight. */
const SizeBoxContext = React.createContext(false);

/** True below a `SizeBox`: the panel and its frame fill the box, so they take each eased frame's size, not the target's. @internal */
export const useInsideSizeBox = (): boolean => React.useContext(SizeBoxContext);

/**
 * `PanelSizeBox` with a height that may be the slot's own (`'100%'`, a panel that fills the row's height), which is the box the
 * default frame draws around its whole panel. A box below another draws a plain div of the same size.
 * @internal
 */
export function SizeBox({ width: given, height: givenHeight, reveal = false, children }: { width?: number; height?: number | '100%'; reveal?: boolean; children: React.ReactNode }) {
  const slot = React.useContext(PanelSlotContext);
  // Read without throwing: a box given both sides needs no host.
  const phone = useOptionalPhoneSize();
  const width = given ?? slot?.drawn?.width ?? phone?.width ?? missingHost();
  const height = givenHeight ?? slot?.drawn?.height ?? phone?.height ?? missingHost();
  const nested = React.useContext(SizeBoxContext);
  const slide = slot?.tuning.slide;
  // The system preference too, because a theme's MotionConfig may not carry it.
  const configReduced = useReducedMotionConfig() === true;
  const systemReduced = useReducedMotion() === true;
  const snaps = configReduced || systemReduced || slot?.tracking === true;
  const box = React.useRef<HTMLDivElement>(null);
  const drawn = React.useRef<{ width: number; height: number | '100%' } | undefined>(undefined);
  const run = React.useRef<{ stop: () => void } | undefined>(undefined);
  const [glide, setGlide] = React.useState<PanelSizeGlide | null>(null);
  // Starts in the commit's layout effect, on the slot's slide clock (`slideStart`), so a commit that janks opens no gap to a neighbour.
  React.useLayoutEffect(() => {
    const node = box.current;
    if (node === null || nested) return;
    // From where the box is drawn now, so a resize that lands mid-glide carries on from the size on screen.
    const from = drawn.current;
    run.current?.stop();
    run.current = undefined;
    const draw = (w: number, h: number | '100%'): void => {
      drawn.current = { width: w, height: h };
      node.style.width = `${w}px`;
      node.style.height = typeof h === 'number' ? `${h}px` : h;
    };
    // A height of the slot's own ('100%') has no number to ease from or to, so only the width eases.
    const h0 = typeof from?.height === 'number' && typeof height === 'number' ? from.height : height;
    if (from === undefined || snaps || (Math.abs(from.width - width) < 0.5 && (typeof h0 !== 'number' || typeof height !== 'number' || Math.abs(h0 - height) < 0.5))) {
      draw(width, height);
      setGlide(null);
      return;
    }
    draw(from.width, h0);
    setGlide({ from: { width: from.width, height: h0 }, to: { width, height } });
    const transition = slide === undefined ? PANEL_TRANSITION : slideToTransition(slide);
    run.current = animate(0, 1, {
      ...transition,
      startTime: slideStart(),
      onUpdate: (p: number) => draw(from.width + (width - from.width) * p, typeof h0 === 'number' && typeof height === 'number' ? h0 + (height - h0) * p : height),
      onComplete: () => {
        draw(width, height);
        setGlide(null);
      },
    });
  }, [width, height, snaps, nested]);
  React.useEffect(() => () => run.current?.stop(), []);
  // It fills the box above, so it eases with that box rather than snapping to its own size.
  if (nested) return <div data-panel-size-plain="" style={{ width: '100%', height: '100%' }}>{children}</div>;
  // The larger width, so a grow lays the content out once at its start and a shrink once at its end. The height follows the box,
  // and the clip is sideways only: a frame's header and footer are drawn above and below the box.
  const content = reveal ? (
    <div data-panel-size-reveal="" style={{ width: glide === null ? '100%' : Math.max(glide.from.width, glide.to.width), height: '100%' }}>
      {children}
    </div>
  ) : (
    children
  );
  return (
    <div ref={box} data-panel-size-box="" style={{ width, height, ...(reveal && glide !== null ? { clipPath: 'inset(-100vh 0)' } : {}) }}>
      <SizeBoxContext.Provider value>
        <SizeGlideContext.Provider value={glide}>{content}</SizeGlideContext.Provider>
      </SizeBoxContext.Provider>
    </div>
  );
}
