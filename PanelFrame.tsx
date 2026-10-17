/**
 * The shared phone-shaped card every view renders inside, so every section reads as one
 * silhouette instead of near-identical border/radius/background declarations drifting apart.
 * Fixed size by default; `expanded` is only the tap-to-expand fullscreen overlay. The frame's border, size and
 * header-pill rules are explained in DESIGN.md ("PanelFrame's inset, scrollbar and header pill").
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useOptionalHost, type PanelSize } from './hostApi.js';
import { usePhoneSize } from './phoneFit.js';
import { resolveLabels } from './labels.js';
import { PanelFooter } from './panelFooter.js';
import { useFrameClaim } from './panelFrameClaim.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { useChromePixels } from './panelChrome.js';
import { glideCorner, glideEdge } from './sizeGlide.js';

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

/** The phone's corner radius in theme shape units (4 x 6px = 24px). The frame's corners and the header
 * pills' semicircular ends both derive from it, so they cannot drift apart. @public */
export const PANEL_CORNER_RADIUS_UNITS = 4;
/** That radius in px for `theme`; a header pill is twice this tall (exact semicircles). @public */
export const panelCornerRadiusPx = (theme: Theme): number => PANEL_CORNER_RADIUS_UNITS * Number(theme.shape.borderRadius);

/**
 * No effect. PanelFrame no longer styles its content, so there is nothing to cancel; the export stays so
 * existing imports keep compiling.
 * @deprecated Remove the spread. PanelFrame applies no padding or scrollbar to its content.
 * @public
 */
export const panelFrameBareSx = {} as const;

/**
 * Two nested boxes: the OUTER owns border, radius and size and clips to the rounded corner; the INNER is a
 * plain flex column for the view's own content, styled only by the `sx` prop. Padding and scrolling inside
 * are the view's (DESIGN.md).
 * @public
 */
const PanelFrame = React.forwardRef<HTMLDivElement, PanelFrameProps>(function PanelFrame(
  { children, expanded, size, footer = true, sx, ...rest },
  ref,
) {
  useFrameClaim('frame');
  const phone = usePhoneSize();
  const drawn = React.useContext(PanelSlotContext)?.drawn;
  const width = size?.width ?? drawn?.width ?? phone.width;
  const height = size?.height === 'fill' ? '100%' : (size?.height ?? drawn?.height ?? phone.height);
  const frame = (
    <Box
      ref={ref}
      data-phone-frame=""
      {...rest}
      sx={{
        // border-box: row-layout width math elsewhere treats the phone size as this box's real
        // rendered size; content-box would add border+padding on top, silently under-fitting.
        boxSizing: 'border-box',
        // The 1 px edge is an inset shadow, not a border, so the size glide can keep it 1 px drawn without moving the layout.
        p: '1px',
        boxShadow: (theme: Theme) => glideEdge(theme.palette.divider),
        borderRadius: (theme: Theme) => glideCorner(panelCornerRadiusPx(theme)),
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        ...(expanded ? { width: '100%', height: '100%' } : { width, height }),
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          ...sx,
        }}
      >
        {children}
      </Box>
    </Box>
  );
  // The footer is a sibling of the frame, not its child, so the frame's overflow clip cannot cut it off.
  return footer ? (
    <>
      {frame}
      <PanelFooter />
    </>
  ) : frame;
});

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
export function PanelHeader({ children, sx, ...rest }: PanelHeaderProps) {
  const chrome = useChromePixels();
  return (
    <Box
      {...rest}
      sx={{
        position: 'absolute',
        bottom: `calc(100% + ${chrome.headerGapPx}px)`,
        left: 0,
        right: 0,
        // Twice the phone's own corner radius, so each end is an exact semicircle; from the theme, never a
        // raw 48. Fixed, so however the content wraps the pill keeps its shape.
        height: (theme: Theme) => 2 * panelCornerRadiusPx(theme),
        display: 'flex',
        alignItems: 'center',
        // bgcolor + border: MUI Paper variant="outlined"'s look, shaped as a pill.
        bgcolor: 'background.paper',
        // An inset shadow, not a border (see PanelFrame), so the padding gives the 1 px back.
        boxShadow: (theme: Theme) => glideEdge(theme.palette.divider),
        borderRadius: (theme: Theme) => glideCorner(panelCornerRadiusPx(theme)),
        px: `${chrome.headerInsetPx}px`,
        py: '1px',
        fontSize: 13,
        color: 'common.white',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

/** The props of `PanelHeaderRow`: every `PanelHeader` prop except `children` and `title`, plus `title` and `actions`. @public */
export interface PanelHeaderRowProps extends Omit<PanelHeaderProps, 'children' | 'title'> {
  /** Left-aligned, ellipsis-truncated. Falsy renders a placeholder ("Untitled") instead of
   * nothing, so the pill never blanks for a view with no title yet. */
  title: React.ReactNode;
  /** Right-aligned, never truncated. Falsy renders a placeholder icon slot instead of nothing,
   * so a conditional like `isRunning && <IconButton .../>` still keeps the pill's full shape. */
  actions?: React.ReactNode;
  /** Left of the title, never truncated. Nothing is drawn for it when it is omitted. */
  leading?: React.ReactNode;
}

/** Deliberately narrow (mirrors JSX's own falsy-child rules, not a general emptiness check) so a
 * real value like `0` or whitespace is never mistaken for "no content". */
function isEmptyHeaderContent(node: React.ReactNode): boolean {
  return node === undefined || node === null || node === false || node === '';
}

/** A dimmed "Untitled" reads as "intentionally blank" rather than a loading glitch or missing data. */
const placeholderTitle = (text: string) => (
  <Box component="span" data-header-placeholder-title="" sx={{ color: 'text.disabled' }}>
    {text}
  </Box>
);

/** A dimmed "more" glyph reads as "no actions here" rather than a missing icon, and keeps the
 * row's right edge occupied so the pill's shape never depends on whether any were passed. */
const PLACEHOLDER_ACTIONS = (
  <Box
    data-header-placeholder-action=""
    aria-hidden="true"
    sx={{ display: 'flex', alignItems: 'center', color: 'text.disabled' }}
  >
    <MoreHorizIcon fontSize="small" />
  </Box>
);

/**
 * The title-left/actions-right row shape every PanelHeader caller wants, as one shared layout
 * instead of each call site reimplementing near-identical flex/ellipsis markup. Placeholder
 * substitution lives HERE, not in each caller, so every caller gets it for free.
 * @public
 */
export function PanelHeaderRow({ title, actions, leading, sx, ...rest }: PanelHeaderRowProps) {
  const labels = resolveLabels(useOptionalHost()?.labels);
  const resolvedTitle = isEmptyHeaderContent(title) ? placeholderTitle(labels.untitledHeader) : title;
  const resolvedActions = isEmptyHeaderContent(actions) ? PLACEHOLDER_ACTIONS : actions;
  return (
    <PanelHeader {...rest} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, ...sx }}>
      {leading}
      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{resolvedTitle}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{resolvedActions}</Box>
    </PanelHeader>
  );
}

export default PanelFrame;
