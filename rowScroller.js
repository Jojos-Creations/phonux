/**
 * The one writer of a row container's `scrollLeft`. Internal and out of the barrel: a later custom scrollbar reads the
 * strip from `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
 */
import { cubicBezier } from 'motion/react';
// A scroll event this far from the last value written is somebody else's; browsers round a fractional write.
const FOREIGN_SCROLL_PX = 1;
// A bezier tuple is built once per glide, not per frame.
function curveOf(ease) {
    if (ease === 'cubic-out')
        return (t) => 1 - (1 - t) ** 3;
    if (ease === 'linear')
        return (t) => t;
    return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
}
const scrollers = new WeakMap();
/** The one `RowScroller` of `element`: the same object on every call. */
export function rowScrollerFor(element) {
    const existing = scrollers.get(element);
    if (existing !== undefined)
        return existing;
    const created = createRowScroller(element);
    scrollers.set(element, created);
    return created;
}
/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`; never computed overflow, so a container whose `overflow-x` is hidden is found too. */
export function closestRowScroller(from) {
    return from.closest('[data-row-scroller]');
}
function createRowScroller(el) {
    let claimed = false;
    let glide = null;
    let frame = null;
    // Read back after every own write: the browser rounds and clamps, and the scroll event it fires later reports that value.
    let lastWritten = el.scrollLeft;
    let inputs = 0;
    const listeners = new Set();
    const notify = () => {
        for (const l of [...listeners])
            l();
    };
    const write = (left) => {
        el.scrollLeft = left;
        lastWritten = el.scrollLeft;
        notify();
    };
    const onForeignScroll = () => {
        if (Math.abs(el.scrollLeft - lastWritten) > FOREIGN_SCROLL_PX)
            stop();
    };
    const onPointerDown = () => stop();
    function stop() {
        if (frame !== null)
            cancelAnimationFrame(frame);
        frame = null;
        if (glide !== null) {
            el.removeEventListener('scroll', onForeignScroll);
            el.removeEventListener('pointerdown', onPointerDown);
        }
        glide = null;
    }
    function tick() {
        frame = null;
        if (glide === null)
            return;
        const t = (performance.now() - glide.startMs) / glide.durationMs;
        if (t >= 1) {
            const to = glide.to;
            stop();
            write(to);
            return;
        }
        write(glide.from + (glide.to - glide.from) * glide.curve(Math.max(0, t)));
        frame = requestAnimationFrame(tick);
    }
    return {
        scrollLeft: () => el.scrollLeft,
        glideTo(target, o) {
            if (claimed)
                return false;
            if (o.instant || o.durationSec <= 0) {
                stop();
                write(target);
                return true;
            }
            if (glide === null) {
                el.addEventListener('scroll', onForeignScroll);
                el.addEventListener('pointerdown', onPointerDown);
            }
            lastWritten = el.scrollLeft;
            glide = { from: el.scrollLeft, to: target, startMs: performance.now(), durationMs: o.durationSec * 1000, curve: curveOf(o.ease) };
            if (frame === null)
                frame = requestAnimationFrame(tick);
            return true;
        },
        glideTarget: () => (glide === null ? null : glide.to),
        inputs: () => inputs,
        noteInput() {
            inputs += 1;
        },
        claimHeld: () => claimed,
        subscribe(listener) {
            if (listeners.size === 0)
                el.addEventListener('scroll', notify, { passive: true });
            listeners.add(listener);
            return () => {
                if (!listeners.delete(listener) || listeners.size > 0)
                    return;
                el.removeEventListener('scroll', notify);
            };
        },
        stop,
        claim() {
            if (claimed)
                return null;
            stop();
            claimed = true;
            let max = null;
            let released = false;
            return {
                write(left) {
                    if (released || max === null)
                        return 0;
                    const before = el.scrollLeft;
                    write(Math.min(max, Math.max(0, left)));
                    return el.scrollLeft - before;
                },
                setMaxScroll(next) {
                    max = next;
                },
                release() {
                    if (released)
                        return;
                    released = true;
                    claimed = false;
                },
            };
        },
    };
}
