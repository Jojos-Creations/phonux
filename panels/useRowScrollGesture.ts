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
import { GESTURE_LOCK_MS } from '../rowConstants.js';

/**
 * `gestureLockMs`: a trackpad swipe arrives as a burst of small wheel deltas with a momentum tail, and a WebKit or Blink browser cannot
 * tell a momentum event from a fresh user one. Locking on the first event of a burst and unlocking only after this
 * long of silence (the default is not shorter: gaps inside a real momentum stream can exceed 150 ms) keeps one swipe
 * to one step.
 */
export function useRowScrollGesture(
  overflowContainerRef: RefObject<HTMLDivElement | null>,
  onStep: (direction: 'left' | 'right') => void,
  gestureLockMs: number = GESTURE_LOCK_MS,
  mode: 'step' | 'free' | 'off' = 'step',
): void {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const gestureLockMsRef = useRef(gestureLockMs);
  gestureLockMsRef.current = gestureLockMs;

  useEffect(() => {
    const container = overflowContainerRef.current;
    if (!container || mode !== 'step') return;
    let locked = false;
    let unlockTimer: ReturnType<typeof setTimeout> | null = null;
    const armUnlock = (): void => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        locked = false;
      }, gestureLockMsRef.current);
    };
    const onWheel = (e: WheelEvent): void => {
      // A tilt wheel or two-finger swipe reports deltaX; Shift+wheel usually still reports deltaY, so treat
      // Shift+deltaY as a horizontal ask too. Plain vertical wheel is left to overflowY:'auto'.
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || (e.shiftKey && e.deltaY !== 0);
      if (!horizontal) return;
      const amount = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (amount === 0) return;
      e.preventDefault();
      if (!locked) {
        locked = true;
        onStepRef.current(amount > 0 ? 'right' : 'left');
      }
      armUnlock();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
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
    };
    // `overflowContainerRef` is a stable ref object (a useRef in the host's row shell): this effect attaches once,
    // at mount, and reads the latest `onStep` through `onStepRef` instead of re-subscribing to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overflowContainerRef, mode]);
}
