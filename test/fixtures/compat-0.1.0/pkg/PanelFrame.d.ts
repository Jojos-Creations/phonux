/**
 * The shared phone-shaped card every view renders inside, so every section reads as one
 * silhouette instead of near-identical border/radius/background declarations drifting apart.
 * Fixed size by default; `expanded` is only the tap-to-expand fullscreen overlay. The inset, scrollbar
 * and header-pill rules below are explained in DESIGN.md ("PanelFrame's inset, scrollbar and header pill").
 */
import * as React from 'react';
import { type BoxProps } from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import { type PanelSize } from './hostApi.js';
/** @public */
export interface PanelFrameProps extends Omit<BoxProps, 'children'> {
    children: React.ReactNode;
    /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
    expanded?: boolean;
    /** This panel's own size instead of the shared useHost().device.size. Omitted: width and height come from device.size, read live -- see DESIGN.md. `height: 'fill'` renders as `100%` rather than a pixel value. */
    size?: PanelSize;
}
/** @public @deprecated use PanelFrameProps */
export type PhoneFrameProps = PanelFrameProps;
/** The phone's corner radius in theme shape units (4 x 6px = 24px). The frame's corners and the header
 * pills' semicircular ends both derive from it, so they cannot drift apart. @public */
export declare const PANEL_CORNER_RADIUS_UNITS = 4;
/** @public @deprecated use PANEL_CORNER_RADIUS_UNITS */
export declare const PHONE_CORNER_RADIUS_UNITS = 4;
/** That radius in px for `theme`; a header pill is twice this tall (exact semicircles). @public */
export declare const panelCornerRadiusPx: (theme: Theme) => number;
/** @public @deprecated use panelCornerRadiusPx */
export declare const phoneCornerRadiusPx: (theme: Theme) => number;
/** The header pill's gap above the frame, in px -- also the grab bar's own height (Panel.tsx),
 * since the grab bar fills that whole strip. One constant so the two can't drift apart, and sized to WCAG
 * 2.5.8's 24px minimum pointer-target height even though the drawn pill inside it is thinner. @internal */
export declare const PANEL_HEADER_GAP_PX = 24;
/**
 * Keeps content inset the same from the border on every side, scrollbar or not: `scrollbar-gutter: stable`
 * reserves the bar's strip, so the right padding is pre-shrunk by its width. A nested scroller needs its own
 * copy of the `::-webkit-scrollbar` rules below, which style only the element they are set on.
 * @public
 */
export declare const panelFrameScrollSx: {
    readonly overflowX: "hidden";
    readonly overflowY: "auto";
    readonly scrollbarGutter: "stable";
    readonly pt: "12px";
    readonly pb: "12px";
    readonly pl: "12px";
    readonly pr: "4px";
    readonly '&::-webkit-scrollbar': {
        readonly width: 8;
    };
    readonly '&::-webkit-scrollbar-track': {
        readonly background: "transparent";
    };
    readonly '&::-webkit-scrollbar-thumb': {
        readonly background: "rgba(255, 255, 255, 0.25)";
        readonly borderRadius: number;
    };
    readonly '&::-webkit-scrollbar-thumb:hover': {
        readonly background: "rgba(255, 255, 255, 0.4)";
    };
};
/** @public @deprecated use panelFrameScrollSx */
export declare const phoneFrameScrollSx: {
    readonly overflowX: "hidden";
    readonly overflowY: "auto";
    readonly scrollbarGutter: "stable";
    readonly pt: "12px";
    readonly pb: "12px";
    readonly pl: "12px";
    readonly pr: "4px";
    readonly '&::-webkit-scrollbar': {
        readonly width: 8;
    };
    readonly '&::-webkit-scrollbar-track': {
        readonly background: "transparent";
    };
    readonly '&::-webkit-scrollbar-thumb': {
        readonly background: "rgba(255, 255, 255, 0.25)";
        readonly borderRadius: number;
    };
    readonly '&::-webkit-scrollbar-thumb:hover': {
        readonly background: "rgba(255, 255, 255, 0.4)";
    };
};
/**
 * For a caller doing its own scrolling one level deeper (an embedded web view, a transcript under a
 * pinned input bar): cancels PanelFrame's own padding AND its reserved scrollbar strip, so
 * neither is reserved twice. Every property is a longhand -- MUI resolves `p`/`pr` and
 * `overflow`/`overflowY` independently, so a shorthand spread over a longhand does not reliably win.
 * @public
 */
export declare const panelFrameBareSx: {
    readonly pt: 0;
    readonly pr: 0;
    readonly pb: 0;
    readonly pl: 0;
    readonly overflowX: "hidden";
    readonly overflowY: "hidden";
    readonly scrollbarGutter: "auto";
};
/** @public @deprecated use panelFrameBareSx */
export declare const phoneFrameBareSx: {
    readonly pt: 0;
    readonly pr: 0;
    readonly pb: 0;
    readonly pl: 0;
    readonly overflowX: "hidden";
    readonly overflowY: "hidden";
    readonly scrollbarGutter: "auto";
};
/**
 * Two nested boxes: the OUTER owns border, radius and size and clips to the rounded corner; the INNER owns
 * the padding and is the scroll container. `panelFrameScrollSx` forces a classic scrollbar, because an
 * overlay one floats over content with an inset no padding can cancel (DESIGN.md).
 * @public
 */
declare const PanelFrame: React.ForwardRefExoticComponent<Omit<PanelFrameProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
/** @public */
export interface PanelHeaderProps extends Omit<BoxProps, 'children'> {
    children: React.ReactNode;
}
/** @public @deprecated use PanelHeaderProps */
export type PhoneFrameHeaderProps = PanelHeaderProps;
/**
 * A header that floats ABOVE a PanelFrame (`position: absolute; bottom: calc(100% + gap)`), so its parent must
 * be `position: relative`. Internal layout is not baked in (callers differ): pass `sx`, layered on top. A plain
 * `Box`, since `Paper`'s polymorphic `component` typing collides with `Omit<BoxProps, ...>`. Drag wiring and
 * any grab cursor belong on `Panel`'s `grabProps`, never here.
 * @public
 */
export declare function PanelHeader({ children, sx, ...rest }: PanelHeaderProps): React.JSX.Element;
/** @public @deprecated use PanelHeader */
export declare const PhoneFrameHeader: typeof PanelHeader;
/** @public */
export interface PanelHeaderRowProps extends Omit<PanelHeaderProps, 'children' | 'title'> {
    /** Left-aligned, ellipsis-truncated. Falsy renders a placeholder ("Untitled") instead of
     * nothing, so the pill never blanks for a view with no title yet. */
    title: React.ReactNode;
    /** Right-aligned, never truncated. Falsy renders a placeholder icon slot instead of nothing,
     * so a conditional like `isRunning && <IconButton .../>` still keeps the pill's full shape. */
    actions?: React.ReactNode;
}
/** @public @deprecated use PanelHeaderRowProps */
export type PhoneFrameHeaderRowProps = PanelHeaderRowProps;
/**
 * The title-left/actions-right row shape every PanelHeader caller wants, as one shared layout
 * instead of each call site reimplementing near-identical flex/ellipsis markup. Placeholder
 * substitution lives HERE, not in each caller, so every caller gets it for free.
 * @public
 */
export declare function PanelHeaderRow({ title, actions, sx, ...rest }: PanelHeaderRowProps): React.JSX.Element;
/** @public @deprecated use PanelHeaderRow */
export declare const PhoneFrameHeaderRow: typeof PanelHeaderRow;
export default PanelFrame;
