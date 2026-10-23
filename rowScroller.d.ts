/**
 * The one writer of a row container's `scrollLeft`. Internal and out of the barrel: a later custom scrollbar reads the
 * strip from `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
 */
import type { GlideEase } from './panelSettings.js';
/** The exclusive writer `claim()` hands one holder. */
export interface ScrollClaim {
    /** Moves `scrollLeft` to `left`, clamped to `[0, the bound from setMaxScroll]`, and returns the delta applied. Applies nothing before the first `setMaxScroll`. */
    write(left: number): number;
    /** The farthest legal `scrollLeft`, from the row numbers; the DOM is never asked. */
    setMaxScroll(max: number): void;
    /** Gives the claim back; `glideTo` and `claim()` work again. */
    release(): void;
}
/** What may move one container's `scrollLeft`. */
export interface RowScroller {
    /** The container's current `scrollLeft`. */
    scrollLeft(): number;
    /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
    glideTo(target: number, o: {
        durationSec: number;
        instant: boolean;
        ease: GlideEase;
    }): boolean;
    /** Where the glide in flight ends; null when none is. */
    glideTarget(): number | null;
    /** How many times a person has asked to move the row: a step, a dot, a press on the row. Counted whether or not the row moved. */
    inputs(): number;
    /** Records one such ask. */
    noteInput(): void;
    /** Ends the glide in flight where it is. */
    stop(): void;
    /** The exclusive writer, or null while one is held. */
    claim(): ScrollClaim | null;
    /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
    claimHeld(): boolean;
}
/** The one `RowScroller` of `element`: the same object on every call. */
export declare function rowScrollerFor(element: HTMLElement): RowScroller;
/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`; never computed overflow, so a container whose `overflow-x` is hidden is found too. */
export declare function closestRowScroller(from: Element): HTMLElement | null;
