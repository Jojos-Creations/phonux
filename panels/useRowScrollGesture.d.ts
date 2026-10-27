import type { RefObject } from 'react';
/**
 * Hands the row a wheel from content whose input never reaches the page, such as an Electron `<webview>` or a cross-origin
 * `<iframe>`: a script in that content cancels the wheel itself and passes its deltas here, with `from` the element that shows it.
 * The row reads the wheel as it reads one over its own content, so a sideways one steps it and a vertical one does nothing.
 * Pass `altKey` true for a gesture the content keeps, so the row lets the rest of it be.
 *
 * @param from - An element inside the row, usually the webview or iframe.
 * @param wheel - The wheel's deltas, `deltaMode` as `WheelEvent` reports it (0 pixels, 1 lines, 2 pages).
 * @returns True when the row took the wheel, so the content must not scroll by it.
 *
 * @public
 */
export declare function feedRowWheel(from: Element, wheel: {
    deltaX: number;
    deltaY?: number;
    deltaMode?: number;
    shiftKey?: boolean;
    altKey?: boolean;
}): boolean;
/**
 * One gesture travels as far as it is pushed, one step per `stepPx` of wheel travel, never by free pixels: the first
 * event of a gesture steps at once, so a short swipe or one wheel notch still moves, and every further `stepPx` of
 * travel in the same direction steps again, momentum included. A reversal starts a fresh gesture. Each step is the
 * caller's glide to the next stop, so the row always comes to rest on one.
 *
 * A finger drag feeds the same accumulator: a finger moving left is the travel a wheel reports as `deltaX` > 0, so it asks
 * for the step right. A drag that starts vertical is left to the page for the whole touch.
 *
 * `gestureLockMs`: after a step, the next one waits at least this long, so a single event far larger than `stepPx`
 * cannot jump several stops in one frame. `gestureQuietMs`: no wheel event for this long ends a gesture.
 */
export declare function useRowScrollGesture(overflowContainerRef: RefObject<HTMLDivElement | null>, onStep: (direction: 'left' | 'right') => void, gestureLockMs?: number, mode?: 'step' | 'off', gestureQuietMs?: number, stepPx?: number): void;
