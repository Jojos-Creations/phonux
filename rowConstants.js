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
/** How far a vertical drag travels before its preview is grabbed; until then the box does not move. */
export const PREVIEW_OUT_PX = 24;
/** The spring a released drag-to-close box snaps back with. */
export const SNAP_BACK_SPRING = Object.freeze({ stiffness: 520, damping: 42 });
/**
 * The enter and exit slide every slot shares, which a resize also rides. Eased in and out: an ease-out covers half a resize in
 * its first tenth of a second, which reads as a snap.
 */
export const SLIDE_DURATION_SEC = 0.6;
export const SLIDE_EASE = Object.freeze([0.4, 0, 0.2, 1]);
export const SLIDE_CLOSE_EXIT_SECONDS = CLOSE_EXIT_SECONDS;
/** A drag crosses a neighbor once it has covered this fraction of that neighbor's span. */
export const HOP_FRACTION = 0.5;
/** Quiet time before the workspace file is written. */
export const SAVE_QUIET_MS = 500;
/** The least time between two row-scroll steps of one wheel gesture. */
export const GESTURE_LOCK_MS = 30;
/** No wheel event for this long ends a row-scroll gesture: the next one is fresh and steps at once. */
export const GESTURE_QUIET_MS = 150;
/** A pointer that lifts this long after its last move had stopped has no release velocity. */
export const DRAG_REST_MS = 50;
/** How far back a release looks for its velocity, ms. */
export const DRAG_VELOCITY_WINDOW_MS = 100;
/** The curve a closing panel leaves along, and the curve a row-scroll glide travels along ('cubic-out' is 1 - (1 - t)^3). */
export const CLOSE_EXIT_EASE = 'easeIn';
export const GLIDE_EASE = 'cubic-out';
/**
 * The z-index tiers of a row's slots: a `raised` panel sits above a `base` one, so a park that exits left crosses its
 * footprint on the way out, and the panel being dragged is drawn above both. Within a tier a slot's z-index is the tier
 * plus twice its distance in slots from the nearer end of the row (at most 2 * 31 under `ALL_SLOTS`), and a slot entering
 * or leaving sits one under that, so the tiers are 99 apart. Every `OVERLAY_Z` value is higher.
 * @public
 */
export const ROW_LAYER_Z = Object.freeze({ BASE: 1, RAISED: 100, DRAGGED: 200 });
/** Which of two equal-priority panels returns or lands first. */
export const RETURN_TIE_BREAK = 'latest-first';
export const DROP_TIE_BREAK = 'leftmost';
/** What the row's own scroll input does, and where the strip starts. */
export const ROW_GESTURE = 'step';
export const FAST_SCROLL = 'coalesce';
export const INITIAL_SCROLL = 'start';
/** When a panel's header, grab bar and footer show, and how they fade. */
export const CHROME = {
    mode: 'always',
    fadeMs: 120,
    fadeEase: 'easeOut',
};
/** Pixels between a header and the frame it floats above, and between the frame and its footer. */
export const HEADER_GAP_PX = 4;
/** Pixels the grab bar's square strip is wide and tall, so its icon sits the same whatever the header gap. */
export const GRAB_HANDLE_PX = 24;
/** Pixels a header's content is inset from each end. */
export const HEADER_INSET_PX = 13;
/** Pixels of horizontal and vertical padding on the footer. */
export const FOOTER_PAD_X_PX = 12;
export const FOOTER_PAD_Y_PX = 8;
/** How many slide durations the container width must hold still before the phone size is fitted again: 200 ms at the default slide, short of one macOS zoom. */
export const RESIZE_SETTLE_SLIDES = 1 / 3;
/** Scrolling the row while a dragged panel is held near the window's edge. */
export const EDGE_SCROLL_ZONE_PX = 48;
export const EDGE_SCROLL_MAX_PX_PER_SEC = 900;
export const EDGE_SCROLL_REDUCED_STEP_MS = 500;
/**
 * The largest slot count a panel can have: 64. `slots` and `maxSlots` accept whole numbers from 1 to this value,
 * and a request above it is refused. A consumer may rely on it as the upper bound, and may pass it as `maxSlots`
 * to mean "every slot that fits". A drawn count is always capped at what fits the window.
 */
export const ALL_SLOTS = 64;
/** Whether the default mount fits the phone size to the window: 'off' draws the host's preferred size as it is. */
export const PHONE_FIT = 'off';
/** The scale band the fit keeps the phone in, as fractions of the preferred size: 320 to 441 px on 390, inside real phone widths. */
export const PHONE_FIT_MIN = 0.82;
export const PHONE_FIT_MAX = 1.13;
/** The widest `slots` slots are drawn: whole phone widths with the row gap between them, so edges sit on the stop grid. */
export const slotWidth = (slots, phoneWidth, gap) => slots * phoneWidth + (slots - 1) * gap;
/** The slots a panel is drawn at while the row is unmeasured. */
export const UNMEASURED_SLOTS = 3;
/** How many slots fit in `maxLiveWidth`; at least one, and `UNMEASURED_SLOTS` while the row is unmeasured (infinite). */
export function fitSlots(maxLiveWidth, phoneWidth, gap) {
    if (!Number.isFinite(maxLiveWidth))
        return UNMEASURED_SLOTS;
    return Math.max(1, Math.min(ALL_SLOTS, Math.floor((maxLiveWidth + gap) / (phoneWidth + gap))));
}
