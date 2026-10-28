/**
 * The one moment every row motion started in the same task counts from, so the compositor samples a slot, its neighbors, the
 * strip and a fullscreen panel together however long the commit that started them runs.
 */
/** The start time, in `performance.now()` units, shared by every animation created in this task. @internal */
export declare function sharedStartTime(): number;
/**
 * Starts `keyframes` on `el` at the shared start time. Null where the Web Animations API is missing: the caller then draws each
 * frame itself.
 * @internal
 */
export declare function animateShared(el: Element, keyframes: Keyframe[], durationMs: number, easing?: string): Animation | null;
