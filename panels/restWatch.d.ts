/**
 * Watches a row until it has stood still, then reports where it rests. It adds no listener: the caller starts it from the
 * gestures it already hears. Plain frame callbacks, no React, so the hook that owns the row only supplies the reads.
 */
export interface RestWatch {
    /** Starts a watch of the row in `el` unless one is running. `onRest(at)` runs once the row has stood still for the quiet time and moved since the watch began. */
    readonly watch: (el: HTMLElement, onRest: (at: number) => void) => void;
    /** Stops the running watch, if any. */
    readonly cancel: () => void;
}
export interface RestWatchEnv {
    /** How long the row must stand still before it counts as at rest. */
    readonly quietMs: number;
    /** True while a pointer holds the row, so a rest is not called. */
    readonly pointerHeld: () => boolean;
    /** False until the restore settled: a row that moved then is not saved. */
    readonly settled: () => boolean;
}
export declare function createRestWatch(env: RestWatchEnv): RestWatch;
