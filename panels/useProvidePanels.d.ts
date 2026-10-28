/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */
import { type RefObject } from 'react';
import type { JsonValue, PanelsAPI, PanelSummary } from '../hostApi.js';
import { type RowNumbers } from '../rowNumbers.js';
import { type PhonuxLabels } from '../labels.js';
import { type CaptureTrigger } from '../snapshots.js';
import { type PanelRectEvent } from '../panelChrome.js';
import type { ResolvedWorkspaceTuning, ScrollAlign, SettingNote } from '../panelSettings.js';
import { type PanelWindow } from '../panelWindow.js';
import { type WorkspaceHandle } from '../workspaceCore.js';
/**
 * What an app hands `useProvidePanels`: the row's measured inputs, plus the behavior only the host can decide
 * (where closes are logged, what `hostData` means).
 * @public
 */
export interface PanelsInput {
    /** The workspace this hook feeds: it supplies the root, the storage, the templates, the declared panels, the defaults, the tuning and the ids. One workspace feeds one hook. */
    workspace: WorkspaceHandle;
    /** The phone frame's current width: the unit a default-sized panel is priced in. */
    phoneWidth: number;
    /** Overrides `count(!collapsible)` over the provider's own list, which is the default: a host that prices the row from a count it already holds passes it through so usePanelManager always agrees with it. */
    fixedViewCount?: number;
    /** The host's measured row width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this. */
    containerWidth: number;
    /** The row's scroll container: the gesture's wheel listener attaches here. */
    overflowContainerRef: RefObject<HTMLDivElement | null>;
    /** Defaults to phonux's `noopCaptureTrigger`: a host that wants real pictures passes its own. */
    capture?: CaptureTrigger;
    /**
     * Called with a panel's box while it moves: `moving` on each change, then one `settled` with the box it stopped at. A
     * native view a host draws over a panel follows these; phonux draws nothing itself. Panels are keyed by their public key.
     */
    onPanelRect?: (event: PanelRectEvent) => void;
    /** Called when setSlots really resizes a panel, so the host can glide the row's margin with it. */
    onPanelResize?: () => void;
    /** The view a `create()` without a `view` opens. Unset: such a panel has no view and renders the unregistered-view placeholder, which is also what an unregistered key renders. */
    defaultView?: string;
    /** Overrides of the library's visible strings that this hook writes into the panels it makes (see `PhonuxLabels`); a key left out keeps its English default. */
    labels?: Partial<PhonuxLabels>;
    /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
    onPanelsClosed?: (entry: {
        /** The log id, `<closedAt>#<panel id>`; the id `onPanelsRestored` reports back. */
        id: string;
        /** The panel's own title; the empty string when it had none, which the host replaces with whatever it shows for an untitled entry. */
        title: string;
        /** The panel's URL; the empty string when it had none. */
        url: string;
        /** When the panel closed, as an ISO 8601 timestamp. */
        closedAt: string;
    }) => void;
    /** Called once per undo batch with the log ids it restores. See usePanelClosing.ts. */
    onPanelsRestored?: (logIds: string[]) => void;
    /** Called once per restored panel; the return value becomes its `hostData` (`undefined` drops the key). Unset keeps what it closed with. phonux never reads inside `hostData`, so what needs resetting after an undo is the host's call. */
    resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined;
    /** Builds the `hostData` of every panel `create()` opens, and of every panel restored from `storage`. Unset: new panels carry none. */
    defaultHostData?: () => JsonValue;
    /** Called with each note the engine raises while it works (a runtime diagnostic, never an error): whatever it throws is swallowed. */
    onNote?: (note: SettingNote) => void;
}
/**
 * PanelsAPI plus the inputs PanelRow and the workspace read: the raw list, the exit/enter animation sets and the
 * row's numbers. They stay OFF PanelsAPI on purpose: that interface is the narrow surface a third-party view is
 * written against (hostApi.tsx's header).
 * @public
 */
export interface ProvidedPanels extends PanelsAPI {
    /** `PanelsAPI.setSlots`, always present on the library's own provider. */
    setSlots(id: string, slots: number): void;
    /** The provider's one panel list, raw (not summarized): the row's input, never part of PanelsAPI. */
    readonly entries: readonly PanelWindow[];
    /** The views in `recentlyClosed` the person closed (source `'person'`), oldest first; null when there are none. What the undo-close toast shows. */
    readonly closedByPerson: readonly PanelSummary[] | null;
    /** How many always-rendered columns the row has: `PanelsInput.fixedViewCount` when passed, else `count(!collapsible)` over `entries`. Capacity is priced from it. */
    readonly fixedViewCount: number;
    /** Each live collapsible panel's own width in row order, capped at `maxLiveWidth`: the row's centering margin reads the same array the park capacity is priced from. */
    readonly liveWidths: readonly number[];
    /** The widest one live panel can be in this row; `Infinity` until the row is measured (`containerWidth` 0). */
    readonly maxLiveWidth: number;
    /** Whether the row scrolls: any drawn entry carries settings whose `overflow` is 'scroll'. Hand it to a Workspace's `rowScroll`. */
    readonly rowScroll: boolean;
    /** The row's one set of numbers, the same value the shell, the row and the capacity are priced from. Hand it to a Workspace's and a PanelRow's `rowNumbers`. */
    readonly rowNumbers: RowNumbers;
    /** the workspace's tuning over the library defaults, leaf by leaf: the one value this render's capacity and widths were priced from. Hand it to `usePhoneFit`. */
    readonly tuning: ResolvedWorkspaceTuning;
    /**
     * Asks the row to scroll to panel `id` after the next commit, at `align` (default: the panel's `scrollOnOpen`, else
     * 'into-view'). True when the request was recorded; false, scrolling nothing, while a drag holds the row or when the
     * row has no scroll container. A panel not yet in the row is waited for over two commits.
     */
    scrollTo(id: string, align?: ScrollAlign): boolean;
    /**
     * Tells the row panel `id` was just moved, placed or resized. When it was in view and its `scrollOnMove` is
     * 'follow', the row scrolls the least distance that shows it whole again after the next commit.
     */
    followPanel(id: string): void;
    /** Ids being closed: each exits DOWN before it leaves `entries`. */
    readonly closingIds: ReadonlySet<string>;
    /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. */
    readonly enteringViaAnchorIds: ReadonlySet<string>;
    /** See usePanelManager.ts's `UsePanelManagerResult.exitRightIds` for the full contract. */
    readonly exitRightIds: ReadonlySet<string>;
    /** See usePanelManager.ts's `UsePanelManagerResult.swapExitIds` for the full contract. */
    readonly swapExitIds: ReadonlySet<string>;
    /** See usePanelManager.ts's `UsePanelManagerResult.enterSideById` for the full contract. */
    readonly enterSideById: ReadonlyMap<string, 'left' | 'right'>;
}
/**
 * Builds the `PanelsAPI` an app hands its views. The provider owns the panel list, seeded once from `initialEntries`.
 * Call it with this render's inputs and never memoise the result: its handlers close over this render's list.
 * @public
 */
export declare function useProvidePanels(i: PanelsInput): ProvidedPanels;
