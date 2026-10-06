import * as React from 'react';
import { motion, type TargetAndTransition } from 'motion/react';
import { SLOT_TRANSITION, directionalTransition, slideToTransition } from './directionalTransition.js';
import { PanelSlotContext } from './panelSlotContext.js';
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
  readonly initial: TargetAndTransition;
  readonly animate: TargetAndTransition;
  readonly exit: TargetAndTransition;
  readonly transition: typeof PANEL_TRANSITION | typeof INSTANT_TRANSITION;
}

/** What an `animated: false` slot moves with: the same targets, no time taken. */
const INSTANT_TRANSITION = { duration: 0 } as const;

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
      ? { x: rest, y: phoneHeight, opacity: 0, transition: animated ? { duration: slide.closeExitSeconds, ease: 'easeIn' } : INSTANT_TRANSITION }
      : exitDirection === 'right'
        ? { x: rest + ownSpan, opacity: 0 }
        : { x: -ownSpan, opacity: 0 };
  return { initial, animate, exit, transition };
}

/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @internal
 */
export function PanelRowSlot({
  leftOffset,
  width,
  phoneHeight,
  enterDirection,
  exitDirection,
  zIndex,
  animated = true,
  gap,
  slide,
  children,
}: {
  /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
  leftOffset: number;
  /** This panel's own width (`panelWidthOf`), also this slot's enter/exit travel distance (`panelRowSlotMotion`'s `ownSpan`). */
  width: number;
  phoneHeight: number;
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
  children: React.ReactNode;
}) {
  const { initial, animate, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection, animated, gap, slide);
  return (
    <motion.div
      // Enters from one own-width-plus-gap span beyond its destination, right or left per `enterDirection` above.
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
        width,
        zIndex: zIndex ?? 0,
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The element a resize animates: an INNER box, never the slot, which owns `exit` (Motion's docs warn against
 * `layout` and `exit` on one element). A layout animation sets the real size once and animates a transform
 * toward it, so the view never re-lays out mid-resize; `layout="size"` because the slot's `x` already animates
 * position. A view renders it inside its own slot, so a view that never resizes needs no wrapper.
 * @public
 */
export function PanelSizeBox({ width, height, children }: { width: number; height: number; children: React.ReactNode }) {
  const slide = React.useContext(PanelSlotContext)?.tuning.slide;
  return (
    <motion.div data-panel-size-box="" layout="size" transition={slide === undefined ? PANEL_TRANSITION : slideToTransition(slide)} style={{ width, height }}>
      {children}
    </motion.div>
  );
}
