/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { GLIDE_EASE, SLIDE_DURATION_SEC } from './rowConstants.js';
import { centreScroll, dotLayout, dragScroll } from './rowDots.js';
import { maxScrollOf, type RowNumbers } from './rowNumbers.js';
import { rowScrollerFor, type ScrollClaim } from './rowScroller.js';

/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
  /** Each drawn panel's dot in track px, in row order. `hollow` is the panel setting `hollowDot`. */
  readonly dots: readonly { readonly id: string; readonly left: number; readonly width: number; readonly hollow: boolean }[];
  /** The window oval in track px. */
  readonly oval: { readonly left: number; readonly width: number };
  /** Centres the panel `id` in the window. Does nothing when the row cannot scroll, or while a drag holds the row. */
  selectDot(id: string): void;
  /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
  startOvalDrag(): { drag(dx: number): void; end(): void } | null;
}

/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `trackWidth` is the width the app gives the bar;
 * `minDotPx` is the narrowest a dot may draw; `scroller` is the row's scroll container (the element with
 * `data-row-scroller`). Reduce Motion snaps a dot click, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i: {
  rowNumbers: RowNumbers;
  entries: readonly { readonly id: string; readonly settings?: { readonly hollowDot: boolean } }[];
  trackWidth: number;
  minDotPx: number;
  scroller: React.RefObject<HTMLElement | null>;
}): PanelDots {
  const { rowNumbers: n, entries, trackWidth, minDotPx, scroller } = i;
  const systemReduced = useReducedMotion();
  const configReduced = useReducedMotionConfig();
  const reduced = systemReduced === true || configReduced === true;
  const [scrollLeft, setScrollLeft] = React.useState(0);

  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const sync = () => setScrollLeft(el.scrollLeft);
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => el.removeEventListener('scroll', sync);
  }, [scroller]);

  const hollow = n.ids.map((id) => entries.find((e) => e.id === id)?.settings?.hollowDot === true);
  const layout = dotLayout({
    ids: n.ids,
    widths: n.widths,
    leftOffsets: n.leftOffsets,
    hollow,
    stripWidth: n.stripWidth,
    windowWidth: n.windowWidth,
    // The track starts at the strip's first panel, not at scroll 0.
    scrollLeft: scrollLeft - n.rowMarginLeft,
    trackWidth,
    minDotPx,
  });
  const maxScroll = maxScrollOf(n);

  const selectDot = (id: string): void => {
    const el = scroller.current;
    const index = n.ids.indexOf(id);
    if (!el || index < 0) return;
    const target = centreScroll({ index, leftOffsets: n.leftOffsets, widths: n.widths, windowWidth: n.windowWidth, maxScroll });
    if (target === null) return;
    rowScrollerFor(el).glideTo(Math.min(maxScroll, target + n.rowMarginLeft), { durationSec: SLIDE_DURATION_SEC, instant: reduced, ease: GLIDE_EASE });
  };

  const startOvalDrag = () => {
    const el = scroller.current;
    if (!el) return null;
    const scroll = rowScrollerFor(el);
    const claim: ScrollClaim | null = scroll.claim();
    if (claim === null) return null;
    claim.setMaxScroll(maxScroll);
    const startScroll = scroll.scrollLeft();
    let open = true;
    return {
      drag(dx: number) {
        if (open) claim.write(dragScroll({ startScroll, dx, trackWidth, stripWidth: n.stripWidth, maxScroll }));
      },
      end() {
        if (!open) return;
        open = false;
        claim.release();
      },
    };
  };

  return { dots: layout.dots, oval: layout.oval, selectDot, startOvalDrag };
}
