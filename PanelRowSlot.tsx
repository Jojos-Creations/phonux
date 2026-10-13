import * as React from 'react';
import { animate, motion, useIsPresent, useReducedMotion, useReducedMotionConfig, visualElementStore, type TargetAndTransition } from 'motion/react';
import { SLOT_TRANSITION, directionalTransition, slideToTransition } from './directionalTransition.js';
import { PanelHiddenContext, PanelSlotContext } from './panelSlotContext.js';
import { LIBRARY_TUNING_DEFAULTS } from './panelSettings.js';
import type { SlideTuning } from './panelSettings.js';
import { ROW_GAP } from './rowConstants.js';

export { ROW_GAP as GAP } from './rowConstants.js';
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
  /** The timing the slot moves with; instant when `animated` is false. */
  readonly transition: typeof PANEL_TRANSITION | typeof INSTANT_TRANSITION;
}

/** What an `animated: false` slot moves with: the same targets, no time taken. */
const INSTANT_TRANSITION = { duration: 0 } as const;

/** What a kept slot leaves with when its entry is dropped: at once, since a hidden slot has nothing left to slide. */
const KEPT_EXIT: TargetAndTransition = { opacity: 0, transition: INSTANT_TRANSITION };

type ExitDirection = 'down' | 'left' | 'right';

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
  enterDirection: 'left' | 'right',
  exitDirection: ExitDirection,
  animated = true,
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
  const { initial, animate, transition: slideTransition } = directionalTransition('x', rest, enterDistance, slideToTransition(slide));
  const transition = animated ? slideTransition : INSTANT_TRANSITION;
  // 'down': a close, timed to DragToClose's exit so trash and drag closes read as one motion (DragToClose calls
  // `onClose` after its own `y` animation, so this ramps in under a box already off-screen). 'left'/'right': a
  // park, off the edge it was hidden past, so a close never looks like a park.
  const exit: TargetAndTransition =
    exitDirection === 'down'
      ? { x: rest, y: phoneHeight, opacity: 0, transition: animated ? { duration: slide.closeExitSeconds, ease: slide.closeExitEase } : INSTANT_TRANSITION }
      : exitDirection === 'right'
        ? { x: rest + ownSpan, opacity: 0 }
        : { ...parkExitTarget(rest, ownSpan, 'left', rowScroll) };
  return { initial, animate, exit, transition };
}

/** The `x` and `opacity` a kept slot moves between while it is parked and revived. */
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
 * Where a kept slot starts when its panel is shown again: one span beyond its rest on its enter side, faded out.
 * @internal
 */
export function enterStart(rest: number, ownSpan: number, side: 'left' | 'right'): SlotValues {
  return { x: side === 'left' ? rest - ownSpan : rest + ownSpan, opacity: 0 };
}

/** A running imperative slide: `finished` settles when it ends or is stopped. */
interface SlotRun {
  readonly finished: Promise<void>;
  stop(): void;
}

/**
 * The two imperative moves a kept slot makes on its own element. An object so a test can wrap them and read the
 * order of the calls; `set` writes the motion values at once, which a zero-duration animation would not.
 * @internal
 */
export const slotDriver = {
  set(el: HTMLElement, values: SlotValues): void {
    const visual = visualElementStore.get(el);
    visual?.getValue('x')?.set(values.x);
    visual?.getValue('opacity')?.set(values.opacity);
  },
  read(el: HTMLElement): SlotValues | undefined {
    const visual = visualElementStore.get(el);
    const x = visual?.getValue('x')?.get();
    const opacity = visual?.getValue('opacity')?.get();
    return typeof x === 'number' && typeof opacity === 'number' ? { x, opacity } : undefined;
  },
  animate(el: HTMLElement, values: SlotValues, transition: TargetAndTransition['transition']): SlotRun {
    const at = slotDriver.read(el);
    // Motion settles a slide whose target it already stands on only at the next frame; a kept slot must not wait for one.
    if (at !== undefined && at.x === values.x && at.opacity === values.opacity) return { finished: Promise.resolve(), stop: () => {} };
    const controls = animate(el, { x: values.x, opacity: values.opacity }, transition as never);
    return { finished: new Promise<void>((resolve) => controls.then(() => resolve())), stop: () => controls.stop() };
  },
};

