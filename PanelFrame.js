import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The shared phone-shaped card every view renders inside, so every section reads as one
 * silhouette instead of near-identical border/radius/background declarations drifting apart.
 * Fixed size by default; `expanded` is only the tap-to-expand fullscreen overlay. The frame's border, size and
 * header-pill rules are explained in DESIGN.md ("PanelFrame's inset, scrollbar and header pill").
 */
import * as React from 'react';
import Box from '@mui/material/Box';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useOptionalHost } from './hostApi.js';
import { usePhoneSize } from './phoneFit.js';
import { resolveLabels } from './labels.js';
import { PanelFooter } from './panelFooter.js';
import { useFrameClaim } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { useInsideSizeBox } from './PanelRowSlot.js';
import { HEADER_GAP_PX, HEADER_INSET_PX } from './rowConstants.js';
import { BAR_HEIGHT_PX } from './panelChromeSize.js';
/** The attribute a panel's phone frame carries, so a stylesheet can select the frame without a class name. @public */
export const PHONE_FRAME_ATTRIBUTE = 'data-phone-frame';
/** The phone's corner radius in theme shape units (4 x 6px = 24px). @public */
export const PANEL_CORNER_RADIUS_UNITS = 4;
/** That radius in px for `theme`. @public */
export const panelCornerRadiusPx = (theme) => PANEL_CORNER_RADIUS_UNITS * theme.radiusUnitPx;
// The same radius read off the styling theme the frame's own sx callbacks receive.
const radiusOf = (theme) => PANEL_CORNER_RADIUS_UNITS * Number(theme.shape.borderRadius);
// One width for the padding and the inset shadow, so the content box begins exactly where the ring ends.
const EDGE_PX = 1;
/**
 * No effect. PanelFrame no longer styles its content, so there is nothing to cancel; the export stays so
 * existing imports keep compiling.
 * @deprecated Remove the spread. PanelFrame applies no padding or scrollbar to its content.
 * @public
 */
export const panelFrameBareSx = {};
/**
 * Two nested boxes: the OUTER owns border, radius and size and clips to the rounded corner; the INNER is a
 * plain flex column for the view's own content, styled only by the `sx` prop. Padding and scrolling inside
 * are the view's (DESIGN.md).
 * @public
 */
const PanelFrame = React.forwardRef(function PanelFrame({ children, expanded, size, footer = true, sx, ...rest }, ref) {
    useFrameClaim('frame');
    const phone = usePhoneSize();
    const drawn = React.useContext(PanelSlotContext)?.drawn;
    // Below a size box the frame fills it, so a resize eases the frame too instead of jumping it to the new size.
    const boxed = useInsideSizeBox();
    const width = boxed ? '100%' : (size?.width ?? drawn?.width ?? phone.width);
    const height = boxed || size?.height === 'fill' ? '100%' : (size?.height ?? drawn?.height ?? phone.height);
    const frame = (_jsx(Box, { ref: ref, [PHONE_FRAME_ATTRIBUTE]: '', ...rest, sx: {
            // border-box: row-layout width math elsewhere treats the phone size as this box's real
            // rendered size; content-box would add border+padding on top, silently under-fitting.
            boxSizing: 'border-box',
            // The edge is an inset shadow inside padding of the same width, so it draws over nothing the content lays out.
            p: `${EDGE_PX}px`,
            boxShadow: (theme) => `inset 0 0 0 ${EDGE_PX}px ${theme.palette.divider}`,
            borderRadius: (theme) => `${radiusOf(theme)}px`,
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
                // Opaque full-bleed content would otherwise paint over the ring along each corner arc. Inherited, so it follows
                // the frame's radius however that is set, including an inline or animated one a stylesheet cannot see.
                borderRadius: 'inherit',
                overflow: 'hidden',
                ...sx,
            }, children: children }) }));
    // The footer is a sibling of the frame, not its child, so the frame's overflow clip cannot cut it off.
    return footer ? (_jsxs(_Fragment, { children: [frame, _jsx(PanelFooter, {})] })) : frame;
});
/**
 * A header that floats ABOVE a PanelFrame (`position: absolute; bottom: calc(100% + gap)`), so its parent must
 * be `position: relative`. Internal layout is not baked in (callers differ): pass `sx`, layered on top. A plain
 * `Box`, since `Paper`'s polymorphic `component` typing collides with `Omit<ElementProps, ...>`. Drag wiring and
 * any grab cursor belong on `Panel`'s `grabProps`, never here.
 * @public
 */
