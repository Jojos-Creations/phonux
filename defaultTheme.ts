import { createTheme, type Theme } from '@mui/material/styles';

/**
 * An optional MUI theme for a consumer that embeds phonux views but has no theme of
 * its own. Opt-in only -- phonux never applies any theme implicitly. Wire it explicitly:
 *
 *   `<ThemeProvider theme={createDefaultTheme(mode)}><CssBaseline />...`
 *
 * Both are required: the no-animation reset below lives in MuiCssBaseline's
 * styleOverrides, which stay inert until CssBaseline is actually rendered
 * (ThemeProvider alone does not mount them -- https://github.com/mui/material-ui/issues/16483).
 *
 * Carries over phonUX's own no-motion rule (client/src/shared/theme/theme.ts) because a
 * consumer's phonux views run the same slide/enter-exit animations that rule targets.
 * The reset only ever touches `transition`/`animation`: panel slides write `transform`
 * and `opacity` directly (inline style and the Web Animations API), so an `!important`
 * on either here would freeze every slide with no error anywhere.
 *
 * Deliberately excludes phonUX's own brand palette, typography and per-component style
 * overrides -- those are product branding, not something a third-party consumer of this
 * package should inherit by taking the default.
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
