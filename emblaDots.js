/**
 * The dot bar on an Embla row (`Workspace rowEngine="embla"`): one dot per panel along the strip, and the oval over the panels the
 * window shows, both one linear map of the strip read from where Embla draws it this frame. Dragging the oval writes the row's
 * position directly, so the oval stays under the pointer; holding the pointer at the bar's visible end keeps the row moving by
 * time. Internal: `usePanelDots` returns this on an Embla row.
 */
import * as React from 'react';
import { useReducedMotion, useReducedMotionConfig } from 'motion/react';
import { DOT_GAP_PX, DOT_PHONE_PX } from './rowBar.js';
import { emblaDrawnOf, emblaOf, endEmblaWheel, emblaRowsVersion, emblaStripOf, nearestStop, runsOnEmbla, subscribeEmblaRows, writeEmbla } from './emblaRow.js';
/** A press that moves this far across the bar drags the oval; a shorter one is a click. */
const DRAG_THRESHOLD_PX = 4;
/** How far inside the bar's visible end the pointer starts the timed scroll, in px. */
export const EDGE_ZONE_PX = 6;
/** The timed scroll's speed, in slots a second per px the pointer lies past the start of the edge zone, and its most. */
export const EDGE_SLOTS_PER_SEC_PER_PX = 0.1;
export const EDGE_MAX_SLOTS_PER_SEC = 12;
/** Wheel travel over the bar for one step, and the quiet that ends a wheel gesture. */
const WHEEL_STEP_PX = 100;
const WHEEL_QUIET_MS = 200;
const tidy = (px) => Math.round(px * 1e6) / 1e6;
/** The bar for `strip` at `scroll`: every panel's dot at its place on the strip scaled to dots, and the oval over the window. @internal */
export function emblaBarOf(strip, scroll, hollowOf) {
    const { layout, windowWidth, stripWidth, pitch, gap } = strip;
    const scale = (DOT_PHONE_PX + DOT_GAP_PX) / pitch;
    const max = Math.max(0, stripWidth - windowWidth);
    const at = Math.min(Math.max(scroll, 0), max);
    const dots = layout.ids
        .map((id, k) => ({ id, left: tidy(scale * layout.lefts[k]), width: tidy(Math.max(0, scale * (layout.widths[k] + gap) - DOT_GAP_PX)), hollow: hollowOf(id), riding: false }))
        .sort((a, b) => a.left - b.left);
    const shown = layout.ids.filter((_, k) => Math.min(layout.lefts[k] + layout.widths[k], at + windowWidth) - Math.max(layout.lefts[k], at) > 1);
    return {
        dots,
        oval: layout.ids.length === 0 ? { left: 0, width: 0 } : { left: tidy(scale * at), width: tidy(Math.max(0, scale * (Math.min(windowWidth, stripWidth) + gap) - DOT_GAP_PX)) },
        width: layout.ids.length === 0 ? 0 : tidy(Math.max(0, scale * (stripWidth + gap) - DOT_GAP_PX)),
        shown,
        scale,
        max,
    };
}
/** The part of `el` on screen, left to right in client px: its box cut by every ancestor that clips and by the viewport. @internal */
export function visibleSpan(el, clips) {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let right = r.right;
    for (const a of clips) {
        const b = a.getBoundingClientRect();
        left = Math.max(left, b.left);
        right = Math.min(right, b.right);
    }
    const view = el.ownerDocument.defaultView;
    return { left: Math.max(left, 0), right: Math.min(right, view?.innerWidth ?? right) };
}
const clipsOf = (el) => {
    const view = el.ownerDocument.defaultView;
    const out = [];
    for (let a = el.parentElement; a !== null && view !== null; a = a.parentElement)
        if (view.getComputedStyle(a).overflowX !== 'visible')
            out.push(a);
    return out;
};
/**
 * The timed scroll's speed in px of scroll a ms, for a pointer at `x` while the bar shows `span`: positive past the right end's zone,
 * negative past the left's, growing with how far past, 0 between.
 * @internal
 */
