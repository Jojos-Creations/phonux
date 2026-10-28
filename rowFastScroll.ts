import type { GlideEase } from './panelSettings.js';
import type { RowScroller } from './rowScroller.js';

/** The shortest a step's glide gets however fast the input comes: quicker reads as a jump cut, not a slide. */
export const FAST_SCROLL_FLOOR_SEC = 0.25;

const lastAsk = new WeakMap<RowScroller, number>();

/**
 * Moves the row for a person's step or dot. A move asked while another glides retargets it, carrying its speed, over the time
 * since the last ask, never less than the floor: fast input reads as one quicker glide, never a queue of slides. Under 'jump'
 * a move of more than a window fades past everything between instead.
 */
export function stepGlide(
  scroller: RowScroller,
  to: number,
  o: { mode: 'coalesce' | 'jump'; durationSec: number; ease: GlideEase; instant: boolean; windowWidth: number },
): boolean {
  const now = performance.now();
  const since = now - (lastAsk.get(scroller) ?? Number.NEGATIVE_INFINITY);
  lastAsk.set(scroller, now);
  if (o.instant) return scroller.glideTo(to, { durationSec: 0, instant: true, ease: o.ease });
  if (o.mode === 'jump' && Math.abs(to - scroller.scrollLeft()) > o.windowWidth) return scroller.glideTo(to, { durationSec: o.durationSec, instant: false, ease: o.ease, fade: true });
  if (scroller.glideTarget() === null) return scroller.glideTo(to, { durationSec: o.durationSec, instant: false, ease: o.ease });
  const durationSec = Math.min(o.durationSec, Math.max(FAST_SCROLL_FLOOR_SEC, since / 1000));
  return scroller.glideTo(to, { durationSec, instant: false, ease: o.ease, carry: true });
}
