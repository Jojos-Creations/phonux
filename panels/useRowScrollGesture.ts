/**
 * The row's scroll gesture: a wheel swipe or an arrow key moves the row one step, bringing a parked panel back from
 * whichever side it sits on.
 *
 * Native `addEventListener`, not React's `onWheel`: React's wheel listener is passive, so the `preventDefault()` that
 * keeps a horizontal swipe from also scrolling the page vertically would do nothing.
 *
 * `scrollRow` is read through a ref and never re-subscribed: it is a fresh closure every render (nothing here may be
 * memoised), and tearing the listeners down would lose the momentum lock's timer on every re-render, including the
 * one `scrollRow` itself causes.
 */
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** A trackpad swipe arrives as a burst of small wheel deltas with a momentum tail; Chromium cannot tell a momentum event from a fresh user one. Locking on the first event of a burst and unlocking only after this long of silence (not a shorter one -- gaps inside a real momentum stream can exceed 150 ms) keeps one swipe to one step. */
const GESTURE_LOCK_MS = 350;

export function useRowScrollGesture(overflowContainerRef: RefObject<HTMLDivElement | null>, scrollRow: (direction: 'left' | 'right') => void): void {
  const scrollRowRef = useRef(scrollRow);
  scrollRowRef.current = scrollRow;

  useEffect(() => {
    const container = overflowContainerRef.current;
    if (!container) return;
    let locked = false;
    let unlockTimer: ReturnType<typeof setTimeout> | null = null;
    const armUnlock = (): void => {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => {
        locked = false;
      }, GESTURE_LOCK_MS);
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
        scrollRowRef.current(amount > 0 ? 'right' : 'left');
      }
      armUnlock();
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      scrollRowRef.current(e.key === 'ArrowRight' ? 'right' : 'left');
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      if (unlockTimer) clearTimeout(unlockTimer);
    };
    // `overflowContainerRef` is a stable ref object (useRef in useRowShell.ts): this effect attaches once,
    // at mount, and reads the latest `scrollRow` through `scrollRowRef` instead of re-subscribing to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overflowContainerRef]);
}
