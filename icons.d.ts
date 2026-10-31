import * as React from 'react';
/**
 * Every icon the library draws itself, so a host swaps in its own set instead of forking a component. Each is any React
 * node, drawn in the place of the default at the same spot; the defaults are small inline SVGs in `currentColor`.
 * @public
 */
export interface PhonuxIcons {
    /** The grip on a panel's grab strip. Default a six-dot drag indicator. */
    grab: React.ReactNode;
    /** The dimmed glyph a header with no actions shows at its right edge. Default three dots in a row. */
    noActions: React.ReactNode;
    /** The width that is `slots` phones wide, in the width control. Default a phone, fold, tablet, desktop and ultrawide monitor, then the desktop. */
    size: (slots: number) => React.ReactNode;
    /** The width control's entry that grows the panel to fill the window, and its button while the panel fills it. Default four corners. */
    fullscreen: React.ReactNode;
}
/** The icons the library draws when a host overrides none. @internal */
export declare const DEFAULT_ICONS: Readonly<PhonuxIcons>;
/** `given` over the defaults, key by key; a key given as `undefined` keeps its default. @internal */
export declare function resolveIcons(given?: Partial<PhonuxIcons>): PhonuxIcons;
