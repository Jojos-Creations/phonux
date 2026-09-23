import * as React from 'react';
import { motion } from 'motion/react';
import { DRAG_CLOSE } from '../../shared/phone/dragToClose.js';

/** The one spacing value used everywhere a gap is needed in this row. */
export const GAP = 16;
/** Duration (seconds -- Motion's unit) for the panel slide animations. Was
 * 3 (deliberately slow for testing, owner ask, 2026-09-15) while the
 * mechanics were confirmed live; 0.26 (Chromium tab-strip BoundsAnimator
 * territory) read as too fast once seen at speed (owner report, same
 * session) -- 0.4 is the current happy medium. */
const PANEL_ANIM_SEC = 0.4;
/** Motion wants a cubic-bezier as a fixed 4-tuple, not a plain number[]. */
const PANEL_ANIM_EASE: [number, number, number, number] = [0.2, 0, 0, 1];
export const PANEL_TRANSITION = { duration: PANEL_ANIM_SEC, ease: PANEL_ANIM_EASE };

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
 * Owner, 2026-09-22: "Closing a panel from the history panel should slide it
 * down, not left." This is the one place that governed the History
 * hover-trash close's exit (it used to be `x: -slot`, a pure LEFT slide,
 * behind the adventure card). It now leaves DOWN instead, timed and eased to
 * match `DragToClose`'s (shared/phone/dragToClose.tsx) own downward exit
 * (`DRAG_CLOSE.exitSeconds`/`easeIn`), via a per-variant `transition` that
 * overrides `PANEL_TRANSITION` for this one animation only -- so both close
 * paths (trash icon, drag-down) now read as one motion.
 *
 * The drag-down path does NOT need to be touched for this: `DragToClose` runs
 * its OWN separate `y` animation on the box it wraps and only calls `onClose`
 * once that finishes (dragToClose.tsx's `onDragEnd`), so this slot's own exit
 * never starts until the box is already off-screen. The two compose in
 * sequence, not concurrently -- this exit's `y` motion value starts fresh
 * from 0 (it was never part of `initial`/`animate`) and ramps to
 * `phoneHeight` UNDERNEATH the already-off-screen box, so the extra motion is
 * invisible: no snap-back, no jump, just a continued (if redundant) descent
 * before the DOM node unmounts. Confirmed by reading both animations' values
 * together, not by guessing -- see the plan record's Handoff section.
 */
export function LivePanelSlot({
  index,
  phoneWidth,
  phoneHeight,
  children,
}: {
  index: number;
  phoneWidth: number;
  phoneHeight: number;
  children: React.ReactNode;
}) {
  const slot = phoneWidth + GAP;
  return (
    <motion.div
      // Enter from one slot beyond its destination, i.e. in from the right.
      initial={{ x: (index + 1) * slot, opacity: 0 }}
      animate={{ x: index * slot, opacity: 1 }}
      // Leave DOWNWARD (owner, 2026-09-22) by one phone-height -- the
      // vertical analogue of "-slot" -- fading out at the same time. Timed to
      // DragToClose's own exit (exitSeconds/easeIn), not PANEL_TRANSITION, so
      // a trash-close (which has no pre-animation of its own) reads at the
      // same speed as a drag-close's real, physical downward exit.
      exit={{ x: index * slot, y: phoneHeight, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }}
      transition={PANEL_TRANSITION}
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
