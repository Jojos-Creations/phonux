/**
 * The zero-DOM boundary above a template's view. A view that draws its own `Panel` or `PanelFrame` claims it before paint and is
 * mounted exactly once, as it was before the default frame existed; a view that claims nothing is bare and is drawn inside the
 * library's frame instead. DESIGN.md, "The default frame", has the mechanisms that were rejected and why.
 */
import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
import type { PanelTemplate } from './panelTemplate.js';
/** Draws `children` as they are, or inside the library's frame when the view below claims no part of one. @internal */
export declare function FrameBoundary({ template, panel, children }: {
    template: PanelTemplate;
    panel: PanelSummary;
    children: React.ReactNode;
}): React.ReactElement;
