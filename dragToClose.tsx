/**
 * Drag a view's grab handle DOWN to close it (the box follows the pointer up and down); with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { DndContext, PointerSensor, useDndMonitor, useDraggable, useSensor, useSensors } from '@dnd-kit/core';
import { animate, cancelFrame, frame, motion, useIsPresent, useMotionValue, useReducedMotion, useReducedMotionConfig, useTransform, type MotionValue } from 'motion/react';
import { AnnounceContext } from './announce.js';
import { useOptionalHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { PanelSlotContext, type DragScroll } from './panelSlotContext.js';
import { endEdgeHold, openEdgeHold, stepEdgeHold, type EdgeHold } from './panelRowDropScroll.js';
import { closestRowScroller, rowScrollerFor } from './rowScroller.js';
import type { DragToCloseTuning } from './panelSettings.js';
import { CLOSE_EXIT_EASE, DIRECTION_LOCK_PX, DRAG_CLOSE_NUMBERS, DRAG_REST_MS, DRAG_VELOCITY_WINDOW_MS, PREVIEW_OUT_PX, ROW_LAYER_Z, SLIDE_CLOSE_EXIT_SECONDS, SNAP_BACK_SPRING } from './rowConstants.js';

/**
 * The library's default drag-to-close numbers. Distances in px, velocities in px/s, positive = downward.
 * @public
 * @deprecated A panel's numbers are `usePanelTuning().dragToClose`, and the defaults `LIBRARY_TUNING_DEFAULTS.dragToClose`.
 */
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
const OUTSIDE_ROW_DRAG: Readonly<DragToCloseTuning> = {
  distanceFraction: DRAG_CLOSE.distanceFraction,
  minDistancePx: DRAG_CLOSE.minDistancePx,
  flickMinDistancePx: DRAG_CLOSE.flickMinDistancePx,
  flickVelocity: DRAG_CLOSE.flickVelocity,
  cancelVelocity: DRAG_CLOSE.cancelVelocity,
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
  /** Starts a drag from a primary-button press on the handle; a press on a button, link or field is ignored. Until the press ends, the page shows no text selection and starts no native image drag. */
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  /** The handle's styles: a grab cursor, no text selection, and `touch-action: pan-x` so a horizontal swipe still scrolls the row. A keyboard focus ring is drawn when the handle takes keys. */
  sx: { cursor: 'grab'; touchAction: 'pan-x'; userSelect: 'none'; '&:active': { cursor: 'grabbing' }; '&:focus-visible': { outline: '2px solid'; outlineColor: 'primary.main'; outlineOffset: -2 } };
  /** `'button'` when the handle takes keys, which it does when `onClose` or `reorder.onStep` is set; absent otherwise. */
  role?: 'button';
  /** 0 when the handle takes keys; absent otherwise. */
  tabIndex?: 0;
  /** The handle's name when it takes keys, built from the panel's title inside a row. */
  'aria-label'?: string;
  /** The keys the handle takes, for assistive technology. */
  'aria-keyshortcuts'?: string;
  /** ArrowLeft and ArrowRight call `reorder.onStep(-1 | 1)` and Delete calls `onClose`, each said in the workspace's live region. Absent when the handle takes no keys. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
  /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
  onDragEnd: (offsetX: number) => void;
  /** Moves the panel `steps` slots (-1 left, 1 right) for an ArrowLeft or ArrowRight on the handle; true when it moved. Without it the handle takes no Arrow keys. */
  onStep?: (steps: number) => boolean;
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
    stepEdgeHold(h, nowMs, pointer.current.x, slot, latest.current.reduceMotion);
    scrollX.set(h.scroller.scrollLeft() - h.startScroll);
    h.frame = requestAnimationFrame(tick);
  };

  /** Gives the claim back and returns how far the row scrolled since the pointer went down; 0 when no claim was held. */
  const end = (): number => {
    const h = hold.current;
    if (h === null) return 0;
    hold.current = null;
    return endEdgeHold(h, latest.current.dragScroll, latest.current.reduceMotion);
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
      const opened = openEdgeHold(p.scrollerEl, p.startScroll, slot);
      if (opened === null) return;
      pointer.current = { x: clientX, offset: clientX - p.downX };
      hold.current = opened;
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
 * The bottom of the visible area in layout-viewport px. The visual viewport is what the person sees: a pinch or an on-screen
 * keyboard shrinks it while `window.innerHeight` stays put, and an exit short of the visible bottom stops on screen.
 */
export function visibleViewportBottom(): number {
  const visual = window.visualViewport;
  return visual === null || visual === undefined ? window.innerHeight : visual.offsetTop + visual.height;
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

const INTERACTIVE = 'button, a, input, select, textarea, [role="button"]';

/** The three properties a drag turns off on the document element; -webkit-user-select is what Safari reads. */
const SELECTION_PROPERTIES = ['user-select', '-webkit-user-select', '-webkit-user-drag'] as const;

interface SelectionHold {
  holds: number;
  /** Inline value and priority each property had when the first hold took it. */
  before: Array<[string, string, string]>;
  onDragStart: (event: Event) => void;
}

const selectionHolds = new WeakMap<Document, SelectionHold>();

/**
 * Turns text selection and native image drag off for `doc` until the returned release runs. Holds share one record per
 * document: the first takes the document element's inline values and the last gives them back, so overlapping drags
 * (two touches, a press landing on a spring still unlocking) cannot restore each other's `none`. The release is idempotent.
 * -webkit-user-drag does not inherit, so the `dragstart` listener is what stops a photo inside a panel from starting a
 * native drag, which would cancel the pointer events this drag runs on.
 * @internal
 */
export function holdDragSelection(doc: Document): () => void {
  let hold = selectionHolds.get(doc);
  if (hold === undefined) {
    const style = doc.documentElement.style;
    hold = { holds: 0, before: SELECTION_PROPERTIES.map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]), onDragStart: (event) => event.preventDefault() };
    for (const name of SELECTION_PROPERTIES) style.setProperty(name, 'none');
    doc.addEventListener('dragstart', hold.onDragStart, true);
    selectionHolds.set(doc, hold);
  }
  hold.holds += 1;
  const taken = hold;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    taken.holds -= 1;
    if (taken.holds > 0) return;
    const style = doc.documentElement.style;
    for (const [name, value, priority] of taken.before) {
      if (value === '') style.removeProperty(name);
      else style.setProperty(name, value, priority);
    }
    doc.removeEventListener('dragstart', taken.onDragStart, true);
    selectionHolds.delete(doc);
  };
}

