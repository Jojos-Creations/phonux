/**
 * Where the row's frames sit in a host's page, measured: their height comes from the phone fit, which only the mounted row knows.
 */
import * as React from 'react';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';

/**
 * How far the row's frames sit from a page's top edge and from its bottom edge, in px.
 * @public
 */
export interface RowFrameBand {
  /** Px from the page's top edge to the frames' top edge. */
  readonly above: number;
  /** Px from the frames' bottom edge to the page's bottom edge. */
  readonly below: number;
}

/**
 * Reports the band of the row drawn in `scroller` (the row's scroll container) within `page`, once mounted and again whenever the
 * frames, the scroller or the window change size. `onBand` is read on each report, so it may be a fresh function every render;
 * it is a callback, not state, so a host can write the numbers where it likes (custom properties, say) without a re-render.
 * @public
 */
export function useRowFrameBand(page: React.RefObject<HTMLElement | null>, scroller: React.RefObject<HTMLElement | null>, onBand: (band: RowFrameBand) => void): void {
  const report = React.useRef(onBand);
  report.current = onBand;
  React.useEffect(() => {
    const container = scroller.current;
    const strip = container?.querySelector<HTMLElement>(`[${ROW_STRIP_ATTRIBUTE}]`);
    if (!container || !strip) return undefined;
    const check = (): void => {
      const edges = page.current?.getBoundingClientRect();
      if (!edges) return;
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
