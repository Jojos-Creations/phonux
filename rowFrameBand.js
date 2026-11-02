/**
 * Where the row's frames sit in a host's page, measured: their height comes from the phone fit, which only the mounted row knows.
 */
import * as React from 'react';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';
/** How long the frames must hold still before the band stops following them: past a resize's settle wait and the glide after it. */
const FOLLOW_STILL_MS = 1000;
/**
 * Reports the band of the row drawn in `scroller` (the row's scroll container) within `page`, once mounted and again whenever the
 * frames, the scroller or the window change size. `onBand` is read on each report, so it may be a fresh function every render;
 * it is a callback, not state, so a host can write the numbers where it likes (custom properties, say) without a re-render.
 * @public
 */
export function useRowFrameBand(page, scroller, onBand) {
    const report = React.useRef(onBand);
    report.current = onBand;
    React.useEffect(() => {
        const container = scroller.current;
        const strip = container?.querySelector(`[${ROW_STRIP_ATTRIBUTE}]`);
        if (!container || !strip)
            return undefined;
        let last = '';
        let stillSince = 0;
        let frame = 0;
        const measure = () => {
            const edges = page.current?.getBoundingClientRect();
            if (!edges)
                return;
            const frames = strip.getBoundingClientRect();
            const band = { above: frames.top - edges.top, below: edges.bottom - frames.bottom };
            const key = `${band.above} ${band.below}`;
            if (key === last)
                return;
            last = key;
            stillSince = performance.now();
            report.current(band);
        };
        // The row's top margin glides after a size change, and a resize refits the phone a moment later, both without resizing
        // anything observed: follow the frames each paint until they have held still for a while.
        const follow = () => {
            measure();
            if (performance.now() - stillSince < FOLLOW_STILL_MS)
                frame = requestAnimationFrame(follow);
            else
                frame = 0;
        };
        const check = () => {
            measure();
            stillSince = performance.now();
            if (frame === 0)
                frame = requestAnimationFrame(follow);
        };
        check();
        const observer = new ResizeObserver(check);
        observer.observe(strip);
        observer.observe(container);
        window.addEventListener('resize', check);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', check);
            cancelAnimationFrame(frame);
        };
    }, [page, scroller]);
}
