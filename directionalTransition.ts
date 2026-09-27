/**
 * The enter/exit timing, easing and opacity every animated slot shares, so a live panel and a History row
 * slide with one feel. A plain function, not a hook: it holds no state and calls no hook, so a test calls it
 * directly. Why it shares a preset and not the position math: DESIGN.md, "`directionalTransition` and the
 * test fakes are subpaths, not part of `.`".
 */
import type { TargetAndTransition } from 'motion/react';

/** Seconds, tuned by eye (0.26 read as too fast); one value for every slot, so no copy can drift. */
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
  /** The symmetric exit: `rest - distance` along `axis`, faded out. A caller with more than one exit
   * reason builds its own `exit` and takes only `transition`. */
  readonly exit: TargetAndTransition;
}

function withAxis(axis: TransitionAxis, value: number, opacity: 0 | 1): TargetAndTransition {
  return axis === 'x' ? { x: value, opacity } : { y: value, opacity };
}

/**
 * Enter/exit values for one card sliding along `axis`. `rest` is its settled position (0 in normal flow, as a
 * History row; `index * slotWidth` when absolutely positioned, as a live panel). `distance` is how far past
 * `rest` it starts when entering, and it leaves to the opposite side. It is signed: a positive `distance`
 * enters from the positive-`axis` side (the right, or below), a negative one from the left, or above.
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
