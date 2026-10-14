/**
 * The row's scroll gesture: a wheel swipe or an arrow key asks for one step in a direction. What a step does is the
 * caller's: this hook only filters the input, keeps the burst lock and installs the listeners.
 *
 * Under `mode` 'free' and 'off' no listener is installed: the browser scrolls natively ('free') or nothing does.
 *
 * Native `addEventListener`, not React's `onWheel`: React's wheel listener is passive, so the `preventDefault()` that
 * keeps a horizontal swipe from also scrolling the page vertically would do nothing.
 *
 * `onStep` is read through a ref and never re-subscribed: it is a fresh closure every render (nothing here may be
 * memoised), and tearing the listeners down would lose the momentum lock's timer on every re-render, including the
 * one `onStep` itself causes.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { GESTURE_LOCK_MS, GESTURE_QUIET_MS } from '../rowConstants.js';

/** How far above the trough of a fading tail an event must rise to count as a new swipe; tail jitter such as 14, 12, 13 stays under it. */
const RISE_FACTOR = 1.5;
/** The least the rise must also add to the trough, in delta units: a tail rounded to whole pixels (1, 1, 2, 1) is not a new swipe. */
const RISE_FLOOR = 4;

/**
 * `gestureLockMs`: after a step, wheel events are ignored for this long (the lock is not re-armed by them). A trackpad
 * swipe arrives as a burst of wheel deltas that ramps up, peaks and fades, with a momentum tail, and a WebKit or Blink
 * browser cannot tell a momentum event from a fresh user one. So one swipe is one step: after a step, an event steps again
 * only once the lock is over and either its direction reverses, or the deltas have fallen since the step (the trough is
 * the smallest magnitude seen since) and the event is at least `RISE_FACTOR` times the trough and `RISE_FLOOR` above it, a new swipe starting in the
 * tail. A plateau of equal deltas, a ramp, and jitter in a tail never step again.
 *
 * `gestureQuietMs`: no wheel event for this long ends a gesture, so the next event is fresh and steps whatever its size.
 */
export function useRowScrollGesture(
  overflowContainerRef: RefObject<HTMLDivElement | null>,
  onStep: (direction: 'left' | 'right') => void,
  gestureLockMs: number = GESTURE_LOCK_MS,
  mode: 'step' | 'free' | 'off' = 'step',
  gestureQuietMs: number = GESTURE_QUIET_MS,
): void {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const gestureLockMsRef = useRef(gestureLockMs);
  gestureLockMsRef.current = gestureLockMs;
  const gestureQuietMsRef = useRef(gestureQuietMs);
  gestureQuietMsRef.current = gestureQuietMs;

  useEffect(() => {
    const container = overflowContainerRef.current;
    if (!container || mode !== 'step') return;
    let locked = false;
    let previous = 0;
    let previousSign = 0;
    // The smallest magnitude seen since the last step once the deltas have fallen; null until they do.
    let trough: number | null = null;
    let unlockTimer: ReturnType<typeof setTimeout> | null = null;
    let quietTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (e: WheelEvent): void => {
      // A tilt wheel or two-finger swipe reports deltaX; Shift+wheel usually still reports deltaY, so treat
      // Shift+deltaY as a horizontal ask too. Plain vertical wheel is left to overflowY:'auto'.
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && e.deltaY !== 0);
      if (!horizontal) return;
      const amount = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (amount === 0) return;
      e.preventDefault();
      const magnitude = Math.abs(amount);
      const sign = Math.sign(amount);
      const reversed = sign !== previousSign;
      // A reversal inside the lock is not lost: the first event after it steps.
      if (reversed) trough = 0;
      else if (magnitude < previous) trough = trough === null ? magnitude : Math.min(trough, magnitude);
      const fresh = reversed || previous === 0;
      const holding = fresh || (trough !== null && magnitude >= Math.max(trough * RISE_FACTOR, trough + RISE_FLOOR));
      previous = magnitude;
      previousSign = sign;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        previous = 0;
      }, gestureQuietMsRef.current);
      if (locked || !holding) return;
      locked = true;
      trough = null;
      unlockTimer = setTimeout(() => {
        locked = false;
      }, gestureLockMsRef.current);
      onStepRef.current(sign > 0 ? 'right' : 'left');
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      // A control that used the arrow (a resize grabber) has acted; the row must not also step.
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // A workspace a column keeps off-screen is inert: its row must not step for a key meant for the one in view.
      if (container.closest('[inert]') !== null) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      onStepRef.current(e.key === 'ArrowRight' ? 'right' : 'left');
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      if (unlockTimer) clearTimeout(unlockTimer);
      if (quietTimer) clearTimeout(quietTimer);
    };
    // `overflowContainerRef` is a stable ref object (a useRef in the host's row shell): this effect attaches once,
    // at mount, and reads the latest `onStep` through `onStepRef` instead of re-subscribing to it.
  }, [overflowContainerRef, mode]);
}
