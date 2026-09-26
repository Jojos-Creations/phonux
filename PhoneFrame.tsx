/**
 * The shared "phone" shape (owner reference, 2026-09-10): a tall, rounded
 * card every front-page section renders inside, so the sidebar, the input
 * form, and each search slot all read as the same uniform phone silhouette --
 * one component, not three near-identical border/radius/background
 * declarations drifting out of sync with each other.
 *
 * Always this one fixed size (owner decision, 2026-09-10: slots don't grow
 * to fill space) -- the `expanded` escape hatch is only for the tap-to-expand
 * fullscreen overlay.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useHost } from './phoneViewApi.js';

/**
 * phone-size-auto-detection: the fixed 390x700 stand-in this comment used to
 * describe now lives as DEFAULT_PHONE_SIZE in phoneViewApi.tsx, read reactively
 * here via useHost().device.size -- the connected device's actual screen size (USB
 * popup) or a Settings-chosen model overrides it from there. Nothing here
 * assumes every phone is one fixed size.
 */

export interface PanelFrameProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
  /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
  expanded?: boolean;
}

/** @deprecated use PanelFrameProps */
export type PhoneFrameProps = PanelFrameProps;

/** The classic (non-overlay) scrollbar this app draws for itself, in px. */
const SCROLLBAR_PX = 8;
/** How far content sits from the frame's own border, on every side, in px. */
const CONTENT_INSET_PX = 12;
/** The phone's corner radius in theme shape units (4 x 6px = 24px). The frame's corners and the header
 * pills' semicircular ends both derive from it, so they cannot drift apart. */
export const PANEL_CORNER_RADIUS_UNITS = 4;
/** @deprecated use PANEL_CORNER_RADIUS_UNITS */
export const PHONE_CORNER_RADIUS_UNITS = PANEL_CORNER_RADIUS_UNITS;
/** That radius in px for `theme`; a header pill is twice this tall (exact semicircles). */
export const panelCornerRadiusPx = (theme: Theme): number => PANEL_CORNER_RADIUS_UNITS * Number(theme.shape.borderRadius);
/** @deprecated use panelCornerRadiusPx */
export const phoneCornerRadiusPx = panelCornerRadiusPx;

/**
 * Everything a scrolling box inside a phone needs so its content is inset
 * the SAME distance from the frame's border on every side, whether or not a
 * scrollbar happens to be showing right now (owner report, 2026-09-13: "the
 * borders still do not match consistently across views", and then "views
 * should have alternate paddings for when the scroll bar shows or doesn't").
 *
 * How the two states end up identical, rather than by measuring anything at
 * runtime: `scrollbar-gutter: stable` reserves the scrollbar's own strip
 * between the border and the padding box permanently, so the strip is there
 * whether or not a bar is painted in it -- and this box's own right padding
 * is reduced by exactly that strip's width. Right side is therefore
 * (12 - 8) + 8 = 12px in both states, matching the plain 12px on the other
 * three sides, with the bar itself flush against the frame's border (owner
 * report, 2026-09-13, wanting the webview panel's own look).
 *
 * Nested scrollers need their own copy of the `::-webkit-scrollbar` rules --
 * those style the scrollbar OF the element they're set on, so an inner
 * scrolling box that skipped them would fall back to Chromium's own
 * default-width bar and blow the arithmetic above.
 */
export const panelFrameScrollSx = {
  overflowX: 'hidden',
  overflowY: 'auto',
  scrollbarGutter: 'stable',
  pt: `${CONTENT_INSET_PX}px`,
  pb: `${CONTENT_INSET_PX}px`,
  pl: `${CONTENT_INSET_PX}px`,
  pr: `${CONTENT_INSET_PX - SCROLLBAR_PX}px`,
  // Forces a classic (non-overlay) scrollbar -- see this file's own header
  // comment for why the overlay default can't be fixed by box-model/padding
  // changes alone. Track is transparent (the frame's own bgcolor shows
  // through); thumb is a plain, low-contrast fill that doesn't compete with
  // real content.
  '&::-webkit-scrollbar': { width: SCROLLBAR_PX },
  '&::-webkit-scrollbar-track': { background: 'transparent' },
  '&::-webkit-scrollbar-thumb': {
    background: 'rgba(255, 255, 255, 0.25)',
    borderRadius: SCROLLBAR_PX / 2,
  },
  '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255, 255, 255, 0.4)' },
} as const;
/** @deprecated use panelFrameScrollSx */
export const phoneFrameScrollSx = panelFrameScrollSx;

