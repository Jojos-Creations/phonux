/**
 * The row's own scroll gesture: a trackpad/wheel swipe or an arrow key moves the row one step, bringing a
 * hidden (parked) panel back into view from whichever side it sits on. Lives here, off `GoalFrontPage.tsx`
 * (the host's own acceptance grep forbids `useEffect`/`useRef` there), called from `useProvidePanels.ts`
 * instead.
 *
 * Native `addEventListener`, not React's `onWheel`: React 17+ makes the wheel listener passive, so
 * `preventDefault()` (needed so a horizontal swipe never ALSO scrolls the page vertically) has no effect
 * through it (see the record's own citation).
 *
 * `scrollRow` is read through a ref, updated every render but never re-subscribed: `scrollRow` closes over
 * the latest `panels` and is a fresh function every render (nothing here may be memoised, matching the rest
 * of this app's API-bag rule), so a plain dependency-array subscription would tear the listeners down and
 * lose the momentum lock's own timer on every single re-render -- including the one `scrollRow` itself just
 * caused.
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
      // A tilt wheel or two-finger swipe reports deltaX; Shift+wheel usually still reports deltaY (MDN, cited
      // in the record) -- treat Shift+deltaY as a horizontal ask too. Plain vertical wheel (RS14g's own
      // overflowY:'auto' rule) is left alone.
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
