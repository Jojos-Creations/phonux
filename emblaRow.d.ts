/**
 * The row on Embla Carousel, the library's only row: Embla owns where the strip is, and turns drag, wheel and
 * glide into motion that settles on a stop. Ours is the window, sized to whole slots, and one invisible marker per slot, which
 * Embla takes as its slides, so each slot edge is a stop, a wide panel's inner ones included.
 *
 * Internal and out of the barrel until the old row is retired. Embla is pinned to 8.6: its `internalEngine()` interface, which
 * the later oval drag needs, is not covered by semver.
 */
import * as React from 'react';
import { type EmblaCarouselType, type EmblaOptionsType } from 'embla-carousel';
import type { AwayStore } from './panelAway.js';
import { EMBLA_WINDOW_ATTRIBUTE } from './rowDom.js';
/** On the container of a row that runs on Embla. The old row's own wheel, touch and key listeners stand aside for it. @internal */
export declare const ROW_ENGINE_ATTRIBUTE = "data-row-engine";
/** On each slot marker: an empty box one phone wide, at its slot's place in the strip. @internal */
export declare const EMBLA_SLOT_ATTRIBUTE = "data-row-embla-slot";
export { EMBLA_WINDOW_ATTRIBUTE };
/**
 * How far from the view, in slots, a parkable panel keeps its content loaded on an Embla row. Two: a step, an arrow key or a short
 * flick moves one to three slots, so those never meet a placeholder, and a row whose window fits four slots keeps at most eight
 * parkable panels alive. @internal
 */
export declare const ROW_NEAR_SLOTS = 2;
/** The enclosing `Workspace`'s `rowNearSlots`: how far from the view an Embla row keeps a parkable panel's content loaded. @internal */
export declare const RowNearContext: React.Context<number>;
/** On the placeholder an Embla row draws for a panel whose content it unloaded: the slot keeps its width and place. @internal */
export declare const EMBLA_UNLOADED_ATTRIBUTE = "data-row-unloaded";
/** Whether the row whose container is `container` runs on Embla. @internal */
export declare function runsOnEmbla(container: Element): boolean;
/** The window an Embla row is seen through, in px. @internal */
export interface EmblaWindow {
    /** Whole slots that fit beside each other, at least one. */
    fit: number;
    /** The window's width: `fit` slots and the gaps between them, or the strip's own width when it is narrower. */
    width: number;
    /** True when the strip is wider than the window, so the row moves. */
    scrolls: boolean;
}
/**
 * The window for a strip `stripWidth` wide in `room` px (the container less one gap each side). The window holds whole slots
 * only, so at rest a one-slot panel is never cut; a strip that fits is the window, centered by the caller.
 * @internal
 */
export declare function emblaWindowOf(room: number, phoneWidth: number, gap: number, stripWidth: number): EmblaWindow;
/** Each slot marker's left in strip px: one per slot of a strip `stripWidth` wide, every `phoneWidth + gap`. @internal */
export declare function slotMarkerLefts(stripWidth: number, phoneWidth: number, gap: number): number[];
/**
 * The rests Embla reaches with markers at `markers` in a window `windowWidth` wide, as scroll px (what Embla's `align: 'start'`
 * and `containScroll: 'trimSnaps'` give): every marker up to the strip's end, and the end itself, each once.
 * @internal
 */
export declare function emblaRests(markers: readonly number[], stripWidth: number, windowWidth: number): number[];
/** Whether `scroll` is a rest on the slot grid: a whole number of pitches, or the strip's end. @internal */
export declare function restsOnGrid(scroll: number, pitch: number, max: number): boolean;
/**
 * The scroll that shows a panel at `left` (strip px) `width` wide whole in a window `windowWidth` wide now at `scroll`, moving
 * as little as it can; null when it is whole already. A panel wider than the window lands at its own left edge.
 * @internal
 */
export declare function revealScroll(left: number, width: number, scroll: number, windowWidth: number): number | null;
/** Where each panel sits along the strip: ids in row order, each one's left and width in strip px. @internal */
export interface StripLayout {
    ids: readonly string[];
    lefts: readonly number[];
    widths: readonly number[];
}
/**
 * The scroll that keeps the view still across a change of the strip from `before` to `after` (a panel opened, closed, moved or
 * resized, or clamped by a narrower window). The anchor is the first panel, in strip order, that reaches past the window's left
 * edge at `scroll` and is still in the strip: the scroll moves by as much as that panel moved, so it, and everything after it
 * that did not change, stays where it is on screen. Clamped to `[0, max]`, the strip's new end.
 * A panel `placed` by code is never the anchor: the view stays on what was beside it. Where it was the anchor, the panel before it
 * holds still instead (in view or not), so those after it close the gap it left; with none before it, the next one is the anchor.
 * @internal
 */