/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export function PanelRowSlot({
  panelId,
  leftOffset,
  width,
  phoneHeight,
  top,
  height,
  enterDirection,
  exitDirection,
  zIndex,
  animated = true,
  gap,
  slide,
  kept = false,
  rowScroll = false,
  previewing = false,
  onActivate,
  dragged = false,
  children,
}: {
  /** The panel this slot draws; the row's edge fade finds the slot by it. */
  panelId?: string;
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
  enterDirection: 'left' | 'right';
  /** Must be correct on this component's LAST render before it leaves the `live`-filtered array --
   * AnimatePresence has no later render of a removed child to fix a wrong guess. */
  exitDirection: 'down' | 'left' | 'right';
  /**
   * Each slot's `motion.div` carries a `transform`, so it is its OWN stacking context and a child's `zIndex`
   * cannot compare against a SIBLING slot: stacking between slots (e.g. a raised column above a panel sliding
   * left behind it) must be set HERE, on the slot, not on what renders inside it. Defaults to 0.
   */
  zIndex?: number;
  /** False: the slot's enter and exit take no time. Default true. */
  animated?: boolean;
  /** The row's gap and this panel's slide; the library defaults when omitted. */
  gap?: number;
  slide?: SlideTuning;
  /** True while the panel is parked and its view stays mounted: the slot slides out, is hidden, and slides back in when shown. */
  kept?: boolean;
  /** Whether the row scrolls: a park then exits relative to this slot's rest. Default false. */
  rowScroll?: boolean;
  /** True while a sideways drag previews the reorder: under Reduce Motion the slot's own moves then snap, since a preview-time slide carries no information. */
  previewing?: boolean;
  /** Called when a press or focus lands anywhere inside the slot, a portaled descendant included (React capture handlers follow the React tree). */
  onActivate?: () => void;
  /** True for the slot whose box is being dragged: its rest moving during the preview is the drop, which lands at once whatever the motion setting. */
  dragged?: boolean;
  /** The panel rendered inside the slot. */
  children: React.ReactNode;
}) {
  const { initial, animate: animateTarget, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection, animated, gap, slide, rowScroll);
  const el = React.useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotionConfig();
  // The drag box reads the system preference itself, so the neighbours that make room for it must too, whatever the app's MotionConfig says.
  const systemReduced = useReducedMotion();
  // A press or key inside an iframe never reaches the page's own handlers; the page's window loses focus to the iframe element instead.
  const activate = React.useRef(onActivate);
  activate.current = onActivate;
  React.useEffect(() => {
    const onWindowBlur = (): void => {
      const focused = document.activeElement;
      if (focused instanceof HTMLIFrameElement && el.current?.contains(focused)) activate.current?.();
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, []);
  const ownSpan = width + (gap ?? ROW_GAP);
  const parkSide = exitDirection === 'right' ? 'right' : 'left';
  const slideTransition = animated && !reducedMotion ? transition : INSTANT_TRANSITION;
  const snapping = previewing && (reducedMotion || systemReduced || dragged);
  // `epoch` counts parks, so a finished exit from an earlier park can never hide the slot of a later one.
  const [wasKept, setWasKept] = React.useState(kept);
  const [epoch, setEpoch] = React.useState(0);
  const [settledEpoch, setSettledEpoch] = React.useState(0);
  const [reviving, setReviving] = React.useState(false);
  if (kept !== wasKept) {
    setWasKept(kept);
    setReviving(!kept);
    if (kept) setEpoch(epoch + 1);
  }
  const hidden = kept && epoch > 0 && settledEpoch === epoch;
  const sideAtPark = React.useRef<'left' | 'right'>('left');
  // The slides start in passive effects: motion's own pass over a changed `animate` prop runs in the child's passive
  // effect, and one that ran after ours would stop the slide.
  // Hidden follows the animation's own promise, never a timer or onAnimationComplete, so a zero-length slide still hides.
  React.useEffect(() => {
    if (!kept || el.current === null) return undefined;
    sideAtPark.current = parkSide;
    const run = slotDriver.animate(el.current, parkExitTarget(leftOffset, ownSpan, parkSide, rowScroll), slideTransition);
    let cancelled = false;
    void run.finished.then(() => {
      if (!cancelled) setSettledEpoch(epoch);
    });
    return () => {
      cancelled = true;
      run.stop();
    };
  }, [kept, epoch]);
  // The jump is a layout effect so the revived slot is never painted at its rest before it starts from its enter side.
  React.useLayoutEffect(() => {
    if (!reviving || el.current === null) return;
    const start = enterStart(leftOffset, ownSpan, enterDirection);
    const at = slotDriver.read(el.current);
    // A park that left toward another side, or at another x, would otherwise slide in from the wrong place.
    if (sideAtPark.current !== enterDirection || at === undefined || at.x !== start.x) slotDriver.set(el.current, start);
  }, [reviving]);
  React.useEffect(() => {
    if (!reviving || el.current === null) return undefined;
    const run = slotDriver.animate(el.current, { x: leftOffset, opacity: 1 }, slideTransition);
    let cancelled = false;
    void run.finished.then(() => {
      if (!cancelled) setReviving(false);
    });
    return () => {
      cancelled = true;
      run.stop();
    };
  }, [reviving]);
  // React 19.2 re-runs effect cleanup and setup for a keyed child a reorder moves, and Motion's cleanup stops the slide this
  // slot was making toward its new rest; nothing then starts it again, so the slot stays where it was.
  // A drop under Reduce Motion lands here too: the moved slot's own slide is re-started with the preview's instant transition.
  const restNow = React.useRef({ leftOffset, transition: snapping ? INSTANT_TRANSITION : slideTransition });
  restNow.current = { leftOffset, transition: snapping ? INSTANT_TRANSITION : slideTransition };
  const setUpBefore = React.useRef(false);
  const present = useIsPresent();
  // The drop's new rest lands in the commit that changes it, in the same frame as the dragged box's own offset going to 0: a snap that waited
  // for Motion's next frame would draw the box a frame at the old slot.
  const lastRest = React.useRef(leftOffset);
  React.useLayoutEffect(() => {
    const moved = lastRest.current !== leftOffset;
    lastRest.current = leftOffset;
    if (moved && snapping && el.current !== null && !kept && !reviving && present) slotDriver.set(el.current, { x: leftOffset, opacity: 1 });
  });
  React.useEffect(() => {
    if (!setUpBefore.current) {
      setUpBefore.current = true;
      return;
    }
    if (el.current === null || kept || reviving || !present) return;
    slotDriver.animate(el.current, { x: restNow.current.leftOffset, opacity: 1 }, restNow.current.transition);
  }, []);
  return (
    <motion.div
      ref={el}
      // Enters from one own-width-plus-gap span beyond its destination, right or left per `enterDirection` above.
      // Dropping `animate` alone would send the slot back to `initial`; with both gone it stays where it is, for the imperative slide.
      initial={kept || reviving ? undefined : initial}
      animate={kept || reviving ? undefined : snapping ? { ...animateTarget, transition: INSTANT_TRANSITION } : animateTarget}
      exit={kept ? KEPT_EXIT : exit}
      transition={transition}
      inert={kept ? true : undefined}
      aria-hidden={hidden ? true : undefined}
      data-row-slot={leftOffset}
      data-row-id={panelId}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      style={{
        position: 'absolute',
        top: top ?? 0,
        ...(height === undefined ? { bottom: 0 } : { height }),
        left: 0,
        // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
        width,
        zIndex: zIndex ?? 0,
        ...(hidden ? { display: 'none' } : {}),
      }}
    >
      <PanelHiddenContext.Provider value={hidden}>{children}</PanelHiddenContext.Provider>
    </motion.div>
  );
}

/**
 * The element a resize animates: an INNER box, never the slot, which owns `exit` (Motion's docs warn against
 * `layout` and `exit` on one element). A layout animation sets the real size once and animates a transform
 * toward it, so the view never re-lays out mid-resize; `layout="size"` because the slot's `x` already animates
 * position. A view renders it inside its own slot, so a view that never resizes needs no wrapper.
 * Under Reduce Motion, or for a panel whose `animated` setting is false, the resize snaps.
 * @public
 */
export function PanelSizeBox({
  width,
  height,
  children,
}: {
  /** The box's width in px; a change animates. */
  width: number;
  /** The box's height in px; a change animates. */
  height: number;
  /** The content, laid out at the new size at once. */
  children: React.ReactNode;
}) {
  const slot = React.useContext(PanelSlotContext);
  const slide = slot?.tuning.slide;
  // The system preference is read too: a theme's MotionConfig may not carry it, and a resize must snap under Reduce Motion either way.
  const configReduced = useReducedMotionConfig() === true;
  const systemReduced = useReducedMotion() === true;
  const snaps = configReduced || systemReduced || slot?.animated === false;
  return (
    <motion.div data-panel-size-box="" layout="size" transition={snaps ? INSTANT_TRANSITION : slide === undefined ? PANEL_TRANSITION : slideToTransition(slide)} style={{ width, height }}>
      {children}
    </motion.div>
  );
}
