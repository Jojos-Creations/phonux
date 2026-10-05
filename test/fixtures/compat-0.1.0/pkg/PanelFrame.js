import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The shared phone-shaped card every view renders inside, so every section reads as one
 * silhouette instead of near-identical border/radius/background declarations drifting apart.
 * Fixed size by default; `expanded` is only the tap-to-expand fullscreen overlay. The inset, scrollbar
 * and header-pill rules below are explained in DESIGN.md ("PanelFrame's inset, scrollbar and header pill").
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useHost } from './hostApi.js';
/** The classic (non-overlay) scrollbar this app draws for itself, in px. */
const SCROLLBAR_PX = 8;
/** How far content sits from the frame's own border, on every side, in px. */
const CONTENT_INSET_PX = 12;
/** The phone's corner radius in theme shape units (4 x 6px = 24px). The frame's corners and the header
 * pills' semicircular ends both derive from it, so they cannot drift apart. @public */
export const PANEL_CORNER_RADIUS_UNITS = 4;
/** @public @deprecated use PANEL_CORNER_RADIUS_UNITS */
export const PHONE_CORNER_RADIUS_UNITS = PANEL_CORNER_RADIUS_UNITS;
/** That radius in px for `theme`; a header pill is twice this tall (exact semicircles). @public */
export const panelCornerRadiusPx = (theme) => PANEL_CORNER_RADIUS_UNITS * Number(theme.shape.borderRadius);
/** @public @deprecated use panelCornerRadiusPx */
export const phoneCornerRadiusPx = panelCornerRadiusPx;
/** The header pill's gap above the frame, in px -- also the grab bar's own height (Panel.tsx),
 * since the grab bar fills that whole strip. One constant so the two can't drift apart, and sized to WCAG
 * 2.5.8's 24px minimum pointer-target height even though the drawn pill inside it is thinner. @internal */
export const PANEL_HEADER_GAP_PX = 24;
/**
 * Keeps content inset the same from the border on every side, scrollbar or not: `scrollbar-gutter: stable`
 * reserves the bar's strip, so the right padding is pre-shrunk by its width. A nested scroller needs its own
 * copy of the `::-webkit-scrollbar` rules below, which style only the element they are set on.
 * @public
 */
export const panelFrameScrollSx = {
    overflowX: 'hidden',
    overflowY: 'auto',
    scrollbarGutter: 'stable',
    pt: `${CONTENT_INSET_PX}px`,
    pb: `${CONTENT_INSET_PX}px`,
    pl: `${CONTENT_INSET_PX}px`,
    pr: `${CONTENT_INSET_PX - SCROLLBAR_PX}px`,
    // Forces a classic (non-overlay) scrollbar: an overlay one reserves no layout width, which
    // would break the padding math above. Track transparent, thumb a low-contrast fill.
    '&::-webkit-scrollbar': { width: SCROLLBAR_PX },
    '&::-webkit-scrollbar-track': { background: 'transparent' },
    '&::-webkit-scrollbar-thumb': {
        background: 'rgba(255, 255, 255, 0.25)',
        borderRadius: SCROLLBAR_PX / 2,
    },
    '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255, 255, 255, 0.4)' },
};
/** @public @deprecated use panelFrameScrollSx */
export const phoneFrameScrollSx = panelFrameScrollSx;
/**
 * For a caller doing its own scrolling one level deeper (an embedded web view, a transcript under a
 * pinned input bar): cancels PanelFrame's own padding AND its reserved scrollbar strip, so
 * neither is reserved twice. Every property is a longhand -- MUI resolves `p`/`pr` and
 * `overflow`/`overflowY` independently, so a shorthand spread over a longhand does not reliably win.
 * @public
 */
export const panelFrameBareSx = {
    pt: 0,
    pr: 0,
    pb: 0,
    pl: 0,
    overflowX: 'hidden',
    overflowY: 'hidden',
    scrollbarGutter: 'auto',
};
/** @public @deprecated use panelFrameBareSx */
export const phoneFrameBareSx = panelFrameBareSx;
/**
 * Two nested boxes: the OUTER owns border, radius and size and clips to the rounded corner; the INNER owns
 * the padding and is the scroll container. `panelFrameScrollSx` forces a classic scrollbar, because an
 * overlay one floats over content with an inset no padding can cancel (DESIGN.md).
 * @public
 */
