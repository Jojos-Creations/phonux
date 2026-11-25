/**
 * What a sideways wheel asks of the row: whole stops, never a distance. The row owns the glide to a stop, so slow or uneven input
 * cannot break it into pieces, and there is no pause to guess at.
 */

/** Travel with no wheel for longer than this starts afresh, in ms. @internal */
export const WHEEL_STEP_GAP_MS = 600;
/** Travel a fresh gesture needs before its first step, in px: a finger resting on a trackpad does not move the row. @internal */
export const WHEEL_START_PX = 4;
/** Travel against a gesture's direction that turns it, in px: a momentum tail's last events can flicker the other way. @internal */
export const WHEEL_AGAINST_PX = 8;

/** How long after a step a wheel that is still going queues the next one without a whole pitch of travel, in ms. @internal */
export const WHEEL_QUEUE_MS = 350;
/** The travel that queued step needs since the one before, in px: three notches of a slow mouse wheel. @internal */
export const WHEEL_QUEUE_PX = 12;
/** A wheel this long after the last one is a fresh push, in ms: a momentum tail comes every frame. @internal */
export const WHEEL_NOTCH_MS = 60;

/** One gesture's travel. @internal */
export interface WheelStepState {
  /** 1 toward the strip's end, -1 toward its start, 0 before the first step. */
  dir: -1 | 0 | 1;
  /** Travel not yet turned into a step, in px, in the gesture's direction once it has one. */
  travel: number;
  /** Travel against the direction, in px. */
  against: number;
  /** When the last wheel came, ms. */
  at: number;
  /** When the last step came, ms. */
  stepAt: number;
  /** The size of the last wheel, in px. */
  last: number;
}

/** Whether `state` is too old at `at` for a wheel to extend it. @internal */
export const wheelStale = (state: WheelStepState | undefined, at: number): boolean => state === undefined || at - state.at > WHEEL_STEP_GAP_MS;

/**
 * One wheel of `by` scroll px at `at` ms. Answers the state to keep and the stops to move, signed: the first step comes as soon
 * as the gesture has `WHEEL_START_PX`, and every further `pitch` px of travel in its direction is one more. A long, slow scroll
 * covers little distance, so one still pushing `WHEEL_QUEUE_MS` after a step queues the next. Turning round steps once at once.
 * @internal
 */
export function wheelSteps(state: WheelStepState | undefined, by: number, pitch: number, at: number): { state: WheelStepState; steps: number } {
  const was: WheelStepState = wheelStale(state, at) ? { dir: 0, travel: 0, against: 0, at, stepAt: at, last: 0 } : state!;
  const next: WheelStepState = { ...was, at };
  const sign = Math.sign(by) as -1 | 0 | 1;
  if (sign === 0) return { state: next, steps: 0 };
  let steps = 0;
  if (next.dir === 0) {
    next.travel += by;
    if (Math.abs(next.travel) < WHEEL_START_PX) return { state: next, steps: 0 };
    next.dir = Math.sign(next.travel) as -1 | 1;
    steps = next.dir;
  } else if (sign === next.dir) {
    next.against = 0;
    next.travel += by;
  } else {
    next.against += Math.abs(by);
    if (next.against < WHEEL_AGAINST_PX) return { state: next, steps: 0 };
    next.dir = sign;
    next.travel = sign * next.against;
    next.against = 0;
    steps = sign;
  }
  next.last = Math.abs(by);
  while (pitch > 0 && Math.abs(next.travel) >= pitch) {
    next.travel -= next.dir * pitch;
    steps += next.dir;
  }
  // A push is a wheel that is not fading: a notch apart from the last, or no smaller than it. A momentum tail only fades.
  const push = Math.abs(by) >= WHEEL_START_PX && (at - was.at >= WHEEL_NOTCH_MS || Math.abs(by) >= was.last * 0.95);
  const going = sign === next.dir && push && Math.abs(next.travel) >= WHEEL_QUEUE_PX;
  if (steps === 0 && going && at - next.stepAt >= WHEEL_QUEUE_MS) {
    next.travel = 0;
    steps = next.dir;
  }
  if (steps !== 0) next.stepAt = at;
  return { state: next, steps };
}
