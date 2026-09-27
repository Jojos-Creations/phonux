import { createTheme, type Theme } from '@mui/material/styles';

/**
 * An optional MUI theme for a consumer that embeds phonux views and has no theme of its own; phonux never
 * applies one implicitly. Wire both: `<ThemeProvider theme={createDefaultTheme(mode)}><CssBaseline />...`.
 * The no-animation reset lives in MuiCssBaseline's styleOverrides, inert until CssBaseline renders
 * (https://github.com/mui/material-ui/issues/16483). It touches only `transition`/`animation`: slides write
 * `transform`/`opacity` directly, so an `!important` on either would freeze them silently. See DESIGN.md.
 * @public
 */
export function createDefaultTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: { mode },
    transitions: { create: () => 'none' },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '*, *::before, *::after': {
            transition: 'none !important',
            animation: 'none !important',
          },
        },
      },
      MuiButtonBase: { defaultProps: { disableRipple: true } },
    },
  });
}
