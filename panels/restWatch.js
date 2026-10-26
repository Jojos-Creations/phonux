/**
 * Watches a row until it has stood still, then reports where it rests. It adds no listener: the caller starts it from the
 * gestures it already hears. Plain frame callbacks, no React, so the hook that owns the row only supplies the reads.
 */
import { rowScrollerFor } from '../rowScroller.js';
export function createRestWatch(env) {
    let frame = null;
    const cancel = () => {
        if (frame !== null)
            cancelAnimationFrame(frame);
        frame = null;
    };
    const watch = (el, onRest) => {
        if (frame !== null)
            return;
        const scroller = rowScrollerFor(el);
        const start = scroller.scrollLeft();
        let last = start;
        let still = performance.now();
        let moved = false;
        const tick = () => {
            frame = null;
            const at = scroller.scrollLeft();
            const gliding = scroller.glideTarget() !== null;
            const now = performance.now();
            if (at !== start || gliding)
                moved = true;
            if (at !== last || gliding || scroller.claimHeld() || env.pointerHeld()) {
                last = at;
                still = now;
            }
            else if (now - still >= env.quietMs) {
                if (moved && env.settled())
                    onRest(at);
                return;
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
    };
    return { watch, cancel };
}
