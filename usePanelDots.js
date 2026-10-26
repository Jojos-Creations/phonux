/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { centreScroll, dotLayout, dotMap, dragScroll } from './rowDots.js';
import { maxScrollOf, snapToStop } from './rowNumbers.js';
import { rowScrollerFor } from './rowScroller.js';
/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i) {
    const { rowNumbers: n, entries, scroller, tuning } = i;
    const systemReduced = useReducedMotion();
    const configReduced = useReducedMotionConfig();
    const reduced = systemReduced === true || configReduced === true;
    const [scrollLeft, setScrollLeft] = React.useState(0);
    React.useEffect(() => {
        const el = scroller.current;
        if (!el)
            return;
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
        windowWidth: n.stripWindow,
        // The track starts at the strip's first panel, not at scroll 0.
        scrollLeft: scrollLeft - n.stripStart,
    });
    const maxScroll = maxScrollOf(n);
    const selectDot = (id) => {
        const el = scroller.current;
        const index = n.ids.indexOf(id);
        if (!el || index < 0)
            return;
        rowScrollerFor(el).noteInput();
        rowScrollerFor(el).noteMove();
        const target = centreScroll({ index, leftOffsets: n.leftOffsets, widths: n.widths, windowWidth: n.stripWindow, maxScroll });
        if (target === null)
            return;
        // A stepping row rests on its stops only, so the dot's rest is the stop that shows the panel, not the margin-shifted centre.
        // Numbers built by hand may omit the stops; such a row has none to snap to.
        const at = Math.min(maxScroll, target + n.stripStart);
        rowScrollerFor(el).glideTo(n.stops?.length ? snapToStop(n, index, at) : at, { durationSec: tuning.slide.durationSec, instant: reduced, ease: tuning.slide.glideEase });
    };
    const startOvalDrag = () => {
        const el = scroller.current;
        if (!el)
            return null;
        const scroll = rowScrollerFor(el);
        scroll.noteInput();
        scroll.noteMove();
        const claim = scroll.claim();
        if (claim === null)
            return null;
        claim.setMaxScroll(maxScroll);
        const startScroll = scroll.scrollLeft();
        let open = true;
        return {
            drag(dx) {
                if (open)
                    claim.write(dragScroll({ startScroll, dx, map, maxScroll }));
            },
            end() {
                if (!open)
                    return;
                open = false;
                claim.release();
            },
        };
    };
    return { dots: layout.dots, oval: layout.oval, width: map.width, selectDot, startOvalDrag };
}
