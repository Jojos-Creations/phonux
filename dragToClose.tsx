/**
 * Drag a view's header DOWN to close it (owner, 2026-09-20: "drag a shown phone view vertically
 * downward to close it completely"). A UX-system primitive next to PhoneView: it knows nothing about
 * panels or the app, only "the user dragged this box down far enough, call onClose".
 *
 *   <DragToClose onClose={() => panels.close(id)}>
 *     {(handle) => <PhoneView title="Mine" headerProps={{ ...handle, sx: { ...handle.sx, fontWeight: 'bold' } }}>...</PhoneView>}
 *   </DragToClose>
 *
 * The HANDLE is the header pill and nothing else, so the body keeps its own scrolling and clicks. The box follows the
 * pointer vertically and only downward. On release `shouldCloseOnRelease` decides: close (the box leaves downward,
 * then the LATEST onClose runs) or snap back on a spring. Motion's drag machinery does the pointer work (events on
 * `window`, so the drag survives leaving the header).
 *
 * Coexistence: touch-action is `pan-x` on the handle (a horizontal swipe still scrolls the row, a vertical one is
 * ours); a press on a button, link or field in the header is left alone, and only the primary button grabs. While a
 * drag is live every vertically scrolling ancestor is locked (`overflow-y: hidden`: a transformed box would add a
 * scrollbar); the lock ends with the spring back (or a press that stops it) and when the box UNMOUNTS. A close never
 * unlocks (the box is parked below the fold), so onClose MUST remove the view, and once a release has decided to close
 * the box takes no more presses (one would stop the exit and the close would never run). If the owner then brings the box back
 * while AnimatePresence still holds it (the same key returns: an undo), it is made a fresh box at once: at rest, unlocked, taking
 * presses, its pending exit stopped. Reduced motion: no exit animation and no spring; a far drag calls onClose at once, a short
 * one (or a horizontal reorder release) puts the box back at once.
 *
 * Keyboard or single-click alternative (WCAG 2.5.7): offer a button that calls the same onClose, as
 * History's trash buttons do. The row's own drag-to-reorder gesture needs a single-pointer alternative too
 * (a `move` API exists, hostApi.tsx's PanelsAPI.move) -- not built here, a disclosed gap.
 *
 * `reorder` (optional) makes the SAME handle also drag horizontally: both axes stay enabled the whole
 * gesture (`drag={true}`, never toggled -- a ref-driven axis prop never re-renders, so Motion would keep
 * reading the value from before the gesture began), and the first ~`DIRECTION_LOCK_PX` of movement decides
 * which axis wins, zeroing the LOSING axis's OWN MotionValue every tick after that. A gesture that locks
 * horizontal never evaluates `shouldCloseOnRelease` at all (so residual vertical jitter, however Motion
 * reports it, can never close the view); one that locks vertical (or never locks, a sub-threshold jiggle)
 * runs the exact close logic above, unchanged. Omit `reorder` for a handle that only ever closes (e.g.
 * History's own bar, which is never a reorder source) -- `drag` stays `'y'`, matching this file's original,
 * narrower contract exactly.
 */

