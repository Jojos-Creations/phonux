/**
 * What a caller wants of the row's scroll, said as a value and applied in one place. Callers name the purpose; only `applyRowIntent`
 * (and the driver beneath it) turns a purpose into a glide, so no site picks a duration or an `instant` flag for a purpose of its own.
 */
import type { GlideEase } from './panelSettings.js';
import type { RowScroller, ScrollClaim } from './rowScroller.js';
/** What every glide-shaped intent carries: where to, and the curve. */
interface Move {
    to: number;
    ease: GlideEase;
}
export type RowIntent = 
/** A person's step or dot: retargets a glide in flight, carrying its speed. */
(Move & {
    kind: 'step';
    mode: 'coalesce' | 'jump';
    durationSec: number;
    instant: boolean;
    windowWidth: number;
})
/** The row comes to rest on a stop. */
 | (Move & {
    kind: 'settle';
    durationSec: number;
    instant: boolean;
})
/** A scroll that brings a panel into view. */
 | (Move & {
    kind: 'show';
    durationSec: number;
    instant: boolean;
})
/** The row brings the root to an edge of the view, or carries it back out: the part of a summon the list cannot do, where a wide panel moves out instead of parking. */
 | (Move & {
    kind: 'summon';
    durationSec: number;
    instant: boolean;
})
/** The row is put somewhere with no motion. */
 | (Move & {
    kind: 'place';
});
/**
 * Applies `intent` to the row's scroller. False when the driver refused it (a hold is in place), true otherwise.
 * @internal
 */
export declare function applyRowIntent(scroller: RowScroller, intent: RowIntent): boolean;
/** Takes the row's scroll for a drag or a resize; null while another holder has it. @internal */
export declare function holdRow(scroller: RowScroller, o?: {
    replayScroll?: boolean;
}): ScrollClaim | null;
/** The shortest a step's glide gets however fast the input comes: quicker reads as a jump cut, not a slide. */
export declare const FAST_SCROLL_FLOOR_SEC = 0.25;
/**
 * Moves the row for a person's step or dot. A move asked while another glides retargets it, carrying its speed, over the time
 * since the last ask, never less than the floor: fast input reads as one quicker glide, never a queue of slides. Under 'jump'
 * a move of more than a window fades past everything between instead.
 */
export declare function stepGlide(scroller: RowScroller, to: number, o: {
    mode: 'coalesce' | 'jump';
    durationSec: number;
    ease: GlideEase;
    instant: boolean;
    windowWidth: number;
}): boolean;
export {};
