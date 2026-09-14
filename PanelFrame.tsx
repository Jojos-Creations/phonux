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
import { usePhoneSize } from './phoneSize.js';

/**
 * phone-size-auto-detection: the fixed 390x700 stand-in this comment used to
 * describe now lives as DEFAULT_PHONE_SIZE in phoneSize.ts, read reactively
 * here via usePhoneSize() -- the connected device's actual screen size (USB
 * popup) or a Settings-chosen model overrides it from there. Nothing here
 * assumes every phone is one fixed size.
 */

export interface PhoneFrameProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
  /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
  expanded?: boolean;
}

/** The classic (non-overlay) scrollbar this app draws for itself, in px. */
const SCROLLBAR_PX = 8;
/** How far content sits from the frame's own border, on every side, in px. */
const CONTENT_INSET_PX = 12;

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
export const phoneFrameScrollSx = {
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
export const phoneFrameBareSx = {
  pt: 0,
  pr: 0,
  pb: 0,
  pl: 0,
  overflowX: 'hidden',
  overflowY: 'hidden',
  scrollbarGutter: 'auto',
} as const;

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
const PhoneFrame = React.forwardRef<HTMLDivElement, PhoneFrameProps>(function PhoneFrame(
  { children, expanded, sx, ...rest },
  ref,
) {
  const { width, height } = usePhoneSize();
  return (
    <Box
      ref={ref}
      data-phone-frame=""
      {...rest}
      sx={{
        // border-box: the current phone size must be the REAL rendered size
        // everywhere else in the codebase does width math against it
        // (GoalFrontPage's usePhoneSize() usages). Content-box (the CSS
        // default) would add this border+padding on top of that, silently
        // under-fitting every width computation by ~26px per phone (owner
        // report, 2026-09-10 -- confirmed via getBoundingClientRect()
        // reporting 416px against an intended 390).
        boxSizing: 'border-box',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 4,
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
          ...phoneFrameScrollSx,
          ...sx,
        }}
      >
        {children}
      </Box>
    </Box>
  );
});

export interface PhoneFrameHeaderProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
}

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
 * Provides positioning/spacing/color only -- `px` matches PhoneFrame's own
 * inner content padding exactly (owner report, 2026-09-13: the border
 * padding wasn't consistent -- this header's text sat at a different inset
 * than the frame's own rows below it) so a header's text lines up with the
 * frame's own content, not just "some padding" picked independently -- not
 * internal layout, since one caller needs a centered ellipsis title and
 * another needs a space-between icon row; pass `sx` for that.
 */
export function PhoneFrameHeader({ children, sx, ...rest }: PhoneFrameHeaderProps) {
  return (
    <Box
      {...rest}
      sx={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        left: 0,
        right: 0,
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

export interface PhoneFrameHeaderRowProps extends Omit<PhoneFrameHeaderProps, 'children' | 'title'> {
  /** Left-aligned primary content -- ellipsis-truncated if it overflows. */
  title: React.ReactNode;
  /**
   * Right-aligned content (icon buttons, a status badge, ...) -- never
   * truncated, laid out in its own row so multiple actions space themselves
   * correctly. Falsy (undefined/null/false) renders nothing on the right,
   * so a caller can pass a conditional like `isRunning && <IconButton .../>`
   * directly.
   */
  actions?: React.ReactNode;
}

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
 */
export function PhoneFrameHeaderRow({ title, actions, sx, ...rest }: PhoneFrameHeaderRowProps) {
  return (
    <PhoneFrameHeader {...rest} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, ...sx }}>
      <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{title}</Box>
      {actions ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{actions}</Box> : null}
    </PhoneFrameHeader>
  );
}

export default PhoneFrame;
