import { createTheme } from '@mui/material/styles';
/**
 * The MUI theme the mount draws when `createWorkspace` is given no `theme` option, and a start for an app's own: the function the
 * option takes can return this theme changed. Embedding views by hand, wire both: `<ThemeProvider theme={createDefaultTheme(mode)}><CssBaseline />...`.
 * The no-animation reset lives in MuiCssBaseline's styleOverrides, inert until CssBaseline renders
 * (https://github.com/mui/material-ui/issues/16483). It touches only `transition`/`animation`: slides write
 * `transform`/`opacity` directly, so an `!important` on either would freeze them silently. See DESIGN.md.
 * @public
 */
export function createDefaultTheme(mode) {
    return createTheme({
        palette: { mode },
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
