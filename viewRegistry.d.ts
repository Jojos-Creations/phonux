/** The component a row draws for a panel whose `view` names no template. */
import * as React from 'react';
import type { PanelSummary } from './hostApi.js';
/** What a row renders a panel with: given the panel, nothing else. */
export type ViewComponent = React.ComponentType<{
    panel: PanelSummary;
}>;
/** The placeholder view for a `key` no template answers to. @internal */
export declare function placeholderFor(key: string): ViewComponent;
