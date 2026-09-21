/**
 * Drag a view's header DOWN to close it (owner, 2026-09-20: "drag a shown phone view vertically
 * downward to close it completely"). A UX-system primitive next to PhoneView: it knows nothing about
 * panels or the app, only "the user dragged this box down far enough, call onClose".
 *
 *   <DragToClose onClose={() => panels.close(id)}>
 *     {(handle) => <PhoneView title="Mine" headerProps={{ ...handle, sx: { ...handle.sx, fontWeight: 'bold' } }}>...</PhoneView>}
 *   </DragToClose>
 *
 * The HANDLE is the header pill and nothing else, so the view's body keeps its own scrolling and clicks.
 * The box follows the pointer vertically only, and only downward (upward movement is refused). On
 * release `shouldCloseOnRelease` decides: close (the box leaves downward, then onClose runs) or snap
 * back on a spring. Motion's drag machinery does the pointer work: pointer events on `window`, so the
 * drag survives the pointer leaving the header.
 *
 * Coexistence: touch-action is `pan-x` on the handle, so a horizontal swipe still scrolls the row while
 * a vertical one is ours; a press on a button, link or field inside the header is left alone, and only
 * the primary button grabs. While a drag is live any ancestor that scrolls vertically is locked
 * (`overflow-y: hidden`), because a transformed box adds to its scrollable area and a scrollbar would
 * appear. The lock is released on snap-back and when the box UNMOUNTS. A close never unlocks by itself
 * (the box is still parked below the fold), so onClose MUST remove the view: a caller that keeps it
 * mounted leaves the box off-screen and its scrolling ancestors locked.
 * Reduced motion: no exit animation and no spring, onClose runs at once.
 *
 * Keyboard or single-click alternative (WCAG 2.5.7): offer a button that calls the same onClose, as
 * History's trash buttons do.
 */

import * as React from 'react';
import { animate, motion, useDragControls, useMotionValue, useReducedMotion } from 'motion/react';

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

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

export function DragToClose({ onClose, children }: { onClose: () => void; children: (handle: DragHandleProps) => React.ReactNode }): React.ReactElement {
  const controls = useDragControls();
  const y = useMotionValue(0);
  const box = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const running = React.useRef<{ stop: () => void } | null>(null);
  const locked = React.useRef<Array<[HTMLElement, string]>>([]);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

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

  const handle: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as Element).closest(INTERACTIVE)) return;
      running.current?.stop();
      controls.start(event);
    },
    sx: { cursor: 'grab', touchAction: 'pan-x', userSelect: 'none', '&:active': { cursor: 'grabbing' } },
  };

  return (
    <motion.div
      ref={box}
      data-drag-to-close=""
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 1 }}
      style={{ y }}
      onDragStart={lockScrollParents}
      onDragEnd={(_event, info) => {
        const rect = box.current?.getBoundingClientRect();
        const height = rect?.height ?? 0;
        if (shouldCloseOnRelease({ offsetY: info.offset.y, velocityY: info.velocity.y, height })) {
          if (reduceMotion) return closeRef.current();
          const toBottom = Math.max(height, window.innerHeight - (rect?.top ?? 0));
          const exit = animate(y, toBottom, { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' });
          running.current = exit;
          void exit.then(() => closeRef.current());
        } else if (reduceMotion) {
          y.set(0);
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
