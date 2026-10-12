/**
 * What PanelRow tells the view in each slot, kept in its own leaf so DragToClose can read it without importing
 * PanelRow (PanelRow imports PanelRowSlot, which imports dragToClose: an import there would be a cycle).
 */
import * as React from 'react';
import type { NeighborWidths } from './panelRowEntry.js';
import type { ResolvedPanelSettings, ResolvedPanelTuning, SettingNote } from './panelSettings.js';
import type { ViewHandle } from './panelTemplate.js';

/**
 * What a drag of this panel needs to scroll the row at its edge. Absent outside a row and when the row does not
 * scroll, so a drag there never claims a scroller.
 */
export interface DragScroll {
  /** 'none' when the panel's `scrollOnDrag` is off. */
  readonly mode: 'edge' | 'none';
  /** The width in px of the band at each edge of the row's scroller that scrolls it. */
  readonly zonePx: number;
  /** The fastest scroll speed, px/s. */
  readonly maxPxPerSec: number;
  /** The interval in ms between jumps when motion is reduced. */
  readonly reducedStepMs: number;
  /** True when the panel is not animated: the row jumps by panel instead of scrolling continuously. */
  readonly instant: boolean;
  /** The farthest legal `scrollLeft`, from the row numbers; the DOM is never asked, because a transformed descendant inflates `scrollWidth`. */
  readonly maxScroll: number;
  /** The `scrollLeft` values the row rests at, ascending: where a reduced-motion jump can land and where a released drag settles. */
  readonly stops: readonly number[];
  /** Seconds a released drag takes to glide to the nearest stop. */
  readonly settleSec: number;
}

/** What a panel's header buttons need to draw and press: its resolved slots, its own handle and where errors and notes go. */
export interface HeaderButtonsSlot {
  readonly slots: ResolvedPanelSettings['headerButtons'];
  readonly handle: ViewHandle;
  readonly report: (e: unknown) => void;
  readonly note: (note: SettingNote) => void;
}

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
  /** This panel's tuning: its own dragToClose, slide, hopFraction and edgeScroll, and the workspace's row gap. */
  readonly tuning: ResolvedPanelTuning & { readonly rowGap: number };
  /** Optional so a slot value built by hand (a test, a view mounted outside a row) needs none. */
  readonly dragScroll?: DragScroll | undefined;
  /** The panel's declared header buttons; absent when none are declared or the row has no workspace. */
  readonly headerButtonSlots?: HeaderButtonsSlot | undefined;
}

export const PanelSlotContext = React.createContext<PanelSlotValue | undefined>(undefined);

/**
 * Whether the slot above is hidden: its view is parked, kept mounted and out of layout. Its own context, not a field
 * of PanelSlotValue, because the slot decides it from its exit animation after PanelRow has built the slot value.
 */
export const PanelHiddenContext = React.createContext<boolean>(false);
