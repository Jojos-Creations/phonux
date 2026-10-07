/**
 * Drag a view's grab handle DOWN to close it; with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */

import * as React from 'react';
import { animate, motion, useDragControls, useIsPresent, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { edgeScrollSpeed, edgeScrollStep } from './edgeScroll.js';
import { PanelSlotContext, type DragScroll } from './panelSlotContext.js';
import { closestRowScroller, rowScrollerFor, type RowScroller, type ScrollClaim } from './rowScroller.js';
import { stepTarget } from './scrollTargets.js';
import type { DragToCloseTuning } from './panelSettings.js';
import { DIRECTION_LOCK_PX, DRAG_CLOSE_NUMBERS, SLIDE_CLOSE_EXIT_SECONDS, SNAP_BACK_SPRING } from './rowConstants.js';

/** The tunables, in one place. Distances in px, velocities in px/s, positive = downward. @public */
export const DRAG_CLOSE = {
  /** Close once dragged this fraction of the view's height ... */
  distanceFraction: DRAG_CLOSE_NUMBERS.distanceFraction,
  /** ... but never less than this: a click that slips a few px is not a close. */
  minDistancePx: DRAG_CLOSE_NUMBERS.minDistancePx,
  /** A flick closes early: at least this fast at release ... */
  flickVelocity: DRAG_CLOSE_NUMBERS.flickVelocity,
  /** ... and at least this far. */
  flickMinDistancePx: DRAG_CLOSE_NUMBERS.flickMinDistancePx,
  /** Released while moving back UP faster than this (negative): the user changed their mind. */
  cancelVelocity: DRAG_CLOSE_NUMBERS.cancelVelocity,
  /** Seconds the box takes to leave the screen. */
  exitSeconds: DRAG_CLOSE_NUMBERS.exitSeconds,
  snapBack: { type: 'spring', stiffness: SNAP_BACK_SPRING.stiffness, damping: SNAP_BACK_SPRING.damping },
} as const;

/** What a DragToClose outside any row reads: the library defaults. */
const OUTSIDE_ROW_DRAG: DragToCloseTuning = {
  distanceFraction: DRAG_CLOSE.distanceFraction,
  minDistancePx: DRAG_CLOSE.minDistancePx,
  flickMinDistancePx: DRAG_CLOSE.flickMinDistancePx,
  flickVelocity: DRAG_CLOSE.flickVelocity,
  cancelVelocity: DRAG_CLOSE.cancelVelocity,
  directionLockPx: DIRECTION_LOCK_PX,
  snapBack: { stiffness: DRAG_CLOSE.snapBack.stiffness, damping: DRAG_CLOSE.snapBack.damping },
};

/** The five numbers the close rule reads. */
type CloseRule = Pick<DragToCloseTuning, 'distanceFraction' | 'minDistancePx' | 'flickMinDistancePx' | 'flickVelocity' | 'cancelVelocity'>;

/** What `shouldCloseOnRelease` reads from a drag's release. @internal */
export interface ReleaseMeasure {
  /** How far the box was dragged from its resting place, px (positive = down). */
  offsetY: number;
  /** Vertical velocity at release, px/s (positive = down). */
  velocityY: number;
  /** The box's own height, px (0 or NaN when unmeasured: only the minimum distance applies). */
  height: number;
}

/** The whole close rule, pure, over `rule` (default DRAG_CLOSE). Never closes on an upward or zero offset, or when released moving back up. @internal */
export function shouldCloseOnRelease({ offsetY, velocityY, height }: ReleaseMeasure, rule: CloseRule = DRAG_CLOSE): boolean {
  if (!(offsetY > 0) || velocityY <= rule.cancelVelocity) return false;
  const distance = Math.max(rule.minDistancePx, rule.distanceFraction * (Number.isFinite(height) ? height : 0));
  if (offsetY >= distance) return true;
  return offsetY >= rule.flickMinDistancePx && velocityY >= rule.flickVelocity;
}

/** Spread onto Panel's `grabProps`. @public */
export interface DragHandleProps {
  /** Starts a drag from a primary-button press on the handle; a press on a button, link or field is ignored. */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** The handle's styles: a grab cursor, no text selection, and `touch-action: pan-x` so a horizontal swipe still scrolls the row. */
  sx: { cursor: 'grab'; touchAction: 'pan-x'; userSelect: 'none'; '&:active': { cursor: 'grabbing' } };
}

/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
  /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
  onDragEnd: (offsetX: number) => void;
}

