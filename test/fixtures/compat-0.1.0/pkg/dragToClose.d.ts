/**
 * Drag a view's grab handle DOWN to close it; with `reorder`, also sideways to reorder. It knows nothing about
 * panels or the app. onClose MUST remove the view: a close never unlocks the scroll ancestors. Also offer a
 * button calling the same onClose (WCAG 2.5.7). The full contract: DESIGN.md, "`DragToClose`".
 */
import * as React from 'react';
/** The tunables, in one place. Distances in px, velocities in px/s, positive = downward. @public */
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
/** @public */
export interface ReleaseMeasure {
    /** How far the box was dragged from its resting place, px (positive = down). */
    offsetY: number;
    /** Vertical velocity at release, px/s (positive = down). */
    velocityY: number;
    /** The box's own height, px (0 or NaN when unmeasured: only the minimum distance applies). */
    height: number;
}
/** The whole close rule, pure. Never closes on an upward or zero offset, or when released moving back up. @public */
export declare function shouldCloseOnRelease({ offsetY, velocityY, height }: ReleaseMeasure): boolean;
/** Spread onto Panel's `grabProps`. @public */
export interface DragHandleProps {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    sx: {
        cursor: 'grab';
        touchAction: 'pan-x';
        userSelect: 'none';
        '&:active': {
            cursor: 'grabbing';
        };
    };
}
/** Hands the same handle's horizontal drag to the caller's own reorder (DESIGN.md, "`DragToClose`"). @public */
export interface ReorderHandle {
    /** The gesture's own total horizontal offset (px, +right/-left from where the drag started), read once it has locked horizontal AND released. */
    onDragEnd: (offsetX: number) => void;
}
/** @public */
export declare function DragToClose({ onClose, reorder, children, }: {
    onClose: () => void;
    reorder?: ReorderHandle;
    children: (handle: DragHandleProps) => React.ReactNode;
}): React.ReactElement;
