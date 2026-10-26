/**
 * Panel sizes: the size a panel starts at, and the one rule for how wide a panel is in the row. Pure, and free of live
 * device state, so the row's state functions stay pure too.
 */
import { type PanelSize } from './hostApi.js';
import type { PanelRowEntry } from './panelRowEntry.js';
/**
 * The size every panel starts at: one slot at the built-in phone size.
 * @public
 */
export declare const DEFAULT_PANEL_SIZE: PanelSize;
/**
 * The slots a panel is drawn at: its `slots` (at most its `maxSlots`) capped at what fits in `maxLiveWidth`; undefined for a
 * hand-built entry that carries no slots, which keeps drawing at the phone width.
 * @internal
 */
export declare function drawnSlotsOf(p: Pick<PanelRowEntry, 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap?: number): number | undefined;
/**
 * A panel's own width in the row: its slots, that many phone widths with the row gap between them, no more than fit in
 * `maxLiveWidth`. A hand-built entry without slots takes the live `phoneWidth`.
 * @public
 * @deprecated Inside a row, `Panel`, `PanelFrame` and `PanelSizeBox` take the slot's drawn size when `size` is left out, and `PanelSummary.size.width` is that width.
 */
export declare function panelWidthOf(p: Pick<PanelRowEntry, 'slots' | 'settings'>, phoneWidth: number, maxLiveWidth: number, gap?: number): number;