/** A horizontal drag's hold on the row scroller: the claim, the pointer-down scroll it counts from, and the frame loop. */
interface EdgeHold {
  scroller: RowScroller;
  scrollerEl: HTMLElement;
  claim: ScrollClaim;
  startScroll: number;
  frame: number | null;
  /** The previous frame's timestamp; null until the first frame, whose dt is 0. */
  lastMs: number | null;
  /** Reduced motion: how long the pointer has stayed in a band since the last jump. */
  waitedMs: number;
  /** The pointer has lifted or been cancelled: no further frame may move the row before the release reads the distance. */
  stopped: boolean;
}

/**
 * Edge scrolling for one DragToClose: the claim on the row scroller (taken when a horizontal drag locks), the
 * requestAnimationFrame loop that scrolls it while the pointer rests in a band, and the scroll distance the release
 * adds to the pointer offset. Reads only `dragScroll` from the slot, so what scrolls is decided by the row.
 */
function useEdgeScroll(box: React.RefObject<HTMLDivElement | null>, dragScroll: DragScroll | undefined, reduceMotion: boolean, scrollX: MotionValue<number>) {
  // The loop outlives the render that started it: it reads the latest slot facts and nothing else from the closure.
  const latest = React.useRef({ dragScroll, reduceMotion });
  latest.current = { dragScroll, reduceMotion };
  const pressed = React.useRef<{ scrollerEl: HTMLElement; startScroll: number; downX: number } | null>(null);
  const hold = React.useRef<EdgeHold | null>(null);
  const pointer = React.useRef({ x: 0, offset: 0 });
  const cancelled = React.useRef(false);
  // A capture listener on the window, registered at the press so it runs before motion's own: the loop must not take one
  // more step between the pointer lifting and the release reading the distance.
  const onLift = React.useRef((event: Event) => {
    if (event.type === 'pointercancel') cancelled.current = true;
    const h = hold.current;
    if (h !== null) {
      h.stopped = true;
      if (h.frame !== null) cancelAnimationFrame(h.frame);
      h.frame = null;
    }
    unwatch();
  });
  function unwatch(): void {
    window.removeEventListener('pointerup', onLift.current, true);
    window.removeEventListener('pointercancel', onLift.current, true);
  }

  const tick = (nowMs: number): void => {
    const h = hold.current;
    const slot = latest.current.dragScroll;
    if (h === null) return;
    h.frame = null;
    if (h.stopped || slot === undefined || slot.mode !== 'edge') return;
    const dt = h.lastMs === null ? 0 : nowMs - h.lastMs;
    h.lastMs = nowMs;
    const bound = slot.maxScroll;
    h.claim.setMaxScroll(bound);
    const rect = h.scrollerEl.getBoundingClientRect();
    const speed = edgeScrollSpeed({ pointerX: pointer.current.x, left: rect.left, right: rect.right, zonePx: slot.zonePx, maxPxPerSec: slot.maxPxPerSec });
    const at = h.scroller.scrollLeft();
    if (slot.instant || latest.current.reduceMotion) {
      h.waitedMs = speed === 0 ? 0 : h.waitedMs + dt;
      if (h.waitedMs >= slot.reducedStepMs) {
        h.waitedMs = 0;
        const to = stepTarget(speed < 0 ? 'left' : 'right', at, slot.stops, bound);
        if (to !== null) h.claim.write(to);
      }
    } else if (speed !== 0) {
      h.claim.write(at + edgeScrollStep({ speed, dtMs: dt, scrollLeft: at, maxScroll: bound }));
    }
    scrollX.set(h.scroller.scrollLeft() - h.startScroll);
    h.frame = requestAnimationFrame(tick);
  };

  /** Gives the claim back and returns how far the row scrolled since the pointer went down; 0 when no claim was held. */
  const end = (): number => {
    const h = hold.current;
    if (h === null) return 0;
    hold.current = null;
    if (h.frame !== null) cancelAnimationFrame(h.frame);
    const distance = h.scroller.scrollLeft() - h.startScroll;
    h.claim.release();
    return distance;
  };

  React.useEffect(
    () => () => {
      end();
      unwatch();
    },
    [],
  );
  const edgeOn = dragScroll?.mode === 'edge';
  React.useEffect(() => {
    if (!edgeOn) end();
  }, [edgeOn]);

  return {
    /** A press on the handle: where the pointer is and where the row is scrolled, which the release counts from. */
    press(event: React.PointerEvent<HTMLElement>): void {
      const scrollerEl = box.current === null ? null : closestRowScroller(box.current);
      // A touch swipe is a native pan that ends in pointercancel, so only a mouse or pen drags to the edge.
      pressed.current = scrollerEl === null || event.pointerType === 'touch' ? null : { scrollerEl, startScroll: rowScrollerFor(scrollerEl).scrollLeft(), downX: event.clientX };
      cancelled.current = false;
      unwatch();
      if (pressed.current !== null) {
        window.addEventListener('pointerup', onLift.current, true);
        window.addEventListener('pointercancel', onLift.current, true);
      }
    },
    /** The drag has just locked horizontal: take the claim unless the row is not scrolling or another drag holds it. */
    lock(clientX: number): void {
      const slot = latest.current.dragScroll;
      const p = pressed.current;
      if (p === null || slot === undefined || slot.mode !== 'edge') return;
      const scroller = rowScrollerFor(p.scrollerEl);
      const claim = scroller.claim();
      if (claim === null) return;
      claim.setMaxScroll(slot.maxScroll);
      pointer.current = { x: clientX, offset: clientX - p.downX };
      hold.current = { scroller, scrollerEl: p.scrollerEl, claim, startScroll: p.startScroll, frame: null, lastMs: null, waitedMs: 0, stopped: false };
      hold.current.frame = requestAnimationFrame(tick);
    },
    /** Each pointer move: the box follows the pointer by `x` alone, and the scroll distance rides the second value. */
    track(clientX: number, x: MotionValue<number>): void {
      if (hold.current === null) return;
      pointer.current = { x: clientX, offset: clientX - (pressed.current?.downX ?? clientX) };
      x.set(pointer.current.offset);
    },
    held: (): boolean => hold.current !== null,
    /** The pointer's offset from where it went down, counted by the drag alone. */
    pointerOffset: (): number => pointer.current.offset,
    end,
    /** Ends the press's watch on the pointer and says whether it ended in a pointercancel, which a native pan sends. */
    release(): boolean {
      unwatch();
      pressed.current = null;
      return cancelled.current;
    },
  };
}