/** Where the pointer is during a grab-handle drag: what `DragToClose`'s `onDragMove` receives on every pointer move. @public */
export interface GrabDragMove {
  /** How far the pointer has travelled right of where it went down, px (negative = left). */
  x: number;
  /** How far the pointer has travelled below where it went down, px (negative = up). */
  y: number;
  /** The pointer's x in viewport px, the coordinate to hit-test against `getBoundingClientRect()` or pass to `elementFromPoint`. */
  clientX: number;
  /** The pointer's y in viewport px. */
  clientY: number;
}

/** Where the pointer let go of a grab-handle drag: what `DragToClose`'s `onDragEnd` receives on release. @public */
export interface GrabDragEnd {
  /** How far the pointer travelled right of where it went down, px (negative = left); the pointer's own travel, not the row's scroll added. */
  offsetX: number;
  /** How far the pointer travelled below where it went down, px (negative = up). */
  offsetY: number;
  /** The pointer's x in viewport px at release. */
  clientX: number;
  /** The pointer's y in viewport px at release. */
  clientY: number;
}

/** The side a vertically dragged panel slides out to when its preview is dropped there. @public */
export type PreviewExit = 'top' | 'bottom';

/**
 * The tile a vertical drag pops out. `width` and `height` are the tile's size in px; `render` draws its content, typically a
 * snapshot of the panel. The panel itself stays in its slot while the tile is dragged.
 * @public
 */
