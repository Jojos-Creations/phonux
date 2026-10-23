import type { CaptureTrigger, ViewId } from './snapshots.js';
/** Options for `useRecaptureOnSettle`. @public */
export interface RecaptureOnSettleOptions {
    /** Whether the pictures are on screen. Nothing is captured while this is false. */
    readonly open: boolean;
    /** The panels to picture. Read at the start of each round, so it reflects the list at that moment. */
    readonly liveIds: () => readonly ViewId[];
    /**
     * How long scrolling must stay still before the second round, in ms.
     * @defaultValue 150
     */
    readonly settleMs?: number;
}
/**
 * Pictures every live panel when `open` turns on, then once more after the document stops scrolling. Scroll events
 * within `settleMs` of each other count as one scroll, so a long scroll costs one round, not one per frame.
 * @public
 */
export declare function useRecaptureOnSettle(trigger: CaptureTrigger, options: RecaptureOnSettleOptions): void;
