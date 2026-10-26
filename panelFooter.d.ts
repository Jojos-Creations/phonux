/**
 * The footer a template declares: the context that carries it from the template's view adapter to the frame, and the
 * component that draws it.
 */
import * as React from 'react';
import type { CssStyle } from './cssStyle.js';
/** The footer element of the template view above, or null; provided by the view adapter, read by `PanelFooter`. @internal */
export declare const PanelFooterContext: React.Context<React.ReactElement<unknown, string | React.JSXElementConstructor<any>> | null>;
/**
 * Draws the footer the panel's template declares, floating below the frame as the header floats above it: outside the panel's own
 * space, so it takes no height, and it is bare like the header (no border, shadow or fill; the header's height). The parent must be `position: relative`, as for `PanelHeader`.
 * `PanelFrame` draws it by default; a view that does not use `PanelFrame` renders this itself. Outside a template's view, or
 * for a template that declares no footer, it draws nothing. A footer that throws while rendering is hidden and the
 * rest of the panel stays. `sx` is layered over the footer's box (its offset below the frame, its padding): to restyle the footer
 * `PanelFrame` would draw, give the frame `footer={false}` and render `PanelFooter` with the `sx`.
 * @public
 */
export declare function PanelFooter({ sx }: {
    sx?: CssStyle;
}): React.ReactElement | null;
