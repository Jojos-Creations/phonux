import * as React from 'react';
import { motion, type TargetAndTransition } from 'motion/react';
import { DRAG_CLOSE } from 'phonux';
import { SLOT_TRANSITION, directionalTransition } from 'phonux/internal/directionalTransition';

/** The one spacing value used everywhere a gap is needed in this row. */
export const GAP = 16;
/** The timing/easing every panel slide uses, shared with History's rows via
 * shared/phone/directionalTransition.ts. Re-exported under the old name:
 * row/useRowShell.ts and test/row-shell-style.test.ts key off THIS binding
 * (`transition: PANEL_TRANSITION`) to read the row's own recenter animation as
 * "the same motion as a panel"; it is the SAME object as SLOT_TRANSITION, not a
 * copy, so that reference-equality check keeps working. */
export const PANEL_TRANSITION = SLOT_TRANSITION;

/**
 * One live panel's animated slot.
 *
 * Panels are positioned PER ITEM, not as one translated strip: each sits
 * absolutely at its own `leftOffset` (the caller's running sum of every PRECEDING
 * item's own width plus one gap), so adding, removing or resizing one never
 * disturbs the panels to its left.
 *
 * `x` (a transform), not `left`, so the browser can composite it rather than
 * re-laying-out every frame.
 *
 * Motion (npm `motion`) rather than a hand-rolled FLIP: React unmounts a
 * removed panel in the same commit that adds the new one, so there is no
 * moment at which a plain exit animation could run -- AnimatePresence
 * intercepts the removal and keeps the outgoing node mounted until its
 * `exit` finishes.
 *
 * It is also immune to theme.ts's global `transition/animation: none
 * !important` reset: Motion never writes `style.transition` or
 * `style.animation` -- `exit`/`animate` run through the Web Animations API
 * (`element.animate()`, which that CSS cannot reach) and layout changes run
 * through Motion's own rAF loop writing inline transforms. That reset must
 * stay scoped to `transition`/`animation` (test/theme-motion-reset.test.ts
 * pins it) -- covering `transform` or `opacity` too would kill both of
 * Motion's paths at once, silently.
 *
 * A resize animates in place on an INNER box (`data-panel-size-box`), never on
 * the slot itself: the slot owns `exit`, and Motion's own docs warn against
 * `layout` and `exit` on one element. That inner box is Motion `layout="size"`
 * (a FLIP resize, measured in the real tree before this shipped); "size" so a
 * position change snaps there, since the slot's own `x` already animates it.
 *
 * One caller, LivePanels.tsx, uses this for every PRESENT entry of the one
 * panel list -- History and every live web panel alike, each "one item,
 * absolutely positioned at its own `leftOffset`" inside that caller's one
 * reserved-width Box. `leftOffset` and `width` are the entry's own position
 * and own size in that list, so this component itself never needs to know
 * which kind of entry it is rendering, nor whether every entry shares one
 * width.
 *
 * `enterDirection` is computed by the CALLER from the anchor-panel formula
 * (anchorPanel.ts's `resolveEnterDirection`) -- never a bare hardcoded
 * 'left'/'right' here -- and, like `exitDirection`, must be correct on THIS
 * component's FIRST render after the item (re)appears (AnimatePresence has
 * no later render of a fresh mount to fix a wrong guess).
 *
 * A CLOSE (History's hover-trash, or DragToClose) slides down; a park (hidden
 * by opening or reviving another panel, by the row's own scroll gesture, or
 * by a capacity drop) slides left or right, off the row edge it was hidden
 * past -- so a close always reads as visually distinct from a park, whichever
 * side the park picks. `exitDirection` (LivePanels.tsx computes it from `closingIds` and
 * `exitRightIds`) picks between the three:
 *   - 'down': timed/eased to DragToClose's own downward exit
 *     (`DRAG_CLOSE.exitSeconds`/`easeIn`, dragToClose.tsx) via a per-variant
 *     `transition` override, so trash and drag closes read as one motion.
 *     DragToClose itself needs no change: its own `y` animation finishes and
 *     calls `onClose` BEFORE this exit starts, so the two run in sequence --
 *     this exit's `y` ramps in underneath a box already off-screen,
 *     invisibly, not fighting it (no snap, no jump).
 *   - 'left': `x: -ownSpan` on plain `PANEL_TRANSITION` -- a park off the row's
 *     own left edge (the default for every park not marked right); `ownSpan`
 *     (this panel's own width plus one gap) so a wide panel clears far enough
 *     to be fully off-screen, not just one uniform slot.
 *   - 'right': `x: rest + ownSpan` -- the mirror, off the right edge (an
 *     `insertAt: 'start'` open, a revive left of the range, a leftward gesture).
 *
 * `exitDirection` MUST be correct on THIS component's LAST render before it
 * leaves the `live`-filtered array -- AnimatePresence has no later render of
 * a removed child to fix a wrong guess (see LivePanels.tsx's own comment).
 */
