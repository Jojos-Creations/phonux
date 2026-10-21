/**
 * How a template's view tells the library it draws its own panel frame. The adapter that renders a view puts a
 * boundary above it; a `Panel` or `PanelFrame` that mounts below claims the boundary in a layout effect, so the boundary
 * knows before paint whether to draw the library's frame. A leaf module: Panel and PanelFrame import it, so it imports no component.
 */
import * as React from 'react';
/** Unset outside a template's view: a `Panel` there claims nothing and nobody is waiting for it. */
export const FrameClaimContext = React.createContext(undefined);
/** Claims the boundary above for as long as the calling component is mounted. */
export function useFrameClaim(part) {
    const claims = React.useContext(FrameClaimContext);
    React.useLayoutEffect(() => claims?.claim(part), [claims, part]);
}