export interface PreviewOut {
  /** The tile's width in px. */
  width: number;
  /** The tile's height in px. */
  height: number;
  /** Draws the tile's content; called while a preview is out. */
  render: () => React.ReactNode;
}

// A touch press reaches dnd-kit only after this hold, and only if it has not moved past TOUCH_HOLD_TOLERANCE_PX by then: a
// touch that moves first is a page pan, which the handle's touch-action leaves to the browser. WorkspacePanel's tile drag
// holds a touch the same way.
const TOUCH_HOLD_MS = 250;
const TOUCH_HOLD_TOLERANCE_PX = 6;

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
  /**
   * Whether a drag released far or fast enough downward closes the box. Default true. When false a release anywhere springs the box
   * home and `onClose` is not called by the drag; the Delete key on the handle still calls it.
   */
  closeOnRelease?: boolean;
  /**
   * Called on every pointer move of a drag, from the move that starts it, with where the pointer is. Not called for a press that never
   * becomes a drag. Use `clientX` and `clientY` to hit-test your own targets.
   */
  onDragMove?: (move: GrabDragMove) => void;
  /**
   * Called once when the pointer is released after a drag, before `reorder.onDragEnd` and before any close, with where the pointer
   * let go. Not called when the gesture is cancelled (a native pan, the Escape key), and not for a press that never became a drag.
   */
  onDragEnd?: (end: GrabDragEnd) => void;
  /**
   * When set, a vertical drag past `PREVIEW_OUT_PX` grabs a tile-size preview instead of moving the box, and the box stays in its slot.
   * Pair with `exitFor` to say where a dropped preview's panel leaves to.
   */
  previewOut?: PreviewOut;
  /**
   * Called once at release when a preview is out, to choose the side the real panel slides out to: 'top' or 'bottom' closes the box
   * that way (then `onClose` runs), and null drops the preview and leaves the panel where it is. Not called without `previewOut`.
   */
  exitFor?: (end: GrabDragEnd) => PreviewExit | null;
  /** Render prop: receives the handle props to spread onto the grab bar, and returns the box's content. */
  children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement {
  const slot = React.useContext(PanelSlotContext);
  // The distance is the direction lock, a hair under it because the sensor wants to be passed and a lock is reached.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: Math.max(0, DIRECTION_LOCK_PX - 0.01) } }));
  const labels = resolveLabels(useOptionalHost()?.labels);
  // dnd-kit would name the drag 'draggable item' and a React id; inside a row it says the panel's title instead.
  const handle = slot?.handle;
  const titleNow = (): string => handle?.getState().title ?? labels.untitledPanel;
  const announcements =
    handle === undefined
      ? undefined
      : { onDragStart: () => labels.pickedUp(titleNow()), onDragOver: () => undefined, onDragEnd: () => labels.dropped(titleNow()), onDragCancel: () => labels.dragCancelled(titleNow()) };
  // autoScroll off: dnd-kit would write scrollLeft itself, and the row's scroll claim is the one writer.
  return (
    <DndContext sensors={sensors} autoScroll={false} {...(announcements === undefined ? {} : { accessibility: { announcements } })}>
      <DragToCloseBox {...input} />
    </DndContext>
  );
}

