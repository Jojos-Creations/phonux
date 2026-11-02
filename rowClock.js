/**
 * The one moment every row motion started in the same task counts from, so the compositor samples a slot, its neighbors, the
 * strip and a fullscreen panel together however long the commit that started them runs.
 */
let stamp;
/** The start time, in `performance.now()` units, shared by every animation created in this task. @internal */
export function sharedStartTime() {
    if (stamp === undefined) {
        stamp = performance.now();
        queueMicrotask(() => {
            stamp = undefined;
        });
    }
    return stamp;
}
/**
 * Starts `keyframes` on `el` at the shared start time. Null where the Web Animations API is missing: the caller then draws each
 * frame itself.
 * @internal
 */
export function animateShared(el, keyframes, durationMs, easing = 'linear') {
    if (typeof el.animate !== 'function')
        return null;
    const anim = el.animate(keyframes, { duration: durationMs, easing, fill: 'both' });
    const start = sharedStartTime();
    // `startTime` is on the document timeline, whose origin is the one `performance.now()` counts from.
    if (anim.timeline === document.timeline || anim.timeline === null)
        anim.startTime = start;
    return anim;
}
