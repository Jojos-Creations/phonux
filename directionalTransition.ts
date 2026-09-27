/**
 * The shared enter/exit "card slides in, slides out" contract every animated
 * slot in the app uses -- built for ux-history-column-card-transitions
 * (owner, 2026-09-22: "I want to be able to open panels in any direction with
 * the same smooth animation of the entering and exiting") by pulling the
 * timing out of LivePanelSlot.tsx (the right-side live panels, items 6/7) so
 * a second surface (History's rows, left side, HistoryRowSlot.tsx) shares the
 * exact same feel instead of a second hand-tuned constant someone has to
 * remember to keep in sync.
 *
 * A plain function, not a React hook (no "use" prefix): it holds no state and
 * calls no other hook, so nothing about it needs the rules-of-hooks calling
 * convention, and a test can call it directly outside a component the way an
 * actual hook could not be. (The plan record floated `useDirectionalTransition`
 * as one possible name; this file's own judgment call is to not imply hook
 * semantics for a pure computation -- see the session report.)
 *
 * What is genuinely shared between the two call sites is the timing/easing/
 * opacity CONTRACT, not the position math: LivePanelSlot positions panels
 * absolutely (`index * (phoneWidth + GAP)`) and needs two different EXIT
 * targets depending on why a panel left -- a close slides down (LivePanelSlot.tsx's
 * own header comment), an auto-collapse slides left to a FIXED spot behind the
 * sidebar, independent of the leaving panel's own index. History's rows sit in
 * normal document flow and have only one reason to leave (the trash button).
 * Forcing both through one generic `exit` shape would either lose LivePanelSlot's
 * index-independent auto-collapse target or grow a wrapper with conditionals
 * that do not apply to History -- the research record
 * (plans/records/ux-history-column-card-transitions.md) recommends against
 * exactly that (option 2: a shared preset, not a shared wrapper component).
 * So this function returns `initial`/`animate` (both call sites' ENTER is the
 * same shape: start `distance` past rest, faded out) plus the shared
 * `transition`, and a plain, symmetric `exit` for the ordinary case (what
 * History uses as-is); LivePanelSlot builds its own two exit variants and
 * takes only `transition` from here.
 */
import type { TargetAndTransition } from 'motion/react';

/** Duration (seconds) -- see LivePanelSlot.tsx's own header comment for the
 * tuning history (3s while confirming the mechanics live, 0.26s read as too
 * fast, 0.4s is the current happy medium); pulled here so every slot in the
 * app, present and future (Settings, once item 8 lands), uses the identical
 * value rather than a copy that could drift. */
const TRANSITION_SEC = 0.4;
/** Motion wants a cubic-bezier as a fixed 4-tuple, not a plain number[]. */
const TRANSITION_EASE: [number, number, number, number] = [0.2, 0, 0, 1];
/** The one enter/exit timing/easing every animated slot in the app shares. @internal */
export const SLOT_TRANSITION = { duration: TRANSITION_SEC, ease: TRANSITION_EASE };

/** @internal */
export type TransitionAxis = 'x' | 'y';

/** @internal */
export interface DirectionalTransition {
  readonly transition: typeof SLOT_TRANSITION;
  /** A motion.div's `initial`: `rest + distance` along `axis`, faded out. */
  readonly initial: TargetAndTransition;
  /** A motion.div's `animate`: `rest` along `axis`, faded in. */
  readonly animate: TargetAndTransition;
  /** The ordinary, symmetric exit: `rest - distance` along `axis` (the
   * opposite direction from the enter), faded out. Most callers (History's
   * rows) use this as-is; a caller with more than one exit reason builds its
   * own `exit` object and uses `transition` alone (see this file's header). */
  readonly exit: TargetAndTransition;
}

function withAxis(axis: TransitionAxis, value: number, opacity: 0 | 1): TargetAndTransition {
  return axis === 'x' ? { x: value, opacity } : { y: value, opacity };
}

/**
 * Direction-agnostic enter/exit values for one card sliding along `axis`.
 * `rest` is its settled position along that axis (0 for a normal-flow
 * element, e.g. a History row; `index * slotWidth` for an absolutely-
 * positioned one, e.g. a live panel). `distance` is how far PAST rest it
 * starts, entering (and, by default, ends up on the opposite side, leaving)
 * -- signed, so a positive `distance` enters from the positive-`axis`
 * direction (the right, or down) and a negative one enters from the negative
 * direction (the left, or up).
 * @internal
 */
export function directionalTransition(axis: TransitionAxis, rest: number, distance: number): DirectionalTransition {
  return {
    transition: SLOT_TRANSITION,
    initial: withAxis(axis, rest + distance, 0),
    animate: withAxis(axis, rest, 1),
    exit: withAxis(axis, rest - distance, 0),
  };
}
