/**
 * What PanelRow tells the view in each slot, kept in its own leaf so DragToClose can read it without importing
 * PanelRow (PanelRow imports PanelRowSlot, which imports dragToClose: an import there would be a cycle).
 */
import * as React from 'react';
import type { NeighborWidths } from './panelRowEntry.js';
import type { ResolvedPanelSettings } from './panelSettings.js';

/**
 * Per-slot facts a view cannot read itself: it only receives `PanelSummary`, which has no `collapsible`, `anchor`
 * or settings, on purpose (hostApi.tsx). No provider above (a view mounted directly, as in tests) is `undefined`,
 * deliberately not `false`: each hook resolves that case to its OWN default.
 */
export interface PanelSlotValue {
  readonly collapsible: boolean;
  readonly closable: ResolvedPanelSettings['closable'];
  readonly draggable: ResolvedPanelSettings['draggable'];
  readonly placeable: ResolvedPanelSettings['placeable'];
  readonly resizable: ResolvedPanelSettings['resizable'];
  readonly formFactors: ResolvedPanelSettings['formFactors'];
  readonly neighborWidths: NeighborWidths;
  readonly pinned: boolean;
}

export const PanelSlotContext = React.createContext<PanelSlotValue | undefined>(undefined);
