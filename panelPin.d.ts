/**
 * Pinning as pure functions of the entry, the row and the `pinning` definition: whether a panel reads as pinned, what
 * a pin change does to a panel in each status, and the row that applying one half yields. Nothing is stored, so a drag
 * that re-anchors every entry to the root cannot change what a definition reads.
 */
import type { PanelRefusal } from './panelManagerError.js';
import { type PlacementOptions } from './panelPlacement.js';
import type { AddPlacement, CatalogName, PanelSettingsResolution, PinHalf, Pinning, PinningWhenNotLive, SettingNote } from './panelSettings.js';
import type { DeferredPin } from './panelTemplate.js';
import { type PanelWindow } from './panelWindow.js';
/**
 * Whether `entry` reads as pinned under `definition`. A definition naming `parkable` in both halves is read by the
 * entry's resolved `parkable`, whatever its placement; one with `row-start` and `row-end` or `after-fixed` is read
 * by sitting left of the root; both are read when both hold; an empty one reads false. `rootId` names the root; omitted,
 * it is the row's marker or its entry with no anchor.
 * @internal
 */
export declare function isPinned(entry: PanelWindow, row: readonly PanelWindow[], definition: Pinning, rootId?: string): boolean;
/**
 * The ids of the entries of `row` that read as pinned, each under its own `pinning` (the library default for an entry
 * with no settings). Parked entries are read like live ones.
 * @internal
 */
export declare function pinnedIds(row: readonly PanelWindow[], rootId: string): ReadonlySet<string>;
/** A pin change: `pin()`, `unpin()`, or a bare `parkable` value a configure call asks for. @internal */
export type PinChange = DeferredPin;
/** What a panel is when a pin change reaches it: live, engine-parked, held hidden, closed with a record, closed inside the undo window, still being added, or closed with nothing to name it. @internal */
export type PinStatus = 'live' | 'parked' | 'hidden' | 'closed-declared' | 'undo' | 'pending' | 'closed-anonymous';
/** What to do with a pin change: apply it now, show the panel and then apply it, store it, or refuse. @internal */
export type PinDecision = {
    kind: 'apply' | 'show' | 'defer' | 'refuse';
    code?: PanelRefusal;
};
/** The half of `entry`'s `pinning` that `change` applies. @internal */
export declare const pinHalf: (entry: Pick<PanelWindow, "settings">, change: PinChange) => PinHalf;
/**
 * What `entry` does with `change` in `status` under `pinningWhenNotLive`: a live panel applies it; a pending one and a
 * closed one nothing can name refuse; an engine-parked or hidden one follows the setting's answer for that status
 * (a half that names `parkable` is refused whole where the answer is place-only); a closed one with a record can
 * only store the change. There is no room check: a fixed pin never needs room.
 * @internal
 */
export declare function decidePinChange(entry: Pick<PanelWindow, 'settings'>, status: PinStatus, setting: PinningWhenNotLive, change: PinChange): PinDecision;
/** What applying a pin change needs of the engine: the row's root, the cascade a panel resolves under with `parkable` set, and where a placement lands. @internal */
export interface PinEnv {
    /** The id of the row's root. */
    rootId: string;
    /** `entry`'s settings resolved over its own layers with `parkable` as the top one. */
    resolveWith(entry: PanelWindow, parkable: boolean): PanelSettingsResolution;
    /** What a placement of `entry` resolves against: its `placeFallback` and the developer's order. */
    placing(entry: PanelWindow): PlacementOptions;
}
/** The row a pin change yields, or the refusal that leaves the row as it was. @internal */
export type PinApplied = {
    ok: true;
    /** The row with the change applied; `row` itself when nothing at all changed. */
    row: PanelWindow[];
    /** The notes the placement raised. */
    notes: SettingNote[];
    /** False when the panel already read as asked and only a stored deferral, if any, was cleared. */
    changed: boolean;
} | {
    ok: false;
    code: PanelRefusal;
    message: string;
    /** The catalog name of the setting that stood in the way, for 'settings-conflict'. */
    setting?: CatalogName;
};
/** `p` without its deferred pin. @internal */
export declare const withoutDeferral: (p: PanelWindow) => PanelWindow;
/** `entry` carrying `resolution`: the mirror fields follow, and a panel that became a fixed column is live, because a fixed column is never parked. @internal */
export declare const reparked: (entry: PanelWindow, resolution: PanelSettingsResolution) => PanelWindow;
/**
 * `change` applied to panel `id` of `row`, all or nothing. `pin` places, then fixes: a fixed column needs one slot and
 * no explicit setting the fix would override. `unpin` frees first, then places. A half with no placement uses
 * `o.fallback`. Placement is the developer's own ask, so `movable` gates none of it. A deferred pin the panel held is
 * cleared whatever the outcome.
 * @internal
 */
export declare function applyPinChange(row: readonly PanelWindow[], id: string, change: PinChange, env: PinEnv, o?: {
    fallback?: AddPlacement | 'in-place';
}): PinApplied;
/**
 * Lands panel `id` of `row` the way a path that makes it live does: its pending pin change, `pin` or else the one it
 * waits with, applied through `applyPinChange` with `fallback` as the path's own placement, or, with none waiting,
 * `fallback` alone. A change that no longer applies is dropped with a note and the panel lands by `fallback`.
 * @internal
 */
export declare function landPanel(row: readonly PanelWindow[], id: string, pin: PinChange | undefined, fallback: AddPlacement | 'in-place', env: PinEnv): {
    row: PanelWindow[];
    notes: SettingNote[];
    pinned: boolean;
};
