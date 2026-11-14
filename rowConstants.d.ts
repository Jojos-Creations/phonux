/**
 * The default numbers behind the tuning settings, the one place each is written. A leaf module with no imports so
 * the settings table can read it without pulling in React or the row code.
 */
/**
 * The one spacing value used everywhere a gap is needed in this row.
 * @public
 */
export declare const ROW_GAP = 16;
/** The six drag-to-close numbers, under the keys `DRAG_CLOSE` uses. Distances in px, velocities in px/s. */
export declare const DRAG_CLOSE_NUMBERS: Readonly<{
    distanceFraction: 0.25;
    minDistancePx: 80;
    flickVelocity: 700;
    flickMinDistancePx: 40;
    cancelVelocity: -300;
    exitSeconds: 0.18;
}>;
/** The first this many px of either axis decide which direction a drag locks to. */
export declare const DIRECTION_LOCK_PX = 8;
/** How far a vertical drag travels before its preview is grabbed; until then the box does not move. */
export declare const PREVIEW_OUT_PX = 24;
/** The spring a released drag-to-close box snaps back with. */
export declare const SNAP_BACK_SPRING: Readonly<{
    stiffness: 520;
    damping: 42;
}>;
/**
 * The enter and exit slide every slot shares, which a resize also rides. Eased in and out: an ease-out covers half a resize in
 * its first tenth of a second, which reads as a snap.
 */
export declare const SLIDE_DURATION_SEC = 0.6;
export declare const SLIDE_EASE: readonly [number, number, number, number];
export declare const SLIDE_CLOSE_EXIT_SECONDS = 0.18;
/** A drag crosses a neighbor once it has covered this fraction of that neighbor's span. */
export declare const HOP_FRACTION = 0.5;
/** Quiet time before the workspace file is written. */
export declare const SAVE_QUIET_MS = 500;
/** The least time between two row-scroll steps of one wheel gesture. */
export declare const GESTURE_LOCK_MS = 30;
/** No wheel event for this long ends a row-scroll gesture: the next one is fresh and steps at once. */
export declare const GESTURE_QUIET_MS = 150;
/** A pointer that lifts this long after its last move had stopped has no release velocity. */
export declare const DRAG_REST_MS = 50;
/** How far back a release looks for its velocity, ms. */
export declare const DRAG_VELOCITY_WINDOW_MS = 100;
/** The curve a closing panel leaves along, and the curve a row-scroll glide travels along ('cubic-out' is 1 - (1 - t)^3). */
export declare const CLOSE_EXIT_EASE: "easeIn";
export declare const GLIDE_EASE: "cubic-out";
/**
 * The z-index tiers of a row's slots: a `raised` panel sits above a `base` one, so a park that exits left crosses its
 * footprint on the way out, and the panel being dragged is drawn above both. Within a tier a slot's z-index is the tier
 * plus twice its distance in slots from the nearer end of the row (at most 2 * 31 under `ALL_SLOTS`), and a slot entering
 * or leaving sits one under that, so the tiers are 99 apart. Every `OVERLAY_Z` value is higher.
 * @public
 */
export declare const ROW_LAYER_Z: Readonly<{
    BASE: 1;
    RAISED: 100;
    DRAGGED: 200;
}>;
/** Which of two equal-priority panels returns or lands first. */
export declare const RETURN_TIE_BREAK: "latest-first";
export declare const DROP_TIE_BREAK: "leftmost";
/** What the row's own scroll input does, and where the strip starts. */
export declare const ROW_GESTURE: "step";
export declare const FAST_SCROLL: "coalesce";
export declare const INITIAL_SCROLL: "start";
/** When a panel's header, grab bar and footer show, and how they fade. */
export declare const CHROME: {
    readonly mode: "always";
    readonly fadeMs: 120;
    readonly fadeEase: "easeOut";
    readonly where: "outside";
    readonly fitVisibleMaxSlots: 2;
};
/** Pixels between a header and the frame it floats above, and between the frame and its footer. */
export declare const HEADER_GAP_PX = 4;
/** Pixels the grab bar's square strip is wide and tall, so its icon sits the same whatever the header gap. */
export declare const GRAB_HANDLE_PX = 24;
/** Pixels a header's content is inset from each end. */
export declare const HEADER_INSET_PX = 13;
/** Pixels of horizontal and vertical padding on the footer. */
export declare const FOOTER_PAD_X_PX = 12;
export declare const FOOTER_PAD_Y_PX = 8;
/** How many slide durations the container width must hold still before the phone size is fitted again: 200 ms at the default slide, short of one macOS zoom. */
export declare const RESIZE_SETTLE_SLIDES: number;
/** Scrolling the row while a dragged panel is held near the window's edge. */
export declare const EDGE_SCROLL_ZONE_PX = 48;
export declare const EDGE_SCROLL_MAX_PX_PER_SEC = 900;
export declare const EDGE_SCROLL_REDUCED_STEP_MS = 500;
/**
 * The largest slot count a panel can have: 64. `slots` and `maxSlots` accept whole numbers from 1 to this value,
 * and a request above it is refused. A consumer may rely on it as the upper bound, and may pass it as `maxSlots`
 * to mean "every slot that fits". A drawn count is always capped at what fits the window.
 */
export declare const ALL_SLOTS = 64;
/** Whether the default mount fits the phone size to the window: 'off' draws the host's preferred size as it is. */
export declare const PHONE_FIT: "off";
/** The scale band the fit keeps the phone in, as fractions of the preferred size: 320 to 441 px on 390, inside real phone widths. */
export declare const PHONE_FIT_MIN = 0.82;
export declare const PHONE_FIT_MAX = 1.13;
/** The widest `slots` slots are drawn: whole phone widths with the row gap between them, so edges sit on the stop grid. */
export declare const slotWidth: (slots: number, phoneWidth: number, gap: number) => number;
/** The slots a panel is drawn at while the row is unmeasured. */
export declare const UNMEASURED_SLOTS = 3;
/** How many slots fit in `maxLiveWidth`; at least one, and `UNMEASURED_SLOTS` while the row is unmeasured (infinite). */
export declare function fitSlots(maxLiveWidth: number, phoneWidth: number, gap: number): number;
