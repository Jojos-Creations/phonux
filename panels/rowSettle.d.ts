/**
 * The row's pricing and its capacity settle: pure functions of a row and the workspace's numbers. The list hook settles
 * the row with them before anything reads it, and the panel manager prices the same row with them, so the two agree.
 */
import type { WorkspaceTuning } from '../panelSettings.js';
import { type PanelWindow } from '../panelWindow.js';
/** The workspace numbers a row is priced against. `maxLive` is null without a cap. */
export interface RowEnv {
    readonly phoneWidth: number;
    readonly containerWidth: number;
    readonly gap: number;
    readonly fixedColumnCount: number;
    readonly maxLive: number | null;
    readonly dropTieBreak: NonNullable<WorkspaceTuning['dropTieBreak']>;
}
/** Live and parkable for room: the panels whose count and widths the capacity governs. */
export declare const isParkLive: (p: PanelWindow) => boolean;
/**
 * What prices `row`: panel widths, how many parkable panels may be live, whether a live set settles. A scroll panel never parks, so its width comes off the budget instead of counting.
 */
export declare function rowPricing(env: RowEnv, row: readonly PanelWindow[]): {
    widthOf: (p: PanelWindow) => number;
    capacityFor: (set: readonly PanelWindow[], fitWidths?: readonly number[]) => number;
    settles: (set: readonly PanelWindow[]) => boolean;
};
/** `next`, plus in the same update whatever the reconcile's DROP would park, so no committed row overflows. */
export declare function settleKeeping(env: RowEnv, next: PanelWindow[], keep: readonly string[]): PanelWindow[];
/**
 * The ids (row order) to park so the live panels left settle: as FEW as possible, and among equally few the lowest
 * `evictionRank` first, then the `tieBreak` end: the LEFTMOST by default, so a row of equal widths parks exactly its
 * leftmost excess, and a wide panel parks alone when that is what leaves the most panels live. Each of `keepIds`
 * (in the order they were acted on) is never parked, whatever that costs the others, unless the ones before it
 * already fill the row.
 * @internal
 */
export declare function fewestParksThatSettle(live: readonly PanelWindow[], widthOf: (p: PanelWindow) => number, settles: (set: readonly PanelWindow[]) => boolean, keepIds?: readonly string[], tieBreak?: 'leftmost' | 'rightmost'): string[];
