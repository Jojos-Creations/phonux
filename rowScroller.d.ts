/**
 * The one owner of a row's horizontal position: where the window's left edge sits along the strip, the view. The view is two
 * numbers that add: the scroll, which a person's step or a claim moves, and the origin, the negative of the row's centering,
 * which the Workspace supplies. Each runs its own clock, so a re-centering never retimes a scroll glide, a fade or a bump. The
 * container never scrolls: the strip is one `translateX(-view)`, run as a Web Animations API animation so a glide keeps moving
 * while the main thread is busy. Internal and out of the barrel: a later custom scrollbar reads the strip from
 * `computeRowNumbers` and writes through `claim()`, the way edge scrolling does.
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
/** How a move of the scroll or the origin runs. */
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
/** The strip of the row whose scroll container is `container`: inside the window element that cuts it, never a nested row's. @internal */
export declare function rowStripOf(container: Element): HTMLElement | null;
/** What may move one row's offset. */
export interface RowScroller {
    /** The row's current scroll: how far its content is moved left, in the units a `scrollLeft` would be. A re-centering does not move it. */
    scrollLeft(): number;
    /** Moves to `target` over `durationSec`, or at once when `instant`. False, doing nothing, while a claim is held. */
    glideTo(target: number, o: GlideOptions): boolean;
    /** Where the scroll glide in flight ends; null when none is, and while the centering alone is on its way. */
    glideTarget(): number | null;
    /** A panel's size glide started at `startMs`: a scroll glide asked for just after rides its clock and curve, so the row and the panel's edge move as one. */
    followSize(o: {
        startMs: number;
        durationSec: number;
        ease: readonly [number, number, number, number];
    }): void;
    /**
     * The row's centering is now `centering` px. Every panel stays where it is on screen at the call, then the origin glides to
     * the new centering on its own clock, beside any scroll glide, fade or bump, which it never touches. Not counted as a scroll.
     * The first call places the row without a move.
     */
    reorigin(centering: number, o: GlideOptions): void;
    /** The strip's translate now: the view's negative, less any bump. */
    stripX(): number;
    /** Ends the glide in flight where it is. */
    stop(): void;
    /**
     * A push past the row's end: the strip gives `distancePx` toward `direction`, holds there until `holdMs` pass with no
     * further ask or `keepBump`, then springs back to where it rests. `durationSec` is the push and the return together. It
     * starts as the glide in flight lands, and moves no offset. An ask the same way while the bump holds only extends the hold.
     */
    bump(direction: 'left' | 'right', o: {
        distancePx: number;
        durationSec: number;
        holdMs: number;
    }): void;
    /** Extends a bump toward `direction` that has not begun springing back, by `holdMs` from now; does nothing otherwise. */
    keepBump(direction: 'left' | 'right', holdMs: number): void;
    /** The exclusive writer, or null while one is held. A `replayScroll` claim keeps the scroll asked for while it is held, for `replayDeferred()`. */
    claim(options?: {
        replayScroll?: boolean;
    }): ScrollClaim | null;
    /** Keeps `run` for the held `replayScroll` claim: it runs at `replayDeferred()`, the last one kept wins. False when no such claim is held. */
    deferUntilRelease(run: () => void): boolean;
    /** Runs the scroll kept by `deferUntilRelease`, once. A no-op when none was kept. */
    replayDeferred(): void;
    /**
     * Wakes `listener` after each change of the scroll or the origin, on every frame of a glide. Returns the unsubscribe. A
     * `sameFrame` listener writes something that must stand where the strip is drawn, such as a held panel's clamp: while one is
     * subscribed the frame loop draws every glide itself, since a strip the compositor draws can be a frame from the curve the
     * listener reads.
     */
    subscribe(listener: () => void, options?: {
        sameFrame?: boolean;
    }): () => void;
    /** True while a claim is held. Asked instead of probing with `claim()`, which would end a glide in flight. */
    claimHeld(): boolean;
}
/** How far a step past the row's end pushes the strip before it springs back, px, and how long the push and return take. */
export declare const ROW_BUMP_PX = 36;
export declare const ROW_BUMP_SEC = 0.45;
/** The one `RowScroller` of `element`: the same object on every call. */
export declare function rowScrollerFor(element: HTMLElement): RowScroller;
/** The nearest ancestor-or-self of `from` carrying `data-row-scroller`. */
export declare function closestRowScroller(from: Element): HTMLElement | null;
