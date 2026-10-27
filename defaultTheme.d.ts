import * as React from 'react';
import { type Theme } from '@mui/material/styles';
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
export declare function createDefaultTheme(mode: 'light' | 'dark'): PhonuxTheme;
/**
 * Draws `children` under the styling the mount uses for `theme`, with its CssBaseline. Use it where the row is rendered by hand,
 * with `mount: false`. @public
 */
export declare function PhonuxThemeProvider({ theme, children }: {
    theme: PhonuxTheme;
    children?: React.ReactNode;
}): React.ReactElement;
/**
 * The styling theme the mount renders with, built from a `PhonuxTheme`. The no-animation reset lives in MuiCssBaseline's
 * styleOverrides, inert until CssBaseline renders (https://github.com/mui/material-ui/issues/16483). It touches only
 * `transition`/`animation`: slides write `transform`/`opacity` directly, so an `!important` on either would freeze them
 * silently. See DESIGN.md.
 * @internal
 */
export declare function muiThemeFor(theme: PhonuxTheme): Theme;
