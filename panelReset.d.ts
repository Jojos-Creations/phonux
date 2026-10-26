import { type PlacementOptions } from './panelPlacement.js';
import type { PanelSettingsResolution, SettingNote } from './panelSettings.js';
import { type PanelWindow } from './panelWindow.js';
/** What a reset needs of the engine: the row's root, the cascade a panel resolves under without the person's layer, and where a placement lands. @internal */
export interface ResetEnv {
    /** The id of the row's root. */
    rootId: string;
    /** `entry`'s settings resolved over its own layers with no person's layer. */
    resolveDefaults(entry: PanelWindow): PanelSettingsResolution;
    /** What a placement of `entry` resolves against: its `placeFallback` and the developer's order. */
    placing(entry: PanelWindow): PlacementOptions;
}
/** The row a reset yields. @internal */
export interface ResetOutcome {
    /** The row with every named panel reset; `row` itself when nothing at all differs. */
    row: PanelWindow[];
    /** False when nothing moved, resized or was cleared. */
    changed: boolean;
    /** The ids whose slot count was reset. */
    resized: string[];
    /** The notes the placements raised. */
    notes: SettingNote[];
}
/**
 * `ids` of `row` reset in the order given, each against the row the earlier ones left. A panel the row does not hold,
 * the root, a marker and an entry with no settings are skipped. Overrides are cleared through `clearOverrides`, the
 * one writer of them.
 * @internal
 */
export declare function resetEntries(row: readonly PanelWindow[], ids: readonly string[], env: ResetEnv): ResetOutcome;
