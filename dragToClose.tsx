/**
 * Drag a view's grab handle DOWN to close it; with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */

import * as React from 'react';
import { animate, motion, useDragControls, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react';

/** The first this many px of either axis decide which one the gesture locks to. */
const DIRECTION_LOCK_PX = 8;

/** The tunables, in one place. Distances in px, velocities in px/s, positive = downward. @public */
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

/** @public */
export interface ReleaseMeasure {
  /** How far the box was dragged from its resting place, px (positive = down). */
  offsetY: number;
  /** Vertical velocity at release, px/s (positive = down). */
  velocityY: number;
  /** The box's own height, px (0 or NaN when unmeasured: only the minimum distance applies). */
  height: number;
}

/** The whole close rule, pure. Never closes on an upward or zero offset, or when released moving back up. @public */
export function shouldCloseOnRelease({ offsetY, velocityY, height }: ReleaseMeasure): boolean {
  if (!(offsetY > 0) || velocityY <= DRAG_CLOSE.cancelVelocity) return false;
  const distance = Math.max(DRAG_CLOSE.minDistancePx, DRAG_CLOSE.distanceFraction * (Number.isFinite(height) ? height : 0));
  if (offsetY >= distance) return true;
  return offsetY >= DRAG_CLOSE.flickMinDistancePx && velocityY >= DRAG_CLOSE.flickVelocity;
}

/** Spread onto Panel's `grabProps`. @public */
export interface DragHandleProps {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  sx: { cursor: 'grab'; touchAction: 'pan-x'; userSelect: 'none'; '&:active': { cursor: 'grabbing' } };
}

/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
  /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
  onDragEnd: (offsetX: number) => void;
}

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/** @public */
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
  // Set once the first DIRECTION_LOCK_PX decides; null until then, and always for a vertical-only handle.
  const axisLock = React.useRef<'x' | 'y' | null>(null);

  // overflow-y: hidden while a drag is live: the transformed box would otherwise add a scrollbar.
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
  // An undo while AnimatePresence still holds this box revives the SAME instance: parked, locked, refusing presses. A layout effect that
  // writes the DOM itself, not on Motion's next frame: the host scrolls a revived view into view in this same commit and must find it at rest.
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
    // pan-x: a horizontal swipe still scrolls the row; a vertical one is this gesture's.
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
              // Zero the losing axis every tick instead of toggling `drag`: Motion keeps reading the axis prop's
              // value from before the gesture began.
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