/**
 * For a caller that does its own scrolling one level deeper (a transcript
 * that scrolls under a pinned input bar, a `<webview>` that scrolls itself):
 * cancels PhoneFrame's own padding AND its reserved scrollbar strip, so
 * neither is reserved twice. Reserving twice is exactly the bug the owner
 * caught on 2026-09-13 -- a phantom 8px gap outside the scrollbar, and a
 * right-hand inset of 28px against the left's 12px.
 *
 * Every property here is a longhand on purpose: MUI resolves `p` and `pr`
 * (and `overflow` vs `overflowY`) independently, so a shorthand spread over
 * a longhand does not reliably win.
 */
export const panelFrameBareSx = {
  pt: 0,
  pr: 0,
  pb: 0,
  pl: 0,
  overflowX: 'hidden',
  overflowY: 'hidden',
  scrollbarGutter: 'auto',
} as const;
/** @deprecated use panelFrameBareSx */
export const phoneFrameBareSx = panelFrameBareSx;

/**
 * Two nested boxes, not one (owner report, 2026-09-13: the scrollbar sat
 * inset from the phone's own rounded edge, with a visible gap on both sides
 * of it, instead of flush against the border like the webview panel's own
 * scrollbar). The OUTER box owns the border/radius/size and clips to the
 * rounded corners (`overflow: hidden`) but carries NO padding of its own;
 * the INNER box owns the padding and is the actual `overflow: auto` scroll
 * container, sized to fill the outer box exactly (`flex: 1`, `minHeight: 0`).
 *
 * That box-model split alone was NOT sufficient (measured live, 2026-09-13,
 * after the owner reported the gap was still there): `inner.offsetWidth ===
 * inner.clientWidth` even with real overflowing content confirmed this is
 * Chromium's OVERLAY-style scrollbar (floats over content, reserves no
 * layout width) -- and an overlay scrollbar renders with its own built-in
 * inset margin from the scrolling element's edge, which no amount of
 * padding/box-model change on OUR side can remove; it's the browser's own
 * scrollbar chrome, not part of the boxes we control. Fixed with explicit
 * `::-webkit-scrollbar` rules below, which force a CLASSIC (non-overlay)
 * scrollbar that Chromium renders flush against the scrolling element's own
 * edge -- confirmed the classic scrollbar reserves real layout width
 * (`offsetWidth - clientWidth` now equals the declared `width` below) and
 * sits flush, matching the live-webpage panel's own real browser scrollbar.
 */
const PanelFrame = React.forwardRef<HTMLDivElement, PanelFrameProps>(function PanelFrame(
  { children, expanded, sx, ...rest },
  ref,
) {
  const { width, height } = useHost().device.size;
  return (
    <Box
      ref={ref}
      data-phone-frame=""
      {...rest}
      sx={{
        // border-box: the current phone size must be the REAL rendered size
        // everywhere else in the codebase does width math against it
        // (GoalFrontPage's row layout, from device.size). Content-box (the CSS
        // default) would add this border+padding on top of that, silently
        // under-fitting every width computation by ~26px per phone (owner
        // report, 2026-09-10 -- confirmed via getBoundingClientRect()
        // reporting 416px against an intended 390).
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
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          ...panelFrameScrollSx,
          ...sx,
        }}
      >
        {children}
      </Box>
    </Box>
  );
});

export interface PanelHeaderProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
}

/** @deprecated use PanelHeaderProps */
export type PhoneFrameHeaderProps = PanelHeaderProps;

/**
 * The shared shape for a header that floats ABOVE a PhoneFrame rather than
 * inside it -- the session title and ActStatusBar (GoalFrontPage.tsx) and
 * the Sessions sidebar's title+icons (PreviousSessionsSidebar.tsx) all used
 * their own near-identical `position: absolute; bottom: calc(100% + 4px)`
 * block before this (owner direction, 2026-09-13: "make a universal header
 * component so the style stays consistent across views"). Requires its
 * parent to be `position: relative` (every caller already wraps its
 * PhoneFrame in one, for exactly this).
 *
 * front-page-unify-panel-header-visual-style (owner, 2026-09-14, pointing at
 * the live app: "every header [should be] a circular like input with one or
 * two icons aligned to the right ... They should all use the same reusable
 * component"): until then this component only provided position/spacing/
 * color, never a shared LOOK. Now a real pill, baked in once: `bgcolor` +
 * `border` are MUI's `Paper variant="outlined"` look (a plain `Box` only
 * because `Paper`'s polymorphic `component` typing collides with this
 * component's `Omit<BoxProps, ...>` props), the goal-input bar's pill.
 *
 * Shape (owner, 2026-09-20: "have the rounding match the phone views and
 * have the height form a perfect half circle on the left and right"): the
 * radius is the phone's own (PHONE_CORNER_RADIUS_UNITS) and the height is
 * twice it (phoneCornerRadiusPx), so each end is an exact semicircle with
 * the phone's curvature; both derive from the theme, never a raw 24/48.
 * The fixed height keeps the pill the same however its content wraps.
 *
 * `px` matches PhoneFrame's own inner content padding exactly (owner report,
 * 2026-09-13: the border padding wasn't consistent -- this header's text sat
 * at a different inset than the frame's own rows below it) so a header's
 * text lines up with the frame's own content, not just "some padding" picked
 * independently -- not internal layout, since one caller needs a centered
 * ellipsis title and another needs a space-between icon row; pass `sx` for
 * that (genuinely per-instance styling like `fontWeight: 'bold'` or
 * `cursor: 'grab'` layers on top of, rather than replacing, this base).
 */
