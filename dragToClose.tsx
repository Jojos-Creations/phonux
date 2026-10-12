/**
 * Drag a view's grab handle DOWN to close it; with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */

import * as React from 'react';
import { DndContext, PointerSensor, useDndMonitor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { animate, cancelFrame, frame, motion, useIsPresent, useMotionValue, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
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
  /** The slot's edge numbers when the drag locked: a configure made mid-drag must reach the next drag, not this one. */
  began: { zonePx: number; maxPxPerSec: number; reducedStepMs: number };
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
function useEdgeScroll(box: React.RefObject<HTMLDivElement | null>, dragScroll: DragScroll | undefined, reduceMotion: boolean, x: MotionValue<number>, scrollX: MotionValue<number>) {
  // The loop outlives the render that started it: the bound, the stops and `instant` come from the latest slot, while the
  // mode and the three edge numbers stay with the hold, because a drag in flight keeps what it locked with.
  const latest = React.useRef({ dragScroll, reduceMotion });
  latest.current = { dragScroll, reduceMotion };
  const pressed = React.useRef<{ scrollerEl: HTMLElement; startScroll: number; downX: number } | null>(null);
  const hold = React.useRef<EdgeHold | null>(null);
  const pointer = React.useRef({ x: 0, offset: 0 });
  const cancelled = React.useRef(false);
  // How far the box may be drawn right of its slot before it passes the row's end, in content px. A box drawn past the end
  // adds to the scroll container's scrollable width; Infinity when nothing is measured.
  const slack = React.useRef(Number.POSITIVE_INFINITY);
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
  /** The drawn offset for a wanted pointer offset: the box and the row's scroll distance together never carry it past the row's end. */
  const cap = (wanted: number): number => Math.min(wanted, slack.current - scrollX.get());
  function unwatch(): void {
    window.removeEventListener('pointerup', onLift.current, true);
    window.removeEventListener('pointercancel', onLift.current, true);
  }

  const tick = (nowMs: number): void => {
    const h = hold.current;
    const slot = latest.current.dragScroll;
    if (h === null) return;
    h.frame = null;
    if (h.stopped || slot === undefined) return;
    const dt = h.lastMs === null ? 0 : nowMs - h.lastMs;
    h.lastMs = nowMs;
    const bound = slot.maxScroll;
    h.claim.setMaxScroll(bound);
    const rect = h.scrollerEl.getBoundingClientRect();
    const speed = edgeScrollSpeed({ pointerX: pointer.current.x, left: rect.left, right: rect.right, zonePx: h.began.zonePx, maxPxPerSec: h.began.maxPxPerSec });
    const at = h.scroller.scrollLeft();
    if (slot.instant || latest.current.reduceMotion) {
      h.waitedMs = speed === 0 ? 0 : h.waitedMs + dt;
      if (h.waitedMs >= h.began.reducedStepMs) {
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
  const rowScrolls = dragScroll !== undefined;
  React.useEffect(() => {
    if (!rowScrolls) end();
  }, [rowScrolls]);

  return {
    /** A press on the handle: where the pointer is and where the row is scrolled, which the release counts from. */
    press(event: React.PointerEvent<HTMLElement>): void {
      const scrollerEl = box.current === null ? null : closestRowScroller(box.current);
      slack.current = Number.POSITIVE_INFINITY;
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
      const rowEnd = p?.scrollerEl.querySelector(':scope > [data-row-strip]')?.getBoundingClientRect();
      const own = box.current?.getBoundingClientRect();
      // Rects and the translations drawn now are in the same screen px; both ends scroll together, so the gap holds as the row scrolls.
      slack.current = rowEnd === undefined || own === undefined || rowEnd.width === 0 ? Number.POSITIVE_INFINITY : rowEnd.right - (own.right - x.get() - scrollX.get());
      if (p === null || slot === undefined || slot.mode !== 'edge') return;
      const scroller = rowScrollerFor(p.scrollerEl);
      const claim = scroller.claim();
      if (claim === null) return;
      claim.setMaxScroll(slot.maxScroll);
      pointer.current = { x: clientX, offset: clientX - p.downX };
      hold.current = { scroller, scrollerEl: p.scrollerEl, claim, startScroll: p.startScroll, began: { zonePx: slot.zonePx, maxPxPerSec: slot.maxPxPerSec, reducedStepMs: slot.reducedStepMs }, frame: null, lastMs: null, waitedMs: 0, stopped: false };
      hold.current.frame = requestAnimationFrame(tick);
    },
    /** Each pointer move: the box follows the pointer by `x` alone, and the scroll distance rides the second value. */
    track(clientX: number, x: MotionValue<number>): void {
      if (hold.current === null) return;
      pointer.current = { x: clientX, offset: clientX - (pressed.current?.downX ?? clientX) };
      x.set(pointer.current.offset);
    },
    cap,
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

/**
 * The fastest the pointer travelled between two samples at least SEGMENT_MIN_MS apart, px/s (positive = down). The
 * peak, not the average of the window: a flick is judged by how fast it moved, and its events arrive unevenly.
 */
function peakSpeed(samples: ReadonlyArray<{ t: number; y: number }>): number {
  let peak = 0;
  let from = 0;
  for (let to = 1; to < samples.length; to += 1) {
    const dt = samples[to]!.t - samples[from]!.t;
    if (dt < SEGMENT_MIN_MS) continue;
    peak = Math.max(peak, ((samples[to]!.y - samples[from]!.y) / dt) * 1000);
    from = to;
  }
  return peak;
}

/** Samples closer together than this are one segment, so two events sharing a timestamp cannot make an infinite speed. */
const SEGMENT_MIN_MS = 8;

/** A pointer that lifts this long after its last move had stopped: no velocity, however fast it was going before. */
const REST_MS = 50;

/** How far back the release velocity looks, ms. */
const VELOCITY_WINDOW_MS = 100;

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/**
 * A box whose grab handle, dragged down far enough, calls `onClose`; with `reorder`, the same handle also drags
 * sideways. `onClose` must remove the view, because a close never unlocks the scroll ancestors.
 * @public
 */
export function DragToClose(input: {
  /** Without it a release past the close line snaps back: the box has nothing to close. */
  onClose?: () => void;
  /** When set, the handle also drags horizontally and reports the total offset to `reorder.onDragEnd` on release. */
  reorder?: ReorderHandle;
  /** Render prop: receives the handle props to spread onto the grab bar, and returns the box's content. */
  children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement {
  const slot = React.useContext(PanelSlotContext);
  const lockPx = (slot?.tuning.dragToClose ?? OUTSIDE_ROW_DRAG).directionLockPx;
  // The distance is the direction lock, a hair under it because the sensor wants to be passed and a lock is reached.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: Math.max(0, lockPx - 0.01) } }));
  // autoScroll off: dnd-kit would write scrollLeft itself, and the row's scroll claim is the one writer.
  return (
    <DndContext sensors={sensors} autoScroll={false}>
      <DragToCloseBox {...input} />
    </DndContext>
  );
}

function DragToCloseBox({
  onClose,
  reorder,
  children,
}: {
  onClose?: () => void;
  reorder?: ReorderHandle;
  children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement {
  const draggable = useDraggable({ id: React.useId() });
  // Where the pointer went down and where it is: read from the events themselves, because dnd-kit reports a move only after its
  // activation distance and a release right after the activating move would otherwise read no offset.
  const pointer = React.useRef({ downX: 0, downY: 0, x: 0, y: 0 });
  const samples = React.useRef<Array<{ t: number; y: number }>>([]);
  const released = React.useRef(0);
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
  // Read by the frame step and the release, which outlive the render that started them.
  const slotRef = React.useRef(slot);
  slotRef.current = slot;
  const drag = slot?.tuning.dragToClose ?? OUTSIDE_ROW_DRAG;
  const edge = useEdgeScroll(box, reorder === undefined ? undefined : slot?.dragScroll, reduceMotion === true, x, scrollX);
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
  // The cleanup leaves a running spring alone: React 19.2 re-runs it for a keyed child a reorder moves under StrictMode, and
  // Activity runs it on a hide; a stopped release spring leaves the box at its drag offset.
  React.useEffect(() => unlockScrollParents, []);
  // The row slides the neighbours aside while a horizontal drag is live; the preview ends with the drag and with the box.
  // The row keeps the dragged slot raised from the first publish until null, so null follows the spring home that ends the drag.
  const previewed = React.useRef<number | null | undefined>(null);
  const preview = (offset: number | null) => {
    if (previewed.current === offset) return;
    previewed.current = offset;
    slotRef.current?.previewReorder?.(offset);
  };
  // A cleanup that React 19.2 also runs for a keyed child a reorder moves: forget what was published so a live drag republishes on its next frame.
  // A box that really unmounts needs no clear: the row ignores a dragged id it no longer renders.
  React.useEffect(
    () => () => {
      previewed.current = undefined;
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
    preview(null);
    y.jump(0); // also stops an exit that is still running: its end would call onClose for a box that is back
    x.jump(0);
    scrollX.jump(0);
    if (box.current) box.current.style.transform = 'none';
  }, [isPresent]);

  // Release springs the box home; a cancelled gesture takes the same road without reporting a hop or a close.
  const springHome = () => {
    const back = settleHome(x, scrollX, snapBack);
    running.current = back;
    void back.then(() => {
      unlockScrollParents();
      preview(null);
    });
  };
  // A press stopped a spring that had not reached rest: if the press never becomes a drag, nothing else returns the box.
  const stoppedSpring = React.useRef(false);
  const returnHome = () => {
    stoppedSpring.current = false;
    const vertical = animate(y, 0, snapBack);
    const sideways = settleHome(x, scrollX, snapBack);
    running.current = { stop: () => { vertical.stop(); sideways.stop(); } };
    void Promise.all([vertical, sideways]).then(() => {
      unlockScrollParents();
      preview(null);
    });
  };
  const engaged = React.useRef(false);
  const followStep = React.useRef<(() => void) | null>(null);
  const stopFollowing = () => {
    engaged.current = false;
    if (followStep.current !== null) cancelFrame(followStep.current);
    followStep.current = null;
  };
  const latestMove = React.useRef<() => void>(() => undefined);
  const returnHomeRef = React.useRef<() => void>(() => undefined);
  returnHomeRef.current = returnHome;
  const trackPointer = React.useRef((event: Event) => {
    const { clientX, clientY } = event as PointerEvent;
    if (event.type !== 'pointercancel') {
      pointer.current = { ...pointer.current, x: clientX, y: clientY };
      if (event.type === 'pointerup') released.current = event.timeStamp;
      else {
        // Every move is a sample, stamped by the browser: a short flick is a few events, and a frame loop would see fewer.
        const kept = samples.current;
        kept.push({ t: event.timeStamp, y: clientY - pointer.current.downY });
        while (kept.length > 2 && kept[0]!.t < event.timeStamp - VELOCITY_WINDOW_MS) kept.shift();
      }
    }
    if (event.type === 'pointermove') return latestMove.current();
    for (const type of ['pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(type, trackPointer.current, true);
    // This capture listener runs before dnd-kit's: a press that never engaged gets no onDragEnd, so it ends here.
    if (stoppedSpring.current && !engaged.current) returnHomeRef.current();
  });

  // The box follows the pointer on the locked axis; the lock is decided by the first offset past the direction lock.
  const follow = (): { dx: number; dy: number } => {
    // The frame step outlives the render that started it; a box that is gone ends it.
    if (box.current === null || !box.current.isConnected) stopFollowing();
    const dx = pointer.current.x - pointer.current.downX;
    const dy = pointer.current.y - pointer.current.downY;
    if (axisLock.current === null) {
      axisLock.current = reorder !== undefined && Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      if (axisLock.current === 'x') edge.lock(pointer.current.x);
    }
    edge.track(pointer.current.x, x);
    if (axisLock.current === 'x') {
      const rowSlot = slotRef.current;
      // The pointer offset plus the row's scroll distance is what the release hands the hop rule.
      const total = (edge.held() ? edge.pointerOffset() : dx) + scrollX.get();
      if (rowSlot?.draggable === true) preview(total);
    }
    // The losing axis is held at zero on every move: a locked box moves on one axis only. Upward y is not followed.
    if (axisLock.current === 'x') {
      x.set(edge.cap(dx));
      y.set(0);
    } else {
      x.set(0);
      y.set(Math.max(0, dy));
    }
    return { dx, dy };
  };

  // The gesture starts on the pointer's own events, in the frame the offset passes the direction lock, not when dnd-kit's
  // context renders its start; dnd-kit decides when the press is a drag (and ends or cancels it), this decides what the box does.
  latestMove.current = () => {
    if (engaged.current) return;
    if (Math.hypot(pointer.current.x - pointer.current.downX, pointer.current.y - pointer.current.downY) < drag.directionLockPx) return;
    engaged.current = true;
    axisLock.current = null;
    lockScrollParents();
    // A keep-alive step in Motion's own frame loop: the row scroll the edge loop adds is then drawn in
    // the frame that wrote it, not the one after, and the pointer offset is read once per frame.
    followStep.current = () => void follow();
    frame.update(followStep.current, true);
  };

  useDndMonitor({
    onDragCancel: () => {
      stoppedSpring.current = false;
      if (previewed.current !== null) preview(0);
      stopFollowing();
      axisLock.current = null;
      edge.release();
      edge.end();
      springHome();
    },
    onDragEnd: () => {
      stoppedSpring.current = false;
      if (engaged.current) follow(); // the last move may not have had its frame yet
      stopFollowing();
      const lockedAxis = axisLock.current;
      axisLock.current = null;
      const dx = pointer.current.x - pointer.current.downX;
      const dy = pointer.current.y - pointer.current.downY;
      const cancelled = reorder ? edge.release() : false;
      if (reorder && lockedAxis === 'x') {
        // The claim goes back before the hop is reported: the move the hop causes may ask the row to scroll, and a held claim would drop that request.
        const held = edge.held();
        const offset = held ? edge.pointerOffset() : dx;
        const scrolled = edge.end();
        if (!cancelled) reorder.onDragEnd(offset + scrolled);
        preview(0);
        if (reduceMotion) {
          x.jump(0);
          scrollX.jump(0);
          preview(null);
          return unlockScrollParents();
        }
        springHome();
        return; // never a close: shouldCloseOnRelease is not even consulted for a horizontal-locked release
      }
      if (reorder) x.jump(0); // residual sub-threshold horizontal drift from a gesture that never locked (or locked vertical)
      const rect = box.current?.getBoundingClientRect();
      const height = rect?.height ?? 0;
      const recent = samples.current;
      const last = recent[recent.length - 1];
      const rested = released.current - (last?.t ?? 0) > REST_MS;
      const velocityY = rested ? 0 : peakSpeed(recent);
      if (closeRef.current !== undefined && closableRef.current && shouldCloseOnRelease({ offsetY: Math.max(0, dy), velocityY, height }, drag)) {
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
        animate(y, 0, { duration: 0 }); // not y.set(0): a spring already running on y would win
        unlockScrollParents();
      } else {
        const back = animate(y, 0, snapBack);
        running.current = back;
        void back.then(unlockScrollParents);
      }
    },
  });

  const handle: DragHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== 0 || (event.target as Element).closest(INTERACTIVE) || closing.current) return; // a press would stop the exit: onClose would never run
      stoppedSpring.current = false;
      if (running.current) { running.current.stop(); running.current = null; stoppedSpring.current = y.get() !== 0 || x.get() !== 0 || scrollX.get() !== 0; unlockScrollParents(); preview(null); } // stop() never settles the spring's promise, so its own unlock would not run
      edge.press(event);
      pointer.current = { downX: event.clientX, downY: event.clientY, x: event.clientX, y: event.clientY };
      samples.current = [{ t: event.timeStamp, y: 0 }];
      stopFollowing();
      for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
        window.removeEventListener(type, trackPointer.current, true);
        window.addEventListener(type, trackPointer.current, true);
      }
      draggable.listeners?.onPointerDown?.(event);
    },
    // pan-x: a horizontal swipe still scrolls the row; a vertical one is this gesture's.
    sx: { cursor: 'grab', touchAction: 'pan-x', userSelect: 'none', '&:active': { cursor: 'grabbing' } },
  };

  return (
    <motion.div
      ref={(el: HTMLDivElement | null) => {
        box.current = el;
        draggable.setNodeRef(el);
      }}
      data-drag-to-close=""
      style={reorder ? { x, y, translate: scrollTranslate } : { y }}
    >
      {children(handle)}
    </motion.div>
  );
}
