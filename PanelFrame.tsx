/**
 * The shared "phone" shape (owner reference, 2026-09-10): a tall, rounded
 * card every front-page section renders inside, so the sidebar, the input
 * form, and each search slot all read as the same uniform phone silhouette --
 * one component, not three near-identical border/radius/background
 * declarations drifting out of sync with each other.
 *
 * Always this one fixed size (owner decision, 2026-09-10: the row grows by
 * adding more phone-sized slots as the window widens, not by growing any
 * single slot) -- the `expanded` escape hatch is only for the tap-to-expand
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

/** Forwards its ref to the underlying Box -- callers doing position/size measurement need the real DOM node. */
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
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        flexShrink: 0,
        ...(expanded ? { width: '100%', height: '100%' } : { width: PHONE_WIDTH, height: PHONE_HEIGHT }),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
});

export default PhoneFrame;
