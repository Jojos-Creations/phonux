/**
 * What PanelRow tells a template's view about the workspace it belongs to, kept in its own leaf so the view registry
 * can read it without importing PanelRow.
 */
import * as React from 'react';
import type { PanelReader, ViewHandle } from './panelTemplate.js';
import type { ViewWorkspace } from './workspaceCore.js';
/** The handle for a row entry and the reader for every panel; undefined outside a row that was given a workspace. */
export interface PanelViewContext {
    /** The read handle of the row entry with this engine id, or undefined when the workspace does not know it. */
    handleFor(name: string): ViewHandle | undefined;
    /** Read-only access to every panel, or undefined when the row has no workspace. */
    manager: PanelReader | undefined;
    /** What a view acts through on its workspace, or undefined when the row has none. */
    workspace?: ViewWorkspace;
    /** The same for the view of the panel drawn under `engineId`: a panel its `addPanel` creates records that panel as its opener. */
    workspaceFor?(engineId: string): ViewWorkspace;
}
/** Provided by PanelRow from its `workspace` prop; absent for a row without one. */
export declare const PanelViewContextValue: React.Context<PanelViewContext | undefined>;