function DragToCloseBox({
  onClose,
  reorder,
  closeOnRelease = true,
  onDragMove,
  onDragEnd,
  previewOut,
  exitFor,
  children,
}: {
  onClose?: () => void;
  reorder?: ReorderHandle;
  closeOnRelease?: boolean;
  onDragMove?: (move: GrabDragMove) => void;
  onDragEnd?: (end: GrabDragEnd) => void;
  previewOut?: PreviewOut;
  exitFor?: (end: GrabDragEnd) => PreviewExit | null;
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
  // The OS preference and the theme's MotionConfig both count: a MotionConfig 'always' must snap the drag box too.
  const systemReduced = useReducedMotion();
  const configReduced = useReducedMotionConfig();
  const reduceMotion = systemReduced === true || configReduced === true;
  const running = React.useRef<{ stop: () => void } | null>(null);
  const locked = React.useRef<Array<[HTMLElement, string]>>([]);
  const slot = React.useContext(PanelSlotContext);
  const labels = resolveLabels(useOptionalHost()?.labels);
  const announce = React.useContext(AnnounceContext);
  const slotHandle = slot?.handle;
  // The strip's name is drawn from this, so it must follow a title change that does not re-render this box.
  const drawnTitle = React.useSyncExternalStore(
    (l: () => void) => slotHandle?.subscribe(l) ?? (() => {}),
    () => slotHandle?.getState().title,
    () => slotHandle?.getState().title,
  );
  const titleNow = (): string => slotHandle?.getState().title ?? labels.untitledPanel;
  // Every close, by a drag or by Delete, says so; the panel is gone by the time anything could.
  const closeRef = React.useRef<(() => void) | undefined>(onClose);
  closeRef.current =
    onClose === undefined
      ? undefined
      : () => {
          announce?.(labels.closed(titleNow()));
          onClose();
        };
  const reorderRef = React.useRef(reorder);
  reorderRef.current = reorder;
  // Read by the window listener, which is made once and outlives the render that made it.
  const dragMoveRef = React.useRef(onDragMove);
  dragMoveRef.current = onDragMove;
  const previewOutRef = React.useRef(previewOut);
  previewOutRef.current = previewOut;
  const exitForRef = React.useRef(exitFor);
  exitForRef.current = exitFor;
  // The pointer's position while a vertical preview is out, or null: the tile is drawn at it.
  const [previewAt, setPreviewAt] = React.useState<{ x: number; y: number } | null>(null);
  // Set once a vertical drag passes PREVIEW_OUT_PX with a preview set; the box then never moves on that drag.
  const previewing = React.useRef(false);
  // Read by the frame step and the release, which outlive the render that started them.
  const slotRef = React.useRef(slot);
  slotRef.current = slot;
  const drag = slot?.tuning.dragToClose ?? OUTSIDE_ROW_DRAG;
  const edge = useEdgeScroll(box, reorder === undefined ? undefined : slot?.dragScroll, reduceMotion === true, x, scrollX);
  const exitSeconds = slot?.tuning.slide.closeExitSeconds ?? SLIDE_CLOSE_EXIT_SECONDS;
  const exitEase = slot?.tuning.slide.closeExitEase ?? CLOSE_EXIT_EASE;
  // Read again when the exit ends: a lock that lands mid-exit must stop the close.
  const closableRef = React.useRef(true);
  closableRef.current = slot?.closable ?? true;
  // The document this box's press holds selection off for; null once the pointer is up. The unmount cleanup gives the hold back
  // and a re-run of the effect takes it again while the pointer is still down, as it does for a keyed child a reorder moves.
  const pressedDoc = React.useRef<Document | null>(null);
  const selectionRelease = React.useRef<(() => void) | null>(null);
  const giveBackSelection = () => {
    selectionRelease.current?.();
    selectionRelease.current = null;
  };
  React.useEffect(() => {
    if (pressedDoc.current !== null && selectionRelease.current === null) selectionRelease.current = holdDragSelection(pressedDoc.current);
    return giveBackSelection;
  }, []);
  const closing = React.useRef(false); // a release has decided to close: the exit runs and takes no more presses
  // Set once the first `DIRECTION_LOCK_PX` of movement decides; null until then, and always for a vertical-only handle.
  const axisLock = React.useRef<'x' | 'y' | null>(null);
  const snapBack = DRAG_CLOSE.snapBack;

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
    slotRef.current?.setDragging?.(false);
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

  const dropping = React.useRef(false);
  // Release springs the box home; a cancelled gesture takes the same road without reporting a hop or a close.
  const springHome = () => {
    const vertical = animate(y, 0, snapBack);
    const sideways = settleHome(x, scrollX, snapBack);
    running.current = { stop: () => { vertical.stop(); sideways.stop(); } };
    void Promise.all([vertical, sideways]).then(() => {
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
  // False while a touch press waits for its hold: the box must not follow a swipe the page is about to scroll.
  const touchHeld = React.useRef(true);
  // The frame that checks a touch press's hold; the pointer loop is frame-driven too, so the hold is not a timer.
  const touchHold = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (touchHold.current !== null) cancelAnimationFrame(touchHold.current);
  }, []);
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
    if (touchHold.current !== null && (event.type !== 'pointermove' || Math.hypot(clientX - pointer.current.downX, clientY - pointer.current.downY) > TOUCH_HOLD_TOLERANCE_PX)) {
      cancelAnimationFrame(touchHold.current);
      touchHold.current = null;
    }
    if (event.type !== 'pointercancel') {
      pointer.current = { ...pointer.current, x: clientX, y: clientY };
      if (event.type === 'pointerup') released.current = event.timeStamp;
      else {
        // Every move is a sample, stamped by the browser: a short flick is a few events, and a frame loop would see fewer.
        const kept = samples.current;
        kept.push({ t: event.timeStamp, y: clientY - pointer.current.downY });
        while (kept.length > 2 && kept[0]!.t < event.timeStamp - DRAG_VELOCITY_WINDOW_MS) kept.shift();
      }
    }
    if (event.type === 'pointermove') {
      latestMove.current();
      if (engaged.current) dragMoveRef.current?.({ x: clientX - pointer.current.downX, y: clientY - pointer.current.downY, clientX, clientY });
      return;
    }
    pressedDoc.current = null;
    giveBackSelection();
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
      if (rowSlot?.movable === true) preview(total);
    }
    // The losing axis is held at zero on every move: a locked box moves on one axis only.
    if (axisLock.current === 'x') {
      x.set(edge.cap(dx));
      y.set(0);
    } else if (previewOutRef.current !== undefined) {
      x.set(0);
      y.set(0);
      if (!previewing.current && Math.abs(dy) >= PREVIEW_OUT_PX) previewing.current = true;
      if (previewing.current) setPreviewAt({ x: pointer.current.x, y: pointer.current.y });
    } else {
      x.set(0);
      y.set(dy);
    }
    return { dx, dy };
  };

  // The gesture starts on the pointer's own events, in the frame the offset passes the direction lock, not when dnd-kit's
  // context renders its start; dnd-kit decides when the press is a drag (and ends or cancels it), this decides what the box does.
  latestMove.current = () => {
    if (engaged.current || !touchHeld.current) return;
    if (Math.hypot(pointer.current.x - pointer.current.downX, pointer.current.y - pointer.current.downY) < DIRECTION_LOCK_PX) return;
    engaged.current = true;
    axisLock.current = null;
    slotRef.current?.setDragging?.(true);
    lockScrollParents();
    // A keep-alive step in Motion's own frame loop: the row scroll the edge loop adds is then drawn in
    // the frame that wrote it, not the one after, and the pointer offset is read once per frame.
    followStep.current = () => void follow();
    frame.update(followStep.current, true);
  };

  useDndMonitor({
    onDragCancel: () => {
      stoppedSpring.current = false;
      previewing.current = false;
      setPreviewAt(null);
      if (previewed.current !== null) preview(0);
      stopFollowing();
      axisLock.current = null;
      edge.release();
      edge.end();
      springHome();
    },
    onDragEnd: () => {
      // A host that renders the move synchronously re-registers this monitor, and dnd-kit then calls the new listener for the same drop.
      if (dropping.current) return;
      stoppedSpring.current = false;
      const wasEngaged = engaged.current;
      if (wasEngaged) follow(); // the last move may not have had its frame yet
      stopFollowing();
      const lockedAxis = axisLock.current;
      axisLock.current = null;
      const dx = pointer.current.x - pointer.current.downX;
      const dy = pointer.current.y - pointer.current.downY;
      if (wasEngaged) onDragEnd?.({ offsetX: dx, offsetY: dy, clientX: pointer.current.x, clientY: pointer.current.y });
      const cancelled = reorder ? edge.release() : false;
      if (reorder && lockedAxis === 'x') {
        // The claim goes back before the hop is reported: the move the hop causes may ask the row to scroll, and a held claim would drop that request.
        const held = edge.held();
        const offset = held ? edge.pointerOffset() : dx;
        const scrolled = edge.end();
        // Judged before the host hears of the drop: a host that renders the move synchronously must not change the answer.
        const hopped = slotRef.current?.dragHops?.(offset + scrolled) ?? false;
        const slotEl = box.current?.closest<HTMLElement>('[data-row-slot]') ?? null;
        const restBefore = Number(slotEl?.dataset.rowSlot);
        let landed = false;
        dropping.current = true;
        // The host's commit moves the slot. This observer runs before paint, so the box gives up the same distance and the spring carries it in.
        const watch = new MutationObserver(() => {
          const moved = Number(slotEl?.dataset.rowSlot) - restBefore;
          if (moved === 0 || Number.isNaN(moved)) return;
          landed = true;
          watch.disconnect();
          x.jump(x.get() + scrollX.get() - moved);
          scrollX.jump(0);
          springHome();
        });
        const gliding = hopped && !reduceMotion && slotEl !== null && !Number.isNaN(restBefore);
        if (gliding) watch.observe(slotEl, { attributes: true, attributeFilter: ['data-row-slot'] });
        if (!cancelled) reorder.onDragEnd(offset + scrolled);
        preview(0);
        if (reduceMotion || hopped) {
          if (!gliding) {
            x.jump(0);
            scrollX.jump(0);
          }
          // One frame later, so the row judges the host's reorder with the preview still set and snaps the dragged slot too.
          frame.postRender(() => {
            watch.disconnect();
            if (gliding && !landed) {
              // The host kept the panel where it was: the box returns to its slot at once, as it left.
              x.jump(0);
              scrollX.jump(0);
              unlockScrollParents();
            }
            dropping.current = false;
            preview(null);
          });
          return gliding ? undefined : unlockScrollParents();
        }
        dropping.current = false;
        springHome();
        return; // never a close: shouldCloseOnRelease is not even consulted for a horizontal-locked release
      }
      if (reorder) x.jump(0); // residual sub-threshold horizontal drift from a gesture that never locked (or locked vertical)
      const rect = box.current?.getBoundingClientRect();
      const height = rect?.height ?? 0;
      if (previewOutRef.current !== undefined) {
        // A preview drag never moves the box, so the only motion here is the exit the caller picks for a dropped preview.
        const wasPreviewing = previewing.current;
        previewing.current = false;
        setPreviewAt(null);
        const side = wasPreviewing && wasEngaged && closableRef.current ? (exitForRef.current?.({ offsetX: dx, offsetY: dy, clientX: pointer.current.x, clientY: pointer.current.y }) ?? null) : null;
        if (side === null || closeRef.current === undefined) {
          unlockScrollParents();
          return;
        }
        if (reduceMotion) return closeRef.current();
        const distance = side === 'bottom' ? Math.max(height, visibleViewportBottom() - (rect?.top ?? 0)) : -Math.max(height, rect?.bottom ?? 0);
        const exit = animate(y, distance, { duration: exitSeconds, ease: exitEase });
        running.current = exit;
        closing.current = true;
        void exit.then(() => {
          if (closeRef.current !== undefined && closableRef.current) return closeRef.current();
          closing.current = false;
          const back = animate(y, 0, snapBack);
          running.current = back;
          void back.then(unlockScrollParents);
        });
        return;
      }
      const recent = samples.current;
      const last = recent[recent.length - 1];
      const rested = released.current - (last?.t ?? 0) > DRAG_REST_MS;
      const velocityY = rested ? 0 : peakSpeed(recent);
      if (closeOnRelease && closeRef.current !== undefined && closableRef.current && shouldCloseOnRelease({ offsetY: Math.max(0, dy), velocityY, height }, drag)) {
        if (reduceMotion) return closeRef.current();
        const toBottom = Math.max(height, visibleViewportBottom() - (rect?.top ?? 0));
        const exit = animate(y, toBottom, { duration: exitSeconds, ease: exitEase });
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
      // The handle may itself be a button (it takes keys), so only a control inside it is skipped.
      const control = (event.target as Element).closest(INTERACTIVE);
      if (event.button !== 0 || (control !== null && control !== event.currentTarget) || closing.current) return; // a press would stop the exit: onClose would never run
      stoppedSpring.current = false;
      dropping.current = false;
      touchHeld.current = event.pointerType !== 'touch';
      if (running.current) { running.current.stop(); running.current = null; stoppedSpring.current = y.get() !== 0 || x.get() !== 0 || scrollX.get() !== 0; unlockScrollParents(); preview(null); } // stop() never settles the spring's promise, so its own unlock would not run
      edge.press(event);
      // Taken at the press so no selection can begin elsewhere during the gesture. An existing selection is left alone until dnd-kit
      // activates (it clears the selection then), so a click on the grab bar does not wipe what the person selected. The new hold is taken before the old one is given back.
      const previousRelease = selectionRelease.current;
      pressedDoc.current = event.currentTarget.ownerDocument;
      selectionRelease.current = holdDragSelection(pressedDoc.current);
      previousRelease?.();
      pointer.current = { downX: event.clientX, downY: event.clientY, x: event.clientX, y: event.clientY };
      samples.current = [{ t: event.timeStamp, y: 0 }];
      stopFollowing();
      for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
        window.removeEventListener(type, trackPointer.current, true);
        window.addEventListener(type, trackPointer.current, true);
      }
      if (event.pointerType !== 'touch') {
        draggable.listeners?.onPointerDown?.(event);
        return;
      }
      if (touchHold.current !== null) cancelAnimationFrame(touchHold.current);
      const pressedAt = event.timeStamp;
      const awaitHold = (now: number): void => {
        if (now - pressedAt < TOUCH_HOLD_MS) {
          touchHold.current = requestAnimationFrame(awaitHold);
          return;
        }
        touchHold.current = null;
        touchHeld.current = true;
        draggable.listeners?.onPointerDown?.(event);
      };
      touchHold.current = requestAnimationFrame(awaitHold);
    },
    // pan-x: a horizontal swipe still scrolls the row; a vertical one is this gesture's, once a touch has held (TOUCH_HOLD_MS).
    sx: { cursor: 'grab', touchAction: 'pan-x', userSelect: 'none', '&:active': { cursor: 'grabbing' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } },
    ...(onClose === undefined && reorder?.onStep === undefined
      ? {}
      : {
          role: 'button' as const,
          tabIndex: 0 as const,
          'aria-label': labels.grabStrip(drawnTitle ?? labels.untitledPanel),
          'aria-keyshortcuts': [reorder?.onStep === undefined ? '' : 'ArrowLeft ArrowRight', closeRef.current === undefined ? '' : 'Delete'].filter(Boolean).join(' '),
          onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
            if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && reorderRef.current?.onStep !== undefined) {
              event.preventDefault();
              const steps = event.key === 'ArrowLeft' ? -1 : 1;
              announce?.(reorderRef.current.onStep(steps) ? labels.moved(titleNow(), steps) : labels.cannotMove(titleNow(), steps));
            } else if (event.key === 'Delete' && closeRef.current !== undefined && closableRef.current) {
              event.preventDefault();
              closeRef.current();
            }
          },
        }),
  };

  // In the body, not in the box: the box is transformed, which would make a fixed position relative to it.
  const tile = previewOut !== undefined && previewAt !== null && typeof document !== 'undefined'
    ? createPortal(
        <div
          data-drag-preview=""
          style={{ position: 'fixed', left: previewAt.x - previewOut.width / 2, top: previewAt.y - previewOut.height / 2, width: previewOut.width, height: previewOut.height, pointerEvents: 'none', zIndex: ROW_LAYER_Z.DRAGGED + 1000 }}
        >
          {previewOut.render()}
        </div>,
        document.body,
      )
    : null;
  return (
    <>
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
      {tile}
    </>
  );
}
