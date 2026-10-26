import { SLIDE_DURATION_SEC, SLIDE_EASE } from './rowConstants.js';
/** The one enter/exit timing/easing every animated slot in the app shares. Motion wants the cubic-bezier as a fixed 4-tuple. @internal */
export const SLOT_TRANSITION = {
    duration: SLIDE_DURATION_SEC,
    ease: [SLIDE_EASE[0], SLIDE_EASE[1], SLIDE_EASE[2], SLIDE_EASE[3]],
};
/**
 * The Motion transition for a slide tuning. The shared SLOT_TRANSITION itself while the duration and the four ease
 * numbers are the defaults, so a host animating its own row by that reference still matches an untuned panel;
 * otherwise a fresh object, its ease copied because the tuning's is read-only. The close exit is not part of a transition.
 * @public
 */
export function slideToTransition(slide) {
    const [x1, y1, x2, y2] = slide.ease;
    if (slide.durationSec === SLIDE_DURATION_SEC && x1 === SLIDE_EASE[0] && y1 === SLIDE_EASE[1] && x2 === SLIDE_EASE[2] && y2 === SLIDE_EASE[3])
        return SLOT_TRANSITION;
    return { duration: slide.durationSec, ease: [x1, y1, x2, y2] };
}
function withAxis(axis, value, opacity) {
    return axis === 'x' ? { x: value, opacity } : { y: value, opacity };
}
/**
 * Enter/exit values for one card sliding along `axis`. `rest` is its settled position (0 in normal flow, as a
 * History row; `index * slotWidth` when absolutely positioned, as a live panel). `distance` is how far past
 * `rest` it starts when entering, and it leaves to the opposite side. It is signed: a positive `distance`
 * enters from the positive-`axis` side (the right, or below), a negative one from the left, or above.
 * @internal
 */
export function directionalTransition(axis, rest, distance, transition = SLOT_TRANSITION) {
    return {
        transition,
        initial: withAxis(axis, rest + distance, 0),
        animate: withAxis(axis, rest, 1),
        exit: withAxis(axis, rest - distance, 0),
    };
}
