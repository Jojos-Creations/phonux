/**
 * What PanelRow tells a template's view about the workspace it belongs to, kept in its own leaf so the view registry
 * can read it without importing PanelRow.
 */
import * as React from 'react';
/** Provided by PanelRow from its `workspace` prop; absent for a row without one. */
export const PanelViewContextValue = React.createContext(undefined);
