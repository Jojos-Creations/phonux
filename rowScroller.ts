/**
 * The one owner of a row's horizontal offset. The container never scrolls: the offset and the row's centering margin are one
 * `translateX` on its strip, run as a Web Animations API animation so a glide keeps moving while the main thread is busy.
 * Internal and out of the barrel: a later custom scrollbar reads the strip from `computeRowNumbers` and writes through
 * `claim()`, the way edge scrolling does.
 */

import { cubicBezier } from 'motion/react';
import type { GlideEase } from './panelSettings.js';
import { ROW_STRIP_ATTRIBUTE } from './rowDom.js';

/** The exclusive writer `claim()` hands one holder. */
export interface ScrollClaim {
  /** Moves the offset to `left`, clamped to `[0, the bound from setMaxScroll]`, and returns the delta applied. Applies nothing before the first `setMaxScroll`. */
  write(left: number): number;
  /** The farthest legal offset, from the row numbers; the DOM is never asked. */
  setMaxScroll(max: number): void;
  /** Gives the claim back; `glideTo` and `claim()` work again. */
  release(): void;
}

/** How a move of the offset or the margin runs. */
export interface GlideOptions {
  /** Seconds the move takes. */
  durationSec: number;
  /** True: at once. */
  instant: boolean;
  /** The curve. */
  ease: GlideEase;
  /** True: a glide in flight hands its speed to this one, so a retarget keeps moving instead of starting from rest. */
  carry?: boolean;
  /** True: the strip fades out, moves at once while unseen, and fades back in, over `durationSec`. Nothing between is drawn. */
  fade?: boolean;
}

/** What may move one row's offset. */
export interface RowScroller {
  /** The row's current offset: how far its content is moved left, in the units a `scrollLeft` would be. */
  scrollLeft(): number;
  /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
  glideTo(target: number, o: GlideOptions): boolean;
  /** Where the glide in flight ends; null when none is. */
  glideTarget(): number | null;
  /** Moves the strip's centering margin to `left`, gliding beside any offset glide. Not counted as a scroll. */
  setMargin(left: number, o: GlideOptions): void;
  /** The strip's translate now: its margin less the offset. */
  stripX(): number;
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
  /**
   * A push past the row's end: the strip gives `distancePx` toward `direction` and springs back to where it rests, over
   * `durationSec`, starting as the glide in flight lands. Moves no offset. Asks while one plays, or until a bump's length after
   * the last ask, are absorbed, so a held key or a wheel's momentum bumps once.
   */
  bump(direction: 'left' | 'right', o: { distancePx: number; durationSec: number }): void;
  /** The exclusive writer, or null while one is held. A `replayScroll` claim keeps the scroll asked for while it is held, for `replayDeferred()`. */
  claim(options?: { replayScroll?: boolean }): ScrollClaim | null;
  /** Keeps `run` for the held `replayScroll` claim: it runs at `replayDeferred()`, the last one kept wins. False when no such claim is held. */
  deferUntilRelease(run: () => void): boolean;
  /** Runs the scroll kept by `deferUntilRelease`, once. A no-op when none was kept. */
  replayDeferred(): void;
  /** Wakes `listener` after each change of the offset or the margin, on every frame of a glide. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
  claimHeld(): boolean;
  /** True while a resize's settle waits for the margin to glide: the settle, not a change of stops, decides where the row rests. */
  settling(): boolean;
  /** Marks or unmarks that wait. */
  setSettling(on: boolean): void;
}

// A bezier tuple is built once per glide, not per frame.
function curveOf(ease: GlideEase): (t: number) => number {
  if (ease === 'cubic-out') return (t) => 1 - (1 - t) ** 3;
  if (ease === 'linear') return (t) => t;
  return cubicBezier(ease[0], ease[1], ease[2], ease[3]);
}

// The compositor runs the same curve the frame loop reports: sampled this often and joined linearly, it is the curve to the eye.
const SAMPLE_MS = 1000 / 60;

interface Glide {
  from: number;
  to: number;
  startMs: number;
  durationMs: number;
  curve: (t: number) => number;
  fade: boolean;
}

const progress = (g: Glide, nowMs: number): number => Math.min(1, Math.max(0, (nowMs - g.startMs) / g.durationMs));

const at = (g: Glide, nowMs: number): number => {
  const t = (nowMs - g.startMs) / g.durationMs;
  return t >= 1 ? g.to : g.from + (g.to - g.from) * g.curve(Math.max(0, t));
};

// A fade moves at its midpoint, where the strip is fully transparent.
const jumpCurve = (t: number): number => (t < 0.5 ? 0 : 1);
const opacityAt = (g: Glide, nowMs: number): number => Math.abs(1 - 2 * progress(g, nowMs));

const glideOf = (from: number, to: number, nowMs: number, o: GlideOptions): Glide => ({ from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: o.fade === true ? jumpCurve : curveOf(o.ease), fade: o.fade === true });

// The slope a glide in flight has now, in px per ms, read off its own curve.
const speedOf = (g: Glide, nowMs: number): number => (at(g, nowMs + 1) - at(g, nowMs - 1)) / 2;

