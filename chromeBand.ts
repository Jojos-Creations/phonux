import type { Theme } from '@mui/material/styles';

const BAND_CORNER_UNITS = 2;

/**
 * The solid band under a panel's header and footer: the frame's own surface and edge, opaque, so their words read the
 * same over any page or background picture behind the row.
 */
export const chromeBandSx = {
  bgcolor: 'background.paper',
  boxShadow: (theme: Theme) => `inset 0 0 0 1px ${theme.palette.divider}`,
  borderRadius: (theme: Theme) => {
    const unit = theme.shape.borderRadius;
    return typeof unit === 'number' ? `${BAND_CORNER_UNITS * unit}px` : `calc(${BAND_CORNER_UNITS} * ${unit})`;
  },
} as const;
