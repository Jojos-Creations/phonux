/**
 * The shared "phone" shape (owner reference, 2026-09-10): a tall, rounded
 * card every front-page section renders inside, so the sidebar, the input
 * form, and each live view all read as the same uniform phone silhouette --
 * one component, not three near-identical border/radius/background
 * declarations drifting out of sync with each other.
 *
 * Three fixed sizes, not a fluid one: a lone live view grows into the
 * biggest tier that still fits the available width (owner decision,
 * 2026-09-10) rather than staying phone-sized in a sea of empty space.
 */

import * as React from 'react';
import Box, { type BoxProps } from '@mui/material/Box';

/**
 * A typical modern smartphone's CSS-pixel viewport (iPhone 12/13/14's own
 * reported size -- the most commonly cited "standard phone" figure in
 * responsive design). A stand-in, not a real measurement: the owner's own
 * direction is that this becomes the connected device's ACTUAL screen size
 * once phone-size-auto-detection exists (plans/queue.yaml stub) -- nothing
 * here should assume every phone is this exact size going forward.
 */
export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 844;

/** iPad portrait's CSS viewport -- the same "common tablet width" GoalFrontPage caps the pre-submit form at. */
export const TABLET_WIDTH = 768;
export const TABLET_HEIGHT = 1024;

/** A common laptop/desktop CSS viewport. */
export const DESKTOP_WIDTH = 1440;
export const DESKTOP_HEIGHT = 900;

export type PhoneFrameSize = 'phone' | 'tablet' | 'desktop';

export const SIZE_DIMENSIONS: Record<PhoneFrameSize, { width: number; height: number }> = {
  phone: { width: PHONE_WIDTH, height: PHONE_HEIGHT },
  tablet: { width: TABLET_WIDTH, height: TABLET_HEIGHT },
  desktop: { width: DESKTOP_WIDTH, height: DESKTOP_HEIGHT },
};

/** The biggest size tier whose width still fits within `availableWidth`. */
export function sizeForWidth(availableWidth: number): PhoneFrameSize {
  if (availableWidth >= DESKTOP_WIDTH) return 'desktop';
  if (availableWidth >= TABLET_WIDTH) return 'tablet';
  return 'phone';
}

export interface PhoneFrameProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
  /** Which fixed size to render at. Default 'phone'. */
  size?: PhoneFrameSize;
  /** Fill the available space instead of the fixed size (the tap-to-expand overlay). */
  expanded?: boolean;
}

/** Forwards its ref to the underlying Box -- callers (e.g. a FLIP position animation) need the real DOM node. */
const PhoneFrame = React.forwardRef<HTMLDivElement, PhoneFrameProps>(function PhoneFrame(
  { children, size = 'phone', expanded, sx, ...rest },
  ref,
) {
  const { width, height } = SIZE_DIMENSIONS[size];
  return (
    <Box
      ref={ref}
      data-phone-frame=""
      data-phone-frame-size={size}
      {...rest}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 4,
        bgcolor: 'background.paper',
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
        flexShrink: 0,
        ...(expanded ? { width: '100%', height: '100%' } : { width, height }),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
});

export default PhoneFrame;
