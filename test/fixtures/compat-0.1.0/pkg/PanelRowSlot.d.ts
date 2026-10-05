import * as React from 'react';
import { type TargetAndTransition } from 'motion/react';
/**
 * The one spacing value used everywhere a gap is needed in this row.
 * @public
 */
export declare const GAP = 16;
/** The timing/easing every panel slide uses. The SAME object as SLOT_TRANSITION, not a copy: a host animates
 * its own row "the same as a panel" by this reference (test/row-shell-style.test.ts pins it).
 * @public */
export declare const PANEL_TRANSITION: {
    duration: number;
    ease: [number, number, number, number];
};
/**
 * One live panel's animated slot, absolutely positioned at its own `leftOffset` so adding,
 * removing or resizing a panel never disturbs the ones to its left; `x`, not `left`, so the
 * browser composites it. Motion drives enter/exit (AnimatePresence keeps an outgoing node
 * mounted through its own unmount commit, unlike a plain CSS transition), and its Web Animations
 * API is immune to a theme's transition/animation:none reset, which must stay scoped there and never reach
 * transform/opacity, or it would kill this silently.
 */
export interface PanelRowSlotMotion {
    readonly initial: TargetAndTransition;
    readonly animate: TargetAndTransition;
    readonly exit: TargetAndTransition;
    readonly transition: typeof PANEL_TRANSITION;
}
type ExitDirection = 'down' | 'left' | 'right';
/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export declare function panelRowSlotMotion(leftOffset: number, width: number, phoneHeight: number, enterDirection: 'left' | 'right', exitDirection: ExitDirection): PanelRowSlotMotion;
/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @public
 */
export declare function PanelRowSlot({ leftOffset, width, phoneHeight, enterDirection, exitDirection, zIndex, children, }: {
    /** This slot's own rest x position -- the caller's running sum of every PRECEDING present item's own width plus one gap. */
    leftOffset: number;
    /** This panel's own width (`panelWidthOf`), also this slot's enter/exit travel distance (`panelRowSlotMotion`'s `ownSpan`). */
    width: number;
    phoneHeight: number;
    /** Computed by the caller (panelRowOrder.ts's `resolveEnterDirection`, or an explicit gesture side).
     * Must be correct on this component's FIRST render after the item (re)appears -- AnimatePresence
     * has no later render of a fresh mount to fix a wrong guess. */
    enterDirection: 'left' | 'right';
    /** Must be correct on this component's LAST render before it leaves the `live`-filtered array --
     * AnimatePresence has no later render of a removed child to fix a wrong guess. */
    exitDirection: 'down' | 'left' | 'right';
    /**
     * Each slot's `motion.div` carries a `transform`, so it is its OWN stacking context and a child's `zIndex`
     * cannot compare against a SIBLING slot: stacking between slots (e.g. a raised column above a panel sliding
     * left behind it) must be set HERE, on the slot, not on what renders inside it. Defaults to 0.
     */
    zIndex?: number;
    children: React.ReactNode;
}): React.JSX.Element;
/**
 * The element a resize animates: an INNER box, never the slot, which owns `exit` (Motion's docs warn against
 * `layout` and `exit` on one element). A layout animation sets the real size once and animates a transform
 * toward it, so the view never re-lays out mid-resize; `layout="size"` because the slot's `x` already animates
 * position. A view renders it inside its own slot, so a view that never resizes needs no wrapper.
 * @public
 */
export declare function PanelSizeBox({ width, height, children }: {
    width: number;
    height: number;
    children: React.ReactNode;
}): React.JSX.Element;
export {};
