import { jsx as _jsx } from "react/jsx-runtime";
import { createSvgIcon } from '@mui/material/utils';
// Paths from Material Icons (Apache-2.0, see THIRD_PARTY_NOTICES.md), except Fold and Ultrawide, which Material lacks.
const DragIndicatorIcon = createSvgIcon(_jsx("path", { d: "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2m-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2" }), 'DragIndicator');
const MoreHorizIcon = createSvgIcon(_jsx("path", { d: "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2m-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2" }), 'MoreHoriz');
const SmartphoneIcon = createSvgIcon(_jsx("path", { d: "M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99M17 19H7V5h10z" }), 'SmartphoneOutlined');
/** Two outlined phones side by side, the fold drawn as the gap between them. */
const FoldIcon = createSvgIcon(_jsx("path", { d: "M3 4h18v16H3V4zm2 2v12h6V6H5zm8 0v12h6V6h-6z" }), 'Fold');
const TabletIcon = createSvgIcon(_jsx("path", { d: "M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 1.99-.9 1.99-2L23 6c0-1.1-.9-2-2-2m-2 14H5V6h14z" }), 'TabletOutlined');
const DesktopIcon = createSvgIcon(_jsx("path", { d: "M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H3V4h18z" }), 'DesktopWindowsOutlined');
/** The outlined desktop monitor with the screen drawn wide and short. */
const UltrawideIcon = createSvgIcon(_jsx("path", { d: "M21 5H3c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 9H3V7h18v7z" }), 'Ultrawide');
const FullscreenIcon = createSvgIcon(_jsx("path", { d: "M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" }), 'FullscreenOutlined');
/** One icon per width, by slots. The outlined set throughout: a filled monitor is solid beside the hollow phone and tablet. */
const SIZE_ICONS = [SmartphoneIcon, FoldIcon, TabletIcon, DesktopIcon, UltrawideIcon];
/** The icons the library draws when a host overrides none. @internal */
export const DEFAULT_ICONS = {
    grab: _jsx(DragIndicatorIcon, { "aria-hidden": "true", fontSize: "small" }),
    noActions: _jsx(MoreHorizIcon, { fontSize: "small" }),
    size: (slots) => {
        const Icon = SIZE_ICONS[slots - 1] ?? DesktopIcon;
        return _jsx(Icon, { fontSize: "small" });
    },
    fullscreen: _jsx(FullscreenIcon, { fontSize: "small" }),
};
/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export function resolveIcons(given) {
    if (given === undefined)
        return DEFAULT_ICONS;
    const out = { ...DEFAULT_ICONS };
    for (const key of Object.keys(DEFAULT_ICONS)) {
        const value = given[key];
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