export interface PanelSlotMotion {
  readonly initial: TargetAndTransition;
  readonly animate: TargetAndTransition;
  readonly exit: TargetAndTransition;
  readonly transition: typeof PANEL_TRANSITION;
}

type ExitDirection = 'down' | 'left' | 'right';

/**
 * The pure values behind one LivePanelSlot render, split out of the component
 * so a test can assert exact motion values for both exit directions without
 * mounting a component or reading computed style. `initial`/`animate` come
 * from the shared preset (both are expressible as "distance from rest" --
 * rest = `leftOffset`, the caller's own running sum, enter one `ownSpan`
 * further along `x`); `exit` stays entirely local: 'down' needs a second axis
 * and a different transition, 'left' needs a target that is independent of
 * `leftOffset`, and neither fits directionalTransition's symmetric default.
 */
export function panelSlotMotion(
  leftOffset: number,
  width: number,
  phoneHeight: number,
  enterDirection: 'left' | 'right',
  exitDirection: ExitDirection,
): PanelSlotMotion {
  // This panel's OWN footprint (its width plus one gap) is how far it must travel to clear the row edge --
  // a wider panel needs to travel further than a uniform `slot` would have, so this can no longer be one
  // value shared by every item.
  const ownSpan = width + GAP;
  const rest = leftOffset;
  // Positive distance enters from the right (directionalTransition.ts's own sign convention); a negative
  // one enters from the left -- see anchorPanel.ts for who decides which.
  const enterDistance = enterDirection === 'left' ? -ownSpan : ownSpan;
  const { initial, animate, transition } = directionalTransition('x', rest, enterDistance);
  const exit: TargetAndTransition =
    exitDirection === 'down'
      ? { x: rest, y: phoneHeight, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }
      : exitDirection === 'right'
        ? { x: rest + ownSpan, opacity: 0 }
        : { x: -ownSpan, opacity: 0 };
  return { initial, animate, exit, transition };
}

export function LivePanelSlot({
  leftOffset,
  width,
  phoneHeight,
  enterDirection,
  exitDirection,
  zIndex,
  children,
}: {
  /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
  leftOffset: number;
  /** This panel's own width (panelWindow.ts's `panelWidthOf`) -- also this slot's own enter/exit travel distance (see `panelSlotMotion`'s `ownSpan`). */
  width: number;
  phoneHeight: number;
  /** Computed by the caller (anchorPanel.ts's `resolveEnterDirection`, or an explicit gesture side), never a bare literal picked here. */
  enterDirection: 'left' | 'right';
  exitDirection: ExitDirection;
  /**
   * Each slot's own `motion.div` is a `transform`-bearing element, which establishes its OWN CSS stacking
   * context -- a child's `zIndex` can no longer escape it to compare against a SIBLING slot. Stacking order
   * between slots (e.g. History always above a web panel sliding left behind it) must therefore be set
   * HERE, on the slot itself, not on whatever renders inside it. Defaults to 0 (no caller currently needs
   * more than two tiers).
   */
  zIndex?: number;
  children: React.ReactNode;
}) {
  const { initial, animate, exit, transition } = panelSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection);
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
        width,
        zIndex: zIndex ?? 0,
      }}
    >
      {/* A flex row, so the view's root stretches to this box's height and a 'fill' tier's percentage height resolves. */}
      <motion.div data-panel-size-box="" layout="size" transition={transition} style={{ display: 'flex', width, height: '100%' }}>
        {children}
      </motion.div>
    </motion.div>
  );
}
