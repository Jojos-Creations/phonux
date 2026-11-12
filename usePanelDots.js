import { useEmblaPanelDots } from './emblaDots.js';
/**
 * The bar for one row. `entries` is every panel in row order (the hollow dot is the panel setting `hollowDot`); `scroller` is the
 * row's scroll container (the element with `data-row-scroller`). The bar grows and shrinks with the panels; the app sets no width
 * for it. Reduce Motion snaps its glides, under either the OS query or `MotionConfig`.
 *
 * Every panel has a dot at its place on the row's one strip and the oval spans
 * the panels the window shows, both read from where the strip is drawn this frame. Dragging the oval moves the row with the pointer,
 * one dot of travel to one slot, and on release the row glides to the nearest rest; a pointer held at the bar's visible end (its box
 * cut by any ancestor that clips it) keeps the row moving, faster the further past the end it is. A dot press glides the row to show
 * that panel; a wheel over the bar steps one slot.
 * @public
 */
export function usePanelDots(i) {
    return useEmblaPanelDots(i) ?? NO_DOTS;
}
const noop = () => undefined;
/** Before the Embla row is mounted and measured: no dots, and the handlers do nothing. */
const NO_DOTS = {
    dots: [],
    oval: { left: 0, width: 0 },
    width: 0,
    shown: [],
    selectDot: noop,
    startOvalDrag: () => null,
    cursor: 'default',
    barProps: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerLeave: noop, onPointerCancel: noop, onWheel: noop, style: { touchAction: 'none', cursor: 'default' }, 'data-dot-bar': '' },
    ovalProps: { role: 'slider', tabIndex: 0, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 },
    dotProps: (id) => ({ 'data-dot': id, onClick: noop }),
};
