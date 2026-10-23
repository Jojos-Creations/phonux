/**
 * The hold a drag takes on the row scroller and the one frame of edge scrolling it runs: shared by the header drag
 * (DragToClose) and the row-drop hook, so both scroll at the row edges by the same numbers.
 */
import { edgeScrollSpeed, edgeScrollStep } from './edgeScroll.js';
import type { DragScroll } from './panelSlotContext.js';
import { rowScrollerFor, type RowScroller, type ScrollClaim } from './rowScroller.js';
import { stepTarget } from './scrollTargets.js';

/** A drag's hold on the row scroller: the claim, the scroll it counts from, and the frame state. */
export interface EdgeHold {
  scroller: RowScroller;
  scrollerEl: HTMLElement;
  claim: ScrollClaim;
  startScroll: number;
  /** The slot's edge numbers when the drag locked: a configure made mid-drag must reach the next drag, not this one. */
  began: { zonePx: number; maxPxPerSec: number; reducedStepMs: number };
  frame: number | null;
  /** The previous frame's timestamp; null until the first frame, whose dt is 0. */
  lastMs: number | null;
  /** Reduced motion: how long the pointer has stayed in a band since the last jump. */
  waitedMs: number;
  /** The pointer has lifted or been cancelled: no further frame may move the row before the release reads the distance. */
  stopped: boolean;
}

/** Takes the claim on `scrollerEl`'s scroller for a drag that counts its scroll from `startScroll`; null while another drag holds it. */
export function openEdgeHold(scrollerEl: HTMLElement, startScroll: number, slot: DragScroll): EdgeHold | null {
  const scroller = rowScrollerFor(scrollerEl);
  const claim = scroller.claim();
  if (claim === null) return null;
  claim.setMaxScroll(slot.maxScroll);
  return { scroller, scrollerEl, claim, startScroll, began: { zonePx: slot.zonePx, maxPxPerSec: slot.maxPxPerSec, reducedStepMs: slot.reducedStepMs }, frame: null, lastMs: null, waitedMs: 0, stopped: false };
}

/** One frame: scrolls the row for a pointer at `pointerX`, by speed or, under reduced motion, by a jump to the next stop after the wait. */
export function stepEdgeHold(h: EdgeHold, nowMs: number, pointerX: number, slot: DragScroll, reduceMotion: boolean): void {
  const dt = h.lastMs === null ? 0 : nowMs - h.lastMs;
  h.lastMs = nowMs;
  const bound = slot.maxScroll;
  h.claim.setMaxScroll(bound);
  const rect = h.scrollerEl.getBoundingClientRect();
  // The band is the strip's window: a held panel's edge group covers the scroller's ends, so a pointer over it does not scroll the row.
  const speed = edgeScrollSpeed({ pointerX, left: rect.left + (slot.insetLeft ?? 0), right: rect.right - (slot.insetRight ?? 0), zonePx: h.began.zonePx, maxPxPerSec: h.began.maxPxPerSec });
  const at = h.scroller.scrollLeft();
  if (reduceMotion) {
    h.waitedMs = speed === 0 ? 0 : h.waitedMs + dt;
    if (h.waitedMs >= h.began.reducedStepMs) {
      h.waitedMs = 0;
      const to = stepTarget(speed < 0 ? 'left' : 'right', at, slot.stops, bound);
      if (to !== null) h.claim.write(to);
    }
  } else if (speed !== 0) {
    h.claim.write(at + edgeScrollStep({ speed, dtMs: dt, scrollLeft: at, maxScroll: bound }));
  }
}

/** Gives the claim back and returns how far the row scrolled since the hold began; a release settles on the nearest whole-panel stop when the row has stops. */
export function endEdgeHold(h: EdgeHold, slot: DragScroll | undefined, reduceMotion: boolean, settle = true): number {
  if (h.frame !== null) cancelAnimationFrame(h.frame);
  h.frame = null;
  const distance = h.scroller.scrollLeft() - h.startScroll;
  h.claim.release();
  if (settle && slot !== undefined && slot.settleStops.length > 0) {
    const at = h.scroller.scrollLeft();
    const to = slot.settleStops.reduce((best, stop) => (Math.abs(stop - at) < Math.abs(best - at) ? stop : best));
    if (Math.abs(to - at) >= 0.5) h.scroller.glideTo(to, { durationSec: slot.settleSec, instant: reduceMotion, ease: slot.settleEase });
  }
  return distance;
}
