/**
 * The shared phone-shaped card every view renders inside, so every section reads as one
 * silhouette instead of near-identical border/radius/background declarations drifting apart.
 * Fixed size by default; `expanded` is only the tap-to-expand fullscreen overlay. The frame's border, size and
 * header-pill rules are explained in DESIGN.md ("PanelFrame's inset, scrollbar and header pill").
 */
import * as React from 'react';
import { type BoxProps } from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import { type PanelSize } from './hostApi.js';
/** The props of `PanelFrame`: every `Box` prop except `children`, plus `expanded` and `size`. @public */
export interface PanelFrameProps extends Omit<BoxProps, 'children'> {
    /** The frame's content, rendered inside its scroll container. */
    children: React.ReactNode;
    /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
    expanded?: boolean;
    /** This panel's own size instead of the shared phone size (`usePhoneSize()`). Omitted: inside a row the width and height are the slot's drawn size, else the phone size's, read live -- see DESIGN.md. `height: 'fill'` renders as `100%` rather than a pixel value. */
    size?: PanelSize;
    /** `false` keeps the footer the panel's template declares out of this frame, for a view that draws `PanelFooter` itself. Default: drawn floating below the frame. */
    footer?: boolean;
}
/** The attribute a panel's phone frame carries, so a stylesheet can select the frame without a class name. @public */
export declare const PHONE_FRAME_ATTRIBUTE = "data-phone-frame";
/** The phone's corner radius in theme shape units (4 x 6px = 24px). @public */
export declare const PANEL_CORNER_RADIUS_UNITS = 4;
/** That radius in px for `theme`. @public */
export declare const panelCornerRadiusPx: (theme: Theme) => number;
/**
 * No effect. PanelFrame no longer styles its content, so there is nothing to cancel; the export stays so
 * existing imports keep compiling.
 * @deprecated Remove the spread. PanelFrame applies no padding or scrollbar to its content.
 * @public
 */
export declare const panelFrameBareSx: {};
/**
 * Two nested boxes: the OUTER owns border, radius and size and clips to the rounded corner; the INNER is a
 * plain flex column for the view's own content, styled only by the `sx` prop. Padding and scrolling inside
 * are the view's (DESIGN.md).
 * @public
 */
declare const PanelFrame: React.ForwardRefExoticComponent<Omit<PanelFrameProps, "ref"> & React.RefAttributes<HTMLDivElement>>;
/** The props of `PanelHeader`: every `Box` prop except `children`. @public */
export interface PanelHeaderProps extends Omit<BoxProps, 'children'> {
    /** The header's content; its internal layout is the caller's. */
    children: React.ReactNode;
}
/**
 * A header that floats ABOVE a PanelFrame (`position: absolute; bottom: calc(100% + gap)`), so its parent must
 * be `position: relative`. Internal layout is not baked in (callers differ): pass `sx`, layered on top. A plain
 * `Box`, since `Paper`'s polymorphic `component` typing collides with `Omit<BoxProps, ...>`. Drag wiring and
 * any grab cursor belong on `Panel`'s `grabProps`, never here.
 * @public
 */
export declare function PanelHeader({ children, sx, ...rest }: PanelHeaderProps): React.JSX.Element;
/** The props of `PanelHeaderRow`: every `PanelHeader` prop except `children` and `title`, plus `title` and `actions`. @public */
export interface PanelHeaderRowProps extends Omit<PanelHeaderProps, 'children' | 'title'> {
    /** Left-aligned, ellipsis-truncated. Falsy renders a placeholder ("Untitled") instead of
     * nothing, so the header never blanks for a view with no title yet. */
    title: React.ReactNode;
    /** Right-aligned, never truncated. Falsy renders a placeholder icon slot instead of nothing,
     * so a conditional like `isRunning && <IconButton .../>` still keeps the header's full height. */
    actions?: React.ReactNode;
    /** Left of the title, never truncated. Nothing is drawn for it when it is omitted. */
    leading?: React.ReactNode;
    /** Whether a click on a string title edits it in place. Needs `onTitleChange`. Default false. */
    isInput?: boolean;
    /** Called with the trimmed new title when an edit commits (Enter or blur) to a non-empty, changed value. Escape cancels. */
    onTitleChange?: (next: string) => void;
}
/**
 * The title-left/actions-right row shape every PanelHeader caller wants, as one shared layout
 * instead of each call site reimplementing near-identical flex/ellipsis markup. Placeholder
 * substitution lives HERE, not in each caller, so every caller gets it for free.
 * @public
 */
export declare function PanelHeaderRow({ title, actions, leading, sx, isInput, onTitleChange, ...rest }: PanelHeaderRowProps): React.JSX.Element;
export default PanelFrame;