/**
 * Springs the box home from where the drag left it. The pointer offset `x` and the row's scroll distance `scrollX` are
 * two translations of one box, so they ride one spring: two springs over distances this different would reach 0 in
 * different frames, and the box would land on its slot in two stages. With no scroll distance this is the plain
 * spring on `x`.
 */
function settleHome(x: MotionValue<number>, scrollX: MotionValue<number>, spring: { type: 'spring'; stiffness: number; damping: number }): ReturnType<typeof animate> {
  const scrolled = scrollX.get();
  if (scrolled === 0) return animate(x, 0, spring);
  const fromX = x.get();
  // Rest thresholds in the px of the larger translation, so the spring stops where a px spring would.
  const scale = Math.max(Math.abs(fromX), Math.abs(scrolled));
  return animate(1, 0, {
    ...spring,
    restDelta: 0.5 / scale,
    restSpeed: 2 / scale,
    onUpdate: (progress) => {
      x.set(fromX * progress);
      scrollX.set(scrolled * progress);
    },
  });
}

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/**
 * A box whose grab handle, dragged down far enough, calls `onClose`; with `reorder`, the same handle also drags
 * sideways. `onClose` must remove the view, because a close never unlocks the scroll ancestors.
 * @public
 */
export function DragToClose({
  onClose,
  reorder,
  children,
}: {
  /** Without it a release past the close line snaps back: the box has nothing to close. */
  onClose?: () => void;
  /** When set, the handle also drags horizontally and reports the total offset to `reorder.onDragEnd` on release. */
  reorder?: ReorderHandle;
  /** Render prop: receives the handle props to spread onto the grab bar, and returns the box's content. */
  children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement {
  const controls = useDragControls();
  const y = useMotionValue(0);
  const x = useMotionValue(0);
  // The row's scroll distance since the pointer went down, drawn as the CSS `translate` property: motion rewrites `transform`, never this.
  const scrollX = useMotionValue(0);
  const scrollTranslate = useTransform(scrollX, (distance) => (distance === 0 ? 'none' : `${distance}px 0px`));
  const box = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const running = React.useRef<{ stop: () => void } | null>(null);
  const locked = React.useRef<Array<[HTMLElement, string]>>([]);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const slot = React.useContext(PanelSlotContext);
  const drag = slot?.tuning.dragToClose ?? OUTSIDE_ROW_DRAG;
  const edge = useEdgeScroll(box, reorder === undefined ? undefined : slot?.dragScroll, reduceMotion === true, scrollX);
  const exitSeconds = slot?.tuning.slide.closeExitSeconds ?? SLIDE_CLOSE_EXIT_SECONDS;
  // Read again when the exit ends: a lock that lands mid-exit must stop the close.
  const closableRef = React.useRef(true);
  closableRef.current = slot?.closable ?? true;
  const closing = React.useRef(false); // a release has decided to close: the exit runs and takes no more presses
  // Set once the first `directionLockPx` decides; null until then, and always for a vertical-only handle.
  const axisLock = React.useRef<'x' | 'y' | null>(null);
  const snapBack = { type: 'spring', stiffness: drag.snapBack.stiffness, damping: drag.snapBack.damping } as const;

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
    scrollX.jump(0);
    if (box.current) box.current.style.transform = 'none';
  }, [isPresent]);

  const handle: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as Element).closest(INTERACTIVE) || closing.current) return; // a press would stop the exit: onClose would never run
      if (running.current) { running.current.stop(); running.current = null; unlockScrollParents(); } // stop() never settles the spring's promise, so its own unlock would not run
      edge.press(event);
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
      style={reorder ? { x, y, translate: scrollTranslate } : { y }}
      onDragStart={() => {
        axisLock.current = null;
        lockScrollParents();
      }}
      onDrag={
        reorder
          ? (event, info) => {
              if (axisLock.current === null && (Math.abs(info.offset.x) >= drag.directionLockPx || Math.abs(info.offset.y) >= drag.directionLockPx)) {
                axisLock.current = Math.abs(info.offset.x) >= Math.abs(info.offset.y) ? 'x' : 'y';
                if (axisLock.current === 'x') edge.lock((event as PointerEvent).clientX);
              }
              edge.track((event as PointerEvent).clientX, x);
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
        const cancelled = reorder ? edge.release() : false;
        if (reorder && lockedAxis === 'x') {
          // The claim goes back before the hop is reported: the move the hop causes may ask the row to scroll, and a held claim would drop that request.
          const held = edge.held();
          const offset = held ? edge.pointerOffset() : info.offset.x;
          const scrolled = edge.end();
          if (!cancelled) reorder.onDragEnd(offset + scrolled);
          if (reduceMotion) {
            x.jump(0); // jump, not set: it also stops the inertia Motion itself just started on x
            scrollX.jump(0);
            return unlockScrollParents();
          }
          const back = settleHome(x, scrollX, snapBack);
          running.current = back;
          void back.then(unlockScrollParents);
          return; // never a close: shouldCloseOnRelease is not even consulted for a horizontal-locked release
        }
        if (reorder) x.jump(0); // residual sub-threshold horizontal drift from a gesture that never locked (or locked vertical)
        const rect = box.current?.getBoundingClientRect();
        const height = rect?.height ?? 0;
        if (closeRef.current !== undefined && closableRef.current && shouldCloseOnRelease({ offsetY: info.offset.y, velocityY: info.velocity.y, height }, drag)) {
          if (reduceMotion) return closeRef.current();
          const toBottom = Math.max(height, window.innerHeight - (rect?.top ?? 0));
          const exit = animate(y, toBottom, { duration: exitSeconds, ease: 'easeIn' });
          running.current = exit;
          closing.current = true;
          void exit.then(() => {
            if (closeRef.current !== undefined && closableRef.current) return closeRef.current();
            closing.current = false;
            const back = animate(y, 0, snapBack);
            running.current = back;
            void back.then(unlockScrollParents);
          });
        } else if (reduceMotion) {
          animate(y, 0, { duration: 0 }); // not y.set(0): Motion's own constraint return is animating y and would win
          unlockScrollParents();
        } else {
          const back = animate(y, 0, snapBack);
          running.current = back;
          void back.then(unlockScrollParents);
        }
      }}
    >
      {children(handle)}
    </motion.div>
  );
}
