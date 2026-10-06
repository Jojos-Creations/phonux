/**
 * The enter/exit timing, easing and opacity every animated slot shares, so a live panel and a History row
 * slide with one feel. A plain function, not a hook: it holds no state and calls no hook, so a test calls it
 * directly. Why it shares a preset and not the position math: DESIGN.md, "The test fakes are a subpath;
 * `directionalTransition` is not exported".
 */
import type { TargetAndTransition } from 'motion/react';
import type { SlideTuning } from './panelSettings.js';
import { SLIDE_DURATION_SEC, SLIDE_EASE } from './rowConstants.js';

/** The one enter/exit timing/easing every animated slot in the app shares. Motion wants the cubic-bezier as a fixed 4-tuple. @internal */
export const SLOT_TRANSITION: { duration: number; ease: [number, number, number, number] } = {
  duration: SLIDE_DURATION_SEC,
  ease: [SLIDE_EASE[0], SLIDE_EASE[1], SLIDE_EASE[2], SLIDE_EASE[3]],
};

/**
 * The Motion transition for a slide tuning. The shared SLOT_TRANSITION itself while the duration and the four ease
 * numbers are the defaults, so a host animating its own row by that reference still matches an untuned panel;
 * otherwise a fresh object, its ease copied because the tuning's is read-only. The close exit is not part of a transition.
 * @public
 */
export function slideToTransition(slide: SlideTuning): { duration: number; ease: [number, number, number, number] } {
  const [x1, y1, x2, y2] = slide.ease;
  if (slide.durationSec === SLIDE_DURATION_SEC && x1 === SLIDE_EASE[0] && y1 === SLIDE_EASE[1] && x2 === SLIDE_EASE[2] && y2 === SLIDE_EASE[3]) return SLOT_TRANSITION;
  return { duration: slide.durationSec, ease: [x1, y1, x2, y2] };
}

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
export function directionalTransition(axis: TransitionAxis, rest: number, distance: number, transition: typeof SLOT_TRANSITION = SLOT_TRANSITION): DirectionalTransition {
  return {
    transition,
    initial: withAxis(axis, rest + distance, 0),
    animate: withAxis(axis, rest, 1),
    exit: withAxis(axis, rest - distance, 0),
  };
}
