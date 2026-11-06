/**
 * The one owner of a row's horizontal position: one scalar, `view`, where the window's left edge sits along the strip. The
 * container never scrolls: the strip is one `translateX(-view)`, run as a Web Animations API animation so a glide keeps moving
 * while the main thread is busy. `scrollLeft()` is the view less its origin, which is where the row's centering lives.
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

/** How a move of the view runs. */
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
  /** Where the scroll glide in flight ends; null when none is, and while the centering alone is on its way. */
  glideTarget(): number | null;
  /**
   * The row's centering is now `centering` px. Every panel stays where it is on screen, then the view glides so the scroll the
   * row was going to rest at is kept: one glide of one number. `scrollLeft()` holds still through it, as the origin is shown
   * moving with the view. Not counted as a scroll.
   * The first call places the row without a move.
   */
  reorigin(centering: number, o: GlideOptions): void;
  /** The strip's translate now: the view's negative, less any bump. */
  stripX(): number;
  /** Whether the frame loop draws every glide instead of the compositor: on while a held panel follows the strip, so the two never drift apart. */
  drawEachFrame(on: boolean): void;
  /** How many times a person has asked to move the row: a step, a dot, a press on the row. Counted whether or not the row moved. */
  inputs(): number;
  /** Records one such ask. */
  noteInput(): void;
  /** Ends the glide in flight where it is. */
  stop(): void;
  /**
   * A push past the row's end: the strip gives `distancePx` toward `direction`, holds there until `holdMs` pass with no
   * further ask or `keepBump`, then springs back to where it rests. `durationSec` is the push and the return together. It
   * starts as the glide in flight lands, and moves no offset. An ask the same way while the bump holds only extends the hold.
   */
  bump(direction: 'left' | 'right', o: { distancePx: number; durationSec: number; holdMs: number }): void;
  /** Extends a bump toward `direction` that has not begun springing back, by `holdMs` from now; does nothing otherwise. */
  keepBump(direction: 'left' | 'right', holdMs: number): void;
  /** The exclusive writer, or null while one is held. A `replayScroll` claim keeps the scroll asked for while it is held, for `replayDeferred()`. */
  claim(options?: { replayScroll?: boolean }): ScrollClaim | null;
  /** Keeps `run` for the held `replayScroll` claim: it runs at `replayDeferred()`, the last one kept wins. False when no such claim is held. */
  deferUntilRelease(run: () => void): boolean;
  /** Runs the scroll kept by `deferUntilRelease`, once. A no-op when none was kept. */
  replayDeferred(): void;
  /** Wakes `listener` after each change of the view, on every frame of a glide. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
  claimHeld(): boolean;
  /** True while a resize's settle waits for the row to re-center: the settle, not a change of stops, decides where the row rests. */
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
  /** Origin shift this glide still has to show, px: the scroll a caller reads keeps its place while the view travels it. */
  owed: number;
  /** False for a glide that only carries the centering to its landing: no caller asked the scroll to go anywhere. */
  scrolls: boolean;
}

const progress = (g: Glide, nowMs: number): number => Math.min(1, Math.max(0, (nowMs - g.startMs) / g.durationMs));

const at = (g: Glide, nowMs: number): number => {
  const t = (nowMs - g.startMs) / g.durationMs;
  return t >= 1 ? g.to : g.from + (g.to - g.from) * g.curve(Math.max(0, t));
};

// A fade moves at its midpoint, where the strip is fully transparent.
const jumpCurve = (t: number): number => (t < 0.5 ? 0 : 1);
const opacityAt = (g: Glide, nowMs: number): number => Math.abs(1 - 2 * progress(g, nowMs));

const glideOf = (from: number, to: number, nowMs: number, o: GlideOptions): Glide => ({ from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: o.fade === true ? jumpCurve : curveOf(o.ease), fade: o.fade === true, owed: 0, scrolls: true });

// What is still owed at `nowMs`: the shift fades out along the glide's own curve, so it is spent exactly when the view lands.
const owedAt = (g: Glide, nowMs: number): number => {
  const t = (nowMs - g.startMs) / g.durationMs;
  return t >= 1 ? 0 : g.owed * (1 - g.curve(Math.max(0, t)));
};

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
  return { from, to, startMs: nowMs, durationMs: o.durationSec * 1000, curve: cubicBezier(1 / 3, y1, 0.6, 1), fade: false, owed: 0, scrolls: true };
}

/** How far a step past the row's end pushes the strip before it springs back, px, and how long the push and return take. */
export const ROW_BUMP_PX = 36;
export const ROW_BUMP_SEC = 0.45;

interface Bump {
  /** Where the push starts from: a bump asked while the last one springs back takes over from where that one is. */
  from: number;
  /** Signed px: positive moves the content left, as a step right would. */
  by: number;
  startMs: number;
  outMs: number;
  holdUntilMs: number;
  backMs: number;
}

