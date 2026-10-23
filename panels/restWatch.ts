/**
 * Watches a row until it has stood still, then reports where it rests. It adds no listener: the caller starts it from the
 * gestures it already hears. Plain frame callbacks, no React, so the hook that owns the row only supplies the reads.
 */

import { rowScrollerFor } from '../rowScroller.js';

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

export function createRestWatch(env: RestWatchEnv): RestWatch {
  let frame: number | null = null;
  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  };
  const watch = (el: HTMLElement, onRest: (at: number) => void): void => {
    if (frame !== null) return;
    const scroller = rowScrollerFor(el);
    const start = scroller.scrollLeft();
    let last = start;
    let still = performance.now();
    let moved = false;
    const tick = (): void => {
      frame = null;
      const at = scroller.scrollLeft();
      const gliding = scroller.glideTarget() !== null;
      const now = performance.now();
      if (at !== start || gliding) moved = true;
      if (at !== last || gliding || scroller.claimHeld() || env.pointerHeld()) {
        last = at;
        still = now;
      } else if (now - still >= env.quietMs) {
        if (moved && env.settled()) onRest(at);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  };
  return { watch, cancel };
}
