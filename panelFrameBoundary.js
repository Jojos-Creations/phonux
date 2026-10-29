import { jsx as _jsx } from "react/jsx-runtime";
/**
 * The zero-DOM boundary above a template's view. A view that draws its own `Panel` or `PanelFrame` claims it before paint and is
 * mounted exactly once, as it was before the default frame existed; a view that claims nothing is bare and is drawn inside the
 * library's frame instead. DESIGN.md, "The default frame", has the mechanisms that were rejected and why.
 */
import * as React from 'react';
import { DefaultFrame } from './defaultFrame.js';
import { FrameClaimContext } from './panelFrameClaim.js';
/** Whether a template's view was last found bare, by template object: the second panel of a bare template is drawn framed at once, so only the first one's view mounts twice. */
const BARE_TEMPLATES = new WeakMap();
/** Draws `children` as they are, or inside the library's frame when the view below claims no part of one. @internal */
export function FrameBoundary({ template, panel, children }) {
    const [bare, setBare] = React.useState(() => BARE_TEMPLATES.get(template) === true);
    const claimed = React.useRef(0);
    const bareNow = React.useRef(bare);
    bareNow.current = bare;
    const claims = React.useMemo(() => ({
        claim: () => {
            claimed.current += 1;
            // A claim that arrives after the library drew its frame (a lazy view, one that rendered nothing first) takes that frame back.
            if (bareNow.current) {
                BARE_TEMPLATES.set(template, false);
                setBare(false);
            }
            return () => {
                claimed.current -= 1;
            };
        },
    }), [template]);
    // After the view's own layout effects: its Panel has claimed by now.
    React.useLayoutEffect(() => {
        const wants = claimed.current === 0;
        BARE_TEMPLATES.set(template, wants);
        if (wants !== bareNow.current)
            setBare(wants);
    }, [bare, template]);
    const view = _jsx(FrameClaimContext.Provider, { value: claims, children: children });
    return bare ? _jsx(DefaultFrame, { panel: panel, children: view }) : view;
}
