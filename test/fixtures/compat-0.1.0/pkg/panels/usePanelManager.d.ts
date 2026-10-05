import type { Dispatch, SetStateAction } from 'react';
import type { FormFactor } from '../hostApi.js';
import { type PanelWindow } from '../panelWindow.js';
export interface UsePanelManagerResult {
    revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
    handleActivatePanel: (id: string) => void;
    /**
     * Removes `id` from the collapse-order stack if it is there. useProvidePanels.ts's `onAfterClose` calls it
     * for whatever id usePanelClosing just closed, live or parked, so a closed panel -- or one later restored
     * by `undoClose` -- never leaves a stale entry a later reveal could resurrect. A no-op for an id not on the
     * stack.
     */
    forgetCollapsed: (id: string) => void;
    /**
     * Given the panels array immediately AFTER a close, reveals the most recently parked panel that fits
     * beside the live ones (the capacity RISE's own settle rule), or none; one that doesn't fit stays on the
     * stack for a later close. With equal widths the most recent one fits exactly when any does. Also drops
     * any stack entry that no longer points at a parked panel -- the backstop for `clearAll()`, which wipes
     * panels without going through `forgetCollapsed`.
     */
    revealMostRecentlyCollapsed: (panelsAfterClose: PanelWindow[]) => void;
    /**
     * Ids (re)entering `live` via `revealMostRecentlyCollapsed` or usePanelClosing.ts's `undoClose` of a LIVE
     * panel (its `onRestoreLive`). PanelRow consults it only when `id` has no `enterSideById` entry: an
     * explicit gesture/capacity-rise side always wins.
     */
    enteringViaAnchorIds: ReadonlySet<string>;
    /** Marks `id` as entering via the anchor formula -- see `enteringViaAnchorIds`'s own doc comment for who calls this and why. */
    markEnteringViaAnchor: (id: string) => void;
    /**
     * Drops any stale `enterSideById`/`exitRightIds` entry `id` picked up from an EARLIER park (ids cycle
     * live/parked repeatedly over a session) -- every path that revives a panel via the anchor formula must
     * call this FIRST, or a stale explicit side would win over the anchor formula (PanelRow's own
     * precedence) and the revived panel would slide in from the wrong side.
     */
    clearEnterSide: (id: string) => void;
    /**
     * The row gesture (wheel or arrow key, wired in `useRowScrollGesture.ts`): 'right' promotes the first parked
     * panel after the current rightmost live panel and parks the LEFTMOST live one; 'left' is the mirror. One
     * reveal per call, in one commit: when the revealed panel is wider than the one parked, the next live
     * panels on the same side park too until the row settles, never a panel another action in the same update
     * keeps live. With nothing parked on that side, does nothing (no `setPanels` at all).
     */
    scrollRow: (direction: 'left' | 'right') => void;
    /**
     * Moves `id` one row-slot toward `direction`: move-by-one, not move-to-index, so no raw array position crosses
     * the PanelsAPI boundary. See `movePanel` (panelWindow.ts) for the no-op contract.
     */
    reorderPanel: (id: string, direction: 'left' | 'right') => void;
    /**
     * PanelsAPI.setFormFactor: panelWindow.ts's `setFormFactor` through setPanels. If the row no longer fits,
     * the same update parks what the capacity reconcile's DROP would (`fewestParksThatSettle`), keeping `id` and
     * every other panel acted on in this handler live, so no committed row overflows. False for a no-op (see
     * `setFormFactor`), which changes nothing.
     */
    resizePanel: (id: string, next: FormFactor) => boolean;
    /**
     * Explicit enter sides set by `scrollRow` and the capacity-rise reconcile -- PanelRow's own
     * `enterSideById` prop. Wins over `enteringViaAnchorIds`/`anchoredEnter`: those two describe "enters via
     * the anchor formula" as a boolean, which cannot express "enters from the LEFT because a rightward
     * gesture revealed it", the case this exists for.
     */
    enterSideById: ReadonlyMap<string, 'left' | 'right'>;
    /**
     * Ids currently parking with an exit to the RIGHT; every other park defaults to 'left', so only this
     * minority needs a mark. Set via `flushSync` BEFORE the parking `setPanels` call: AnimatePresence reads
     * an exiting child's `exit` prop from its LAST render before it left `present`, and a plain `setState`
     * here would batch with that commit instead of rendering "still present, but marked" first.
     */
    exitRightIds: ReadonlySet<string>;
}
export declare function usePanelManager(panels: PanelWindow[], setPanels: Dispatch<SetStateAction<PanelWindow[]>>, storedMaxPanels: number | null, phoneWidth: number, containerWidth: number, 
/** How many always-rendered, non-webview columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
fixedColumnCount: number, rootId: string): UsePanelManagerResult;
