/**
 * The one owner of a row's horizontal offset. The container never scrolls: the offset and the row's centering margin are one
 * `translateX` on its strip, run as a Web Animations API animation so a glide keeps moving while the main thread is busy.
 * Internal and out of the barrel: a later custom scrollbar reads the strip from `computeRowNumbers` and writes through
 * `claim()`, the way edge scrolling does.
 */
import { cubicBezier } from 'motion/react';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';
// A bezier tuple is built once per glide, not per frame.
function curveOf(ease) {
    if (ease === 'cubic-out')
        return (t) => 1 - (1 - t) ** 3;
    if (ease === 'linear')
        return (t) => t;
    return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
}
// The compositor runs the same curve the frame loop reports: sampled this often and joined linearly, it is the curve to the eye.
const SAMPLE_MS = 1000 / 60;
const progress = (g, nowMs) => Math.min(1, Math.max(0, (nowMs - g.startMs) / g.durationMs));
const at = (g, nowMs) => {
    const t = (nowMs - g.startMs) / g.durationMs;
    return t >= 1 ? g.to : g.from + (g.to - g.from) * g.curve(Math.max(0, t));
};
// A fade moves at its midpoint, where the strip is fully transparent.
const jumpCurve = (t) => (t < 0.5 ? 0 : 1);
const opacityAt = (g, nowMs) => Math.abs(1 - 2 * progress(g, nowMs));
const glideOf = (from, to, nowMs, o) => ({ from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: o.fade === true ? jumpCurve : curveOf(o.ease), fade: o.fade === true });
// The slope a glide in flight has now, in px per ms, read off its own curve.
const speedOf = (g, nowMs) => (at(g, nowMs + 1) - at(g, nowMs - 1)) / 2;
/**
 * A glide from `from` to `to` that leaves at `speed` px per ms and eases into its rest: the first control point's slope is the
 * speed measured against the straight line, so a retarget joins the motion before it without a lurch.
 */