/**
 * A glide from `from` to `to` that leaves at `speed` px per ms and eases into its rest: the first control point's slope is the
 * speed measured against the straight line, so a retarget joins the motion before it without a lurch.
 */
function carried(from: number, to: number, nowMs: number, speed: number, o: GlideOptions): Glide {
  const distance = to - from;
  const slope = Math.abs(distance) < 0.5 ? 0 : (speed * o.durationSec * 1000) / distance;
  const y1 = Math.min(1.5, Math.max(0, slope / 3));
  return { from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: cubicBezier(1 / 3, y1, 0.6, 1), fade: false };
}

/** How far a step past the row's end pushes the strip before it springs back, px, and how long the push and return take. */
export const ROW_BUMP_PX = 36;
export const ROW_BUMP_SEC = 0.45;

interface Bump {
  /** Signed px: positive moves the content left, as a step right would. */
  by: number;
  startMs: number;
  durationMs: number;
}

// The push takes this share of the bump on an ease-out; the rest springs back critically damped, so it settles without a wobble.
const BUMP_PEAK = 0.28;
const SPRING_K = 6;
const spring = (u: number): number => (1 + SPRING_K * u) * Math.exp(-SPRING_K * u);
const SPRING_END = spring(1);

const bumpAt = (b: Bump | null, nowMs: number): number => {
  if (b === null) return 0;
  const t = (nowMs - b.startMs) / b.durationMs;
  if (t <= 0 || t >= 1) return 0;
  if (t < BUMP_PEAK) return b.by * (1 - (1 - t / BUMP_PEAK) ** 3);
  return (b.by * (spring((t - BUMP_PEAK) / (1 - BUMP_PEAK)) - SPRING_END)) / (1 - SPRING_END);
};

const scrollers = new WeakMap<HTMLElement, RowScroller>();

/** The one `RowScroller` of `element`: the same object on every call. */
export function rowScrollerFor(element: HTMLElement): RowScroller {
  const existing = scrollers.get(element);
  if (existing !== undefined) return existing;
  const created = createRowScroller(element);
  scrollers.set(element, created);
  return created;
}

