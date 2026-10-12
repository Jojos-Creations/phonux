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

/** After a row-scroll step, further wheel events inside this window are ignored. */
export const GESTURE_LOCK_MS = 60;

/** No wheel event for this long ends a row-scroll gesture: the next one is fresh and steps whatever its size. */
export const GESTURE_QUIET_MS = 150;

/** A pointer that lifts this long after its last move had stopped has no release velocity. */
export const DRAG_REST_MS = 50;

/** How far back a release looks for its velocity, ms. */
export const DRAG_VELOCITY_WINDOW_MS = 100;

/** The curve a closing panel leaves along, and the curve a row-scroll glide travels along ('cubic-out' is 1 - (1 - t)^3). */
export const CLOSE_EXIT_EASE = 'easeIn' as const;
export const GLIDE_EASE = 'cubic-out' as const;

/**
 * The z-index of a row's slots: a `raised` panel sits above a `base` one, so a park that exits left crosses its footprint
 * on the way out, and the panel being dragged is drawn above both. Every `OVERLAY_Z` value is higher.
 * @public
 */
export const ROW_LAYER_Z = Object.freeze({ BASE: 1, RAISED: 2, DRAGGED: 3 });

/** Which of two equal-priority panels returns or lands first. */
export const RETURN_TIE_BREAK = 'latest-first' as const;
export const DROP_TIE_BREAK = 'leftmost' as const;

/** What the row's own scroll input does, and where the strip starts. */
export const ROW_GESTURE = 'step' as const;
export const INITIAL_SCROLL = 'start' as const;

/** When a panel's header, grab bar and footer show, and the numbers a host's header icon row animates with. */
export const CHROME = { mode: 'always', fadeMs: 120, slideMs: 140, slidePx: 8, graceMs: 250 } as const;

/** How many slide durations the container width must hold still before the row's centring margin glides again. */
export const RESIZE_SETTLE_SLIDES = 1.25;

/** Scrolling the row while a dragged panel is held near the window's edge. */
export const EDGE_SCROLL_ZONE_PX = 48;
export const EDGE_SCROLL_MAX_PX_PER_SEC = 900;
export const EDGE_SCROLL_REDUCED_STEP_MS = 500;

/**
 * The slot count `setFormFactor('desktop')` stores: finite, and larger than any window fits, so it keeps meaning
 * "every visible slot" without a non-finite number ever being saved. The drawn count is always capped at the fit.
 */
export const ALL_SLOTS = 64;

/** Pixels a panel grows taller for each slot it is wider than one, before the row's own height caps it. */
export const HEIGHT_PER_SLOT = 48;

/** Where a panel shorter than the row sits in it: on the row's middle. */
export const ROW_ALIGN = 'center' as const;

/** The slot count a tier stands for: phone one, tablet two, desktop every visible slot. */
export const slotsOfTier = (tier: 'phone' | 'tablet' | 'desktop'): number => (tier === 'phone' ? 1 : tier === 'tablet' ? 2 : ALL_SLOTS);

/** The tier a slot count reports: one slot phone, two tablet, three or more desktop. */
export const tierOfSlots = (slots: number): 'phone' | 'tablet' | 'desktop' => (slots <= 1 ? 'phone' : slots === 2 ? 'tablet' : 'desktop');

/** The widest `slots` slots are drawn: whole phone widths with the row gap between them, so edges sit on the stop grid. */
export const slotWidth = (slots: number, phoneWidth: number, gap: number): number => slots * phoneWidth + (slots - 1) * gap;

/** The slots a panel is drawn at while the row is unmeasured, close to the 1200 px a desktop panel was before slots. */
export const UNMEASURED_SLOTS = 3;

/** How many slots fit in `maxLiveWidth`; at least one, and `UNMEASURED_SLOTS` while the row is unmeasured (infinite). */
export function fitSlots(maxLiveWidth: number, phoneWidth: number, gap: number): number {
  if (!Number.isFinite(maxLiveWidth)) return UNMEASURED_SLOTS;
  return Math.max(1, Math.min(ALL_SLOTS, Math.floor((maxLiveWidth + gap) / (phoneWidth + gap))));
}

/** A panel `slots` wide is this tall: the phone height plus `perSlot` per added slot, never more than `available` (but never less than the phone height). */
export const slotHeight = (slots: number, phoneHeight: number, perSlot: number, available: number): number => Math.max(phoneHeight, Math.min(phoneHeight + (slots - 1) * perSlot, available));
