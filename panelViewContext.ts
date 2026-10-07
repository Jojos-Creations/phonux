/**
 * What PanelRow tells a template's view about the workspace it belongs to, kept in its own leaf so the view registry
 * can read it without importing PanelRow.
 */
import * as React from 'react';
import type { PanelReader, ViewHandle } from './panelTemplate.js';

/** The handle for a row entry and the reader for every panel; undefined outside a row that was given a workspace. */
export interface PanelViewContext {
  /** The read handle of the row entry with this engine id, or undefined when the workspace does not know it. */
  handleFor(id: string): ViewHandle | undefined;
  /** Read-only access to every panel, or undefined when the row has no workspace. */
  manager: PanelReader | undefined;
}

/** Provided by PanelRow from its `workspace` prop; absent for a row without one. */
export const PanelViewContextValue = React.createContext<PanelViewContext | undefined>(undefined);
