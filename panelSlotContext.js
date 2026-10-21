/**
 * What PanelRow tells the view in each slot, kept in its own leaf so DragToClose can read it without importing
 * PanelRow (PanelRow imports PanelRowSlot, which imports dragToClose: an import there would be a cycle).
 */
import * as React from 'react';
export const PanelSlotContext = React.createContext(undefined);
