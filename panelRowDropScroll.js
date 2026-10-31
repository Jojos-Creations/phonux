/**
 * The hold a drag takes on the row scroller and the one frame of edge scrolling it runs: shared by the header drag
 * (DragToClose) and the row-drop hook, so both scroll at the row edges by the same numbers.
 */
import { edgeScrollSpeed, edgeScrollStep } from './edgeScroll.js';
import { rowScrollerFor } from './rowScroller.js';
import { stepTarget } from './scrollTargets.js';
/** Takes the claim on `scrollerEl`'s scroller for a drag that counts its scroll from `startScroll`; null while another drag holds it. */
export function openEdgeHold(scrollerEl, startScroll, slot, keepId) {
    const scroller = rowScrollerFor(scrollerEl);
    const claim = scroller.claim();
    if (claim === null)
        return null;
    claim.setMaxScroll(slot.maxScroll);
    return { scroller, scrollerEl, claim, startScroll, began: { zonePx: slot.zonePx, maxPxPerSec: slot.maxPxPerSec, reducedStepMs: slot.reducedStepMs }, frame: null, lastMs: null, waitedMs: 0, stopped: false, keepId, cycleWaitMs: 0 };
}
/** One frame: scrolls the row for a pointer at `pointerX`, by speed or, under reduced motion, by a jump to the next stop after the wait. */
export function stepEdgeHold(h, nowMs, pointerX, slot, reduceMotion) {
    const dt = h.lastMs === null ? 0 : nowMs - h.lastMs;
    h.lastMs = nowMs;
    const bound = slot.maxScroll;
    h.claim.setMaxScroll(bound);
    const rect = h.scrollerEl.getBoundingClientRect();
    // The band is the strip's window: a held panel's edge group covers the scroller's ends, so a pointer over it does not scroll the row.
    // A panel no drag may cross at the row's start (the root) moves the left band onto its own right edge.
    const left = Math.max(rect.left + (slot.insetLeft ?? 0), (slot.barrierRight?.() ?? Number.NEGATIVE_INFINITY) - h.began.zonePx);
    const speed = edgeScrollSpeed({ pointerX, left, right: rect.right - (slot.insetRight ?? 0), zonePx: h.began.zonePx, maxPxPerSec: h.began.maxPxPerSec });
    const at = h.scroller.scrollLeft();
    const stuck = speed < 0 ? at <= 0.5 : speed > 0 && at >= bound - 0.5;
    // Past the scroll's end, the band swaps hidden panels in, one per slide, so each lands before the next starts.
    if (stuck && slot.cycle !== undefined && h.keepId !== undefined) {
        h.cycleWaitMs += dt;
        if (h.cycleWaitMs >= slot.settleSec * 1000) {
            h.cycleWaitMs = 0;
            slot.cycle(speed < 0 ? 'left' : 'right', h.keepId);
        }
        return;
    }
    h.cycleWaitMs = 0;
    if (reduceMotion) {
        h.waitedMs = speed === 0 ? 0 : h.waitedMs + dt;
        if (h.waitedMs >= h.began.reducedStepMs) {
            h.waitedMs = 0;
            const to = stepTarget(speed < 0 ? 'left' : 'right', at, slot.stops, bound);
            if (to !== null)
                h.claim.write(to);
        }
    }
    else if (speed !== 0) {
        const step = edgeScrollStep({ speed, dtMs: dt, scrollLeft: at, maxScroll: bound });
        if (step !== 0)
            h.claim.write(at + step);
    }
}
/** Gives the claim back and returns how far the row scrolled since the hold began; a release settles on the nearest whole-panel stop when the row has stops. */
export function endEdgeHold(h, slot, reduceMotion, settle = true) {
    if (h.frame !== null)
        cancelAnimationFrame(h.frame);
    h.frame = null;
    const distance = h.scroller.scrollLeft() - h.startScroll;
    h.claim.release();
    if (settle && slot !== undefined && slot.settleStops.length > 0) {
        const at = h.scroller.scrollLeft();
        const to = slot.settleStops.reduce((best, stop) => (Math.abs(stop - at) < Math.abs(best - at) ? stop : best));
        if (Math.abs(to - at) >= 0.5)
            h.scroller.glideTo(to, { durationSec: slot.settleSec, instant: reduceMotion, ease: slot.settleEase });
    }
    return distance;
}
