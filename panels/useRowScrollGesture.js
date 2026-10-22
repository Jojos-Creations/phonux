/**
 * The row's scroll gesture: wheel travel or an arrow key asks for steps in a direction. What a step does is the
 * caller's: this hook only filters the input, keeps the burst lock and installs the listeners.
 *
 * Under `mode` 'off' no listener is installed and nothing scrolls the row.
 *
 * The wheel listener is passive and never cancels: a stepping row's overflow is hidden, so the browser has nothing of the row's
 * to scroll, and a listener that could cancel would make the browser wait on it for every wheel over a panel, vertical ones too.
 *
 * `onStep` is read through a ref and never re-subscribed: it is a fresh closure every render (nothing here may be
 * memoised), and tearing the listeners down would lose the gesture's travel on every re-render, including the
 * one `onStep` itself causes.
 */
import { useEffect, useRef } from 'react';
import { arrowKeyBelongsElsewhere, contentScrolls } from '../arrowKeys.js';
import { GESTURE_LOCK_MS, GESTURE_QUIET_MS } from '../rowConstants.js';
/** Pixels per line for a wheel that reports `deltaMode` lines (Firefox's mouse wheel); pages count as one step each. */
const LINE_PX = 16;
/**
 * One gesture travels as far as it is pushed, one step per `stepPx` of wheel travel, never by free pixels: the first
 * event of a gesture steps at once, so a short swipe or one wheel notch still moves, and every further `stepPx` of
 * travel in the same direction steps again, momentum included. A reversal starts a fresh gesture. Each step is the
 * caller's glide to the next stop, so the row always comes to rest on one.
 *
 * `gestureLockMs`: after a step, the next one waits at least this long, so a single event far larger than `stepPx`
 * cannot jump several stops in one frame. `gestureQuietMs`: no wheel event for this long ends a gesture.
 */
export function useRowScrollGesture(overflowContainerRef, onStep, gestureLockMs = GESTURE_LOCK_MS, mode = 'step', gestureQuietMs = GESTURE_QUIET_MS, stepPx = 400) {
    const onStepRef = useRef(onStep);
    onStepRef.current = onStep;
    const gestureLockMsRef = useRef(gestureLockMs);
    gestureLockMsRef.current = gestureLockMs;
    const gestureQuietMsRef = useRef(gestureQuietMs);
    gestureQuietMsRef.current = gestureQuietMs;
    const stepPxRef = useRef(stepPx);
    stepPxRef.current = stepPx;
    useEffect(() => {
        const container = overflowContainerRef.current;
        if (!container || mode !== 'step')
            return;
        // 0 between gestures; otherwise the direction of the one in progress.
        let sign = 0;
        // Wheel travel since the last step, in px.
        let travel = 0;
        let lastStepAt = Number.NEGATIVE_INFINITY;
        let quietTimer = null;
        const step = (direction) => {
            lastStepAt = performance.now();
            onStepRef.current(direction > 0 ? 'right' : 'left');
        };
        const onWheel = (e) => {
            // A tilt wheel or two-finger swipe reports deltaX; Shift+wheel usually still reports deltaY, so treat
            // Shift+deltaY as a horizontal ask too. A plain vertical wheel is not a step, and the row does not scroll vertically either (its overflowY is hidden).
            const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && e.deltaY !== 0);
            if (!horizontal)
                return;
            const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (raw === 0)
                return;
            // A panel's own horizontal scroller (a carousel, a wide table) takes the swipe while it can still move.
            if (e.target instanceof Element && contentScrolls(e.target, 'x', Math.sign(raw)))
                return;
            const unit = Math.max(1, stepPxRef.current);
            const amount = e.deltaMode === 1 ? raw * LINE_PX : e.deltaMode === 2 ? raw * unit : raw;
            if (quietTimer)
                clearTimeout(quietTimer);
            quietTimer = setTimeout(() => {
                sign = 0;
                travel = 0;
            }, gestureQuietMsRef.current);
            const direction = Math.sign(amount);
            if (direction !== sign) {
                sign = direction;
                travel = 0;
                step(direction);
                return;
            }
            travel += Math.abs(amount);
            if (travel < unit || performance.now() - lastStepAt < gestureLockMsRef.current)
                return;
            // Travel beyond one more step carries over, capped so a held burst never queues stops it has not shown yet.
            travel = Math.min(travel - unit, unit);
            step(direction);
        };
        const onKeyDown = (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')
                return;
            if (arrowKeyBelongsElsewhere(e, document))
                return;
            // A workspace a column keeps off-screen is inert: its row must not step for a key meant for the one in view.
            if (container.closest('[inert]') !== null)
                return;
            onStepRef.current(e.key === 'ArrowRight' ? 'right' : 'left');
        };
        container.addEventListener('wheel', onWheel, { passive: true });
        window.addEventListener('keydown', onKeyDown);
        return () => {
            container.removeEventListener('wheel', onWheel);
            window.removeEventListener('keydown', onKeyDown);
            if (quietTimer)
                clearTimeout(quietTimer);
        };
        // `overflowContainerRef` is a stable ref object (a useRef in the host's row shell): this effect attaches once,
        // at mount, and reads the latest `onStep` through `onStepRef` instead of re-subscribing to it.
    }, [overflowContainerRef, mode]);
}
