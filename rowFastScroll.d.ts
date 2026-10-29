import type { GlideEase } from './panelSettings.js';
import type { RowScroller } from './rowScroller.js';
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
