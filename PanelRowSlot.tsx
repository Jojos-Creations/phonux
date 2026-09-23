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
 * Owner, 2026-09-22: closing from History's hover-trash should slide down,
 * not left -- this was the one place still doing `x: -slot` (behind the
 * adventure card). Now exits DOWN, timed/eased to DragToClose's own downward
 * exit (`DRAG_CLOSE.exitSeconds`/`easeIn`, dragToClose.tsx) via a per-variant
 * `transition` that overrides `PANEL_TRANSITION` for just this animation, so
 * trash and drag closes read as one motion. DragToClose itself needs no
 * change: its own `y` animation finishes and calls `onClose` BEFORE this
 * exit starts, so the two run in sequence, not concurrently -- this exit's
 * `y` ramps in underneath a box that is already off-screen, invisibly, not
 * fighting it (no snap, no jump).
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
      // Leave DOWNWARD by one phone-height (owner, 2026-09-22) -- the vertical
      // analogue of "-slot" -- on DragToClose's own timing, not PANEL_TRANSITION.
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
