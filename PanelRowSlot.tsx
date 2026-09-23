import * as React from 'react';
import { motion, type TargetAndTransition } from 'motion/react';
import { DRAG_CLOSE } from '../../shared/phone/dragToClose.js';
import { SLOT_TRANSITION, directionalTransition } from '../../shared/phone/directionalTransition.js';

/** The one spacing value used everywhere a gap is needed in this row. */
export const GAP = 16;
/** The timing/easing every panel slide uses, now shared with History's rows
 * (ux-history-column-card-transitions) via shared/phone/directionalTransition.ts
 * -- see that file for the tuning history. Re-exported under the old name:
 * row/useRowShell.ts and test/row-shell-style.test.ts key off THIS binding
 * (`transition: PANEL_TRANSITION`) to read the row's own recenter animation as
 * "the same motion as a panel"; it is the SAME object as SLOT_TRANSITION, not a
 * copy, so that reference-equality check keeps working unchanged. */
export const PANEL_TRANSITION = SLOT_TRANSITION;

/**
 * One live panel's animated slot.
 *
 * Owner design, 2026-09-15: panels are positioned PER ITEM (the model
 * Chromium's own tab strip uses -- BoundsAnimator animates each view's bounds
 * individually -- rather than translating the whole strip as one unit, which
 * suits continuous carousels instead). Each panel sits absolutely at x =
 * index * (phoneWidth + GAP), so adding or removing one never disturbs the
 * fixed sidebar/chat/adventure-card cluster to its left.
 *
 * `x` (a transform), not `left`, so the browser can composite it rather than
 * re-laying-out every frame.
 *
 * Motion (npm `motion`) rather than a hand-rolled FLIP, for one specific
 * reason: React unmounts a removed panel in the same commit that adds the new
 * one, so there is no moment at which an exit animation could run.
 * AnimatePresence (the caller) intercepts the removal and keeps the outgoing
 * node mounted until its `exit` finishes, which is the entire bug.
 *
 * It is also immune to theme.ts's global `transition/animation: none
 * !important` reset: Motion never writes `style.transition` or
 * `style.animation` -- `exit`/`animate` run through the Web Animations API
 * (`element.animate()`, which that CSS cannot reach) and layout changes run
 * through Motion's own rAF loop writing inline transforms. NOTE for whoever
 * edits theme.ts: keep that reset scoped to `transition` and `animation`. If
 * it ever grows to cover `transform` or `opacity` with `!important`, it kills
 * both of Motion's paths at once, silently.
 *
 * ux-reveal-direction-and-fixed-column-animation: generalized to serve a second
 * caller, FixedColumns.tsx (the row's fixed columns -- History today), not just
 * LivePanels.tsx's live webview panels -- both are "one item, absolutely
 * positioned at `index * (phoneWidth + GAP)` inside a reserved-width Box,"
 * differing only in WHICH array they come from and WHY they enter/exit. `index`
 * is always relative to the caller's OWN Box, never a whole-row offset (each
 * caller reserves its own width the same way LivePanels.tsx's Box does), so
 * this component itself never needs to know about the other caller's items.
 *
 * `enterDirection` (new, mirroring `exitDirection` below) is computed by the
 * CALLER from the anchor-panel formula (anchorPanel.ts's `resolveEnterDirection`)
 * -- never a bare hardcoded 'left'/'right' here -- and, like `exitDirection`,
 * must be correct on THIS component's FIRST render after the item (re)appears
 * (AnimatePresence has no later render of a fresh mount to fix a wrong guess).
 *
 * Owner, 2026-09-22, two decisions the same day: a CLOSE (History's
 * hover-trash, or DragToClose) should slide down, not left; an auto-collapse
 * to parked (usePanelManager.ts's collapseOldestIds/autoCollapseOldest -- the
 * row overflowed, nothing was closed) must stay doing what it always did,
 * `x: -slot` behind the adventure card, so the two remain visually distinct.
 * `exitDirection` (LivePanels.tsx/FixedColumns.tsx each compute it from their
 * OWN usePanelClosing instance's `closingIds`) picks between them:
 *   - 'down': timed/eased to DragToClose's own downward exit
 *     (`DRAG_CLOSE.exitSeconds`/`easeIn`, dragToClose.tsx) via a per-variant
 *     `transition` override, so trash and drag closes read as one motion.
 *     DragToClose itself needs no change: its own `y` animation finishes and
 *     calls `onClose` BEFORE this exit starts, so the two run in sequence --
 *     this exit's `y` ramps in underneath a box already off-screen,
 *     invisibly, not fighting it (no snap, no jump).
 *   - 'left': the original `x: -slot` on plain `PANEL_TRANSITION`, restored
 *     verbatim (no DragToClose involvement to time against: nothing closed).
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

/**
 * The pure values behind one LivePanelSlot render, split out of the component
 * so a test can assert the ux-history-column-card-transitions refactor (which
 * introduced directionalTransition.ts) produced EXACTLY the pre-refactor
 * numbers, for both exit directions, without mounting a component or reading
 * computed style. `initial`/`animate` come from the shared preset (both were
 * already expressible as "distance from rest" -- rest = `index * slot`, enter
 * one slot further along `x`); `exit` stays entirely local, per this file's
 * own header: 'down' needs a second axis and a different transition,
 * 'left' needs a target that is independent of `index`, and neither fits
 * directionalTransition's symmetric default.
 */
export function panelSlotMotion(
  index: number,
  phoneWidth: number,
  phoneHeight: number,
  enterDirection: 'left' | 'right',
  exitDirection: 'down' | 'left',
): PanelSlotMotion {
  const slot = phoneWidth + GAP;
  const rest = index * slot;
  // Positive distance enters from the right (directionalTransition.ts's own sign convention); a negative
  // one enters from the left -- see anchorPanel.ts for who decides which.
  const enterDistance = enterDirection === 'left' ? -slot : slot;
  const { initial, animate, transition } = directionalTransition('x', rest, enterDistance);
  const exit: TargetAndTransition =
    exitDirection === 'down'
      ? { x: rest, y: phoneHeight, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }
      : { x: -slot, opacity: 0 };
  return { initial, animate, exit, transition };
}

export function LivePanelSlot({
  index,
  phoneWidth,
  phoneHeight,
  enterDirection,
  exitDirection,
  children,
}: {
  index: number;
  phoneWidth: number;
  phoneHeight: number;
  /** ux-reveal-direction-and-fixed-column-animation: computed by the caller (anchorPanel.ts's `resolveEnterDirection`), never a bare literal picked here. */
  enterDirection: 'left' | 'right';
  exitDirection: 'down' | 'left';
  children: React.ReactNode;
}) {
  const { initial, animate, exit, transition } = panelSlotMotion(index, phoneWidth, phoneHeight, enterDirection, exitDirection);
  return (
    <motion.div
      // Enters from one slot beyond its destination, right or left per `enterDirection` above.
      initial={initial}
      animate={animate}
      exit={exit}
      transition={transition}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: phoneWidth,
      }}
    >
      {children}
    </motion.div>
  );
}
