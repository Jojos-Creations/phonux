/**
 * The frame the library draws around a template's view that draws none of its own: a header with the panel's title, the
 * grab bar, the phone frame and the template's footer. Built from the exported `Panel`, `PanelFrame`
 * and `DragToClose`, so a bare view looks and behaves like one a developer wrote with them. DESIGN.md, "The default frame".
 */
import * as React from 'react';
import { type PanelSummary } from './hostApi.js';
export declare function DefaultFrame({ panel, children }: {
    panel: PanelSummary;
    children: React.ReactNode;
}): React.ReactElement;
