// Pictures the live panels when the grid opens, and again once scrolling settles. A panel that the scroll moves past is
// faded or hidden mid-scroll, so pictures taken during the scroll would be wrong; waiting for the scroll to stop avoids that.
import * as React from 'react';
/** Gap between two pictures in one round. Each capture clones and restyles its panel on the main thread; a batch started in one tick would hold the page for the whole batch. */
const CAPTURE_STAGGER_MS = 10;
const DEFAULT_SETTLE_MS = 150;
/**
 * Pictures every live panel when `open` turns on, then once more after the document stops scrolling. Scroll events
 * within `settleMs` of each other count as one scroll, so a long scroll costs one round, not one per frame.
 * @public
 */
export function useRecaptureOnSettle(trigger, options) {
    const { open, settleMs = DEFAULT_SETTLE_MS } = options;
    const liveIdsRef = React.useRef(options.liveIds);
    liveIdsRef.current = options.liveIds;
    React.useEffect(() => {
        if (!open)
            return;
        let stop = captureStaggered(trigger, liveIdsRef.current());
        let settle;
        const onScroll = () => {
            clearTimeout(settle);
            settle = setTimeout(() => {
                stop();
                stop = captureStaggered(trigger, liveIdsRef.current());
            }, settleMs);
        };
        // Capture phase, so a scroll inside any panel's own scroll box is seen (scroll events do not bubble).
        document.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('scroll', onScroll, true);
            clearTimeout(settle);
            stop();
        };
    }, [open, settleMs, trigger]);
}
/** Captures `ids` in order, each one `CAPTURE_STAGGER_MS` after the previous. Returns what stops the ones not yet started. */
function captureStaggered(trigger, ids) {
    let timer;
    const start = (index) => {
        const id = ids[index];
        if (id === undefined)
            return;
        trigger.capture(id);
        if (index + 1 < ids.length)
            timer = setTimeout(() => { start(index + 1); }, CAPTURE_STAGGER_MS);
    };
    start(0);
    return () => { clearTimeout(timer); };
}
