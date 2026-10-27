/**
 * The row's scroll gesture: wheel travel, a horizontal finger drag, or an arrow key asks for steps in a direction. What a
 * step does is the caller's: this hook only filters the input, keeps the burst lock and installs the listeners.
 *
 * Under `mode` 'off' no listener is installed and nothing scrolls the row.
 *
 * The row owns sideways wheel scrolling wherever the pointer is, panel content included: its wheel listener runs in the
 * capture phase and cancels a sideways wheel and stops it before content sees it. Option (Alt) held at a gesture's
 * first event leaves that whole gesture to the content. A vertical wheel is never cancelled, so content scrolls as usual.
 * The listener cannot be passive, so the browser waits on it for every wheel over the row; it returns at once for a vertical one.
 * The touch listeners stay passive and a panel's own horizontal scroller still takes a drag it can move, since a touch has no Option key.
 *
 * `onStep` is read through a ref and never re-subscribed: it is a fresh closure every render (nothing here may be
 * memoised), and tearing the listeners down would lose the gesture's travel on every re-render, including the
 * one `onStep` itself causes.
 */
import { useEffect, useRef } from 'react';
import { arrowKeyBelongsElsewhere, contentScrolls } from '../arrowKeys.js';
import { GESTURE_LOCK_MS, GESTURE_QUIET_MS } from '../rowConstants.js';
import { registerRowKeys } from '../rowStep.js';
/** Pixels per line for a wheel that reports `deltaMode` lines (Firefox's mouse wheel); pages count as one step each. */
const LINE_PX = 16;
/** Finger travel before a touch is read as horizontal or vertical: a tap or a small wobble never steps the row. */
const TOUCH_AXIS_PX = 8;
/** Keeps a wheel the row took from the content: no native scroll, and no listener inside the row sees it. */
function cancel(e) {
    e.preventDefault();
    e.stopPropagation();
}
/**
 * Hands the row a wheel from content whose input never reaches the page, such as an Electron `<webview>` or a cross-origin
 * `<iframe>`: a script in that content cancels the wheel itself and passes its deltas here, with `from` the element that shows it.
 * The row reads the wheel as it reads one over its own content, so a sideways one steps it and a vertical one does nothing.
 * Pass `altKey` true for a gesture the content keeps, so the row lets the rest of it be.
 *
 * @param from - An element inside the row, usually the webview or iframe.
 * @param wheel - The wheel's deltas, `deltaMode` as `WheelEvent` reports it (0 pixels, 1 lines, 2 pages).
 * @returns True when the row took the wheel, so the content must not scroll by it.
 *
 * @public
 */
export function feedRowWheel(from, wheel) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, deltaY: 0, deltaMode: 0, ...wheel });
    from.dispatchEvent(event);
    return event.defaultPrevented;
}
/**
 * One gesture travels as far as it is pushed, one step per `stepPx` of wheel travel, never by free pixels: the first
 * event of a gesture steps at once, so a short swipe or one wheel notch still moves, and every further `stepPx` of
 * travel in the same direction steps again, momentum included. A reversal starts a fresh gesture. Each step is the
 * caller's glide to the next stop, so the row always comes to rest on one.
 *
 * A finger drag feeds the same accumulator: a finger moving left is the travel a wheel reports as `deltaX` > 0, so it asks
 * for the step right. A drag that starts vertical is left to the page for the whole touch.
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
        // Both inputs feed this: `amount` is travel in px, positive for a step to the right.
        const feed = (amount) => {
            const unit = Math.max(1, stepPxRef.current);
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
        // Who owns the wheel gesture in progress: 'row' once it has stepped, 'content' when Option began it, null between gestures.
        let wheelOwner = null;
        let wheelQuietTimer = null;
        const onWheel = (e) => {
            if (wheelQuietTimer)
                clearTimeout(wheelQuietTimer);
            wheelQuietTimer = setTimeout(() => {
                wheelOwner = null;
            }, gestureQuietMsRef.current);
            if (wheelOwner === null && e.altKey)
                wheelOwner = 'content';
            if (wheelOwner === 'content')
                return;
            // A tilt wheel or two-finger swipe reports deltaX; Shift+wheel usually still reports deltaY, so treat
            // Shift+deltaY as a horizontal ask too. A plain vertical wheel is not a step, and the row does not scroll vertically either (its overflowY is hidden).
            const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && e.deltaY !== 0);
            const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!horizontal || raw === 0) {
                // A sideways swipe's vertical wobble stays the row's too, so the content under it does not drift up or down.
                if (wheelOwner === 'row')
                    cancel(e);
                return;
            }
            wheelOwner = 'row';
            cancel(e);
            const unit = Math.max(1, stepPxRef.current);
            feed(e.deltaMode === 1 ? raw * LINE_PX : e.deltaMode === 2 ? raw * unit : raw);
        };
        // One finger's drag: decided as horizontal or vertical once it has moved TOUCH_AXIS_PX, then fed by its steps.
        let touch = null;
        const onTouchStart = (e) => {
            const point = e.touches[0];
            touch = e.touches.length === 1 && point !== undefined ? { startX: point.clientX, startY: point.clientY, lastX: point.clientX, target: e.target, axis: 'none' } : null;
        };
        const onTouchMove = (e) => {
            const point = e.touches[0];
            if (touch === null || point === undefined || e.touches.length !== 1)
                return;
            if (touch.axis === 'none') {
                const dx = point.clientX - touch.startX;
                const dy = point.clientY - touch.startY;
                if (Math.hypot(dx, dy) < TOUCH_AXIS_PX)
                    return;
                touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                // A panel's own horizontal scroller takes a drag it can still move, as it takes a wheel.
                if (touch.axis === 'x' && touch.target instanceof Element && contentScrolls(touch.target, 'x', Math.sign(-dx)))
                    touch.axis = 'y';
                touch.lastX = touch.startX;
            }
            if (touch.axis !== 'x')
                return;
            const moved = point.clientX - touch.lastX;
            touch.lastX = point.clientX;
            if (moved !== 0)
                feed(-moved);
        };
        const onTouchEnd = () => {
            touch = null;
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
        container.addEventListener('wheel', onWheel, { capture: true, passive: false });
        container.addEventListener('touchstart', onTouchStart, { passive: true });
        container.addEventListener('touchmove', onTouchMove, { passive: true });
        container.addEventListener('touchend', onTouchEnd, { passive: true });
        container.addEventListener('touchcancel', onTouchEnd, { passive: true });
        window.addEventListener('keydown', onKeyDown);
        const unregister = registerRowKeys(container, { step: (direction) => onStepRef.current(direction) });
        return () => {
            unregister();
            container.removeEventListener('wheel', onWheel, { capture: true });
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            container.removeEventListener('touchcancel', onTouchEnd);
            window.removeEventListener('keydown', onKeyDown);
            if (quietTimer)
                clearTimeout(quietTimer);
            if (wheelQuietTimer)
                clearTimeout(wheelQuietTimer);
        };
        // `overflowContainerRef` is a stable ref object (a useRef in the host's row shell): this effect attaches once,
        // at mount, and reads the latest `onStep` through `onStepRef` instead of re-subscribing to it.
    }, [overflowContainerRef, mode]);
}
