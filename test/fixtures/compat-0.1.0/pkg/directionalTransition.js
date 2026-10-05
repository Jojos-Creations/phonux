/** Seconds, tuned by eye (0.26 read as too fast); one value for every slot, so no copy can drift. */
const TRANSITION_SEC = 0.4;
/** Motion wants a cubic-bezier as a fixed 4-tuple, not a plain number[]. */
const TRANSITION_EASE = [0.2, 0, 0, 1];
/** The one enter/exit timing/easing every animated slot in the app shares. @internal */
export const SLOT_TRANSITION = { duration: TRANSITION_SEC, ease: TRANSITION_EASE };
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
export function directionalTransition(axis, rest, distance) {
    return {
        transition: SLOT_TRANSITION,
        initial: withAxis(axis, rest + distance, 0),
        animate: withAxis(axis, rest, 1),
        exit: withAxis(axis, rest - distance, 0),
    };
}
