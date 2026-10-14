/**
 * What PanelRow tells the view in each slot, kept in its own leaf so DragToClose can read it without importing
 * PanelRow (PanelRow imports PanelRowSlot, which imports dragToClose: an import there would be a cycle).
 */
import * as React from 'react';
import type { NeighborWidths } from './panelRowEntry.js';
import type { ChromeTuning, GlideEase, ResolvedPanelSettings, ResolvedPanelTuning, SettingNote } from './panelSettings.js';
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
  /** The whole-panel stops a released drag settles on; empty when the row has none, so a release leaves the scroll where the drag put it. */
  readonly settleStops: readonly number[];
  /** Seconds a released drag takes to glide to the nearest settle stop. */
  readonly settleSec: number;
  /** The curve that glide travels along. */
  readonly settleEase: GlideEase;
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
  /** The panel's id. Optional so a slot value built by hand (a test, a view mounted outside a row) needs none. */
  readonly id?: string | undefined;
  /** False takes the chrome fade, like every other animation, in no time. Optional like `id`. */
  readonly animated?: boolean | undefined;
  /** True while a host holds a width on a panel of this row (`usePanelResizing`'s `setDrawnWidth`): the row's moves and its size boxes take no time then, so they follow a pointer. */
  readonly tracking?: boolean | undefined;
  readonly collapsible: boolean;
  readonly closable: ResolvedPanelSettings['closable'];
  readonly draggable: ResolvedPanelSettings['draggable'];
  readonly placeable: ResolvedPanelSettings['placeable'];
  readonly resizable: ResolvedPanelSettings['resizable'];
  readonly maxSlots: ResolvedPanelSettings['maxSlots'];
  readonly neighborWidths: NeighborWidths;
  readonly pinned: boolean;
  /** The size the row draws this slot at, which an omitted `size` on `Panel`, `PanelFrame` and `PanelSizeBox` follows. Absent outside a row, where an omitted size is the phone size. */
  readonly drawn?: { readonly width: number; readonly height: number } | undefined;
  /** The panel's own handle, which `usePanelDragProps` closes and moves through and `usePanelPinned` reads. Absent in a row without a workspace. */
  readonly handle?: Pick<ViewHandle, 'close' | 'move' | 'getState' | 'subscribe'> | undefined;
  /** This panel's tuning: its own dragToClose, slide, hopFraction and edgeScroll, and the workspace's row gap. */
  readonly tuning: ResolvedPanelTuning & { readonly rowGap: number; readonly chrome: ChromeTuning };
  /** Optional so a slot value built by hand (a test, a view mounted outside a row) needs none. */
  readonly dragScroll?: DragScroll | undefined;
  /** The panel's declared header buttons; absent when none are declared or the row has no workspace. */
  readonly headerButtonSlots?: HeaderButtonsSlot | undefined;
  /** Marks this panel as being dragged from the moment its drag engages until it settles. Absent outside a row. */
  readonly setDragging?: ((on: boolean) => void) | undefined;
  /**
   * Tells the row how far this panel's horizontal drag has gone (the offset the release would report, px, +right/-left), or
   * null once the drag has ended. The row turns it into hops with the hop rule and slides the panels in between aside. Absent outside a row.
   */
  readonly previewReorder?: ((offset: number | null) => void) | undefined;
  /** Whether a release at this offset (px, +right/-left) crosses at least one panel, by the same hop rule the release reports. Absent outside a row. */
  readonly dragHops?: ((offset: number) => boolean) | undefined;
}

export const PanelSlotContext = React.createContext<PanelSlotValue | undefined>(undefined);

/**
 * Whether the slot above is hidden: its view is parked, kept mounted and out of layout. Its own context, not a field
 * of PanelSlotValue, because the slot decides it from its exit animation after PanelRow has built the slot value.
 */
export const PanelHiddenContext = React.createContext<boolean>(false);
