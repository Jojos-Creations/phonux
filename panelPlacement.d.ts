/**
 * Where a panel lands: the pure half of placeOnAdd, placeOnShow, placeOnReturn, placeFallback and undoPlacement.
 * `resolvePlacement` turns one value into an anchor request against the row as it stands; `placePanel` applies it to
 * a panel already in the row. Placement is the developer's own ask, so nothing here reads `movable`, and the
 * entry's settings are never written: the person's arrangement is whatever the row's anchors say.
 */
import type { AddPlacement, SettingNote } from './panelSettings.js';
import { type AnchorRequest, type PanelWindow } from './panelWindow.js';
/** The five positions a value may name without a target; also what `placeFallback` may be. @internal */
export type NamedPlacement = 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed';
/** What a resolution needs beyond the value: where to land when the value cannot be honoured, and the developer's panel order. @internal */
export interface PlacementOptions {
    fallback: NamedPlacement;
    order?: () => readonly string[];
}
/** The note raised when a placement could not be honoured and its `placeFallback` was used instead. @internal */
export declare const placementFallbackNote: (panelId: string | null, why: string) => SettingNote;
/** Delivers `notes` to `onNote`, which may throw without breaking the update that raised them. @internal */
export declare function reportNotes(onNote: ((note: SettingNote) => void) | undefined, notes: readonly SettingNote[]): void;
/**
 * The anchor request that lands `self` where `value` says, against `row`. Priority -1 on every "immediately next
 * to" request: only -1 lands nearest, because an equal priority on the right goes to the entry earlier in the row.
 * A target that is missing, is the panel itself, or an `order` that cannot place it, lands at `o.fallback` with a
 * note. `self` is the panel's name whether or not it is in `row` yet; null when it has none.
 * @internal
 */
export declare function resolvePlacement(row: readonly PanelWindow[], rootId: string, self: string | null, value: AddPlacement | 'in-place', o: PlacementOptions): {
    anchor: AnchorRequest | null;
    notes: SettingNote[];
};
/**
 * `id` moved to where `value` says, in the row that results; a copy of `row` when the value is 'in-place' or `id` is
 * not in it. The panel keeps its live flag and every setting, and only its anchor changes. `o.rootId` names the
 * row's root.
 * @internal
 */
export declare function placePanel(row: readonly PanelWindow[], id: string, value: AddPlacement | 'in-place', o: PlacementOptions & {
    rootId: string;
}): {
    row: PanelWindow[];
    notes: SettingNote[];
};
/**
 * `panel` put back into `row` by `undoPlacement`: 'old-slot' at `index`, exactly as restorePanel does; any other value
 * appends it and places it there, its live flag kept. An id already present leaves `row` unchanged.
 * @internal
 */
export declare function restorePlaced(row: readonly PanelWindow[], panel: PanelWindow, index: number, value: 'old-slot' | AddPlacement, o: PlacementOptions & {
    rootId: string;
}): {
    row: PanelWindow[];
    notes: SettingNote[];
};
