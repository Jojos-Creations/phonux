import type { RefObject } from 'react';
/**
 * One gesture travels as far as it is pushed, one step per `stepPx` of wheel travel, never by free pixels: the first
 * event of a gesture steps at once, so a short swipe or one wheel notch still moves, and every further `stepPx` of
 * travel in the same direction steps again, momentum included. A reversal starts a fresh gesture. Each step is the
 * caller's glide to the next stop, so the row always comes to rest on one.
 *
 * `gestureLockMs`: after a step, the next one waits at least this long, so a single event far larger than `stepPx`
 * cannot jump several stops in one frame. `gestureQuietMs`: no wheel event for this long ends a gesture.
 */
export declare function useRowScrollGesture(overflowContainerRef: RefObject<HTMLDivElement | null>, onStep: (direction: 'left' | 'right') => void, gestureLockMs?: number, mode?: 'step' | 'off', gestureQuietMs?: number, stepPx?: number): void;