export declare function keptScroll(before: StripLayout, after: StripLayout, scroll: number, max: number, placed?: string): number;
/** Whether two strip layouts place the same panels at the same lefts and widths. @internal */
export declare function sameLayout(a: StripLayout, b: StripLayout): boolean;
/** Records that `embla` built its stops at the box's width now. @internal */
export declare function markEmblaBuilt(embla: EmblaCarouselType): void;
/**
 * Applies a change of the strip to the row: moves it by `shift` px (the keep-still rule's answer, 0 for a change right of the
 * view) and, when `restop`, rebuilds Embla's stops from the markers drawn now. The row stays where it is drawn, plus the shift:
 * a glide in flight goes on to the stop nearest where it was going, and a rest stays a rest. Embla's `reInit` drops a press or
 * wheel gesture in progress (it rebuilds the drag handler, and goes back to the selected stop), so while one holds the row the
 * shift is applied in place and the rebuild waits for its release (`releaseEmbla`). Shifting or keeping a position that is not a stop uses
 * Embla's internal engine, which 8.6 is pinned for; a jump at rest to a stop uses the public `scrollTo`.
 * @internal
 */
export declare function moveEmbla(embla: EmblaCarouselType, shift: number, restop: boolean): void;
/** Whether the row `embla` moves runs under Reduce Motion: every glide it starts lands at once instead. @internal */
export declare function setEmblaReduced(embla: EmblaCarouselType, on: boolean): void;
/** Whether the row `embla` moves runs under Reduce Motion. @internal */
export declare const emblaReduced: (embla: EmblaCarouselType) => boolean;
/** A gesture that held the row let go: runs the rebuild a strip change made wait (see `moveEmbla`). @internal */
export declare function releaseEmbla(embla: EmblaCarouselType): void;
/** The row's furthest rest in scroll px, from Embla's stops. @internal */
export declare function emblaMaxOf(embla: EmblaCarouselType): number;
/**
 * Whether a press may start a drag of the row. A mouse press only on the row's own surface, outside every panel, so a panel's text, controls and header grab keep the mouse.
 * A touch anywhere but on a control, an editable field or a frame, as the old row's finger swipe.
 * @internal
 */
export declare function pressStartsRowDrag(event: Pick<Event, 'target' | 'type'>): boolean;
/**
 * Whether a panel of the row rooted on `win` is lifted to fill the window (growing, grown or shrinking back): it covers the row, so
 * wheels, keys, drags and focus leave the row where it is and the panel shrinks back into the slot it grew from. @internal
 */
export declare function maximizedIn(win: Element): boolean;
/** The options the row runs Embla with: one stop per slot marker, a flick may pass several. @internal */
export declare function emblaRowOptions(): EmblaOptionsType;
/**
 * Which panels of an Embla row keep their content loaded with the view at `scroll`: every panel `unloadable` says no to; every
 * panel the window shows, will show within `ahead` px of travel, or shows at `toward` (where a glide or a jump is going), whatever
 * `limit` says; and, nearest first, the unloadable ones whose edge lies under `near` slots past the window's edge, at
 * most `limit` loaded unloadable panels in all (the view's own count when it shows more). One loaded in `was` stays loaded until it
 * is a whole slot further, so a row resting on the boundary does not load and unload by turns.
 * @internal
 */