import * as React from 'react';
import { animate, motion, useDragControls, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react';

/** The first this many px of either axis decide which one the gesture locks to. */
const DIRECTION_LOCK_PX = 8;

/** The tunables, in one place. Distances in px, velocities in px/s, positive = downward. */
export const DRAG_CLOSE = {
  /** Close once dragged this fraction of the view's height ... */
  distanceFraction: 0.25,
  /** ... but never less than this: a click that slips a few px is not a close. */
  minDistancePx: 80,
  /** A flick closes early: at least this fast at release ... */
  flickVelocity: 700,
  /** ... and at least this far. */
  flickMinDistancePx: 40,
  /** Released while moving back UP faster than this (negative): the user changed their mind. */
  cancelVelocity: -300,
  /** Seconds the box takes to leave the screen. */
  exitSeconds: 0.18,
  snapBack: { type: 'spring', stiffness: 520, damping: 42 },
} as const;

export interface ReleaseMeasure {
  /** How far the box was dragged from its resting place, px (positive = down). */
  offsetY: number;
  /** Vertical velocity at release, px/s (positive = down). */
  velocityY: number;
  /** The box's own height, px (0 or NaN when unmeasured: only the minimum distance applies). */
  height: number;
}

/** The whole close rule, pure. Never closes on an upward or zero offset, or when released moving back up. */
export function shouldCloseOnRelease({ offsetY, velocityY, height }: ReleaseMeasure): boolean {
  if (!(offsetY > 0) || velocityY <= DRAG_CLOSE.cancelVelocity) return false;
  const distance = Math.max(DRAG_CLOSE.minDistancePx, DRAG_CLOSE.distanceFraction * (Number.isFinite(height) ? height : 0));
  if (offsetY >= distance) return true;
  return offsetY >= DRAG_CLOSE.flickMinDistancePx && velocityY >= DRAG_CLOSE.flickVelocity;
}

/** Spread into PhoneView's `headerProps` (merge `sx` with the view's own). */
export interface DragHandleProps {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  sx: { cursor: 'grab'; touchAction: 'pan-x'; userSelect: 'none'; '&:active': { cursor: 'grabbing' } };
}

/** Wires the SAME handle's horizontal branch to a caller's own reorder mechanism -- see this file's own header comment for the full contract. */
export interface ReorderHandle {
  /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
  onDragEnd: (offsetX: number) => void;
}

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

export function DragToClose({
  onClose,
  reorder,
  children,
}: {
  onClose: () => void;
  reorder?: ReorderHandle;
  children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement {
  const controls = useDragControls();
  const y = useMotionValue(0);
  const x = useMotionValue(0);
  const box = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const running = React.useRef<{ stop: () => void } | null>(null);
  const locked = React.useRef<Array<[HTMLElement, string]>>([]);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const closing = React.useRef(false); // a release has decided to close: the exit runs and takes no more presses
  // Which axis this gesture locked to, once the first DIRECTION_LOCK_PX decides -- null before that (or for
  // a plain vertical-only handle, which never sets it at all).
  const axisLock = React.useRef<'x' | 'y' | null>(null);

  const lockScrollParents = () => {
    for (let el = box.current?.parentElement ?? null; el; el = el.parentElement) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        locked.current.push([el, el.style.overflowY]);
        el.style.overflowY = 'hidden';
      }
    }
  };
  const unlockScrollParents = () => {
    for (const [el, previous] of locked.current.splice(0)) el.style.overflowY = previous;
  };
  React.useEffect(
    () => () => {
      running.current?.stop();
      unlockScrollParents();
    },
    [],
  );
  // Revival: an AnimatePresence that is still holding this box while it leaves keeps the SAME instance when the key returns (an undo), parked
  // below the fold, locked and refusing presses. A layout effect, and the DOM is written here too, not on Motion's next frame: the host scrolls a
  // revived view into view in this same commit, right after this, and must find the box at rest.
  const isPresent = useIsPresent();
  const wasPresent = React.useRef(true);
  React.useLayoutEffect(() => {
    const revived = isPresent && !wasPresent.current;
    wasPresent.current = isPresent;
    if (!revived) return;
    closing.current = false;
    unlockScrollParents();
    y.jump(0); // also stops an exit that is still running: its end would call onClose for a box that is back
    x.jump(0);
    if (box.current) box.current.style.transform = 'none';
  }, [isPresent]);

  const handle: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as Element).closest(INTERACTIVE) || closing.current) return; // a press would stop the exit: onClose would never run
      if (running.current) { running.current.stop(); running.current = null; unlockScrollParents(); } // stop() never settles the spring's promise, so its own unlock would not run
      controls.start(event); // a real drag locks again in onDragStart
    },
    sx: { cursor: 'grab', touchAction: 'pan-x', userSelect: 'none', '&:active': { cursor: 'grabbing' } },
  };

  return (
    <motion.div
      ref={box}
      data-drag-to-close=""
      drag={reorder ? true : 'y'}
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 1 }}
      style={reorder ? { x, y } : { y }}
      onDragStart={() => {
        axisLock.current = null;
        lockScrollParents();
      }}
      onDrag={
        reorder
          ? (_event, info) => {
              if (axisLock.current === null && (Math.abs(info.offset.x) >= DIRECTION_LOCK_PX || Math.abs(info.offset.y) >= DIRECTION_LOCK_PX)) {
                axisLock.current = Math.abs(info.offset.x) >= Math.abs(info.offset.y) ? 'x' : 'y';
              }
              // Every tick after the lock resolves, override whatever Motion just wrote to the LOSING axis:
              // this file's own header comment explains why toggling the `drag` prop mid-gesture cannot work.
              if (axisLock.current === 'x') y.set(0);
              else if (axisLock.current === 'y') x.set(0);
            }
          : undefined
      }
      onDragEnd={(_event, info) => {
        const lockedAxis = axisLock.current;
        axisLock.current = null;
        if (reorder && lockedAxis === 'x') {
          reorder.onDragEnd(info.offset.x);
          if (reduceMotion) {
            x.jump(0); // jump, not set: it also stops the inertia Motion itself just started on x
            return unlockScrollParents();
          }
          const back = animate(x, 0, DRAG_CLOSE.snapBack);
          running.current = back;
          void back.then(unlockScrollParents);
          return; // never a close: shouldCloseOnRelease is not even consulted for a horizontal-locked release
        }
        if (reorder) x.jump(0); // residual sub-threshold horizontal drift from a gesture that never locked (or locked vertical)
        const rect = box.current?.getBoundingClientRect();
        const height = rect?.height ?? 0;
        if (shouldCloseOnRelease({ offsetY: info.offset.y, velocityY: info.velocity.y, height })) {
          if (reduceMotion) return closeRef.current();
          const toBottom = Math.max(height, window.innerHeight - (rect?.top ?? 0));
          const exit = animate(y, toBottom, { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' });
          running.current = exit;
          closing.current = true;
          void exit.then(() => closeRef.current());
        } else if (reduceMotion) {
          animate(y, 0, { duration: 0 }); // not y.set(0): Motion's own constraint return is animating y and would win
          unlockScrollParents();
        } else {
          const back = animate(y, 0, DRAG_CLOSE.snapBack);
          running.current = back;
          void back.then(unlockScrollParents);
        }
      }}
    >
      {children(handle)}
    </motion.div>
  );
}
