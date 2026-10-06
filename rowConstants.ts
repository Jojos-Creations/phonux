/**
 * The default numbers behind the tuning settings, the one place each is written. A leaf module with no imports so
 * the settings table can read it without pulling in React or the row code.
 */

/**
 * The one spacing value used everywhere a gap is needed in this row.
 * @public
 */
export const ROW_GAP = 16;

/** Seconds the box takes to leave the screen after a drag-down close; also the slide's close exit. */
const CLOSE_EXIT_SECONDS = 0.18;

/** The six drag-to-close numbers, under the keys `DRAG_CLOSE` uses. Distances in px, velocities in px/s. */
export const DRAG_CLOSE_NUMBERS = Object.freeze({
  distanceFraction: 0.25,
  minDistancePx: 80,
  flickVelocity: 700,
  flickMinDistancePx: 40,
  cancelVelocity: -300,
  exitSeconds: CLOSE_EXIT_SECONDS,
});

/** The first this many px of either axis decide which direction a drag locks to. */
export const DIRECTION_LOCK_PX = 8;

/** The spring a released drag-to-close box snaps back with. */
export const SNAP_BACK_SPRING = Object.freeze({ stiffness: 520, damping: 42 });

/** The enter and exit slide every slot shares. */
export const SLIDE_DURATION_SEC = 0.4;
export const SLIDE_EASE: readonly [number, number, number, number] = Object.freeze([0.2, 0, 0, 1]) as readonly [number, number, number, number];
export const SLIDE_CLOSE_EXIT_SECONDS = CLOSE_EXIT_SECONDS;

/** A drag crosses a neighbour once it has covered this fraction of that neighbour's span. */
export const HOP_FRACTION = 0.5;

/** Quiet time before the workspace file is written. */
export const SAVE_QUIET_MS = 500;

/** After a row-scroll gesture, further wheel events inside this window are ignored. */
export const GESTURE_LOCK_MS = 350;

/** Which of two equal-priority panels returns or lands first. */
export const RETURN_TIE_BREAK = 'latest-first' as const;
export const DROP_TIE_BREAK = 'leftmost' as const;

/** What the row's own scroll input does, and where the strip starts. */
export const ROW_GESTURE = 'step' as const;
export const INITIAL_SCROLL = 'start' as const;

/** Scrolling the row while a dragged panel is held near the window's edge. */
export const EDGE_SCROLL_ZONE_PX = 48;
export const EDGE_SCROLL_MAX_PX_PER_SEC = 900;
export const EDGE_SCROLL_REDUCED_STEP_MS = 500;
