/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { type RowNumbers } from './rowNumbers.js';
import type { WorkspaceRowEntry } from './workspaceRow.js';
/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
    /** Each panel's dot in track px, in row order: the drawn panels and the parked ones a scroll can bring in. `hollow` is the panel setting `hollowDot`. */
    readonly dots: readonly {
        readonly id: string;
        readonly left: number;
        readonly width: number;
        readonly hollow: boolean;
    }[];
    /** The window oval in track px, over the dots of the panels on screen. */
    readonly oval: {
        readonly left: number;
        readonly width: number;
    };
    /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
    readonly width: number;
    /** Centers the panel `id` in the window, or for a parked panel steps the row until it is drawn. Does nothing while a drag holds the row. */
    selectDot(id: string): void;
    /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
    startOvalDrag(): {
        drag(dx: number): void;
        end(): void;
    } | null;
    /** The cursor the bar shows where the pointer rests now: `grabbing` while the oval is dragged, `grab` over the oval, `pointer` over a dot, else `default`. */
    readonly cursor: string;
    /**
     * Spread on the element that holds the dots and the oval. A press that moves past a few px drags the oval; one that does not
     * selects the dot it began on. The pointer is captured, so the drag follows it off the bar. On a row that cannot scroll, the oval
     * moves with the pointer and the row steps each time the oval passes half a dot, bringing in hidden panels; on release the oval
     * settles over the panels on screen. A drag carried past a scrolling row's end steps it one stop per dot it travels. A wheel over
     * the bar, either axis, steps the row too, and the oval follows each step.
     */
    readonly barProps: {
        readonly onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
        readonly onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
        readonly onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
        readonly onPointerLeave: () => void;
        readonly onPointerCancel: () => void;
        readonly onWheel: (e: React.WheelEvent<HTMLElement>) => void;
        readonly style: {
            readonly touchAction: 'none';
            readonly cursor: string;
        };
    };
    /** Spread on the oval: a focusable slider whose value is how far along the row the window is, 0 to 100. Give it an `aria-label`. */
    readonly ovalProps: {
        readonly role: 'slider';
        readonly tabIndex: 0;
        readonly 'aria-valuemin': 0;
        readonly 'aria-valuemax': 100;
        readonly 'aria-valuenow': number;
    };
    /** Spread on the dot of panel `id` (a button): it marks the dot for the bar and selects it on a keyboard activation. */
    dotProps(id: string): {
        readonly 'data-dot': string;
        readonly onClick: (e: React.MouseEvent<HTMLElement>) => void;
    };
}
/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` is every panel in row order, drawn or
 * parked (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export declare function usePanelDots(i: {
    rowNumbers: RowNumbers;
    entries: readonly WorkspaceRowEntry[];
    scroller: React.RefObject<HTMLElement | null>;
    tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
    /** How far the drawn oval reaches past the dots it encloses on each side, in px, so the cursor reads the oval as drawn. Default 0. */
    ovalSide?: number;
}): PanelDots;