export function PanelHeader({ children, sx, ...rest }) {
    return (_jsx(Box, { ...rest, sx: {
            position: 'absolute',
            bottom: `calc(100% + ${HEADER_GAP_PX}px)`,
            left: 0,
            right: 0,
            // Fixed, so however the content wraps the header keeps its height.
            height: `${BAR_HEIGHT_PX}px`,
            display: 'flex',
            alignItems: 'center',
            px: `${HEADER_INSET_PX}px`,
            py: '1px',
            fontSize: 13,
            color: 'text.primary',
            ...sx,
        }, children: children }));
}
/** Deliberately narrow (mirrors JSX's own falsy-child rules, not a general emptiness check) so a
 * real value like `0` or whitespace is never mistaken for "no content". */
function isEmptyHeaderContent(node) {
    return node === undefined || node === null || node === false || node === '';
}
/** A dimmed "Untitled" reads as "intentionally blank" rather than a loading glitch or missing data. */
const placeholderTitle = (text) => (_jsx(Box, { component: "span", "data-header-placeholder-title": "", sx: { color: 'text.disabled' }, children: text }));
/** A dimmed "more" glyph reads as "no actions here" rather than a missing icon, and keeps the
 * row's right edge occupied so the header's height never depends on whether any were passed. */
const PLACEHOLDER_ACTIONS = (_jsx(Box, { "data-header-placeholder-action": "", "aria-hidden": "true", sx: { display: 'flex', alignItems: 'center', color: 'text.disabled' }, children: _jsx(MoreHorizIcon, { fontSize: "small" }) }));
/**
 * The title-left/actions-right row shape every PanelHeader caller wants, as one shared layout
 * instead of each call site reimplementing near-identical flex/ellipsis markup. Placeholder
 * substitution lives HERE, not in each caller, so every caller gets it for free.
 * @public
 */
export function PanelHeaderRow({ title, actions, leading, sx, isInput = false, onTitleChange, ...rest }) {
    const labels = resolveLabels(useOptionalHost()?.labels);
    const [draft, setDraft] = React.useState(null);
    const inputRef = React.useRef(null);
    const editing = draft !== null;
    React.useEffect(() => {
        if (editing)
            inputRef.current?.focus();
    }, [editing]);
    const resolvedTitle = isEmptyHeaderContent(title) ? placeholderTitle(labels.untitledHeader) : title;
    const resolvedActions = isEmptyHeaderContent(actions) ? PLACEHOLDER_ACTIONS : actions;
    const editable = isInput && typeof title === 'string' && onTitleChange !== undefined;
    const commit = () => {
        if (draft === null)
            return;
        const next = draft.trim();
        setDraft(null);
        if (next !== '' && next !== title)
            onTitleChange?.(next);
    };
    const titleNode = draft !== null ? (_jsx("input", { ref: inputRef, "aria-label": typeof title === 'string' ? title : undefined, value: draft, onChange: (event) => setDraft(event.target.value), onBlur: commit, onKeyDown: (event) => {
            if (event.key === 'Enter')
                commit();
            else if (event.key === 'Escape')
                setDraft(null);
        }, style: { font: 'inherit', color: 'inherit', background: 'transparent', border: 0, outline: 'none', padding: 0, width: '100%', minWidth: 0 } })) : editable ? (_jsx(Box, { component: "span", role: "button", tabIndex: 0, onClick: () => setDraft(title), onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ')
                setDraft(title);
        }, sx: { cursor: 'text' }, children: resolvedTitle })) : (resolvedTitle);
    return (_jsxs(PanelHeader, { ...rest, sx: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, ...sx }, children: [leading, _jsx(Box, { sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }, children: titleNode }), _jsx(Box, { sx: { display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }, children: resolvedActions })] }));
}
export default PanelFrame;