// The push takes this share of the bump on an ease-out; the rest springs back critically damped, so it settles without a wobble.
const BUMP_PEAK = 0.28;
const SPRING_K = 6;
const spring = (u: number): number => (1 + SPRING_K * u) * Math.exp(-SPRING_K * u);
const SPRING_END = spring(1);

const releaseOf = (b: Bump): number => Math.max(b.startMs + b.outMs, b.holdUntilMs);
const bumpEnd = (b: Bump | null): number => (b === null ? 0 : releaseOf(b) + b.backMs);

const bumpAt = (b: Bump | null, nowMs: number): number => {
  if (b === null || nowMs >= bumpEnd(b)) return 0;
  if (nowMs <= b.startMs) return b.from;
  if (nowMs < b.startMs + b.outMs) return b.from + (b.by - b.from) * (1 - (1 - (nowMs - b.startMs) / b.outMs) ** 3);
  const release = releaseOf(b);
  if (nowMs <= release) return b.by;
  return (b.by * (spring((nowMs - release) / b.backMs) - SPRING_END)) / (1 - SPRING_END);
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
  // The view's origin is the negative of the row's centering, so the scroll a caller reads is the view less the origin.
  let view = 0;
  let origin = 0;
  let originSet = false;
  let glide: Glide | null = null;
  let frame: number | null = null;
  let anim: Animation | null = null;
  let inputs = 0;
  let settleWait = false;
  let bump: Bump | null = null;

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of [...listeners]) l();
  };
  const strip = (): HTMLElement | null => el.querySelector<HTMLElement>(`:scope > [${ROW_STRIP_ATTRIBUTE}]`);
  const translate = (x: number): string => `translateX(${x}px)`;

  // A held panel and the strip's cut follow `stripX()` from the frame loop. A compositor animation runs a frame or more ahead of it, so such a row draws every frame itself.
  let framed = false;
  // Draws what the numbers say now: the resting translate, plus one compositor animation for whatever still glides.
  const draw = (nowMs: number): void => {
    const s = strip();
    anim?.cancel();
    anim = null;
    if (s === null) return;
    s.style.transform = translate(-view - bumpAt(bump, nowMs));
    s.style.opacity = glide?.fade === true ? String(opacityAt(glide, nowMs)) : '';
    const end = Math.max(glide === null ? 0 : glide.startMs + glide.durationMs, bumpEnd(bump));
    if (end <= nowMs || framed || typeof s.animate !== 'function') return;
    const frames: Keyframe[] = [];
    const steps = Math.max(1, Math.ceil((end - nowMs) / SAMPLE_MS));
    for (let k = 0; k <= steps; k += 1) {
      const t = nowMs + ((end - nowMs) * k) / steps;
      const keyframe: Keyframe = { transform: translate(-(glide === null ? view : at(glide, t)) - bumpAt(bump, t)), offset: k / steps };
      if (glide?.fade === true) keyframe.opacity = String(opacityAt(glide, t));
      frames.push(keyframe);
    }
    // Under the animation, the rest it lands on, so its end hands over without a frame of the old value.
    s.style.transform = translate(-(glide?.to ?? view));
    s.style.opacity = '';
    anim = s.animate(frames, { duration: end - nowMs, easing: 'linear', fill: 'none' });
  };

  const tick = (): void => {
    frame = null;
    const now = performance.now();
    if (glide !== null) {
      view = at(glide, now);
      if (now >= glide.startMs + glide.durationMs) endGlide();
    }
    if (bump !== null && now >= bumpEnd(bump)) bump = null;
    const s = strip();
    // Without the Web Animations API the frame loop draws each frame itself.
    if (anim === null && s !== null) {
      s.style.transform = translate(-view - bumpAt(bump, now));
      s.style.opacity = glide?.fade === true ? String(opacityAt(glide, now)) : '';
    }
    if (glide === null && bump === null) {
      anim?.cancel();
      anim = null;
    }
    notify();
    if (moving()) frame = requestAnimationFrame(tick);
  };
  const moving = (): boolean => glide !== null || bump !== null;
  const run = (): void => {
    if (frame === null && moving()) frame = requestAnimationFrame(tick);
  };

  function endGlide(): void {
    if (glide === null) return;
    glide = null;
  }

  // Sets the scroll at once, ending any scroll glide. A centering still travelling is not a scroll: the origin goes on moving to its
  // landing as it was, so a press or a jump never freezes the row off-center.
  const place = (left: number): void => {
    const now = performance.now();
    const g = glide;
    endGlide();
    const owed = g === null || g.fade ? 0 : owedAt(g, now);
    view = left + origin - owed;
    if (g !== null && owed !== 0) {
      const spent = g.owed * g.curve(Math.max(0, (now - g.startMs) / g.durationMs));
      glide = { ...g, from: view - spent, to: view - spent + g.owed, scrolls: false };
    }
    draw(now);
    run();
    if (!moving()) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    notify();
  };

  // The scroll as a caller would read it this instant, off the glide's own curve rather than the last frame's view.
  const scrollNow = (): number => {
    if (glide === null) return view - origin;
    const now = performance.now();
    return at(glide, now) - origin + (glide.fade ? 0 : owedAt(glide, now));
  };

  function stop(): void {
    if (glide === null) return;
    place(scrollNow());
  }

  // The browser scrolls a clipped container to reveal a focused element. The row takes that as a move of its own offset and
  // gives the container its scroll back, so nothing but the strip ever moves.
  el.addEventListener(
    'scroll',
    () => {
      const by = el.scrollLeft;
      if (by === 0) return;
      el.scrollLeft = 0;
      place(scrollNow() + by);
    },
    { passive: true },
  );

  return {
    scrollLeft: () => (glide === null ? view - origin : view - origin + owedAt(glide, performance.now())),
    // The bump is in the translate, so it is in the strip's x: a reader placing against the strip during a bump sees where it is drawn.
    stripX: () => -view - bumpAt(bump, performance.now()),
    drawEachFrame(on) {
      if (framed === on) return;
      framed = on;
      draw(performance.now());
    },
    glideTo(target, o) {
      if (claimed) return false;
      if (o.instant || o.durationSec <= 0) {
        place(target);
        return true;
      }
      const now = performance.now();
      const from = glide === null ? view : at(glide, now);
      const before = glide;
      const to = target + origin;
      view = from;
      if (o.fade === true && before?.fade === true) {
        // A fade already under way goes on from the opacity it has reached, so a second jump does not flash the row.
        const t = progress(before, now);
        glide = glideOf(from, to, now - (t < 0.5 ? t : 1 - t) * o.durationSec * 1000, o);
      } else if (o.carry === true && before !== null && !before.fade) glide = carried(from, to, now, speedOf(before, now), o);
      else glide = glideOf(from, to, now, o);
      if (before !== null) glide.owed = owedAt(before, now);
      draw(now);
      run();
      return true;
    },
    glideTarget: () => (glide === null || !glide.scrolls ? null : glide.to - origin),
    reorigin(centering, o) {
      const now = performance.now();
      const next = -centering;
      if (originSet && next === origin) return;
      const shift = next - origin;
      const here = glide === null ? view : at(glide, now);
      // The first origin is where the row is drawn from, not a move: the scroll is kept and the view follows it.
      if (!originSet || o.instant || o.durationSec <= 0) {
        if (glide !== null) glide = { ...glide, from: glide.from + shift, to: glide.to + shift };
        view = here + shift;
        origin = next;
        originSet = true;
        draw(now);
        run();
        notify();
        return;
      }
      const landing = glide === null ? here : glide.to;
      origin = next;
      view = here;
      const owed = (glide === null ? 0 : owedAt(glide, now)) + shift;
      const scrolls = glide?.scrolls ?? false;
      glide = glide !== null && !glide.fade ? carried(here, landing + shift, now, speedOf(glide, now), o) : glideOf(here, landing + shift, now, o);
      glide.owed = owed;
      glide.scrolls = scrolls;
      draw(now);
      run();
      notify();
    },
    inputs: () => inputs,
    noteInput() {
      inputs += 1;
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
      if (claimed || o.distancePx <= 0 || o.durationSec <= 0) return;
      const now = performance.now();
      const by = direction === 'right' ? o.distancePx : -o.distancePx;
      if (glide !== null) view = at(glide, now);
      if (bump !== null && bump.by === by && now < releaseOf(bump)) bump.holdUntilMs = Math.max(bump.holdUntilMs, now + o.holdMs);
      else {
        const ms = o.durationSec * 1000;
        bump = { from: bumpAt(bump, now), by, startMs: Math.max(now, glide === null ? now : glide.startMs + glide.durationMs), outMs: ms * BUMP_PEAK, holdUntilMs: now + o.holdMs, backMs: ms * (1 - BUMP_PEAK) };
      }
      draw(now);
      run();
    },
    keepBump(direction, holdMs) {
      const now = performance.now();
      if (bump === null || Math.sign(bump.by) !== (direction === 'right' ? 1 : -1) || now >= releaseOf(bump) || now + holdMs <= bump.holdUntilMs) return;
      if (glide !== null) view = at(glide, now);
      bump.holdUntilMs = now + holdMs;
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
          const before = view;
          place(Math.min(max, Math.max(0, left)));
          return view - before;
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
