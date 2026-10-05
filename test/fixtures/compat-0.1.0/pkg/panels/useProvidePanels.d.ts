/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */
import { type RefObject } from 'react';
import type { JsonValue, PanelsAPI } from '../hostApi.js';
import { type CaptureTrigger } from '../snapshots.js';
import { type PanelWindow } from '../panelWindow.js';
import type { WorkspaceStorage } from '../workspaceState.js';
/**
 * What an app hands `useProvidePanels`: the row's measured inputs, plus the behaviour only the host can decide
 * (where closes are logged, what `hostData` means).
 * @public
 */
export interface PanelsInput {
    /** The list the provider starts with, read once on mount (the host seeds its always-shown columns here); the provider owns the list from then on. Default: empty. */
    initialEntries?: readonly PanelWindow[];
    /** The id of the row's root entry, the one every anchor leads to -- threaded through to every panelWindow.ts call that needs it. */
    rootId: string;
    /** The stored "max panels on screen" choice (`null` = follow the fit count) -- SettingsAPI's own value. */
    storedMaxPanels: number | null;
    /** The phone frame's current width: the unit a default-sized panel is priced in. */
    phoneWidth: number;
    /** Overrides `count(!collapsible)` over the provider's own list, which is the default: a host that prices the row from a count it already holds passes it through so usePanelManager always agrees with it. */
    fixedViewCount?: number;
    /** The host's measured row width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this, the same inputs SettingsAPI.fitCount uses. */
    containerWidth: number;
    /** The row's scroll container: the gesture's wheel listener attaches here. */
    overflowContainerRef: RefObject<HTMLDivElement | null>;
    /** Defaults to phonux's `noopCaptureTrigger`: a host that wants real pictures passes its own. */
    capture?: CaptureTrigger;
    /** Called when setFormFactor really resizes a panel, so the host can glide the row's margin with it. */
    onPanelResize?: () => void;
    /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
    onPanelsClosed?: (entry: {
        id: string;
        title: string;
        url: string;
        closedAt: string;
    }) => void;
    /** Called once per undo batch with the log ids it restores. See usePanelClosing.ts. */
    onPanelsRestored?: (logIds: string[]) => void;
    /** Called once per restored panel; the return value becomes its `hostData` (`undefined` drops the key). Unset keeps what it closed with. phonux never reads inside `hostData`, so what needs resetting after an undo is the host's call. */
    resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined;
    /** Builds the `hostData` of every panel `create()` opens, and of every panel restored from `storage`. Unset: new panels carry none. */
    defaultHostData?: () => JsonValue;
    /** Where the workspace is kept between launches: loaded once at mount, then saved after every change that settles. Unset: nothing is loaded or saved. */
    storage?: WorkspaceStorage;
}
/**
 * PanelsAPI plus the inputs PanelRow and the workspace read: the raw list, the exit/enter animation sets and the
 * row's numbers. They stay OFF PanelsAPI on purpose: that interface is the narrow surface a third-party view is
 * written against (hostApi.tsx's header).
 * @public
 */
export interface ProvidedPanels extends PanelsAPI {
    /** The provider's one panel list, raw (not summarised): the row's input, never part of PanelsAPI. */
    readonly entries: readonly PanelWindow[];
    /** How many always-rendered columns the row has: `PanelsInput.fixedViewCount` when passed, else `count(!collapsible)` over `entries`. Capacity and `SettingsAPI.fitCount` are priced from it. */
    readonly fixedViewCount: number;
    /** Each live collapsible panel's own width in row order, capped at `maxLiveWidth`: the row's centring margin and `SettingsAPI.fitCount` read the same array capacity is priced from. */
    readonly liveWidths: readonly number[];
    /** The widest one live panel can be in this row; `Infinity` until the row is measured (`containerWidth` 0). */
    readonly maxLiveWidth: number;
    /** Ids being closed: each exits DOWN before it leaves `entries`. */
    readonly closingIds: ReadonlySet<string>;
    /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. */
    readonly enteringViaAnchorIds: ReadonlySet<string>;
    /** See usePanelManager.ts's `UsePanelManagerResult.exitRightIds` for the full contract. */
    readonly exitRightIds: ReadonlySet<string>;
    /** See usePanelManager.ts's `UsePanelManagerResult.enterSideById` for the full contract. */
    readonly enterSideById: ReadonlyMap<string, 'left' | 'right'>;
}
/**
 * Builds the `PanelsAPI` an app hands its views. The provider owns the panel list, seeded once from `initialEntries`.
 * Call it with this render's inputs and never memoise the result: its handlers close over this render's list.
 * @public
 */
export declare function useProvidePanels(i: PanelsInput): ProvidedPanels;
