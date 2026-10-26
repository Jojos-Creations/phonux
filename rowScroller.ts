/**
 * The one writer of a row container's `scrollLeft`. Internal and out of the barrel: a later custom scrollbar reads the
 * strip from `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
 */

import { cubicBezier } from 'motion/react';
import type { GlideEase } from './panelSettings.js';

/** The exclusive writer `claim()` hands one holder. */
export interface ScrollClaim {
  /** Moves `scrollLeft` to `left`, clamped to `[0, the bound from setMaxScroll]`, and returns the delta applied. Applies nothing before the first `setMaxScroll`. */
  write(left: number): number;
  /** The farthest legal `scrollLeft`, from the row numbers; the DOM is never asked. */
  setMaxScroll(max: number): void;
  /** Gives the claim back; `glideTo` and `claim()` work again. */
  release(): void;
}

/** What may move one container's `scrollLeft`. */
export interface RowScroller {
  /** The container's current `scrollLeft`. */
  scrollLeft(): number;
  /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
  glideTo(target: number, o: { durationSec: number; instant: boolean; ease: GlideEase }): boolean;
  /** Where the glide in flight ends; null when none is. */
  glideTarget(): number | null;
  /** How many times a person has asked to move the row: a step, a dot, a press on the row. Counted whether or not the row moved. */
  inputs(): number;
  /** Records one such ask. */
  noteInput(): void;
  /** Records that a person is moving the row itself (a step, a dot, a drag of the dot bar), not pressing inside it. */
  noteMove(): void;
  /** Wakes `listener` at each `noteMove()`. Returns the unsubscribe. */
  subscribeMoves(listener: () => void): () => void;
  /** Ends the glide in flight where it is. */
  stop(): void;
  /** The exclusive writer, or null while one is held. A `replayScroll` claim keeps the scroll asked for while it is held, for `replayDeferred()`. */
  claim(options?: { replayScroll?: boolean }): ScrollClaim | null;
  /** Keeps `run` for the held `replayScroll` claim: it runs at `replayDeferred()`, the last one kept wins. False when no such claim is held. */
  deferUntilRelease(run: () => void): boolean;
  /** Runs the scroll kept by `deferUntilRelease`, once. A no-op when none was kept. */
  replayDeferred(): void;
  /** Wakes `listener` after each write to `scrollLeft` and on a native scroll of the row. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
  claimHeld(): boolean;
  /** True while a resize's settle waits for the margin to glide: the settle, not a change of stops, decides where the row rests. */
  settling(): boolean;
  /** Marks or unmarks that wait. */
  setSettling(on: boolean): void;
}

// A scroll event this far from the last value written is somebody else's; browsers round a fractional write.
const FOREIGN_SCROLL_PX = 1;

// A bezier tuple is built once per glide, not per frame.
function curveOf(ease: GlideEase): (t: number) => number {
  if (ease === 'cubic-out') return (t) => 1 - (1 - t) ** 3;
  if (ease === 'linear') return (t) => t;
  return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
}

const scrollers = new WeakMap<HTMLElement, RowScroller>();

/** The one `RowScroller` of `element`: the same object on every call. */
export function rowScrollerFor(element: HTMLElement): RowScroller {
  const existing = scrollers.get(element);
  if (existing !== undefined) return existing;
  const created = createRowScroller(element);
  scrollers.set(element, created);
  return created;
}

/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`; never computed overflow, so a container whose `overflow-x` is hidden is found too. */
export function closestRowScroller(from: Element): HTMLElement | null {
  return from.closest<HTMLElement>('[data-row-scroller]');
}

function createRowScroller(el: HTMLElement): RowScroller {
  let claimed = false;
  // Set by a `replayScroll` claim; `deferred` is the scroll kept for it, run at `replayDeferred()` once its settle has moved the row.
  let replayable = false;
  let deferred: (() => void) | null = null;
  let glide: { from: number; to: number; startMs: number; durationMs: number; curve: (t: number) => number } | null = null;
  let frame: number | null = null;
  // Read back after every own write: the browser rounds and clamps, and the scroll event it fires later reports that value.
  let lastWritten = el.scrollLeft;
  let inputs = 0;
  let settleWait = false;

  const listeners = new Set<() => void>();
  const moveListeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  const write = (left: number): void => {
    el.scrollLeft = left;
    lastWritten = el.scrollLeft;
    notify();
  };
  const onForeignScroll = (): void => {
    if (Math.abs(el.scrollLeft - lastWritten) > FOREIGN_SCROLL_PX) stop();
  };
  const onPointerDown = (): void => stop();

  function stop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (glide !== null) {
      el.removeEventListener('scroll', onForeignScroll);
      el.removeEventListener('pointerdown', onPointerDown);
    }
    glide = null;
  }

  function tick(): void {
    frame = null;
    if (glide === null) return;
    const t = (performance.now() - glide.startMs) / glide.durationMs;
    if (t >= 1) {
      const to = glide.to;
      stop();
      write(to);
      return;
    }
    write(glide.from + (glide.to - glide.from) * glide.curve(Math.max(0, t)));
    frame = requestAnimationFrame(tick);
  }

  return {
    scrollLeft: () => el.scrollLeft,
    glideTo(target, o) {
      if (claimed) return false;
      if (o.instant || o.durationSec <= 0) {
        stop();
        write(target);
        return true;
      }
      if (glide === null) {
        el.addEventListener('scroll', onForeignScroll);
        el.addEventListener('pointerdown', onPointerDown);
      }
      lastWritten = el.scrollLeft;
      glide = { from: el.scrollLeft, to: target, startMs: performance.now(), durationMs: o.durationSec * 1000, curve: curveOf(o.ease) };
      if (frame === null) frame = requestAnimationFrame(tick);
      return true;
    },
    glideTarget: () => (glide === null ? null : glide.to),
    inputs: () => inputs,
    noteInput() {
      inputs += 1;
    },
    noteMove() {
      for (const l of [...moveListeners]) l();
    },
    subscribeMoves(listener) {
      moveListeners.add(listener);
      return () => void moveListeners.delete(listener);
    },
    claimHeld: () => claimed,
    deferUntilRelease(run) {
      if (!claimed || !replayable) return false;
      deferred = run;
      return true;
    },
    replayDeferred() {
      const run = deferred;
      deferred = null;
      replayable = false;
      run?.();
    },
    subscribe(listener) {
      if (listeners.size === 0) el.addEventListener('scroll', notify, { passive: true });
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        el.removeEventListener('scroll', notify);
      };
    },
    settling: () => settleWait,
    setSettling(on) {
      settleWait = on;
    },
    stop,
    claim(options) {
      if (claimed) return null;
      stop();
      claimed = true;
      replayable = options?.replayScroll === true;
      deferred = null;
      let max: number | null = null;
      let released = false;
      return {
        write(left) {
          if (released || max === null) return 0;
          const before = el.scrollLeft;
          write(Math.min(max, Math.max(0, left)));
          return el.scrollLeft - before;
        },
        setMaxScroll(next) {
          max = next;
        },
        release() {
          if (released) return;
          released = true;
          claimed = false;
        },
      };
    },
  };
}