function carried(from, to, nowMs, speed, o) {
    const distance = to - from;
    const slope = Math.abs(distance) < 0.5 ? 0 : (speed * o.durationSec * 1000) / distance;
    const y1 = Math.min(1.5, Math.max(0, slope / 3));
    return { from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: cubicBezier(1 / 3, y1, 0.6, 1), fade: false };
}
/** How far a step past the row's end pushes the strip before it springs back, px, and how long the push and return take. */
export const ROW_BUMP_PX = 36;
export const ROW_BUMP_SEC = 0.45;
// The push takes this share of the bump on an ease-out; the rest springs back critically damped, so it settles without a wobble.
const BUMP_PEAK = 0.28;
const SPRING_K = 6;
const spring = (u) => (1 + SPRING_K * u) * Math.exp(-SPRING_K * u);
const SPRING_END = spring(1);
const bumpAt = (b, nowMs) => {
    if (b === null)
        return 0;
    const t = (nowMs - b.startMs) / b.durationMs;
    if (t <= 0 || t >= 1)
        return 0;
    if (t < BUMP_PEAK)
        return b.by * (1 - (1 - t / BUMP_PEAK) ** 3);
    return (b.by * (spring((t - BUMP_PEAK) / (1 - BUMP_PEAK)) - SPRING_END)) / (1 - SPRING_END);
};
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
/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`. */
export function closestRowScroller(from) {
    return from.closest('[data-row-scroller]');
}
function createRowScroller(el) {
    let claimed = false;
    // Set by a `replayScroll` claim; `deferred` is the scroll kept for it, run at `replayDeferred()` once its settle has moved the row.
    let replayable = false;
    let deferred = null;
    let offset = 0;
    let margin = 0;
    let marginSet = false;
    let glide = null;
    let marginGlide = null;
    let frame = null;
    let anim = null;
    let inputs = 0;
    let settleWait = false;
    let bump = null;
    let lastBumpAsk = Number.NEGATIVE_INFINITY;
    const listeners = new Set();
    const moveListeners = new Set();
    const notify = () => {
        for (const l of [...listeners])
            l();
    };
    const strip = () => el.querySelector(`:scope > [${ROW_STRIP_ATTRIBUTE}]`);
    const translate = (x) => `translateX(${x}px)`;
    // Draws what the numbers say now: the resting translate, plus one compositor animation for whatever still glides.
    const draw = (nowMs) => {
        const s = strip();
        anim?.cancel();
        anim = null;
        if (s === null)
            return;
        s.style.transform = translate(margin - offset - bumpAt(bump, nowMs));
        s.style.opacity = glide?.fade === true ? String(opacityAt(glide, nowMs)) : '';
        const end = Math.max(glide === null ? 0 : glide.startMs + glide.durationMs, marginGlide === null ? 0 : marginGlide.startMs + marginGlide.durationMs, bump === null ? 0 : bump.startMs + bump.durationMs);
        if (end <= nowMs || typeof s.animate !== 'function')
            return;
        const frames = [];
        const steps = Math.max(1, Math.ceil((end - nowMs) / SAMPLE_MS));
        for (let k = 0; k <= steps; k += 1) {
            const t = nowMs + ((end - nowMs) * k) / steps;
            const keyframe = { transform: translate((marginGlide === null ? margin : at(marginGlide, t)) - (glide === null ? offset : at(glide, t)) - bumpAt(bump, t)), offset: k / steps };
            if (glide?.fade === true)
                keyframe.opacity = String(opacityAt(glide, t));
            frames.push(keyframe);
        }
        // Under the animation, the rest it lands on, so its end hands over without a frame of the old value.
        s.style.transform = translate((marginGlide?.to ?? margin) - (glide?.to ?? offset));
        s.style.opacity = '';
        anim = s.animate(frames, { duration: end - nowMs, easing: 'linear', fill: 'none' });
    };
    const tick = () => {
        frame = null;
        const now = performance.now();
        if (glide !== null) {
            offset = at(glide, now);
            if (now >= glide.startMs + glide.durationMs)
                endGlide();
        }
        if (marginGlide !== null) {
            margin = at(marginGlide, now);
            if (now >= marginGlide.startMs + marginGlide.durationMs)
                marginGlide = null;
        }
        if (bump !== null && now >= bump.startMs + bump.durationMs)
            bump = null;
        const s = strip();
        // Without the Web Animations API the frame loop draws each frame itself.
        if (anim === null && s !== null) {
            s.style.transform = translate(margin - offset - bumpAt(bump, now));
            s.style.opacity = glide?.fade === true ? String(opacityAt(glide, now)) : '';
        }
        if (glide === null && marginGlide === null && bump === null) {
            anim?.cancel();
            anim = null;
        }
        notify();
        if (moving())
            frame = requestAnimationFrame(tick);
    };
    const moving = () => glide !== null || marginGlide !== null || bump !== null;
    const run = () => {
        if (frame === null && moving())
            frame = requestAnimationFrame(tick);
    };
    const onPointerDown = () => stop();
    function endGlide() {
        if (glide === null)
            return;
        el.removeEventListener('pointerdown', onPointerDown);
        glide = null;
    }
    // Sets the offset at once, ending any glide of it; a margin glide in flight keeps going.
    const place = (left) => {
        const now = performance.now();
        endGlide();
        if (marginGlide !== null)
            margin = at(marginGlide, now);
        offset = left;
        draw(now);
        if (!moving()) {
            if (frame !== null)
                cancelAnimationFrame(frame);
            frame = null;
        }
        notify();
    };
    function stop() {
        if (glide === null)
            return;
        place(at(glide, performance.now()));
    }
    // The browser scrolls a clipped container to reveal a focused element. The row takes that as a move of its own offset and
    // gives the container its scroll back, so nothing but the strip ever moves.
    el.addEventListener('scroll', () => {
        const by = el.scrollLeft;
        if (by === 0)
            return;
        el.scrollLeft = 0;
        place((glide === null ? offset : at(glide, performance.now())) + by);
    }, { passive: true });
    return {
        scrollLeft: () => offset,
        stripX: () => margin - offset,
        glideTo(target, o) {
            if (claimed)
                return false;
            if (o.instant || o.durationSec <= 0) {
                place(target);
                return true;
            }
            const now = performance.now();
            const from = glide === null ? offset : at(glide, now);
            const before = glide;
            if (glide === null)
                el.addEventListener('pointerdown', onPointerDown);
            if (marginGlide !== null)
                margin = at(marginGlide, now);
            offset = from;
            if (o.fade === true && before?.fade === true) {
                // A fade already under way goes on from the opacity it has reached, so a second jump does not flash the row.
                const t = progress(before, now);
                glide = glideOf(from, target, now - (t < 0.5 ? t : 1 - t) * o.durationSec * 1000, o);
            }
            else if (o.carry === true && before !== null && !before.fade)
                glide = carried(from, target, now, speedOf(before, now), o);
            else
                glide = glideOf(from, target, now, o);
            draw(now);
            run();
            return true;
        },
        glideTarget: () => (glide === null ? null : glide.to),
        setMargin(left, o) {
            const now = performance.now();
            const target = marginGlide === null ? margin : marginGlide.to;
            if (marginSet && target === left)
                return;
            if (glide !== null)
                offset = at(glide, now);
            margin = marginGlide === null ? margin : at(marginGlide, now);
            // The first margin is where the row is drawn from, not a move.
            marginGlide = !marginSet || o.instant || o.durationSec <= 0 ? null : glideOf(margin, left, now, o);
            marginSet = true;
            if (marginGlide === null)
                margin = left;
            draw(now);
            run();
            notify();
        },
        inputs: () => inputs,
        noteInput() {
            inputs += 1;
        },
        noteMove() {
            for (const l of [...moveListeners])
                l();
        },
        subscribeMoves(listener) {
            moveListeners.add(listener);
            return () => void moveListeners.delete(listener);
        },
        claimHeld: () => claimed,
        deferUntilRelease(run) {
            if (!claimed || !replayable)
                return false;
            deferred = run;
            return true;
        },
        replayDeferred() {
            const kept = deferred;
            deferred = null;
            replayable = false;
            kept?.();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        settling: () => settleWait,
        setSettling(on) {
            settleWait = on;
        },
        stop,
        bump(direction, o) {
            const now = performance.now();
            const absorbed = now - lastBumpAsk < o.durationSec * 1000 || (bump !== null && now < bump.startMs + bump.durationMs);
            lastBumpAsk = now;
            if (absorbed || claimed || o.distancePx <= 0 || o.durationSec <= 0)
                return;
            if (glide !== null)
                offset = at(glide, now);
            if (marginGlide !== null)
                margin = at(marginGlide, now);
            bump = { by: direction === 'right' ? o.distancePx : -o.distancePx, startMs: Math.max(now, glide === null ? now : glide.startMs + glide.durationMs), durationMs: o.durationSec * 1000 };
            draw(now);
            run();
        },
        claim(options) {
            if (claimed)
                return null;
            stop();
            claimed = true;
            // Visible on the element, so a row that refuses every step can be told apart from one that never got the input.
            el.setAttribute('data-row-held', '');
            replayable = options?.replayScroll === true;
            deferred = null;
            let max = null;
            let released = false;
            return {
                write(left) {
                    if (released || max === null)
                        return 0;
                    const before = offset;
                    place(Math.min(max, Math.max(0, left)));
                    return offset - before;
                },
                setMaxScroll(next) {
                    max = next;
                },
                release() {
                    if (released)
                        return;
                    released = true;
                    claimed = false;
                    el.removeAttribute('data-row-held');
                },
            };
        },
    };
}
