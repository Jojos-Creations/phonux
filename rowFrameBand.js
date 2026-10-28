/**
 * Where the row's frames sit in a host's page, measured: their height comes from the phone fit, which only the mounted row knows.
 */
import * as React from 'react';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';
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
        const check = () => {
            const edges = page.current?.getBoundingClientRect();
            if (!edges)
                return;
            const frames = strip.getBoundingClientRect();
            report.current({ above: frames.top - edges.top, below: edges.bottom - frames.bottom });
        };
        check();
        const observer = new ResizeObserver(check);
        observer.observe(strip);
        observer.observe(container);
        window.addEventListener('resize', check);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', check);
        };
    }, [page, scroller]);
}
