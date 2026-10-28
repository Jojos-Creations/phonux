import * as React from 'react';
import { type Theme } from '@mui/material/styles';
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
export declare function createDefaultTheme(mode: 'light' | 'dark'): PhonuxTheme;
/** The custom properties `theme` stands for, keyed by property name. @internal */
export declare function phonuxCssVariables(theme: PhonuxTheme): Record<string, string>;
/**
 * Draws `children` under the styling the mount uses for `theme`, with its CssBaseline and the `--phonux-*` custom properties.
 * Use it where the row is rendered by hand, with `mount: false`. @public
 */
export declare function PhonuxThemeProvider({ theme, children }: {
    theme: PhonuxTheme;
    children?: React.ReactNode;
}): React.ReactElement;
/**
 * The styling theme the mount renders with, built from a `PhonuxTheme`. Its palette and corner are `var(--phonux-*)`, so a
 * stylesheet override reaches every MUI component; `nativeColor` lets MUI derive hover and contrast shades from a variable
 * with CSS relative colors. The no-animation reset lives in MuiCssBaseline's styleOverrides, inert until CssBaseline renders
 * (https://github.com/mui/material-ui/issues/16483). It touches only `transition`/`animation`: slides write
 * `transform`/`opacity` directly, so an `!important` on either would freeze them silently. See DESIGN.md.
 * @internal
 */
export declare function muiThemeFor(theme: PhonuxTheme): Theme;
