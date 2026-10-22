/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { centreScroll, dotLayout, dotMap, dragScroll } from './rowDots.js';
import { maxScrollOf, snapToStop, type RowNumbers } from './rowNumbers.js';
import { rowScrollerFor, type ScrollClaim } from './rowScroller.js';

/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
  /** Each drawn panel's dot in track px, in row order. `hollow` is the panel setting `hollowDot`. */
  readonly dots: readonly { readonly id: string; readonly left: number; readonly width: number; readonly hollow: boolean }[];
  /** The window oval in track px. */
  readonly oval: { readonly left: number; readonly width: number };
  /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
  readonly width: number;
  /** Centers the panel `id` in the window. Does nothing when the row cannot scroll, or while a drag holds the row. */
  selectDot(id: string): void;
  /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
  startOvalDrag(): { drag(dx: number): void; end(): void } | null;
}

/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i: {
  rowNumbers: RowNumbers;
  entries: readonly { readonly id: string; readonly settings?: { readonly hollowDot: boolean } }[];
  scroller: React.RefObject<HTMLElement | null>;
  tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
}): PanelDots {
  const { rowNumbers: n, entries, scroller, tuning } = i;
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
  const map = dotMap({ widths: n.widths, leftOffsets: n.leftOffsets });
  const layout = dotLayout({
    ids: n.ids,
    hollow,
    map,
    windowWidth: n.windowWidth,
    // The track starts at the strip's first panel, not at scroll 0.
    scrollLeft: scrollLeft - n.rowMarginLeft,
  });
  const maxScroll = maxScrollOf(n);

  const selectDot = (id: string): void => {
    const el = scroller.current;
    const index = n.ids.indexOf(id);
    if (!el || index < 0) return;
    rowScrollerFor(el).noteInput();
    const target = centreScroll({ index, leftOffsets: n.leftOffsets, widths: n.widths, windowWidth: n.windowWidth, maxScroll });
    if (target === null) return;
    // A stepping row rests on its stops only, so the dot's rest is the stop that shows the panel, not the margin-shifted center.
    // Numbers built by hand may omit the stops; such a row has none to snap to.
    const at = Math.min(maxScroll, target + n.rowMarginLeft);
    rowScrollerFor(el).glideTo(n.stops?.length ? snapToStop(n, index, at) : at, { durationSec: tuning.slide.durationSec, instant: reduced, ease: tuning.slide.glideEase });
  };

  const startOvalDrag = () => {
    const el = scroller.current;
    if (!el) return null;
    const scroll = rowScrollerFor(el);
    scroll.noteInput();
    const claim: ScrollClaim | null = scroll.claim();
    if (claim === null) return null;
    claim.setMaxScroll(maxScroll);
    const startScroll = scroll.scrollLeft();
    let open = true;
    return {
      drag(dx: number) {
        if (open) claim.write(dragScroll({ startScroll, dx, map, maxScroll }));
      },
      end() {
        if (!open) return;
        open = false;
        claim.release();
      },
    };
  };

  return { dots: layout.dots, oval: layout.oval, width: map.width, selectDot, startOvalDrag };
}
