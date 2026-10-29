import type * as React from 'react';
/**
 * A style a consumer passes to a library element: camelCase CSS properties, string or number values, and nested keys for
 * selectors such as `'&:active'`. A plain object, read by the library's own styling; no UI kit's theme tokens. @public
 */
export type CssStyle = {
    readonly [property: string]: string | number | CssStyle | undefined;
};
/** The props a library element takes on its root: the DOM attributes, a `ref`, and `sx` as a `CssStyle`. @public */
export type ElementProps = React.HTMLAttributes<HTMLElement> & {
    ref?: React.Ref<HTMLElement>;
    sx?: CssStyle;
};
