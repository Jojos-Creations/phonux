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

/**
 * Loosely a modern smartphone's CSS-pixel viewport (iPhone 12/13/14's own
 * reported WIDTH -- the most commonly cited "standard phone" figure in
 * responsive design). A stand-in, not a real measurement: the owner's own
 * direction is that this becomes the connected device's ACTUAL screen size
 * once phone-size-auto-detection exists (plans/queue.yaml stub) -- nothing
 * here should assume every phone is this exact size going forward.
 *
 * Height is deliberately shorter than a real iPhone's (844) -- tall enough
 * to read as "phone-shaped", short enough that a default-height window has
 * spare room below one row of these, so the next row's tops peek into view
 * as a sign there's more below without having to scroll first to find out
 * (owner report, 2026-09-10).
 */
export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 700;

export interface PhoneFrameProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
  /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
  expanded?: boolean;
}

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
  return (
    <Box
      ref={ref}
      data-phone-frame=""
      {...rest}
      sx={{
        // border-box: PHONE_WIDTH/PHONE_HEIGHT must be the REAL rendered
        // size everywhere else in the codebase does width math against
        // them (GoalFrontPage's LEFT_WIDTH, columnsForWidth). Content-box
        // (the CSS default) would add this border+padding on top of that,
        // silently under-fitting every width computation by ~26px per
        // phone (owner report, 2026-09-10 -- confirmed via
        // getBoundingClientRect() reporting 416px against an intended 390).
        boxSizing: 'border-box',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 4,
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
        ...(expanded ? { width: '100%', height: '100%' } : { width: PHONE_WIDTH, height: PHONE_HEIGHT }),
      }}
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          p: 1.5,
          // Forces a classic (non-overlay) scrollbar -- see this file's own
          // header comment for why the overlay default can't be fixed by
          // box-model/padding changes alone. Track is transparent (the
          // frame's own bgcolor shows through); thumb is a plain, low-
          // contrast fill that doesn't compete with real content.
          '&::-webkit-scrollbar': {
            width: 8,
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255, 255, 255, 0.25)',
            borderRadius: 4,
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: 'rgba(255, 255, 255, 0.4)',
          },
          ...sx,
        }}
      >
        {children}
      </Box>
    </Box>
  );
});

export default PhoneFrame;