export function edgeSpeed(x, span, pitch) {
    const right = x - (span.right - EDGE_ZONE_PX);
    const left = span.left + EDGE_ZONE_PX - x;
    const depth = right > 0 ? right : left > 0 ? -left : 0;
    const slots = Math.sign(depth) * Math.min(EDGE_MAX_SLOTS_PER_SEC, Math.abs(depth) * EDGE_SLOTS_PER_SEC_PER_PX);
    return (slots * pitch) / 1000;
}
/** The dot bar on an Embla row, or null when `scroller` is not an Embla row that has drawn. Same shape as `usePanelDots`. @internal */
export function useEmblaPanelDots(i) {
    const { entries, scroller, ovalSide = 0 } = i;
    const systemReduced = useReducedMotion();
    const configReduced = useReducedMotionConfig();
    const reduced = systemReduced === true || configReduced === true;
    // A store change outside React's events re-renders synchronously in a microtask, so the oval is drawn in the frame the strip moved.
    React.useSyncExternalStore(subscribeEmblaRows, emblaRowsVersion, emblaRowsVersion);
    const drag = React.useRef(null);
    const press = React.useRef(null);
    const wheel = React.useRef({ travel: 0, at: 0 });
    const [pointer, setPointer] = React.useState(null);
    const [dragging, setDragging] = React.useState(false);
    React.useEffect(() => () => {
        if (drag.current !== null)
            cancelAnimationFrame(drag.current.raf);
    }, []);
    const el = scroller.current;
    const embla = el !== null && runsOnEmbla(el) ? emblaOf(el) : undefined;
    const strip = el === null || embla === undefined ? undefined : emblaStripOf(el);
    if (embla === undefined || strip === undefined)
        return null;
    const hollowOf = (id) => entries.find((e) => e.id === id)?.settings?.hollowDot === true;
    const bar = emblaBarOf(strip, emblaDrawnOf(embla), hollowOf);
    const clamp = (px) => Math.min(Math.max(px, 0), bar.max);
    // The oval drag's one write. The proof page swaps this line for an eased move (its negative control), so keep it on one line.
    const move = (px) => writeEmbla(embla, px);
    const targetOf = (d) => clamp(d.base + (d.x - d.x0) / bar.scale);
    // Each frame while the oval is dragged: a pointer held at the bar's visible end moves the row on by time, at a speed set by how far past.
    const tick = (now) => {
        const d = drag.current;
        if (d === null)
            return;
        const dt = Math.min(50, now - d.last);
        d.last = now;
        const speed = edgeSpeed(d.x, visibleSpan(d.el, d.clips), strip.pitch);
        const to = targetOf(d);
        if ((speed > 0 && to < bar.max) || (speed < 0 && to > 0)) {
            d.base += speed * dt;
            move(targetOf(d));
        }
        d.raf = requestAnimationFrame(tick);
    };
    const startOvalDrag = () => {
        endEmblaWheel(embla);
        if (embla.internalEngine().dragHandler.pointerDown())
            return null;
        const start = clamp(emblaDrawnOf(embla));
        let open = true;
        return {
            drag(dx) {
                if (open)
                    move(clamp(start + dx / bar.scale));
            },
            end() {
                if (!open)
                    return;
                open = false;
                embla.scrollTo(nearestStop(embla, emblaDrawnOf(embla)), reduced);
            },
        };
    };
    const endDrag = () => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        if (d === null)
            return;
        cancelAnimationFrame(d.raf);
        // The row rests on the grid: from where the drag left it, Embla glides to the nearest stop.
        embla.scrollTo(nearestStop(embla, emblaDrawnOf(embla)), reduced);
    };
    const selectDot = (id) => {
        const k = strip.layout.ids.indexOf(id);
        if (k < 0 || drag.current !== null || embla.internalEngine().dragHandler.pointerDown())
            return;
        const left = strip.layout.lefts[k];
        const width = strip.layout.widths[k];
        const at = emblaDrawnOf(embla);
        if (left >= at - 0.5 && left + width <= at + strip.windowWidth + 0.5)
            return;
        // A dot pressed during a wheel gesture takes the row from where it is drawn, as a key step does.
        endEmblaWheel(embla);
        embla.scrollTo(nearestStop(embla, clamp(left + width / 2 - strip.windowWidth / 2)), reduced);
    };
    const ovalAt = (x) => x >= bar.oval.left && x <= bar.oval.left + bar.oval.width + 2 * ovalSide;
    const dotOf = (target) => (target instanceof Element ? target.closest('[data-dot]') : null);
    const cursor = dragging ? 'grabbing' : pointer === null ? 'default' : ovalAt(pointer.x) ? 'grab' : pointer.overDot ? 'pointer' : 'default';
    const barProps = {
        onPointerDown: (e) => {
            if (e.button !== 0)
                return;
            const at = e.clientX - e.currentTarget.getBoundingClientRect().left;
            press.current = { x: e.clientX, id: dotOf(e.target)?.dataset.dot ?? null, onOval: ovalAt(at), moved: false };
            e.currentTarget.setPointerCapture?.(e.pointerId);
        },
        onPointerMove: (e) => {
            setPointer({ x: e.clientX - e.currentTarget.getBoundingClientRect().left, overDot: dotOf(e.target) !== null });
            const p = press.current;
            if (p === null)
                return;
            if (!p.moved && p.onOval && Math.abs(e.clientX - p.x) > DRAG_THRESHOLD_PX) {
                if (embla.internalEngine().dragHandler.pointerDown())
                    return;
                endEmblaWheel(embla);
                p.moved = true;
                setDragging(true);
                // From the press, not from here: the oval keeps the place under the pointer it was grabbed at.
                drag.current = { base: clamp(emblaDrawnOf(embla)), x0: p.x, x: e.clientX, el: e.currentTarget, clips: clipsOf(e.currentTarget), raf: 0, last: performance.now() };
                drag.current.raf = requestAnimationFrame(tick);
            }
            const d = drag.current;
            if (d === null)
                return;
            d.x = e.clientX;
            move(targetOf(d));
        },
        onPointerUp: () => {
            const p = press.current;
            press.current = null;
            const dragged = drag.current !== null;
            endDrag();
            if (p !== null && !p.moved && !dragged && p.id !== null)
                selectDot(p.id);
        },
        onPointerLeave: () => setPointer(null),
        onPointerCancel: () => {
            press.current = null;
            endDrag();
        },
        onWheel: (e) => {
            const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (raw === 0 || drag.current !== null)
                return;
            const w = wheel.current;
            if (e.timeStamp - w.at > WHEEL_QUIET_MS || Math.sign(raw) !== Math.sign(w.travel))
                w.travel = 0;
            const first = w.travel === 0;
            w.travel += e.deltaMode === 1 ? raw * 16 : raw;
            w.at = e.timeStamp;
            if (!first && Math.abs(w.travel) < WHEEL_STEP_PX)
                return;
            if (!first)
                w.travel = Math.sign(w.travel) * 0.001;
            if (raw > 0)
                embla.scrollNext(reduced);
            else
                embla.scrollPrev(reduced);
        },
        style: { touchAction: 'none', cursor },
        'data-dot-bar': '',
    };
    const ovalProps = {
        role: 'slider',
        tabIndex: 0,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': bar.max <= 0 ? 0 : Math.round((clamp(emblaDrawnOf(embla)) / bar.max) * 100),
    };
    const dotProps = (id) => ({
        'data-dot': id,
        onClick: (e) => {
            if (e.detail === 0)
                selectDot(id);
        },
    });
    return { dots: bar.dots, oval: bar.oval, width: bar.width, shown: bar.shown, selectDot, startOvalDrag, cursor, barProps, ovalProps, dotProps };
}
