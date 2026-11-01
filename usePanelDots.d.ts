/**
 * The dot bar's state and handlers, headless: the app draws the dots and the oval and places them. Dots and oval come
 * back in track px; the handlers move the row only through its one scroll writer (`rowScrollerFor`), so a drag or a
 * click never fights a glide or a gesture already holding the row.
 */
import * as React from 'react';
import type { ResolvedWorkspaceTuning } from './panelSettings.js';
import { type RowNumbers } from './rowNumbers.js';
/** What the bar draws and where: `dots` and `oval` in track px, from the left edge of the track. @public */
export interface PanelDots {
    /** Each drawn panel's dot in track px, in row order. `hollow` is the panel setting `hollowDot`. */
    readonly dots: readonly {
        readonly id: string;
        readonly left: number;
        readonly width: number;
        readonly hollow: boolean;
    }[];
    /** The window oval in track px. */
    readonly oval: {
        readonly left: number;
        readonly width: number;
    };
    /** The bar's total width in px: its dots and the gaps between them. The app sizes the track to this. */
    readonly width: number;
    /** Centers the panel `id` in the window. Does nothing when the row cannot scroll, or while a drag holds the row. */
    selectDot(id: string): void;
    /** Begins dragging the oval. Null while the row is held elsewhere (a gesture or another drag). Call `drag` with the pointer's track dx and `end` on release or cancel. */
    startOvalDrag(): {
        drag(dx: number): void;
        end(): void;
    } | null;
}
/**
 * The bar for one row. `rowNumbers` is `useProvidePanels(...).rowNumbers`; `entries` carries each drawn panel's
 * settings (the hollow dot is the panel setting `hollowDot`); `scroller` is the row's scroll container (the element
 * with `data-row-scroller`). A dot's width comes from its panel's size, and the bar grows and shrinks with the
 * panels; the app sets no width for it. A dot click glides with the workspace's `slide` (`tuning` is `useProvidePanels(...).tuning`).
 * Reduce Motion snaps it, under either the OS query or `MotionConfig`.
 * @public
 */
export declare function usePanelDots(i: {
    rowNumbers: RowNumbers;
    entries: readonly {
        readonly id: string;
        readonly settings?: {
            readonly hollowDot: boolean;
        };
    }[];
    scroller: React.RefObject<HTMLElement | null>;
    tuning: Pick<ResolvedWorkspaceTuning, 'slide'>;
}): PanelDots;
