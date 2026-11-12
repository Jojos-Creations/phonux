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
 * What prices `row`: panel widths, how many parkable panels may be live, whether a live set settles. The row is one continuous
 * strip (Embla): every panel has its slot on it, so nothing parks for room or for the cap, and every live set settles.
 */
export declare function rowPricing(env: RowEnv, row: readonly PanelWindow[]): {
    widthOf: (p: PanelWindow) => number;
    capacityFor: (_set: readonly PanelWindow[], _fitWidths?: readonly number[]) => number;
    settles: (_set: readonly PanelWindow[]) => boolean;
};
/** `next` as it is: on a strip no committed row overflows, so nothing parks. */
export declare function settleKeeping(_env: RowEnv, next: PanelWindow[], _keep: readonly string[]): PanelWindow[];