export declare function loadedNear(i: {
    layout: StripLayout;
    scroll: number;
    windowWidth: number;
    pitch: number;
    gap: number;
    near: number;
    limit: number | null;
    unloadable: (id: string) => boolean;
    was: ReadonlySet<string> | null;
    /** How far the row will move in the next frames, scroll px (negative: toward the start): what that brings into view counts as shown. */
    ahead?: number;
    /** Where the row is going, scroll px: what the window shows there counts as shown, so a far glide or a jump lands on loaded pages. */
    toward?: number | null;
}): Set<string>;
/** What an Embla row lays out, for the dot bar: its panels along the strip, the window's width and the strip's, in px. @internal */
export interface EmblaStrip {
    layout: StripLayout;
    windowWidth: number;
    stripWidth: number;
    pitch: number;
    gap: number;
    /** `tuning.chrome.fitVisibleMaxSlots`: the widest panel, in slots, whose header and footer follow the part the window shows. */
    chromeFollowSlots: number;
}
/** Tells every reader of an Embla row (its dot bar, its loader) that the row moved or changed. @internal */
export declare function notifyEmblaRows(): void;
/** Subscribes to every Embla row's moves and changes, for `useSyncExternalStore`. @internal */
export declare function subscribeEmblaRows(listener: () => void): () => void;
/** A number that changes whenever an Embla row moved or changed. @internal */
export declare const emblaRowsVersion: () => number;
/** Records what the Embla row rooted on `win` lays out now. @internal */
export declare function publishEmblaStrip(win: Element, strip: EmblaStrip): void;
/** What the Embla row whose window or container is `el` lays out, once it has drawn. @internal */
export declare function emblaStripOf(el: Element): EmblaStrip | undefined;
/** The Embla instance moving the row whose window or container is `el`, for the proof page and the later steps. @internal */
export declare function emblaOf(el: Element): EmblaCarouselType | undefined;
/** Where the row is, in scroll px (how far the strip is moved left), from Embla's own location. @internal */
export declare function emblaScrollOf(embla: EmblaCarouselType): number;
/** Where the row is drawn this frame, in scroll px: Embla draws a translate between its last two fixed-step locations. @internal */
export declare function emblaDrawnOf(embla: EmblaCarouselType): number;
/**
 * How far the row will move in the next few frames, in scroll px (negative toward the start), at its speed now and never past where
 * it is going: the panels that brings into view load before they enter it. @internal
 */
export declare function emblaAheadOf(embla: EmblaCarouselType): number;
/** The index of the stop nearest `px` (scroll px). @internal */
export declare function nearestStop(embla: EmblaCarouselType, px: number): number;
/**
 * Puts the row at `px` and draws it there in this frame, with no glide and no stop: the oval drag's direct write. Any glide in flight
 * ends (an instant body has no velocity left). Uses Embla's internal engine, which 8.6 is pinned for.
 * @internal
 */
export declare function writeEmbla(embla: EmblaCarouselType, px: number): void;
/**
 * Marks each slot of the row rooted on `win` that is drawn wholly outside the window `inert`, and clears it as soon as any part is
 * drawn inside: a page the window does not show takes no focus, key, pointer or find-in-page, and a host's styles can key on it (a
 * focus halo resting one gap past the edge). The row's away store (`usePanelPresence`'s 'scrolledAway') follows the same marks. Read off each slot's drawn box, so a glide, a wheel, a drag, a slot's own glide and a
 * reorder shift all count where they are drawn this frame, never where Embla's location runs ahead. Answers a weighted sum of the drawn
 * lefts, so a caller can tell a frame that moved from one that did not.
 * @internal
 */
export declare function markAwaySlots(win: Element): number;
/**
 * How far in from a slot's left and right its header and footer lie, so they span the part of it the window `viewLeft..viewRight`
 * shows. Never narrower than `minWidth` (one phone): below that the chrome would not fit, so the cuts give back what they took past it,
 * each in proportion, and the chrome goes off with the panel as it did uncut. Both zero for a slot the window shows whole.
 * @internal
 */
export declare function chromeCutOf(slotLeft: number, width: number, viewLeft: number, viewRight: number, minWidth: number): {
    left: number;
    right: number;
};
/** Keeps the inert marks of the row rooted on `win` current over the next frames: a commit that starts slot glides calls it. @internal */
export declare function kickEmblaAway(win: Element): void;
/** Whether a press, a wheel gesture or a reorder drag's edge scroll holds the row `embla` moves. @internal */
export declare function emblaHeld(embla: EmblaCarouselType): boolean;
/** Runs `run` now, or, while a gesture holds the row, once it lets go (in the order asked). @internal */
export declare function whenEmblaFree(embla: EmblaCarouselType, run: () => void): void;
/** Where the row goes to show a panel at `left` `width` wide (strip px) at `align`, from `from`, clamped to `[0, max]`. @internal */
export declare function emblaShowScroll(left: number, width: number, from: number, windowWidth: number, align: 'into-view' | 'start' | 'center', max: number): number;
/**
 * Brings panel `id` of the row `embla` moves into view at `align`, from where the row is heading: a glide to the nearest stop (a jump
 * under Reduce Motion), and none when it is there already. While a gesture holds the row it waits for the release, and then reads the
 * strip as drawn at that time. False when the strip has no such panel now.
 * @internal
 */
