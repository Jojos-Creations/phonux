import type { DragScroll } from './panelSlotContext.js';
import { type RowScroller, type ScrollClaim } from './rowScroller.js';
/** A drag's hold on the row scroller: the claim, the scroll it counts from, and the frame state. */
export interface EdgeHold {
    scroller: RowScroller;
    scrollerEl: HTMLElement;
    claim: ScrollClaim;
    startScroll: number;
    /** The slot's edge numbers when the drag locked: a configure made mid-drag must reach the next drag, not this one. */
    began: {
        zonePx: number;
        maxPxPerSec: number;
        reducedStepMs: number;
    };
    frame: number | null;
    /** The previous frame's timestamp; null until the first frame, whose dt is 0. */
    lastMs: number | null;
    /** Reduced motion: how long the pointer has stayed in a band since the last jump. */
    waitedMs: number;
    /** The pointer has lifted or been cancelled: no further frame may move the row before the release reads the distance. */
    stopped: boolean;
    /** The dragged panel's engine id: a swap at the edge never parks it. */
    keepId: string | undefined;
    /** How long the pointer has stayed in a band the row cannot scroll toward since the last swap. */
    cycleWaitMs: number;
}
/** Takes the claim on `scrollerEl`'s scroller for a drag that counts its scroll from `startScroll`; null while another drag holds it. */
export declare function openEdgeHold(scrollerEl: HTMLElement, startScroll: number, slot: DragScroll, keepId?: string): EdgeHold | null;
/** One frame: scrolls the row for a pointer at `pointerX`, by speed or, under reduced motion, by a jump to the next stop after the wait. */
export declare function stepEdgeHold(h: EdgeHold, nowMs: number, pointerX: number, slot: DragScroll, reduceMotion: boolean): void;
/** Gives the claim back and returns how far the row scrolled since the hold began; a release settles on the nearest whole-panel stop when the row has stops. */
export declare function endEdgeHold(h: EdgeHold, slot: DragScroll | undefined, reduceMotion: boolean, settle?: boolean): number;
