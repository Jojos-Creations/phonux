import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { motion } from 'motion/react';
import Box from '@mui/material/Box';
import { computeRowLayout } from './panelRowLayout.js';
import { GAP, PANEL_TRANSITION } from './PanelRowSlot.js';
import { OverlaySlot } from './windowOverlay.js';
/** Everything the markup needs from the measurement, computed synchronously while rendering (never through state or an effect).
 * @internal */
export function workspaceShellStyle(i) {
    // Calculated from known widths, never measured off the DOM. `fixedColumnCount` and `liveWidths` must come
    // from the same array the row's JSX renders (see computeRowLayout's own doc comment for why).
    const { computedRowMarginLeft } = computeRowLayout({
        containerWidth: i.containerWidth,
        phoneWidth: i.phoneWidth,
        gap: GAP,
        fixedItemCount: i.fixedColumnCount,
        liveWidths: i.liveWidths,
    });
    return {
        marginLeft: computedRowMarginLeft,
        transition: i.rowResizeSettled ? PANEL_TRANSITION : { duration: 0 },
        overflowX: 'hidden',
    };
}
/**
 * The workspace shell: a scroll container holding the centred, animated row, with two OverlaySlots
 * (`dialog` inside the row, `toast` as this component's own last sibling) so a view's WindowOverlay always
 * has somewhere to render, independent of the host's own mount order.
 * @public
 */
export function Workspace(props) {
    const { overflowContainerRef, rowRef, containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths, topPadding, beforeRow, children, ...rest } = props;
    const style = workspaceShellStyle({ containerWidth, rowResizeSettled, phoneWidth, fixedColumnCount, liveWidths });
    return (_jsxs(_Fragment, { children: [_jsxs(Box, { ref: overflowContainerRef, ...rest, sx: {
                    position: 'relative',
                    display: 'flex',
                    height: '100%',
                    minHeight: 0,
                    pt: `${topPadding ?? GAP}px`,
                    pb: `${GAP}px`,
                    pl: `${GAP}px`,
                    pr: `${GAP}px`,
                    // Always hidden: the row hides its far panel instead of ever scrolling or growing past what fits.
                    overflowX: style.overflowX,
                    overflowY: 'auto',
                }, children: [beforeRow, _jsxs(motion.div, { ref: rowRef, style: { display: 'flex', gap: `${GAP}px`, marginTop: 'auto', marginBottom: 'auto', marginRight: 'auto' }, animate: { marginLeft: style.marginLeft }, transition: style.transition, children: [_jsx(OverlaySlot, { name: "dialog" }), children] })] }), _jsx(OverlaySlot, { name: "toast" })] }));
}
