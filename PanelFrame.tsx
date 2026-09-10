/**
 * The shared "phone" shape (owner reference, 2026-09-10): a tall, rounded
 * card every front-page section renders inside, so the sidebar, the input
 * form, and each live view all read as the same uniform phone silhouette --
 * one component, not three near-identical border/radius/background
 * declarations drifting out of sync with each other.
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

export interface PhoneFrameProps extends Omit<BoxProps, 'children'> {
  children: React.ReactNode;
  /** Fill the available space instead of the fixed phone size (the tap-to-expand overlay). */
  expanded?: boolean;
}

export default function PhoneFrame({ children, expanded, sx, ...rest }: PhoneFrameProps) {
  return (
    <Box
      data-phone-frame=""
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
        ...(expanded
          ? { width: '100%', height: '100%' }
          : { width: PHONE_WIDTH, height: PHONE_HEIGHT }),
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