/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`. */
export function closestRowScroller(from: Element): HTMLElement | null {
  return from.closest<HTMLElement>('[data-row-scroller]');
}

function createRowScroller(el: HTMLElement): RowScroller {
  let claimed = false;
  // Set by a `replayScroll` claim; `deferred` is the scroll kept for it, run at `replayDeferred()` once its settle has moved the row.
  let replayable = false;
  let deferred: (() => void) | null = null;
  let offset = 0;
  let margin = 0;
  let marginSet = false;
  let glide: Glide | null = null;
  let marginGlide: Glide | null = null;
  let frame: number | null = null;
  let anim: Animation | null = null;
  let inputs = 0;
  let settleWait = false;
  let bump: Bump | null = null;
  let lastBumpAsk = Number.NEGATIVE_INFINITY;

  const listeners = new Set<() => void>();
  const moveListeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  const strip = (): HTMLElement | null => el.querySelector<HTMLElement>(`:scope > [${ROW_STRIP_ATTRIBUTE}]`);
  const translate = (x: number): string => `translateX(${x}px)`;

  // Draws what the numbers say now: the resting translate, plus one compositor animation for whatever still glides.
  const draw = (nowMs: number): void => {
    const s = strip();
    anim?.cancel();
    anim = null;
    if (s === null) return;
    s.style.transform = translate(margin - offset - bumpAt(bump, nowMs));
    s.style.opacity = glide?.fade === true ? String(opacityAt(glide, nowMs)) : '';
    const end = Math.max(glide === null ? 0 : glide.startMs + glide.durationMs, marginGlide === null ? 0 : marginGlide.startMs + marginGlide.durationMs, bump === null ? 0 : bump.startMs + bump.durationMs);
    if (end <= nowMs || typeof s.animate !== 'function') return;
    const frames: Keyframe[] = [];
    const steps = Math.max(1, Math.ceil((end - nowMs) / SAMPLE_MS));
    for (let k = 0; k <= steps; k += 1) {
      const t = nowMs + ((end - nowMs) * k) / steps;
      const keyframe: Keyframe = { transform: translate((marginGlide === null ? margin : at(marginGlide, t)) - (glide === null ? offset : at(glide, t)) - bumpAt(bump, t)), offset: k / steps };
      if (glide?.fade === true) keyframe.opacity = String(opacityAt(glide, t));
      frames.push(keyframe);
    }
    // Under the animation, the rest it lands on, so its end hands over without a frame of the old value.
    s.style.transform = translate((marginGlide?.to ?? margin) - (glide?.to ?? offset));
    s.style.opacity = '';
    anim = s.animate(frames, { duration: end - nowMs, easing: 'linear', fill: 'none' });
  };

  const tick = (): void => {
    frame = null;
    const now = performance.now();
    if (glide !== null) {
      offset = at(glide, now);
      if (now >= glide.startMs + glide.durationMs) endGlide();
    }
    if (marginGlide !== null) {
      margin = at(marginGlide, now);
      if (now >= marginGlide.startMs + marginGlide.durationMs) marginGlide = null;
    }
    if (bump !== null && now >= bump.startMs + bump.durationMs) bump = null;
    const s = strip();
    // Without the Web Animations API the frame loop draws each frame itself.
    if (anim === null && s !== null) {
      s.style.transform = translate(margin - offset - bumpAt(bump, now));
      s.style.opacity = glide?.fade === true ? String(opacityAt(glide, now)) : '';
    }
    if (glide === null && marginGlide === null && bump === null) {
      anim?.cancel();
      anim = null;
    }
    notify();
    if (moving()) frame = requestAnimationFrame(tick);
  };
  const moving = (): boolean => glide !== null || marginGlide !== null || bump !== null;
  const run = (): void => {
    if (frame === null && moving()) frame = requestAnimationFrame(tick);
  };

  const onPointerDown = (): void => stop();
  function endGlide(): void {
    if (glide === null) return;
    el.removeEventListener('pointerdown', onPointerDown);
    glide = null;
  }

  // Sets the offset at once, ending any glide of it; a margin glide in flight keeps going.
  const place = (left: number): void => {
    const now = performance.now();
    endGlide();
    if (marginGlide !== null) margin = at(marginGlide, now);
    offset = left;
    draw(now);
    if (!moving()) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    notify();
  };

  function stop(): void {
    if (glide === null) return;
    place(at(glide, performance.now()));
  }

  // The browser scrolls a clipped container to reveal a focused element. The row takes that as a move of its own offset and
  // gives the container its scroll back, so nothing but the strip ever moves.
  el.addEventListener(
    'scroll',
    () => {
      const by = el.scrollLeft;
      if (by === 0) return;
      el.scrollLeft = 0;
      place((glide === null ? offset : at(glide, performance.now())) + by);
    },
    { passive: true },
  );

  return {
    scrollLeft: () => offset,
    stripX: () => margin - offset,
    glideTo(target, o) {
      if (claimed) return false;
      if (o.instant || o.durationSec <= 0) {
        place(target);
        return true;
      }
      const now = performance.now();
      const from = glide === null ? offset : at(glide, now);
      const before = glide;
      if (glide === null) el.addEventListener('pointerdown', onPointerDown);
      if (marginGlide !== null) margin = at(marginGlide, now);
      offset = from;
      if (o.fade === true && before?.fade === true) {
        // A fade already under way goes on from the opacity it has reached, so a second jump does not flash the row.
        const t = progress(before, now);
        glide = glideOf(from, target, now - (t < 0.5 ? t : 1 - t) * o.durationSec * 1000, o);
      } else if (o.carry === true && before !== null && !before.fade) glide = carried(from, target, now, speedOf(before, now), o);
      else glide = glideOf(from, target, now, o);
      draw(now);
      run();
      return true;
    },
    glideTarget: () => (glide === null ? null : glide.to),
    setMargin(left, o) {
      const now = performance.now();
      const target = marginGlide === null ? margin : marginGlide.to;
      if (marginSet && target === left) return;
      if (glide !== null) offset = at(glide, now);
      margin = marginGlide === null ? margin : at(marginGlide, now);
      // The first margin is where the row is drawn from, not a move.
      marginGlide = !marginSet || o.instant || o.durationSec <= 0 ? null : glideOf(margin, left, now, o);
      marginSet = true;
      if (marginGlide === null) margin = left;
      draw(now);
      run();
      notify();
    },
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
      const kept = deferred;
      deferred = null;
      replayable = false;
      kept?.();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    settling: () => settleWait,
    setSettling(on) {
      settleWait = on;
    },
    stop,
    bump(direction, o) {
      const now = performance.now();
      const absorbed = now - lastBumpAsk < o.durationSec * 1000 || (bump !== null && now < bump.startMs + bump.durationMs);
      lastBumpAsk = now;
      if (absorbed || claimed || o.distancePx <= 0 || o.durationSec <= 0) return;
      if (glide !== null) offset = at(glide, now);
      if (marginGlide !== null) margin = at(marginGlide, now);
      bump = { by: direction === 'right' ? o.distancePx : -o.distancePx, startMs: Math.max(now, glide === null ? now : glide.startMs + glide.durationMs), durationMs: o.durationSec * 1000 };
      draw(now);
      run();
    },
    claim(options) {
      if (claimed) return null;
      stop();
      claimed = true;
      // Visible on the element, so a row that refuses every step can be told apart from one that never got the input.
      el.setAttribute('data-row-held', '');
      replayable = options?.replayScroll === true;
      deferred = null;
      let max: number | null = null;
      let released = false;
      return {
        write(left) {
          if (released || max === null) return 0;
          const before = offset;
          place(Math.min(max, Math.max(0, left)));
          return offset - before;
        },
        setMaxScroll(next) {
          max = next;
        },
        release() {
          if (released) return;
          released = true;
          claimed = false;
          el.removeAttribute('data-row-held');
        },
      };
    },
  };
}
