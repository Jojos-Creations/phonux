/**
 * The one owner of a row's horizontal position: where the window's left edge sits along the strip, the view. The view is two
 * numbers that add: the scroll, which a person's step or a claim moves, and the origin, the negative of the row's centering,
 * which the Workspace supplies. Each runs its own clock, so a re-centering never retimes a scroll glide, a fade or a bump. The
 * container never scrolls: the strip is one `translateX(-view)`, run as a Web Animations API animation so a glide keeps moving
 * while the main thread is busy. Internal and out of the barrel: a later custom scrollbar reads the strip from
 * `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
 */
import { cubicBezier } from 'motion/react';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';
// The scroll a size change asks for comes a frame or two after the glide starts, once focus has returned to the panel.
const SIZE_FOLLOW_MS = 150;
/** The strip of the row whose scroll container is `container`: inside the window element that cuts it, never a nested row's. @internal */
export function rowStripOf(container) {
    return container.querySelector(`:scope > [data-row-window] > [${ROW_STRIP_ATTRIBUTE}]`);
}
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
const releaseOf = (b) => Math.max(b.startMs + b.outMs, b.holdUntilMs);
const bumpEnd = (b) => (b === null ? 0 : releaseOf(b) + b.backMs);
const bumpAt = (b, nowMs) => {
    if (b === null || nowMs >= bumpEnd(b))
        return 0;
    if (nowMs <= b.startMs)
        return b.from;
    if (nowMs < b.startMs + b.outMs)
        return b.from + (b.by - b.from) * (1 - (1 - (nowMs - b.startMs) / b.outMs) ** 3);
    const release = releaseOf(b);
    if (nowMs <= release)
        return b.by;
    return (b.by * (spring((nowMs - release) / b.backMs) - SPRING_END)) / (1 - SPRING_END);
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
    // The view is the scroll plus the origin, the negative of the row's centering. Each has its own glide and clock: a glide of one
    // never reshapes the other, so what a caller asked of the scroll lands as asked however the row is re-centering beside it.
    let offset = 0;
    let origin = 0;
    let originSet = false;
    let glide = null;
    let originGlide = null;
    let frame = null;
    let anim = null;
    let bump = null;
    let sizeMove = null;
    const listeners = new Set();
    const notify = () => {
        for (const l of [...listeners])
            l();
    };
    const strip = () => rowStripOf(el);
    const translate = (x) => `translateX(${x}px)`;
    // Where each stands at `nowMs`, off its glide's own curve rather than the last frame's value.
    const scrollAt = (nowMs) => (glide === null ? offset : at(glide, nowMs));
    const originAt = (nowMs) => (originGlide === null ? origin : at(originGlide, nowMs));
    const viewAt = (nowMs) => scrollAt(nowMs) + originAt(nowMs);
    // Listeners that write from `stripX()` need the strip drawn by the frame loop: a compositor animation runs a frame or more ahead of it.
    const framers = new Set();
    let framed = false;
    // Draws what the numbers say now: the resting translate, plus one compositor animation for whatever still glides.
    const draw = (nowMs) => {
        framed = framers.size > 0;
        const s = strip();
        anim?.cancel();
        anim = null;
        if (s === null)
            return;
        s.style.transform = translate(-(offset + origin) - bumpAt(bump, nowMs));
        s.style.opacity = glide?.fade === true ? String(opacityAt(glide, nowMs)) : '';
        const end = Math.max(glide === null ? 0 : glide.startMs + glide.durationMs, originGlide === null ? 0 : originGlide.startMs + originGlide.durationMs, bumpEnd(bump));
        if (end <= nowMs || framed || typeof s.animate !== 'function')
            return;
        const frames = [];
        const steps = Math.max(1, Math.ceil((end - nowMs) / SAMPLE_MS));
        for (let k = 0; k <= steps; k += 1) {
            const t = nowMs + ((end - nowMs) * k) / steps;
            const keyframe = { transform: translate(-viewAt(t) - bumpAt(bump, t)), offset: k / steps };
            if (glide?.fade === true)
                keyframe.opacity = String(opacityAt(glide, t));
            frames.push(keyframe);
        }
        // Under the animation, the rest it lands on, so its end hands over without a frame of the old value.
        s.style.transform = translate(-((glide?.to ?? offset) + (originGlide?.to ?? origin)));
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
        if (originGlide !== null) {
            origin = at(originGlide, now);
            if (now >= originGlide.startMs + originGlide.durationMs)
                originGlide = null;
        }
        if (bump !== null && now >= bumpEnd(bump))
            bump = null;
        const s = strip();
        // Without the Web Animations API the frame loop draws each frame itself.
        if (anim === null && s !== null) {
            s.style.transform = translate(-(offset + origin) - bumpAt(bump, now));
            s.style.opacity = glide?.fade === true ? String(opacityAt(glide, now)) : '';
        }
        if (glide === null && originGlide === null && bump === null) {
            anim?.cancel();
            anim = null;
        }
        notify();
        if (moving())
            frame = requestAnimationFrame(tick);
    };
    const moving = () => glide !== null || originGlide !== null || bump !== null;
    const run = () => {
        if (frame === null && moving())
            frame = requestAnimationFrame(tick);
    };
    function endGlide() {
        if (glide === null)
            return;
        glide = null;
    }
    // Sets the scroll at once, ending any scroll glide. A centering still travelling is not a scroll: the origin goes on to its
    // landing on its own clock, so a press or a jump never freezes the row off-center.
    const place = (left) => {
        const now = performance.now();
        endGlide();
        origin = originAt(now);
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
        place(scrollAt(performance.now()));
    }
    // The browser scrolls a clipped container to reveal a focused element. The row takes that as a move of its own offset and
    // gives the container its scroll back, so nothing but the strip ever moves.
    el.addEventListener('scroll', () => {
        const by = el.scrollLeft;
        if (by === 0)
            return;
        el.scrollLeft = 0;
        place(scrollAt(performance.now()) + by);
    }, { passive: true });
    return {
        scrollLeft: () => scrollAt(performance.now()),
        // The bump is in the translate, so it is in the strip's x: a reader placing against the strip during a bump sees where it is drawn.
        stripX: () => -viewAt(performance.now()) - bumpAt(bump, performance.now()),
        glideTo(target, o) {
            if (claimed)
                return false;
            if (o.instant || o.durationSec <= 0) {
                place(target);
                return true;
            }
            const now = performance.now();
            const from = scrollAt(now);
            const before = glide;
            origin = originAt(now);
            if (o.fade === true && before?.fade === true) {
                // A fade already under way goes on from the opacity it has reached, so a second jump does not flash the row.
                const t = progress(before, now);
                glide = glideOf(from, target, now - (t < 0.5 ? t : 1 - t) * o.durationSec * 1000, o);
            }
            else if (o.carry === true && before !== null && !before.fade)
                glide = carried(from, target, now, speedOf(before, now), o);
            else if (o.fade !== true && sizeMove !== null && now - sizeMove.startMs < SIZE_FOLLOW_MS)
                glide = glideOf(from, target, sizeMove.startMs, { ...o, durationSec: sizeMove.durationSec, ease: [...sizeMove.ease] });
            else
                glide = glideOf(from, target, now, o);
            // A glide that joins a size change starts in the past, so its curve is already ahead of `from`: what is stored and drawn is
            // the curve's value now, the same one scrollLeft() reads, not the value the strip had a frame ago.
            offset = at(glide, now);
            draw(now);
            run();
            return true;
        },
        glideTarget: () => (glide === null ? null : glide.to),
        followSize(o) {
            sizeMove = o;
        },
        reorigin(centering, o) {
            const now = performance.now();
            const next = -centering;
            if (originSet && (originGlide === null ? origin : originGlide.to) === next)
                return;
            if (glide !== null)
                offset = at(glide, now);
            origin = originAt(now);
            // The first origin is where the row is drawn from, not a move.
            originGlide = !originSet || o.instant || o.durationSec <= 0 ? null : glideOf(origin, next, now, o);
            originSet = true;
            if (originGlide === null)
                origin = next;
            draw(now);
            run();
            notify();
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
        subscribe(listener, options) {
            listeners.add(listener);
            if (options?.sameFrame === true) {
                framers.add(listener);
                // A glide already under the compositor goes on in the frame loop from where it is.
                if (!framed) {
                    draw(performance.now());
                    run();
                }
            }
            return () => {
                listeners.delete(listener);
                framers.delete(listener);
            };
        },
        stop,
        bump(direction, o) {
            if (claimed || o.distancePx <= 0 || o.durationSec <= 0)
                return;
            const now = performance.now();
            const by = direction === 'right' ? o.distancePx : -o.distancePx;
            if (glide !== null)
                offset = at(glide, now);
            origin = originAt(now);
            if (bump !== null && bump.by === by && now < releaseOf(bump))
                bump.holdUntilMs = Math.max(bump.holdUntilMs, now + o.holdMs);
            else {
                const ms = o.durationSec * 1000;
                bump = { from: bumpAt(bump, now), by, startMs: Math.max(now, glide === null ? now : glide.startMs + glide.durationMs), outMs: ms * BUMP_PEAK, holdUntilMs: now + o.holdMs, backMs: ms * (1 - BUMP_PEAK) };
            }
            draw(now);
            run();
        },
        keepBump(direction, holdMs) {
            const now = performance.now();
            if (bump === null || Math.sign(bump.by) !== (direction === 'right' ? 1 : -1) || now >= releaseOf(bump) || now + holdMs <= bump.holdUntilMs)
                return;
            if (glide !== null)
                offset = at(glide, now);
            origin = originAt(now);
            bump.holdUntilMs = now + holdMs;
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
