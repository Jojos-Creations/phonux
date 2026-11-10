/**
 * The hold a drag takes on the row scroller and the one frame of edge scrolling it runs: shared by the header drag
 * (DragToClose) and the row-drop hook, so both scroll at the row edges by the same numbers.
 */
import { edgeScrollSpeed, edgeScrollStep } from './edgeScroll.js';
import type { DragScroll } from './panelSlotContext.js';
import { rowScrollerFor, type RowScroller, type ScrollClaim } from './rowScroller.js';
import { stepTarget } from './scrollTargets.js';
import { applyRowIntent, holdRow } from './rowIntents.js';
import type { EmblaCarouselType } from 'embla-carousel';
import { EMBLA_WINDOW_ATTRIBUTE, emblaDrawnOf, emblaOf, holdEmbla, nearestStop } from './emblaRow.js';

/** A drag's hold on the row scroller: the claim, the scroll it counts from, and the frame state. */
export interface EdgeHold {
  scroller: Pick<RowScroller, 'scrollLeft'>;
  /** The element whose box bounds the bands: the row scroller, or an Embla row's window. */
  scrollerEl: HTMLElement;
  /** The Embla row the hold moves, or null on the own row. */
  embla: EmblaCarouselType | null;
  claim: ScrollClaim;
  startScroll: number;
  /** The slot's edge numbers when the drag locked: a configure made mid-drag must reach the next drag, not this one. */
  began: { zonePx: number; maxPxPerSec: number; reducedStepMs: number };
  frame: number | null;
  /** The previous frame's timestamp; null until the first frame, whose dt is 0. */
  lastMs: number | null;
  /** Reduced motion: how long the pointer has stayed in a band since the last jump. */
  waitedMs: number;
  /** The pointer has lifted or been canceled: no further frame may move the row before the release reads the distance. */
  stopped: boolean;
  /** The dragged panel's engine id: a swap at the edge never parks it. */
  keepId: string | undefined;
  /** How long the pointer has stayed in a band the row cannot scroll toward since the last swap. */
  cycleWaitMs: number;
}

/** What a drag inside `box` edge-scrolls: an Embla row's window when the row runs on Embla, else the nearest row scroller. */
export function edgeScrollerOf(box: Element): HTMLElement | null {
  return box.closest<HTMLElement>(`[${EMBLA_WINDOW_ATTRIBUTE}]`) ?? box.closest<HTMLElement>('[data-row-scroller]');
}

/** Where the row of `scrollerEl` (from `edgeScrollerOf`) is drawn now, in scroll px. */
export function edgeScrollOf(scrollerEl: HTMLElement): number {
  const embla = scrollerEl.hasAttribute(EMBLA_WINDOW_ATTRIBUTE) ? emblaOf(scrollerEl) : undefined;
  return embla === undefined ? rowScrollerFor(scrollerEl).scrollLeft() : emblaDrawnOf(embla);
}

/** Takes the claim on `scrollerEl`'s scroller for a drag that counts its scroll from `startScroll`; null while another drag holds it. */
export function openEdgeHold(scrollerEl: HTMLElement, startScroll: number, slot: DragScroll, keepId?: string): EdgeHold | null {
  const embla = scrollerEl.hasAttribute(EMBLA_WINDOW_ATTRIBUTE) ? (emblaOf(scrollerEl) ?? null) : null;
  // On Embla the hold writes where the row is drawn: the strip and the dragged box move in the same frame, so the box stays under the pointer.
  const scroller = embla === null ? rowScrollerFor(scrollerEl) : { scrollLeft: () => emblaDrawnOf(embla) };
  const claim = embla === null ? holdRow(scroller as RowScroller) : holdEmbla(embla);
  if (claim === null) return null;
  claim.setMaxScroll(slot.maxScroll);
  return { scroller, scrollerEl, embla, claim, startScroll, began: { zonePx: slot.zonePx, maxPxPerSec: slot.maxPxPerSec, reducedStepMs: slot.reducedStepMs }, frame: null, lastMs: null, waitedMs: 0, stopped: false, keepId, cycleWaitMs: 0 };
}

/** One frame: scrolls the row for a pointer at `pointerX`, by speed or, under reduced motion, by a jump to the next stop after the wait. */
export function stepEdgeHold(h: EdgeHold, nowMs: number, pointerX: number, slot: DragScroll, reduceMotion: boolean): void {
  const dt = h.lastMs === null ? 0 : nowMs - h.lastMs;
  h.lastMs = nowMs;
  const bound = slot.maxScroll;
  h.claim.setMaxScroll(bound);
  const rect = h.scrollerEl.getBoundingClientRect();
  // The band is the strip's window: a held panel's edge group covers the scroller's ends, so a pointer over it does not scroll the row.
  // A panel no drag may cross at the row's start (the root) moves the left band onto its own right edge.
  const left = Math.max(rect.left + (slot.insetLeft ?? 0), (slot.barrierRight?.() ?? Number.NEGATIVE_INFINITY) - h.began.zonePx);
  const speed = edgeScrollSpeed({ pointerX, left, right: rect.right - (slot.insetRight ?? 0), zonePx: h.began.zonePx, maxPxPerSec: h.began.maxPxPerSec });
  const at = h.scroller.scrollLeft();
  const stuck = speed < 0 ? at <= 0.5 : speed > 0 && at >= bound - 0.5;
  // Past the scroll's end, the band swaps hidden panels in, one per slide, so each lands before the next starts.
  if (stuck && slot.cycle !== undefined && h.keepId !== undefined) {
    h.cycleWaitMs += dt;
    if (h.cycleWaitMs >= slot.settleSec * 1000) {
      h.cycleWaitMs = 0;
      slot.cycle(speed < 0 ? 'left' : 'right', h.keepId);
    }
    return;
  }
  h.cycleWaitMs = 0;
  if (reduceMotion) {
    h.waitedMs = speed === 0 ? 0 : h.waitedMs + dt;
    if (h.waitedMs >= h.began.reducedStepMs) {
      h.waitedMs = 0;
      const to = stepTarget(speed < 0 ? 'left' : 'right', at, slot.stops, bound);
      if (to !== null) h.claim.write(to);
    }
  } else if (speed !== 0) {
    const step = edgeScrollStep({ speed, dtMs: dt, scrollLeft: at, maxScroll: bound });
    if (step !== 0) h.claim.write(at + step);
  }
}

/**
 * Gives the claim back and returns how far the row scrolled since the hold began; a release settles on the nearest whole-panel stop
 * when the row has stops. On Embla the row settles on its nearest stop, or with `back` (a cancelled drag) on the stop it started from.
 */
export function endEdgeHold(h: EdgeHold, slot: DragScroll | undefined, reduceMotion: boolean, settle = true, back = false): number {
  if (h.frame !== null) cancelAnimationFrame(h.frame);
  h.frame = null;
  const distance = h.scroller.scrollLeft() - h.startScroll;
  h.claim.release();
  if (h.embla !== null) {
    if (settle) h.embla.scrollTo(nearestStop(h.embla, back ? h.startScroll : h.scroller.scrollLeft()), reduceMotion);
    return distance;
  }
  if (settle && slot !== undefined && slot.settleStops.length > 0) {
    const at = h.scroller.scrollLeft();
    const to = slot.settleStops.reduce((best, stop) => (Math.abs(stop - at) < Math.abs(best - at) ? stop : best));
    if (Math.abs(to - at) >= 0.5) applyRowIntent(h.scroller as RowScroller, { kind: 'settle', to, durationSec: slot.settleSec, instant: reduceMotion, ease: slot.settleEase });
  }
  return distance;
}
