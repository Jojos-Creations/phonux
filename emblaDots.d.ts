/**
 * The dot bar on an Embla row (`Workspace rowEngine="embla"`): one dot per panel along the strip, and the oval over the panels the
 * window shows, both one linear map of the strip read from where Embla draws it this frame. Dragging the oval writes the row's
 * position directly, so the oval stays under the pointer; holding the pointer at the bar's visible end keeps the row moving by
 * time. Internal: `usePanelDots` returns this on an Embla row.
 */
import * as React from 'react';
import { type EmblaStrip } from './emblaRow.js';
import type { PanelDots } from './usePanelDots.js';
import type { WorkspaceRowEntry } from './workspaceRow.js';
/** How far inside the bar's visible end the pointer starts the timed scroll, in px. */
export declare const EDGE_ZONE_PX = 6;
/** The timed scroll's speed, in slots a second per px the pointer lies past the start of the edge zone, and its most. */
export declare const EDGE_SLOTS_PER_SEC_PER_PX = 0.1;
export declare const EDGE_MAX_SLOTS_PER_SEC = 12;
/** The bar of an Embla row at `scroll`, in track px. @internal */
export interface EmblaBar {
    dots: {
        id: string;
        left: number;
        width: number;
        hollow: boolean;
        riding: boolean;
    }[];
    oval: {
        left: number;
        width: number;
    };
    width: number;
    /** Ids of the panels the window shows at `scroll`. */
    shown: string[];
    /** Track px to one px of scroll. */
    scale: number;
    /** The row's furthest scroll. */
    max: number;
}
/** The bar for `strip` at `scroll`: every panel's dot at its place on the strip scaled to dots, and the oval over the window. @internal */
export declare function emblaBarOf(strip: EmblaStrip, scroll: number, hollowOf: (id: string) => boolean): EmblaBar;
/** The part of `el` on screen, left to right in client px: its box cut by every ancestor that clips and by the viewport. @internal */
export declare function visibleSpan(el: Element, clips: readonly Element[]): {
    left: number;
    right: number;
};
/**
 * The timed scroll's speed in px of scroll a ms, for a pointer at `x` while the bar shows `span`: positive past the right end's zone,
 * negative past the left's, growing with how far past, 0 between.
 * @internal
 */
export declare function edgeSpeed(x: number, span: {
    left: number;
    right: number;
}, pitch: number): number;
/** The dot bar on an Embla row, or null when `scroller` is not an Embla row that has drawn. Same shape as `usePanelDots`. @internal */
export declare function useEmblaPanelDots(i: {
    entries: readonly WorkspaceRowEntry[];
    scroller: React.RefObject<HTMLElement | null>;
    ovalSide?: number;
}): PanelDots | null;