const PanelFrame = React.forwardRef(function PanelFrame({ children, expanded, size, sx, ...rest }, ref) {
    const deviceSize = useHost().device.size;
    const width = size?.width ?? deviceSize.width;
    const height = size?.height === 'fill' ? '100%' : (size?.height ?? deviceSize.height);
    return (_jsx(Box, { ref: ref, "data-phone-frame": "", ...rest, sx: {
            // border-box: row-layout width math elsewhere treats device.size as this box's real
            // rendered size; content-box would add border+padding on top, silently under-fitting.
            boxSizing: 'border-box',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: PANEL_CORNER_RADIUS_UNITS,
            bgcolor: 'background.paper',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            flexShrink: 0,
            ...(expanded ? { width: '100%', height: '100%' } : { width, height }),
        }, children: _jsx(Box, { sx: {
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                ...panelFrameScrollSx,
                ...sx,
            }, children: children }) }));
});
/**
 * A header that floats ABOVE a PanelFrame (`position: absolute; bottom: calc(100% + gap)`), so its parent must
 * be `position: relative`. Internal layout is not baked in (callers differ): pass `sx`, layered on top. A plain
 * `Box`, since `Paper`'s polymorphic `component` typing collides with `Omit<BoxProps, ...>`. Drag wiring and
 * any grab cursor belong on `Panel`'s `grabProps`, never here.
 * @public
 */
export function PanelHeader({ children, sx, ...rest }) {
    return (_jsx(Box, { ...rest, sx: {
            position: 'absolute',
            bottom: `calc(100% + ${PANEL_HEADER_GAP_PX}px)`,
            left: 0,
            right: 0,
            // Twice the phone's own corner radius, so each end is an exact semicircle; from the theme, never a
            // raw 48. Fixed, so however the content wraps the pill keeps its shape.
            height: (theme) => 2 * panelCornerRadiusPx(theme),
            display: 'flex',
            alignItems: 'center',
            // bgcolor + border: MUI Paper variant="outlined"'s look, shaped as a pill.
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: PANEL_CORNER_RADIUS_UNITS,
            // 12px, PanelFrame's own content inset, so a header's text lines up with the frame's content below.
            px: 1.5,
            fontSize: 13,
            color: 'common.white',
            ...sx,
        }, children: children }));
}
/** @public @deprecated use PanelHeader */
export const PhoneFrameHeader = PanelHeader;
/** Deliberately narrow (mirrors JSX's own falsy-child rules, not a general emptiness check) so a
 * real value like `0` or whitespace is never mistaken for "no content". */
function isEmptyHeaderContent(node) {
    return node === undefined || node === null || node === false || node === '';
}
/** A dimmed "Untitled" reads as "intentionally blank" rather than a loading glitch or missing data. */
const PLACEHOLDER_TITLE = (_jsx(Box, { component: "span", "data-header-placeholder-title": "", sx: { color: 'text.disabled' }, children: "Untitled" }));
/** A dimmed "more" glyph reads as "no actions here" rather than a missing icon, and keeps the
 * row's right edge occupied so the pill's shape never depends on whether any were passed. */
const PLACEHOLDER_ACTIONS = (_jsx(Box, { "data-header-placeholder-action": "", "aria-hidden": "true", sx: { display: 'flex', alignItems: 'center', color: 'text.disabled' }, children: _jsx(MoreHorizIcon, { fontSize: "small" }) }));
/**
 * The title-left/actions-right row shape every PanelHeader caller wants, as one shared layout
 * instead of each call site reimplementing near-identical flex/ellipsis markup. Placeholder
 * substitution lives HERE, not in each caller, so every caller gets it for free.
 * @public
 */
export function PanelHeaderRow({ title, actions, sx, ...rest }) {
    const resolvedTitle = isEmptyHeaderContent(title) ? PLACEHOLDER_TITLE : title;
    const resolvedActions = isEmptyHeaderContent(actions) ? PLACEHOLDER_ACTIONS : actions;
    return (_jsxs(PanelHeader, { ...rest, sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, ...sx }, children: [_jsx(Box, { sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }, children: resolvedTitle }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }, children: resolvedActions })] }));
}
/** @public @deprecated use PanelHeaderRow */
export const PhoneFrameHeaderRow = PanelHeaderRow;
export default PanelFrame;
