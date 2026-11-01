/**
 * Drag a view's grab handle DOWN to close it (the box follows the pointer up and down); with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */
import * as React from 'react';
import type { CssStyle } from './cssStyle.js';
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
/** The pointer event a handle's `onPointerDown` takes: the fields a press reads. React's pointer events satisfy it. @public */
export interface HandlePointerEvent {
    /** The primary button is 0. */
    readonly button: number;
    /** `'mouse'`, `'pen'` or `'touch'`. */
    readonly pointerType: string;
    /** The pointer's position in the viewport, in px. */
    readonly clientX: number;
    /** The vertical position, in the same units as `clientX`. */
    readonly clientY: number;
    /** When the press happened, in ms on the page's clock. */
    readonly timeStamp: number;
    /** The element the press landed on. */
    readonly target: unknown;
    /** The handle's element. */
    readonly currentTarget: unknown;
    /** Stops the browser's default for the press. */
    preventDefault(): void;
}
/** The key event a handle's `onKeyDown` takes. React's keyboard events satisfy it. @public */
export interface HandleKeyEvent {
    /** The key's name, as `KeyboardEvent.key` gives it. */
    readonly key: string;
    /** Whether the Alt key was held. */
    readonly altKey: boolean;
    /** Whether the Control key was held. */
    readonly ctrlKey: boolean;
    /** Whether the Meta key was held. */
    readonly metaKey: boolean;
    /** Whether the Shift key was held. */
    readonly shiftKey: boolean;
    /** The element the key landed on. */
    readonly target: unknown;
    /** The handle's element. */
    readonly currentTarget: unknown;
    /** Stops the browser's default for the key. */
    preventDefault(): void;
}
/** Spread onto Panel's `grabProps`. @public */
export interface DragHandleProps {
    /** Starts a drag from a primary-button press on the handle; a press on a button, link or field is ignored. Until the press ends, the page shows no text selection and starts no native image drag. */
    onPointerDown: (event: HandlePointerEvent) => void;
    /** The handle's styles: a grab cursor, no text selection, and `touch-action: pan-x` so a horizontal swipe still scrolls the row. A keyboard focus ring is drawn when the handle takes keys. */
    sx: CssStyle;
    /** `'button'` when the handle takes keys, which it does when `onClose` or `reorder.onStep` is set; absent otherwise. */
    role?: 'button';
    /** 0 when the handle takes keys; absent otherwise. */
    tabIndex?: 0;
    /** The handle's name when it takes keys, built from the panel's title inside a row. */
    'aria-label'?: string;
    /** The keys the handle takes, for assistive technology. */
    'aria-keyshortcuts'?: string;
    /** ArrowLeft and ArrowRight call `reorder.onStep(-1 | 1)` and Delete calls `onClose`, each said in the workspace's live region. Absent when the handle takes no keys. */
    onKeyDown?: (event: HandleKeyEvent) => void;
}
/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
    /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
    onDragEnd: (offsetX: number) => void;
    /** Moves the panel `steps` slots (-1 left, 1 right) for an ArrowLeft or ArrowRight on the handle; true when it moved. Without it the handle takes no Arrow keys. */
    onStep?: (steps: number) => boolean;
}
/**
 * The bottom of the visible area in layout-viewport px. The visual viewport is what the person sees: a pinch or an on-screen
 * keyboard shrinks it while `window.innerHeight` stays put, and an exit short of the visible bottom stops on screen.
 */
export declare function visibleViewportBottom(): number;
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
    /** How far the pointer has traveled right of where it went down, px (negative = left). */
    x: number;
    /** How far the pointer has traveled below where it went down, px (negative = up). */
    y: number;
    /** The pointer's x in viewport px, the coordinate to hit-test against `getBoundingClientRect()` or pass to `elementFromPoint`. */
    clientX: number;
    /** The pointer's y in viewport px. */
    clientY: number;
}
/** Where the pointer let go of a grab-handle drag: what `DragToClose`'s `onDragEnd` receives on release. @public */
export interface GrabDragEnd {
    /** How far the pointer traveled right of where it went down, px (negative = left); the pointer's own travel, not the row's scroll added. */
    offsetX: number;
    /** How far the pointer traveled below where it went down, px (negative = up). */
    offsetY: number;
    /** The pointer's x in viewport px at release. */
    clientX: number;
    /** The pointer's y in viewport px at release. */
    clientY: number;
}
/** The side a vertically dragged panel slides out to when its preview is dropped there. @public */
export type PreviewExit = 'top' | 'bottom';
/**
 * The tile a vertical drag pops out. `width` and `height` are the tile's size in px; `render` draws its content, typically a
 * snapshot of the panel. The panel itself stays in its slot while the tile is dragged.
 * @public
 */
export interface PreviewOut {
    /** The tile's width in px. */
    width: number;
    /** The tile's height in px. */
    height: number;
    /** Draws the tile's content; called while a preview is out. */
    render: () => React.ReactNode;
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
     * let go. Not called when the gesture is canceled (a native pan, the Escape key), and not for a press that never became a drag.
     */
    onDragEnd?: (end: GrabDragEnd) => void;
    /**
     * When set, a vertical drag past `PREVIEW_OUT_PX` grabs a tile-size preview instead of moving the box, and the box stays in its slot.
     * Pair with `exitFor` to say where a dropped preview's panel leaves to.
     */
    previewOut?: PreviewOut;
    /**
     * Called once at release when a preview is out, to choose the side the real panel slides out to: 'top' or 'bottom' closes the box
     * that way (then `onClose` runs), and null drops the preview and leaves the panel where it is. Not called without `previewOut`.
     */
    exitFor?: (end: GrabDragEnd) => PreviewExit | null;
    /** Render prop: receives the handle props to spread onto the grab bar, and returns the box's content. */
    children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement;
export {};
