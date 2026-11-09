/**
 * How a mouse wheel feels on the Embla row (emblaRow.ts, `wheelBy`): how far each wheel moves the row, and how far a fast spin
 * coasts on once the wheel stops. Pure arithmetic over the last `RATE_MS` of wheels; the row hands it every wheel and keeps what it
 * answers for the gesture's end.
 *
 * Tuning knobs. A headless run cannot turn a real wheel, so these are set by hand and judged by feel. Rates are wheel px per ms;
 * Chromium on macOS sends 40 px a notch of a mouse wheel, so one notch alone in `RATE_MS` reads 0.4, and a notch every 25 ms 1.6.
 */

/** How far back the wheel's rate is read, in ms: long enough to hold a few notches of a spin, short enough to follow a change. */
export const RATE_MS = 100;
/** Row px per wheel px at or under `SLOW_RATE` (a notch every 100 ms or slower): half a notch each, for fine placing. */
export const SLOW_SPEED = 0.5;
export const SLOW_RATE = 0.5;
/**
 * Row px per wheel px at or over `FAST_RATE` (a notch every 16 ms): a spin covers ground. Between the two rates the speed rises in a
 * straight line, as a desktop's pointer acceleration does.
 */
export const FAST_SPEED = 1.75;
export const FAST_RATE = 2.5;
/** The row speed (row px per ms over `RATE_MS`) a wheel must leave the row moving at for it to coast on: about 2.5 pages a second. */
export const COAST_MIN_RATE = 1;
/** How far a coast carries the row: its speed for this many ms (Embla's own release of a mouse drag throws it 300 ms of its speed). */
export const COAST_MS = 300;
/**
 * How long the wheel is quiet before a fast spin's coast starts: twice the spin's own gap between wheels, within these bounds. The
 * floor leaves a trackpad's momentum (which begins within a frame or two of the lift) time to arrive first; the cap is the
 * wheel-gestures plugin's own end of a gesture.
 */
export const COAST_QUIET_MIN_MS = 50;
export const COAST_QUIET_MAX_MS = 120;

interface Wheel {
  t: number;
  px: number;
  row: number;
  momentum: boolean;
}
/** The wheels of the last `RATE_MS` on one row, oldest first. */
export type WheelFeel = Wheel[];

/** The speed (row px per wheel px) for a wheel rate (wheel px per ms). */
export function wheelSpeed(rate: number): number {
  const k = Math.min(1, Math.max(0, (rate - SLOW_RATE) / (FAST_RATE - SLOW_RATE)));
  return SLOW_SPEED + k * (FAST_SPEED - SLOW_SPEED);
}

/**
 * One wheel at `t` ms moving `px` scroll px (signed), `momentum` when the browser flags it as a trackpad's momentum. Answers the row
 * px it moves, and, if it turns out to be the gesture's last, the coast (scroll px, signed; 0 for none) and how long the wheel must be
 * quiet before it starts (null: no coast, the gesture's own idle wait). No coast follows a trackpad: its momentum is the coast, and a
 * gesture with a momentum wheel in the last `RATE_MS` never adds one.
 */
export function feelWheel(recent: WheelFeel, t: number, px: number, momentum: boolean): { row: number; coast: number; quietMs: number | null } {
  while (recent.length > 0 && recent[0]!.t <= t - RATE_MS) recent.shift();
  const rate = Math.abs(recent.reduce((n, w) => n + w.px, px)) / RATE_MS;
  const row = px * wheelSpeed(rate);
  recent.push({ t, px, row, momentum });
  const moved = recent.reduce((n, w) => n + w.row, 0);
  if (recent.some((w) => w.momentum) || Math.abs(moved) / RATE_MS < COAST_MIN_RATE) return { row, coast: 0, quietMs: null };
  const gap = recent.length > 1 ? (t - recent[0]!.t) / (recent.length - 1) : COAST_QUIET_MAX_MS;
  return { row, coast: (moved / RATE_MS) * COAST_MS, quietMs: Math.min(COAST_QUIET_MAX_MS, Math.max(COAST_QUIET_MIN_MS, 2 * gap)) };
}
