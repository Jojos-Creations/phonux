/**
 * Drag a view's grab handle DOWN to close it (the box follows the pointer up and down); with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */
import * as React from 'react';
import type { DragToCloseTuning } from './panelSettings.js';
/**
 * The library's default drag-to-close numbers. Distances in px, velocities in px/s, positive = downward.
 * @public
 * @deprecated A panel's numbers are `usePanelTuning().dragToClose`, and the defaults `LIBRARY_TUNING_DEFAULTS.dragToClose`.
 */
export declare const DRAG_CLOSE: {
    /** Close once dragged this fraction of the view's height ... */
    readonly distanceFraction: 0.25;
    /** ... but never less than this: a click that slips a few px is not a close. */
    readonly minDistancePx: 80;
    /** A flick closes early: at least this fast at release ... */
    readonly flickVelocity: 700;
    /** ... and at least this far. */
    readonly flickMinDistancePx: 40;
    /** Released while moving back UP faster than this (negative): the user changed their mind. */
    readonly cancelVelocity: -300;
    /** Seconds the box takes to leave the screen. */
    readonly exitSeconds: 0.18;
    readonly snapBack: {
        readonly type: "spring";
        readonly stiffness: 520;
        readonly damping: 42;
    };
};
/** The five numbers the close rule reads. */
type CloseRule = Pick<DragToCloseTuning, 'distanceFraction' | 'minDistancePx' | 'flickMinDistancePx' | 'flickVelocity' | 'cancelVelocity'>;
/** What `shouldCloseOnRelease` reads from a drag's release. @internal */
export interface ReleaseMeasure {
    /** How far the box was dragged from its resting place, px (positive = down). */
    offsetY: number;
    /** Vertical velocity at release, px/s (positive = down). */
    velocityY: number;
    /** The box's own height, px (0 or NaN when unmeasured: only the minimum distance applies). */
    height: number;
}
/** The whole close rule, pure, over `rule` (default DRAG_CLOSE). Never closes on an upward or zero offset, or when released moving back up. @internal */
export declare function shouldCloseOnRelease({ offsetY, velocityY, height }: ReleaseMeasure, rule?: CloseRule): boolean;
/** Spread onto Panel's `grabProps`. @public */
export interface DragHandleProps {
    /** Starts a drag from a primary-button press on the handle; a press on a button, link or field is ignored. Until the press ends, the page shows no text selection and starts no native image drag. */
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    /** The handle's styles: a grab cursor, no text selection, and `touch-action: pan-x` so a horizontal swipe still scrolls the row. A keyboard focus ring is drawn when the handle takes keys. */
    sx: {
        cursor: 'grab';
        touchAction: 'pan-x';
        userSelect: 'none';
        '&:active': {
            cursor: 'grabbing';
        };
        '&:focus-visible': {
            outline: '2px solid';
            outlineColor: 'primary.main';
            outlineOffset: -2;
        };
    };
    /** `'button'` when the handle takes keys, which it does when `onClose` or `reorder.onStep` is set; absent otherwise. */
    role?: 'button';
    /** 0 when the handle takes keys; absent otherwise. */
    tabIndex?: 0;
    /** The handle's name when it takes keys, built from the panel's title inside a row. */
    'aria-label'?: string;
    /** The keys the handle takes, for assistive technology. */
    'aria-keyshortcuts'?: string;
    /** ArrowLeft and ArrowRight call `reorder.onStep(-1 | 1)` and Delete calls `onClose`, each said in the workspace's live region. Absent when the handle takes no keys. */
    onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
}
/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
    /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
    onDragEnd: (offsetX: number) => void;
    /** Moves the panel `steps` slots (-1 left, 1 right) for an ArrowLeft or ArrowRight on the handle; true when it moved. Without it the handle takes no Arrow keys. */
    onStep?: (steps: number) => boolean;
}
/**
 * Turns text selection and native image drag off for `doc` until the returned release runs. Holds share one record per
 * document: the first takes the document element's inline values and the last gives them back, so overlapping drags
 * (two touches, a press landing on a spring still unlocking) cannot restore each other's `none`. The release is idempotent.
 * -webkit-user-drag does not inherit, so the `dragstart` listener is what stops a photo inside a panel from starting a
 * native drag, which would cancel the pointer events this drag runs on.
 * @internal
 */
export declare function holdDragSelection(doc: Document): () => void;
/** Where the pointer is during a grab-handle drag: what `DragToClose`'s `onDragMove` receives on every pointer move. @public */
export interface GrabDragMove {
    /** How far the pointer has travelled right of where it went down, px (negative = left). */
    x: number;
    /** How far the pointer has travelled below where it went down, px (negative = up). */
    y: number;
    /** The pointer's x in viewport px, the coordinate to hit-test against `getBoundingClientRect()` or pass to `elementFromPoint`. */
    clientX: number;
    /** The pointer's y in viewport px. */
    clientY: number;
}
/** Where the pointer let go of a grab-handle drag: what `DragToClose`'s `onDragEnd` receives on release. @public */
export interface GrabDragEnd {
    /** How far the pointer travelled right of where it went down, px (negative = left); the pointer's own travel, not the row's scroll added. */
    offsetX: number;
    /** How far the pointer travelled below where it went down, px (negative = up). */
    offsetY: number;
    /** The pointer's x in viewport px at release. */
    clientX: number;
    /** The pointer's y in viewport px at release. */
    clientY: number;
}
/**
 * A box whose grab handle, dragged down far enough, calls `onClose`; with `reorder`, the same handle also drags
 * sideways. `onClose` must remove the view, because a close never unlocks the scroll ancestors.
 * @public
 */
export declare function DragToClose(input: {
    /** Without it a release past the close line snaps back: the box has nothing to close. */
    onClose?: () => void;
    /** When set, the handle also drags horizontally and reports the total offset to `reorder.onDragEnd` on release. */
    reorder?: ReorderHandle;
    /**
     * Whether a drag released far or fast enough downward closes the box. Default true. When false a release anywhere springs the box
     * home and `onClose` is not called by the drag; the Delete key on the handle still calls it.
     */
    closeOnRelease?: boolean;
    /**
     * Called on every pointer move of a drag, from the move that starts it, with where the pointer is. Not called for a press that never
     * becomes a drag. Use `clientX` and `clientY` to hit-test your own targets.
     */
    onDragMove?: (move: GrabDragMove) => void;
    /**
     * Called once when the pointer is released after a drag, before `reorder.onDragEnd` and before any close, with where the pointer
     * let go. Not called when the gesture is cancelled (a native pan, the Escape key), and not for a press that never became a drag.
     */
    onDragEnd?: (end: GrabDragEnd) => void;
    /** Render prop: receives the handle props to spread onto the grab bar, and returns the box's content. */
    children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement;
export {};
