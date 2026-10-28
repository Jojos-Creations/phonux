import * as React from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { createTheme, ThemeProvider, type Theme } from '@mui/material/styles';
import { PANEL_CORNER_RADIUS_UNITS } from './PanelFrame.js';

/**
 * The colors and corner radius the mount draws with, in the shadcn/Tailwind vocabulary. Every field is a CSS color or a px
 * count, so an app states its theme without importing a UI kit. The mount writes each field as a CSS custom property
 * (`--phonux-primary`, `--phonux-background`, `--phonux-foreground`, `--phonux-card`, `--phonux-border`, `--phonux-radius`) at
 * zero specificity on `:root`, and draws from those properties, so any stylesheet rule that sets one wins. @public
 */
export interface PhonuxTheme {
  /** The color scheme the values were made for. */
  readonly mode: 'light' | 'dark';
  /** The accent: focus rings and selected states. */
  readonly primary: string;
  /** The window behind the rows. */
  readonly background: string;
  /** Body text. */
  readonly foreground: string;
  /** Panel and header surfaces. */
  readonly card: string;
  /** Hairline dividers and the panel edge. */
  readonly border: string;
  /** A panel's corner radius, in px. */
  readonly radius: number;
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
    foreground: base.palette.text.primary,
    card: base.palette.background.paper,
    border: base.palette.divider,
    radius: PANEL_CORNER_RADIUS_UNITS * Number(base.shape.borderRadius),
  };
}

/** The custom properties `theme` stands for, keyed by property name. @internal */
export function phonuxCssVariables(theme: PhonuxTheme): Record<string, string> {
  return {
    '--phonux-primary': theme.primary,
    '--phonux-background': theme.background,
    '--phonux-foreground': theme.foreground,
    '--phonux-card': theme.card,
    '--phonux-border': theme.border,
    '--phonux-radius': `${theme.radius}px`,
  };
}

/**
 * Draws `children` under the styling the mount uses for `theme`, with its CssBaseline and the `--phonux-*` custom properties.
 * Use it where the row is rendered by hand, with `mount: false`. @public
 */
export function PhonuxThemeProvider({ theme, children }: { theme: PhonuxTheme; children?: React.ReactNode }): React.ReactElement {
  const styling = React.useMemo(() => muiThemeFor(theme), [theme]);
  return React.createElement(ThemeProvider, { theme: styling }, React.createElement(CssBaseline), children);
}

/**
 * The styling theme the mount renders with, built from a `PhonuxTheme`. Its palette and corner are `var(--phonux-*)`, so a
 * stylesheet override reaches every MUI component; `nativeColor` lets MUI derive hover and contrast shades from a variable
 * with CSS relative colors. The no-animation reset lives in MuiCssBaseline's styleOverrides, inert until CssBaseline renders
 * (https://github.com/mui/material-ui/issues/16483). It touches only `transition`/`animation`: slides write
 * `transform`/`opacity` directly, so an `!important` on either would freeze them silently. See DESIGN.md.
 * @internal
 */
export function muiThemeFor(theme: PhonuxTheme): Theme {
  return createTheme({
    // A prefix of its own keeps these variables apart from an app's MUI ones on the same :root; the page's color-scheme stays the app's.
    cssVariables: { nativeColor: true, cssVarPrefix: 'phonux-mui', disableCssColorScheme: true },
    palette: {
      mode: theme.mode,
      primary: { main: 'var(--phonux-primary)' },
      background: { default: 'var(--phonux-background)', paper: 'var(--phonux-card)' },
      text: { primary: 'var(--phonux-foreground)' },
      divider: 'var(--phonux-border)',
    },
    shape: { borderRadius: `calc(var(--phonux-radius) / ${PANEL_CORNER_RADIUS_UNITS})` },
    transitions: { create: () => 'none' },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':where(:root)': phonuxCssVariables(theme),
          // The column's slide element keeps its transition: WorkspaceColumn animates it with `transition: transform`, which
          // an `!important` reset here would zero (https://github.com/Jojos-Creations/phonux/issues/435).
          '*:not([data-workspace-column] > div), *::before, *::after': {
            transition: 'none !important',
            animation: 'none !important',
          },
        },
      },
      MuiButtonBase: { defaultProps: { disableRipple: true } },
    },
  });
}
