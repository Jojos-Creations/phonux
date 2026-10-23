/** One virtual frame, in milliseconds. The clock only ever moves by a whole number of these. @public */
export declare const FRAME_MS = 16;
/** The one counter behind requestAnimationFrame, cancelAnimationFrame and performance.now: time moves only when a test steps it. @public */
export declare const frameClock: {
    /** The counter's current value, in milliseconds; what `performance.now()` reads. */
    now: () => number;
    /**
     * Moves the counter on with no frame run, as a task that blocks the main thread does.
     * @param ms - How far to move it.
     */
    skip(ms: number): void;
    /** How many callbacks wait for the next frame; 0 once every animation has finished. */
    pendingCount: () => number;
    /**
     * Runs `frames` frames: each advances the counter by FRAME_MS, then calls the callbacks queued before it began.
     * It never yields, so a caller that needs promise continuations between frames steps one frame per turn.
     * @param frames - How many frames to run.
     */
    step(frames: number): void;
};
