import { jsx as _jsx } from "react/jsx-runtime";
import { motion } from 'motion/react';
import { DRAG_CLOSE } from './dragToClose.js';
import { SLOT_TRANSITION, directionalTransition } from './directionalTransition.js';
/**
 * The one spacing value used everywhere a gap is needed in this row.
 * @public
 */
export const GAP = 16;
/** The timing/easing every panel slide uses. The SAME object as SLOT_TRANSITION, not a copy: a host animates
 * its own row "the same as a panel" by this reference (test/row-shell-style.test.ts pins it).
 * @public */
export const PANEL_TRANSITION = SLOT_TRANSITION;
/**
 * The pure values behind one PanelRowSlot render, split out so a test can assert exact motion
 * values without mounting a component. `exit` stays entirely local to this function: 'down' needs a second
 * axis and its own transition, 'left' a target independent of `leftOffset`; neither fits directionalTransition's
 * symmetric default.
 */
export function panelRowSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection) {
    // This panel's OWN footprint (its width plus one gap) is how far it must travel to clear the row edge,
    // so the distance is per panel: a wider one travels further.
    const ownSpan = width + GAP;
    const rest = leftOffset;
    // Positive distance enters from the right (directionalTransition.ts's own sign convention); a negative
    // one enters from the left -- see panelRowOrder.ts for who decides which.
    const enterDistance = enterDirection === 'left' ? -ownSpan : ownSpan;
    const { initial, animate, transition } = directionalTransition('x', rest, enterDistance);
    // 'down': a close, timed to DragToClose's exit so trash and drag closes read as one motion (DragToClose calls
    // `onClose` after its own `y` animation, so this ramps in under a box already off-screen). 'left'/'right': a
    // park, off the edge it was hidden past, so a close never looks like a park.
    const exit = exitDirection === 'down'
        ? { x: rest, y: phoneHeight, opacity: 0, transition: { duration: DRAG_CLOSE.exitSeconds, ease: 'easeIn' } }
        : exitDirection === 'right'
            ? { x: rest + ownSpan, opacity: 0 }
            : { x: -ownSpan, opacity: 0 };
    return { initial, animate, exit, transition };
}
/**
 * One entry's animated slot in the row: its position, width, enter/exit motion and stacking.
 * @public
 */
export function PanelRowSlot({ leftOffset, width, phoneHeight, enterDirection, exitDirection, zIndex, children, }) {
    const { initial, animate, exit, transition } = panelRowSlotMotion(leftOffset, width, phoneHeight, enterDirection, exitDirection);
    return (_jsx(motion.div
    // Enters from one own-width-plus-gap span beyond its destination, right or left per `enterDirection` above.
    , { 
        // Enters from one own-width-plus-gap span beyond its destination, right or left per `enterDirection` above.
        initial: initial, animate: animate, exit: exit, transition: transition, style: {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            // Snaps, never animates: nothing paints the slot's own width (PanelSizeBox animates the visible resize).
            width,
            zIndex: zIndex ?? 0,
        }, children: children }));
}
/**
 * The element a resize animates: an INNER box, never the slot, which owns `exit` (Motion's docs warn against
 * `layout` and `exit` on one element). A layout animation sets the real size once and animates a transform
 * toward it, so the view never re-lays out mid-resize; `layout="size"` because the slot's `x` already animates
 * position. A view renders it inside its own slot, so a view that never resizes needs no wrapper.
 * @public
 */
export function PanelSizeBox({ width, height, children }) {
    return (_jsx(motion.div, { "data-panel-size-box": "", layout: "size", transition: PANEL_TRANSITION, style: { width, height }, children: children }));
}
