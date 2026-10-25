import * as React from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { createTheme, ThemeProvider } from '@mui/material/styles';
/**
 * The theme the mount draws when `createWorkspace` is given no `theme` option, and a start for an app's own: the function the
 * option takes can return this theme changed.
 * @public
 */
export function createDefaultTheme(mode) {
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
export function PhonuxThemeProvider({ theme, children }) {
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
export function muiThemeFor(theme) {
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
            MuiButtonBase: { defaultProps: { disableRipple: true } },
        },
    });
}