export declare function showOnEmbla(embla: EmblaCarouselType, id: string, align: 'into-view' | 'start' | 'center'): boolean;
/**
 * Whether `showOnEmbla(embla, id, align)` moves the row now: the stop it would go to differs from where the row is heading. Null when
 * the drawn strip does not carry `id`. @internal
 */
export declare function emblaWouldShow(embla: EmblaCarouselType, id: string, align: 'into-view' | 'start' | 'center'): boolean | null;
/** The share of the gap between two stops a wheel gesture must cover to rest on the stop ahead: a touch under it returns. */
export declare const BACK_FRACTION = 0.02;
export declare const emblaWheelLanding: (embla: EmblaCarouselType) => number | undefined;
/**
 * Ends the wheel gesture on the row and leaves the row where it is drawn: a key step, a press, a dot, a focus reveal, a summon or a
 * reorder drag takes the row from there. True when there was one to end.
 * @internal
 */
export declare function endEmblaWheel(embla: EmblaCarouselType): boolean;
/**
 * The stop (an index into `stops`, ascending scroll px) a wheel gesture moving `dir` rests on from `from`: the stop ahead once it has
 * covered `BACK_FRACTION` of the gap from the stop behind, else the stop behind; the stop it is on within half a px. No direction
 * reads as rightwards.
 * @internal
 */
export declare function restStop(stops: readonly number[], from: number, dir: number): number;
/**
 * The one writer a reorder drag's edge scroll holds on an Embla row: `write` puts the row at a scroll px clamped to `[0, the bound]`
 * and draws it there in this frame (`writeEmbla`). Null while another drag holds the row. @internal
 */
export declare function holdEmbla(embla: EmblaCarouselType): {
    write(left: number): number;
    setMaxScroll(max: number): void;
    release(): void;
} | null;
/**
 * Runs Embla on `windowRef` (the root) with `boxRef` (its container, the box the slots and markers sit in). Wheel and trackpad
 * move Embla's target directly (`wheelBy`), read through wheel-gestures; a wheel handed in from embedded content (`feedRowWheel`)
 * bubbles to the same listener and moves the row as a wheel over the row does; Option held at a gesture's first event leaves the whole gesture to the content. Bare arrow keys step
 * one slot. `enabled` false tears it down.
 * @internal
 */
export declare function useEmblaRow(windowRef: React.RefObject<HTMLElement | null>, boxRef: React.RefObject<HTMLElement | null>, enabled: boolean, quietMs: number, awayStore?: AwayStore): void;
/** Where the row is heading, in scroll px: the stop a glide or a drag is going to, or where it rests. @internal */
export declare function emblaTargetOf(embla: EmblaCarouselType): number;
/** A move of a panel the row draws next: the commit that draws it snaps the slots it moves instead of gliding them. @internal */
export interface EmblaMoveNote {
    id: string;
    seq: number;
}
/**
 * Notes that the next commit of the Embla row whose window or container is `el` moves panel `id` from out of the view to just outside
 * it (a summon): that commit snaps the slots it moves (all out of the view), so the panel stands at its new place before the row's
 * glide brings it in. @internal
 */
export declare function noteEmblaMove(el: Element, id: string): void;
/** The last move noted on the Embla row rooted on `win`. @internal */
export declare const emblaMoveOf: (win: Element) => EmblaMoveNote | undefined;
/** Notes that code just placed panel `id` on the Embla row whose window or container is `el`: the commit that draws it keeps the view on what was beside it. @internal */
export declare function noteEmblaPlace(el: Element, id: string): void;
/** The last place by code noted on the Embla row rooted on `win`. @internal */
export declare const emblaPlaceOf: (win: Element) => EmblaMoveNote | undefined;
/** Whether panel `k` of `layout` stands whole in a window `windowWidth` wide at `scroll`. @internal */
export declare function wholeInView(layout: StripLayout, k: number, scroll: number, windowWidth: number): boolean;
/**
 * Where a summon moves root `rootId` on a strip laid out as `layout`, with the row heading for `at` in a window `windowWidth` wide
 * (owner ruling 2026-11-09): into the slot just outside the view on the side it lies on, the left when it lies on neither (wider than
 * the view). `beside` is the page it goes next to: the first page reaching into the view on the left, the last one on the right; null
 * when there is none (the root goes to that end). Null when the root stands whole in the view or is not on the strip.
 * @internal
 */
export declare function emblaSummonMove(layout: StripLayout, at: number, windowWidth: number, rootId: string): {
    side: 'left' | 'right';
    beside: string | null;
} | null;
