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
import { stepRowIn } from './rowStep.js';
/** A press that moves this far across the bar drags the oval; a shorter one is a click. */
const DRAG_THRESHOLD_PX = 4;
/** Track px a drag travels past the row's end for one step: about one phone dot and its gap. */
const OVERSHOOT_STEP_PX = 30;
/** Wheel travel over the bar for one step, and the quiet that ends a wheel gesture. */
const WHEEL_STEP_PX = 100;
const WHEEL_QUIET_MS = 200;
/** The bar's cursor for a pointer at `x` across the bar (null when off it), the oval as drawn now, and `side`, how far the oval reaches past its dots. */
function ovalCursor(x, oval, side, dragging, overDot) {
    if (dragging)
        return 'grabbing';
    if (x === null)
        return 'default';
    // The dots lie over the oval, so a cursor set per dot would leave the part of a dot that straddles the oval's edge as a pointer.
    return x >= oval.left && x <= oval.left + oval.width + 2 * side ? 'grab' : overDot ? 'pointer' : 'default';
}
/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export function usePanelDots(i) {
    const { rowNumbers: n, entries, scroller, tuning, ovalSide = 0 } = i;
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
    // Worked out each render from the pointer's last place and the oval as drawn now, so a redraw that moves the oval under a still pointer reads true.
    const [pointer, setPointer] = React.useState(null);
    const [dragging, setDragging] = React.useState(false);
    const drag = React.useRef(null);
    // `moved` latches once the press passes the threshold: that press drags and never selects. `edgeX` is where the pointer was when
    // the drag last met the row's end (or last stepped), so travel beyond it steps the row.
    const press = React.useRef(null);
    const wheel = React.useRef({ travel: 0, at: 0 });
    const step = (direction) => {
        const el = scroller.current;
        if (el)
            stepRowIn(el, direction);
    };
    const cursor = ovalCursor(pointer?.x ?? null, layout.oval, ovalSide, dragging, pointer?.overDot === true);
    const stop = () => {
        drag.current?.end();
        drag.current = null;
        setDragging(false);
    };
    const dotOf = (target) => (target instanceof Element ? target.closest('[data-dot]') : null);
    const barProps = {
        onPointerDown: (e) => {
            if (e.button !== 0)
                return;
            press.current = { x: e.clientX, id: dotOf(e.target)?.dataset.dot ?? null, moved: false, edgeX: null };
            e.currentTarget.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
            setPointer({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, overDot: dotOf(e.target) !== null });
            const p = press.current;
            if (!p)
                return;
            const dx = e.clientX - p.x;
            if (!p.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
                p.moved = true;
                drag.current = startOvalDrag();
                setDragging(true);
            }
            if (!p.moved)
                return;
            drag.current?.drag(dx);
            // Past the end, or on a row that cannot scroll at all, the drag steps the row instead.
            const el = scroller.current;
            const at = el?.scrollLeft ?? 0;
            const atEnd = drag.current === null || maxScroll <= 0 || (dx > 0 ? at >= maxScroll - 0.5 : at <= 0.5);
            if (!atEnd) {
                p.edgeX = null;
                return;
            }
            p.edgeX ??= e.clientX;
            const past = e.clientX - p.edgeX;
            if (Math.abs(past) < OVERSHOOT_STEP_PX)
                return;
            p.edgeX = e.clientX;
            // A step may hand the row to its glide; the drag picks up again from wherever that leaves it.
            drag.current?.end();
            drag.current = null;
            step(past > 0 ? 'right' : 'left');
        },
        onPointerUp: () => {
            const p = press.current;
            press.current = null;
            stop();
            if (p && !p.moved && p.id !== null)
                selectDot(p.id);
        },
        onPointerLeave: () => setPointer(null),
        onWheel: (e) => {
            const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (raw === 0)
                return;
            const w = wheel.current;
            if (e.timeStamp - w.at > WHEEL_QUIET_MS || Math.sign(raw) !== Math.sign(w.travel))
                w.travel = 0;
            // The first event of a gesture steps at once, so one notch moves the row.
            const first = w.travel === 0;
            w.travel += e.deltaMode === 1 ? raw * 16 : raw;
            w.at = e.timeStamp;
            if (!first && Math.abs(w.travel) < WHEEL_STEP_PX)
                return;
            if (!first)
                w.travel = Math.sign(w.travel) * 0.001;
            step(raw > 0 ? 'right' : 'left');
        },
        onPointerCancel: () => {
            press.current = null;
            stop();
        },
        style: { touchAction: 'none', cursor },
    };
    const ovalProps = {
        role: 'slider',
        tabIndex: 0,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round((layout.oval.left / Math.max(1, map.width - layout.oval.width)) * 100),
    };
    const dotProps = (id) => ({
        'data-dot': id,
        // A pointer press is handled on the bar; only a keyboard activation (detail 0) reaches this click.
        onClick: (e) => {
            if (e.detail === 0)
                selectDot(id);
        },
    });
    return { dots: layout.dots, oval: layout.oval, width: map.width, selectDot, startOvalDrag, cursor, barProps, ovalProps, dotProps };
}
