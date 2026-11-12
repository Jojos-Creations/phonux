/**
 * A row slot's own motion: how far it is drawn from its rest, its scale and its opacity, run as Web Animations API animations on
 * the shared start time, so every slot a commit moves is sampled together by the compositor. The rest itself is the slot's
 * `translate`, which the row's drawing pass writes (rowDraw.ts). The two are separate properties because an additive animation
 * on a style of the same property does not run on the compositor.
 */
import { cubicBezier } from 'motion/react';
import { sharedStartTime } from './rowClock.js';
/** The named curves a close exit may take, as Motion draws them. @internal */
export const NAMED_EASE = {
    easeIn: [0.42, 0, 1, 1],
    easeOut: [0, 0, 0.58, 1],
    easeInOut: [0.42, 0, 0.58, 1],
    linear: [0, 0, 1, 1],
};
// Every keyframe names the same functions in the same order, so the browser interpolates each number on its own.
const fullTransform = (p) => `translateX(${p.x}px) translateY(${p.y}px) scale(${p.scale})`;
/** `rest` as a slot's `translate`. @internal */
export const restTranslate = (rest) => (rest === 0 ? 'none' : `${rest}px`);
/** `pose` as the transform a slot is drawn with: only what differs from rest, `none` when nothing does. @internal */
export const shortTransform = (p) => [p.x === 0 ? '' : `translateX(${p.x}px)`, p.y === 0 ? '' : `translateY(${p.y}px)`, p.scale === 1 ? '' : `scale(${p.scale})`].filter(Boolean).join(' ') || 'none';
const lerp = (a, b, p) => a + (b - a) * p;
const movers = new WeakMap();
/** The mover drawing `el`, if a row slot has one. @internal */
export const moverOf = (el) => movers.get(el);
/** The mover for `el`, starting at `start`. @internal */
export function createSlotMover(el, start) {
    let rest = start;
    let run = null;
    let frame = null;
    const draw = (p) => {
        el.style.transform = shortTransform(p);
        el.style.opacity = String(p.opacity);
    };
    const poseAt = (nowMs) => {
        if (run === null)
            return rest;
        const e = run.curve(Math.min(1, Math.max(0, (nowMs - run.startMs) / run.durationMs)));
        return { x: lerp(run.from.x, run.to.x, e), y: lerp(run.from.y, run.to.y, e), scale: lerp(run.from.scale, run.to.scale, e), opacity: lerp(run.from.opacity, run.to.opacity, e) };
    };
    const halt = () => {
        const now = poseAt(performance.now());
        if (frame !== null)
            cancelAnimationFrame(frame);
        frame = null;
        run?.anim?.cancel();
        run = null;
        rest = now;
        return now;
    };
    const tick = () => {
        frame = null;
        if (run === null)
            return;
        const now = performance.now();
        if (now - run.startMs >= run.durationMs || !el.isConnected) {
            const finished = run;
            run = null;
            rest = finished.to;
            draw(finished.to);
            finished.anim?.cancel();
            finished.done?.();
            return;
        }
        // Without the Web Animations API the frame loop draws each frame itself.
        if (run.anim === null)
            draw(poseAt(now));
        frame = requestAnimationFrame(tick);
    };
    draw(start);
    const mover = {
        pose: () => poseAt(performance.now()),
        set(pose) {
            halt();
            rest = pose;
            draw(pose);
        },
        to(pose, timing, done) {
            const from = halt();
            const durationMs = timing.duration * 1000;
            if (durationMs <= 0) {
                rest = pose;
                draw(pose);
                done?.();
                return;
            }
            const startMs = sharedStartTime();
            let anim = null;
            if (typeof el.animate === 'function') {
                anim = el.animate([
                    { transform: fullTransform(from), opacity: from.opacity },
                    { transform: fullTransform(pose), opacity: pose.opacity },
                ], { duration: durationMs, easing: `cubic-bezier(${timing.ease.join(', ')})`, fill: 'both' });
                anim.startTime = startMs;
            }
            // Under the animation, the pose it lands on, so its end hands over without a frame of the old one.
            draw(anim === null ? from : pose);
            run = { from, to: pose, startMs, durationMs, curve: cubicBezier(timing.ease[0], timing.ease[1], timing.ease[2], timing.ease[3]), anim, done };
            frame = requestAnimationFrame(tick);
        },
        shift(dx) {
            const now = halt();
            rest = { ...now, x: now.x + dx };
            draw(rest);
        },
        moving: () => run !== null,
    };
    movers.set(el, mover);
    return mover;
}
const holdShifts = new WeakMap();
/** Records the sideways shift a held panel's host draws it with. @internal */
export function setHoldShift(holdBox, px) {
    holdShifts.set(holdBox, px);
}
/** The shift last recorded for a held panel's host; 0 for one never held. @internal */
export function holdShiftOf(holdBox) {
    return holdShifts.get(holdBox) ?? 0;
}
/** Everything that moves a slot without laying it out again: the strip's translate, a held panel's shift, the slot's rest and its pose. */
function motionOf(el, stripX) {
    const pose = moverOf(el)?.pose();
    const hold = el.closest('[data-row-hold]');
    const rest = Number(el.dataset.rowSlot) || 0;
    return { dx: stripX() + (hold === null ? 0 : (holdShifts.get(hold) ?? 0)) + rest + (pose?.x ?? 0), dy: pose?.y ?? 0, scale: pose?.scale ?? 1 };
}
const originXOf = (el) => {
    const first = el.style.transformOrigin.split(' ')[0];
    return first?.endsWith('%') === true ? Number.parseFloat(first) / 100 : 0.5;
};
/**
 * Measures `el` once and returns where it is drawn at any later moment, from the numbers that move it: the strip's translate
 * (`stripX`), a held panel's shift, the slot's rest and its pose. Reading it lays nothing out, so a frame loop can call it freely.
 * @internal
 */
export function screenBoxOf(el, stripX) {
    const rect = el.getBoundingClientRect();
    const originX = originXOf(el);
    const at = motionOf(el, stripX);
    const width = at.scale > 0 ? rect.width / at.scale : el.offsetWidth;
    const height = at.scale > 0 ? rect.height / at.scale : el.offsetHeight;
    // Where the box would be with no transform at all, origin-corrected for the scale it was measured at.
    const left = rect.left - at.dx - originX * width * (1 - at.scale);
    const top = rect.top - at.dy - 0.5 * height * (1 - at.scale);
    return () => {
        const now = motionOf(el, stripX);
        return { x: left + now.dx + originX * width * (1 - now.scale), y: top + now.dy + 0.5 * height * (1 - now.scale), width: width * now.scale, height: height * now.scale };
    };
}
