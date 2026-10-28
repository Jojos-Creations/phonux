/**
 * The one owner of a row's horizontal offset. The container never scrolls: the offset and the row's centering margin are one
 * `translateX` on its strip, run as a Web Animations API animation so a glide keeps moving while the main thread is busy.
 * Internal and out of the barrel: a later custom scrollbar reads the strip from `computeRowNumbers` and writes through
 * `claim()`, the way edge scrolling does.
 */
import type { GlideEase } from './panelSettings.js';
/** The exclusive writer `claim()` hands one holder. */
export interface ScrollClaim {
    /** Moves the offset to `left`, clamped to `[0, the bound from setMaxScroll]`, and returns the delta applied. Applies nothing before the first `setMaxScroll`. */
    write(left: number): number;
    /** The farthest legal offset, from the row numbers; the DOM is never asked. */
    setMaxScroll(max: number): void;
    /** Gives the claim back; `glideTo` and `claim()` work again. */
    release(): void;
}
/** How a move of the offset or the margin runs. */
export interface GlideOptions {
    /** Seconds the move takes. */
    durationSec: number;
    /** True: at once. */
    instant: boolean;
    /** The curve. */
    ease: GlideEase;
    /** True: a glide in flight hands its speed to this one, so a retarget keeps moving instead of starting from rest. */
    carry?: boolean;
    /** True: the strip fades out, moves at once while unseen, and fades back in, over `durationSec`. Nothing between is drawn. */
    fade?: boolean;
}
/** What may move one row's offset. */
export interface RowScroller {
    /** The row's current offset: how far its content is moved left, in the units a `scrollLeft` would be. */
    scrollLeft(): number;
    /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
    glideTo(target: number, o: GlideOptions): boolean;
    /** Where the glide in flight ends; null when none is. */
    glideTarget(): number | null;
    /** Moves the strip's centering margin to `left`, gliding beside any offset glide. Not counted as a scroll. */
    setMargin(left: number, o: GlideOptions): void;
    /** The strip's translate now: its margin less the offset. */
    stripX(): number;
    /** How many times a person has asked to move the row: a step, a dot, a press on the row. Counted whether or not the row moved. */
    inputs(): number;
    /** Records one such ask. */
    noteInput(): void;
    /** Records that a person is moving the row itself (a step, a dot, a drag of the dot bar), not pressing inside it. */
    noteMove(): void;
    /** Wakes `listener` at each `noteMove()`. Returns the unsubscribe. */
    subscribeMoves(listener: () => void): () => void;
    /** Ends the glide in flight where it is. */
    stop(): void;
    /** The exclusive writer, or null while one is held. A `replayScroll` claim keeps the scroll asked for while it is held, for `replayDeferred()`. */
    claim(options?: {
        replayScroll?: boolean;
    }): ScrollClaim | null;
    /** Keeps `run` for the held `replayScroll` claim: it runs at `replayDeferred()`, the last one kept wins. False when no such claim is held. */
    deferUntilRelease(run: () => void): boolean;
    /** Runs the scroll kept by `deferUntilRelease`, once. A no-op when none was kept. */
    replayDeferred(): void;
    /** Wakes `listener` after each change of the offset or the margin, on every frame of a glide. Returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
    /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
    claimHeld(): boolean;
    /** True while a resize's settle waits for the margin to glide: the settle, not a change of stops, decides where the row rests. */
    settling(): boolean;
    /** Marks or unmarks that wait. */
    setSettling(on: boolean): void;
}
/** The one `RowScroller` of `element`: the same object on every call. */
export declare function rowScrollerFor(element: HTMLElement): RowScroller;
/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`. */
export declare function closestRowScroller(from: Element): HTMLElement | null;
