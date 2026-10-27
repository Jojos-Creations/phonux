import type { Dispatch, SetStateAction } from 'react';
import { type PinApplied, type PinChange, type PinEnv } from '../panelPin.js';
import type { AddPlacement, PanelSettingsResolution } from '../panelSettings.js';
import type { SettingNote, WorkspaceTuning } from '../panelSettings.js';
import { type PanelWindow } from '../panelWindow.js';
export interface UsePanelManagerResult {
    /** Marks `id` as touched now: the panel the next park for room spares longest. A no-op for an id the row does not hold. */
    touchPanel: (id: string) => void;
    revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
    /**
     * Shows panel `id` the way a click on it does, landing it by `pin` when given. `from` is the row the landing is planned
     * against, this render's list when omitted. `placeAs` lands it there instead of by its `placeOnShow`.
     */
    handleActivatePanel: (id: string, pin?: PinChange, from?: PanelWindow[], placeAs?: AddPlacement | 'in-place') => void;
    /** Removes `id` from the collapse-order stack, so a closed panel (or one `undoClose` restores) leaves no stale entry for a later reveal. */
    forgetCollapsed: (id: string) => void;
    /**
     * Given the panels immediately AFTER a close, reveals the next parked panel that fits beside the live ones, in
     * `returnPriority` and tie-break order; one that does not fit stays on the stack. Also drops stack entries that no
     * longer point at a parked panel, which backstops `clearAll()` (it wipes without `forgetCollapsed`).
     */
    revealMostRecentlyCollapsed: (panelsAfterClose: PanelWindow[]) => void;
    /** Ids (re)entering `live` by a reveal or an `undoClose` of a live panel; PanelRow reads it only when `id` has no `enterSideById` entry. */
    enteringViaAnchorIds: ReadonlySet<string>;
    /** Marks `id` as entering via the anchor formula. */
    markEnteringViaAnchor: (id: string) => void;
    /** Marks `id` to enter from `side`, which wins over the anchor formula: a placed panel's side is a fact of the row it landed in, not of its anchor. */
    markEnterSide: (id: string, side: 'left' | 'right') => void;
    /** Drops a stale `enterSideById`/`exitRightIds` entry from an earlier park of `id`; call it FIRST on every anchor-formula revive, or the stale side wins. */
    clearEnterSide: (id: string) => void;
    /**
     * `row` with `id` landed as a path that makes it live lands it: the pin change it waits with, or `pin` when given,
     * applied through `applyPinChange` with `placeAs` as the path's own placement, else `placeAs` alone. A change that no
     * longer applies is dropped with a note. `pinned` is true when a change was applied.
     */
    landPanel: (row: readonly PanelWindow[], id: string, placeAs: AddPlacement | 'in-place', pin?: PinChange) => {
        row: PanelWindow[];
        notes: SettingNote[];
        pinned: boolean;
    };
    /** What applying `change` to panel `id` would answer, from this render's list, changing nothing. */
    previewPin: (id: string, change: PinChange) => PinApplied;
    /** Saves what a person's pin of `id` by `change` records, in the update it is called in: the anchor when the half names a place, `parkable` when it names that. */
    recordPin: (id: string, change: PinChange) => void;
    /**
     * Applies `change` to the live or parked panel `id` in one update. The refusal, or the outcome of this render's list,
     * is answered at once; `record` true (a person's gesture) saves the anchor and the `parkable` the half names.
     */
    pinPanel: (id: string, change: PinChange, record: boolean) => PinApplied;
    /** Stores `change` on the entry `id` to apply the next time it is live; `null` removes what is stored. */
    deferPin: (id: string, change: PinChange | null) => void;
    /**
     * Resets the panels `ids` (in this order) to their cascade defaults in one update: overrides cleared, deferred pins
     * dropped, tier and `parkable` re-resolved, each placed by its `placeOnAdd`; what no longer fits is parked, and the
     * answer lists what the room it frees brings back. `changed` is false when nothing moved, resized or was cleared.
     */
    resetPanels: (ids: readonly string[]) => {
        changed: boolean;
        parked: string[];
        returned: string[];
    };
    /**
     * The row gesture: 'right' brings the first parked panel after the rightmost live one and parks the LEFTMOST live
     * one ('left' mirrors), then parks more on that side until the row settles, never an acted-on panel. Does nothing,
     * with no `setPanels`, when nothing is parked on that side or when that panel's `revealOnScroll` is 'never'.
     * `keep` (a dragged panel) is never parked. True when a panel came in.
     */
    scrollRow: (direction: 'left' | 'right', keep?: string) => boolean;
    /** Moves `id` `by` row-slots (negative: left; 'left' and 'right' are one slot); see `movePanel` for the no-op contract, and `movePanelBy` for a count that runs out at an edge. `record` false (a call from code) leaves the person's arrangement, `overrides`, as it was. True when the move changes this render's list. */
    reorderPanel: (id: string, by: number | 'left' | 'right', record?: boolean) => boolean;
    /** `setSlots` through setPanels; if the row no longer fits, the same update parks what the capacity drop would, keeping every acted-on panel live. False for a no-op. `record` false leaves `overrides` as it was. */
    resizePanel: (id: string, slots: number, record?: boolean) => boolean;
    /** Puts `id` where `value` says, keeping its live flag; the placement is the developer's own ask, so a person's `movable` is the caller's to check. `record` false leaves `overrides` as it was. True when the placement changes this render's list. */
    placeAt: (id: string, value: AddPlacement | 'in-place', record?: boolean) => boolean;
    /** Puts the parked or hidden panel `id` where `value` says and makes it live, in one update; 'in-place' lands it at its array slot. `record` false leaves `overrides` as it was. False, changing nothing, for an unknown or live panel. */
    landAt: (id: string, value: AddPlacement | 'in-place', record?: boolean) => boolean;
    /** The in-flight gate shared by the manager's operations and the raw mutators. */
    gate: OperationGate;
    /** Explicit enter sides from `scrollRow` and the capacity rise; they win over `enteringViaAnchorIds`, which cannot say which side. */
    enterSideById: ReadonlyMap<string, 'left' | 'right'>;
    /** Ids parking with an exit to the RIGHT (every other park exits left). Set through `flushSync` BEFORE the parking `setPanels`: AnimatePresence reads `exit` from the last render before the child leaves. */
    exitRightIds: ReadonlySet<string>;
    /**
     * Parks `id` and records the hold of `kind`: a 'sticky' hold returns only when shown, an 'until-room' one when
     * the free slots exceed what the park itself left. An id already parked by capacity takes the hold and leaves
     * the collapse stack. False, changing nothing, for an unknown id, a fixed column, an id already parked and held,
     * one already held this turn, and a panel whose `hideWhenLast` is 'refuse' that would leave no panel present.
     */
    holdPanel: (id: string, kind: 'sticky' | 'until-room') => boolean;
    /** Drops the hold mark of `id` and nothing else: `live` and the collapse stack are untouched. True when a mark was dropped. */
    releaseHold: (id: string) => boolean;
    /** Each held id and its hold, this session only: workspace saves never carry it. A not-yet-measured 'until-room' hold reads `freeAfterPark: Infinity`. */
    heldIds: ReadonlyMap<string, Hold>;
    /** True iff no panel other than `ids` and the ones held earlier this turn stays present; a fixed column is always present. */
    wouldEmptyRow: (ids: readonly string[]) => boolean;
    /** Records the hold of an id that is already parked, as a creation path does for a panel created parked. False for a live, fixed or unknown id. */
    markHeld: (id: string, kind: 'sticky' | 'until-room') => boolean;
}
import { type OperationGate } from './operationGate.js';
export type { GateKind, OperationGate } from './operationGate.js';
/** What keeps a parked panel parked: 'sticky' until it is shown, or until the free slots exceed `freeAfterPark`. */
export type Hold = 'sticky' | {
    readonly freeAfterPark: number;
};
/** Inputs usePanelManager takes beyond the row's own numbers; one object, so a later setting adds a field and not a parameter. */
export interface PanelManagerOptions {
    /** The list hook owns these: it settles the row before the manager reads it. Left out, the manager keeps its own. */
    keepLiveRef?: {
        current: ReadonlyMap<string, PanelWindow[]>;
    };
    capParkedRef?: {
        current: string[];
    };
    /** Receives each note the engine raises; whatever it throws is swallowed. */
    onNote?: (note: SettingNote) => void;
    /** Only `rowGap`, `returnTieBreak`, `dropTieBreak` and `maxLivePanels` are read here. */
    tuning?: WorkspaceTuning;
    /** What the panel's settings resolve to over the layers the workspace holds with the person's `parkable` set; without it no pin change can be applied. */
    resolveWith?: PinEnv['resolveWith'];
    /** What the panel's settings resolve to over those layers with no person's layer at all; without it nothing can be reset. */
    resolveDefaults?: (entry: PanelWindow) => PanelSettingsResolution;
    /** The developer's panel order, read by every placement whose value is `'order'`. */
    order?: () => readonly string[];
}
export declare function usePanelManager(panels: PanelWindow[], setPanels: Dispatch<SetStateAction<PanelWindow[]>>, phoneWidth: number, containerWidth: number, 
/** How many always-rendered columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
fixedColumnCount: number, rootId: string, options?: PanelManagerOptions): UsePanelManagerResult;
export { fewestParksThatSettle } from './rowSettle.js';
