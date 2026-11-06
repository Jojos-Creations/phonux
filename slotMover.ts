/**
 * A row slot's own motion: its translate, scale and opacity, run as Web Animations API animations on the shared start time, so
 * every slot a commit moves is sampled together by the compositor.
 */

import { cubicBezier } from 'motion/react';
import { sharedStartTime } from './rowClock.js';

/** Where a slot is drawn: its translate, its scale and its opacity. @internal */
export interface SlotPose {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly opacity: number;
}

/** How one move runs: seconds and a cubic bezier. @internal */
export interface SlotTiming {
  readonly duration: number;
  readonly ease: readonly [number, number, number, number];
}

/** Moves one slot's element. @internal */
export interface SlotMover {
  /** Where the slot is drawn now. */
  pose(): SlotPose;
  /** Draws `pose` at once, ending any move in flight. */
  set(pose: SlotPose): void;
  /** Moves from where the slot is drawn now to `pose` over `timing`; `done` runs when it lands, not when another move replaces it. */
  to(pose: SlotPose, timing: SlotTiming, done?: () => void): void;
  /** True while a move is in flight. */
  moving(): boolean;
}

/** The named curves a close exit may take, as Motion draws them. @internal */
export const NAMED_EASE: Readonly<Record<'easeIn' | 'easeOut' | 'easeInOut' | 'linear', readonly [number, number, number, number]>> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

// Every keyframe names the same functions in the same order, so the browser interpolates each number on its own.
const fullTransform = (p: SlotPose): string => `translateX(${p.x}px) translateY(${p.y}px) scale(${p.scale})`;
/** `pose` as the transform a slot is drawn with: only what differs from rest, `none` when nothing does. @internal */
export const shortTransform = (p: SlotPose): string => [p.x === 0 ? '' : `translateX(${p.x}px)`, p.y === 0 ? '' : `translateY(${p.y}px)`, p.scale === 1 ? '' : `scale(${p.scale})`].filter(Boolean).join(' ') || 'none';

const lerp = (a: number, b: number, p: number): number => a + (b - a) * p;

const movers = new WeakMap<Element, SlotMover>();

/** The mover drawing `el`, if a row slot has one. @internal */
export const moverOf = (el: Element): SlotMover | undefined => movers.get(el);

/** The mover for `el`, starting at `start`. @internal */
export function createSlotMover(el: HTMLElement, start: SlotPose): SlotMover {
  let rest = start;
  let run: { from: SlotPose; to: SlotPose; startMs: number; durationMs: number; curve: (t: number) => number; anim: Animation | null; done?: () => void } | null = null;
  let frame: number | null = null;

  const draw = (p: SlotPose): void => {
    el.style.transform = shortTransform(p);
    el.style.opacity = String(p.opacity);
  };
  const poseAt = (nowMs: number): SlotPose => {
    if (run === null) return rest;
    const e = run.curve(Math.min(1, Math.max(0, (nowMs - run.startMs) / run.durationMs)));
    return { x: lerp(run.from.x, run.to.x, e), y: lerp(run.from.y, run.to.y, e), scale: lerp(run.from.scale, run.to.scale, e), opacity: lerp(run.from.opacity, run.to.opacity, e) };
  };
  const halt = (): SlotPose => {
    const now = poseAt(performance.now());
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    run?.anim?.cancel();
    run = null;
    rest = now;
    return now;
  };
  const tick = (): void => {
    frame = null;
    if (run === null) return;
    const now = performance.now();
    if (now - run.startMs >= run.durationMs || !el.isConnected) {
      const finished = run;
      run = null;
      rest = finished.to;
      draw(finished.to);
      finished.anim?.cancel();
      finished.done?.();
      return;
    }
    // Without the Web Animations API the frame loop draws each frame itself.
    if (run.anim === null) draw(poseAt(now));
    frame = requestAnimationFrame(tick);
  };

  draw(start);
  const mover: SlotMover = {
    pose: () => poseAt(performance.now()),
    set(pose) {
      halt();
      rest = pose;
      draw(pose);
    },
    to(pose, timing, done) {
      const from = halt();
      const durationMs = timing.duration * 1000;
      if (durationMs <= 0) {
        rest = pose;
        draw(pose);
        done?.();
        return;
      }
      const startMs = sharedStartTime();
      let anim: Animation | null = null;
      if (typeof el.animate === 'function') {
        anim = el.animate(
          [
            { transform: fullTransform(from), opacity: from.opacity },
            { transform: fullTransform(pose), opacity: pose.opacity },
          ],
          { duration: durationMs, easing: `cubic-bezier(${timing.ease.join(', ')})`, fill: 'both' },
        );
        anim.startTime = startMs;
      }
      // Under the animation, the pose it lands on, so its end hands over without a frame of the old one.
      draw(anim === null ? from : pose);
      run = { from, to: pose, startMs, durationMs, curve: cubicBezier(timing.ease[0], timing.ease[1], timing.ease[2], timing.ease[3]), anim, done };
      frame = requestAnimationFrame(tick);
    },
    moving: () => run !== null,
  };
  movers.set(el, mover);
  return mover;
}

const holdShifts = new WeakMap<Element, number>();

/** Records the sideways shift a held panel's host draws it with. @internal */
export function setHoldShift(holdBox: Element, px: number): void {
  holdShifts.set(holdBox, px);
}

/** A box on screen, in px. @internal */
export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Everything that moves a slot without laying it out again: the strip's translate, a held panel's shift and the slot's own pose. */
function motionOf(el: HTMLElement, stripX: () => number): { dx: number; dy: number; scale: number } {
  const pose = moverOf(el)?.pose();
  const hold = el.closest('[data-row-hold]');
  return { dx: stripX() + (hold === null ? 0 : (holdShifts.get(hold) ?? 0)) + (pose?.x ?? 0), dy: pose?.y ?? 0, scale: pose?.scale ?? 1 };
}

const originXOf = (el: HTMLElement): number => {
  const first = el.style.transformOrigin.split(' ')[0];
  return first?.endsWith('%') === true ? Number.parseFloat(first) / 100 : 0.5;
};

/**
 * Measures `el` once and returns where it is drawn at any later moment, from the numbers that move it: the strip's translate
 * (`stripX`), a held panel's shift and the slot's pose. Reading it lays nothing out, so a frame loop can call it freely.
 * @internal
 */
export function screenBoxOf(el: HTMLElement, stripX: () => number): () => ScreenBox {
  const rect = el.getBoundingClientRect();
  const originX = originXOf(el);
  const at = motionOf(el, stripX);
  const width = at.scale > 0 ? rect.width / at.scale : el.offsetWidth;
  const height = at.scale > 0 ? rect.height / at.scale : el.offsetHeight;
  // Where the box would be with no transform at all, origin-corrected for the scale it was measured at.
  const left = rect.left - at.dx - originX * width * (1 - at.scale);
  const top = rect.top - at.dy - 0.5 * height * (1 - at.scale);
  return () => {
    const now = motionOf(el, stripX);
    return { x: left + now.dx + originX * width * (1 - now.scale), y: top + now.dy + 0.5 * height * (1 - now.scale), width: width * now.scale, height: height * now.scale };
  };
}
