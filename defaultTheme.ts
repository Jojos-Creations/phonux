import * as React from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';

/**
 * The colors and corner unit the mount draws with. Every field is a CSS color or a px count, so an app states its theme
 * without importing a UI kit. The mount builds its own styling theme from these fields (`muiThemeFor`). @public
 */
export interface PhonuxTheme {
  /** The color scheme the values were made for. */
  readonly mode: 'light' | 'dark';
  /** The accent: focus rings and selected states. */
  readonly primary: string;
  /** The window behind the rows. */
  readonly background: string;
  /** Panel and header surfaces. */
  readonly paper: string;
  /** Body text. */
  readonly text: string;
  /** Hairline dividers and the panel edge. */
  readonly divider: string;
  /** One unit of a panel's corner radius, in px; a corner is four units (`panelCornerRadiusPx`). */
  readonly radiusUnitPx: number;
}

/**
 * The theme the mount draws when `createWorkspace` is given no `theme` option, and a start for an app's own: the function the
 * option takes can return this theme changed.
 * @public
 */
export function createDefaultTheme(mode: 'light' | 'dark'): PhonuxTheme {
  const base = createTheme({ palette: { mode } });
  return {
    mode,
    primary: base.palette.primary.main,
    background: base.palette.background.default,
    paper: base.palette.background.paper,
    text: base.palette.text.primary,
    divider: base.palette.divider,
    radiusUnitPx: Number(base.shape.borderRadius),
  };
}

/**
 * Draws `children` under the styling the mount uses for `theme`, with its CssBaseline. Use it where the row is rendered by hand,
 * with `mount: false`. @public
 */
export function PhonuxThemeProvider({ theme, children }: { theme: PhonuxTheme; children?: React.ReactNode }): React.ReactElement {
  const styling = React.useMemo(() => muiThemeFor(theme), [theme]);
  return React.createElement(ThemeProvider, { theme: styling }, React.createElement(CssBaseline), children);
}

/**
 * The styling theme the mount renders with, built from a `PhonuxTheme`. The no-animation reset lives in MuiCssBaseline's
 * styleOverrides, inert until CssBaseline renders (https://github.com/mui/material-ui/issues/16483). It touches only
 * `transition`/`animation`: slides write `transform`/`opacity` directly, so an `!important` on either would freeze them
 * silently. See DESIGN.md.
 * @internal
 */
export function muiThemeFor(theme: PhonuxTheme): Theme {
  return createTheme({
    palette: {
      mode: theme.mode,
      primary: { main: theme.primary },
      background: { default: theme.background, paper: theme.paper },
      text: { primary: theme.text },
      divider: theme.divider,
    },
    shape: { borderRadius: theme.radiusUnitPx },
    transitions: { create: () => 'none' },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // The column's slide element keeps its transition: WorkspaceColumn animates it with `transition: transform`, which
          // an `!important` reset here would zero (https://github.com/Jojos-Creations/phonux/issues/435).
          '*:not([data-workspace-column] > div), *::before, *::after': {
            transition: 'none !important',
            animation: 'none !important',
          },
        },
      },
      // Mounted but never shown. With disableRipple, ButtonBase's blur handler queues each FocusEvent on a ripple promise that
      // never resolves, keeping every event's target and relatedTarget (closed panels included) alive for the page's life.
      MuiButtonBase: { defaultProps: { disableTouchRipple: true }, styleOverrides: { root: { '& .MuiTouchRipple-root': { display: 'none' } } } },
    },
  });
}