export function PanelHeader({ children, sx, ...rest }: PanelHeaderProps) {
  return (
    <Box
      {...rest}
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        left: 0,
        right: 0,
        height: (theme: Theme) => 2 * panelCornerRadiusPx(theme),
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: PANEL_CORNER_RADIUS_UNITS,
        px: 1.5,
        fontSize: 13,
        color: 'common.white',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

/** @deprecated use PanelHeader */
export const PhoneFrameHeader = PanelHeader;

export interface PanelHeaderRowProps extends Omit<PanelHeaderProps, 'children' | 'title'> {
  /**
   * Left-aligned primary content -- ellipsis-truncated if it overflows.
   * Falsy (undefined/null/false/'') renders a placeholder ("Untitled")
   * instead, so the pill never shrinks or blanks out for a view with no
   * real title yet (owner follow-up, 2026-09-14: "if the view has no title
   * or icon put placeholders").
   */
  title: React.ReactNode;
  /**
   * Right-aligned content (icon buttons, a status badge, ...) -- never
   * truncated, laid out in its own row so multiple actions space themselves
   * correctly. Falsy (undefined/null/false/'') renders a placeholder icon
   * slot instead of nothing, so a caller can still pass a conditional like
   * `isRunning && <IconButton .../>` directly and the pill keeps its full
   * shape either way (owner follow-up, 2026-09-14, same instruction as
   * `title` above).
   */
  actions?: React.ReactNode;
}

/** @deprecated use PanelHeaderRowProps */
export type PhoneFrameHeaderRowProps = PanelHeaderRowProps;

/** True for the exact "nothing real here" values PhoneFrameHeaderRow treats
 * as empty -- deliberately narrow (mirrors JSX's own falsy-child rules, not
 * a general emptiness check) so a real value like `0` or whitespace is never
 * mistaken for "no content". */
function isEmptyHeaderContent(node: React.ReactNode): boolean {
  return node === undefined || node === null || node === false || node === '';
}

/** Owner follow-up, 2026-09-14 (same conversation as the pill request): "if
 * the view has no title or icon put placeholders" -- a plain em-dash reads
 * as "intentionally blank" rather than a loading glitch or missing data. */
const PLACEHOLDER_TITLE = (
  <Box component="span" data-header-placeholder-title="" sx={{ color: 'text.disabled' }}>
    Untitled
  </Box>
);

/** Same owner follow-up as PLACEHOLDER_TITLE, for the action slot -- a
 * dimmed "more" glyph reads as "no actions here" rather than a missing
 * icon/broken layout, and keeps the row's right edge occupied so the pill's
 * height/shape never depends on whether a caller happened to pass any. */
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
 * The title-left/actions-right row shape every PhoneFrameHeader caller
 * actually wants (owner report, 2026-09-13: "a reusable component is not
 * being used between each view" -- PhoneFrameHeader itself only ever
 * provided position/spacing/color, so the sidebar, the webview pane's
 * ActStatusBar and the chat panel's session-title header had each grown
 * their own near-identical inline `display: flex; justifyContent:
 * space-between` + ellipsis-Box markup, the same drift this file's own
 * top-of-file doc comment already named as the reason PhoneFrame itself
 * exists). One shared row layout, parameterized by `title`/`actions`,
 * rather than three call sites reimplementing it.
 *
 * Placeholder substitution lives HERE, not in each caller, so every caller
 * gets it for free (owner follow-up, 2026-09-14) -- see isEmptyHeaderContent
 * and the two PLACEHOLDER_* constants above.
 */
export function PanelHeaderRow({ title, actions, sx, ...rest }: PanelHeaderRowProps) {
  const resolvedTitle = isEmptyHeaderContent(title) ? PLACEHOLDER_TITLE : title;
  const resolvedActions = isEmptyHeaderContent(actions) ? PLACEHOLDER_ACTIONS : actions;
  return (
    <PanelHeader {...rest} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, ...sx }}>
      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{resolvedTitle}</Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{resolvedActions}</Box>
    </PanelHeader>
  );
}

/** @deprecated use PanelHeaderRow */
export const PhoneFrameHeaderRow = PanelHeaderRow;

export default PanelFrame;
