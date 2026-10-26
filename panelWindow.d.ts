import type { JsonValue } from './hostApi.js';
import { type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import type { PanelAnchor } from './panelRowOrder.js';
import type { AddPlacement, FixedBehaviour, PanelSettings, ResolvedPanelSettings } from './panelSettings.js';
import type { DeferredPin } from './panelTemplate.js';
/**
 * One browsing panel in the unified row: either live in the row or parked, never both. Parking only flips
 * `live`; it never removes the entry from the array, only `closePanel` does.
 * @public
 */
export interface PanelWindow {
    /** The panel's id, unique in the row. */
    id: string;
    /** The panel's URL; the empty string for a panel with none, such as History. */
    url: string;
    /** The title shown in the panel's header; absent when none was set. */
    title?: string;
    /** Host-supplied and opaque: every function here only copies it through, never reads or branches on it. Its
     * shape is a host-side agreement `JsonValue` cannot enforce. */
    hostData?: JsonValue;
    /** Mounted in the row right now. `false` means parked: still in this array, just not rendered. */
    live: boolean;
    /** Which component renders this entry (a template id) -- read ONLY by the row (PanelRow); every park/close site reads `collapsible`/`listed` instead, never this. An open string, not a closed union: an unregistered value renders a placeholder, never a crash. */
    view: string;
    /** Capacity parks (an open, a revive, the row gesture, a capacity drop) may park this entry; `false` marks an always-shown column exempt from all of them. */
    collapsible: boolean;
    /** Appears in the public `panelList` (History's own row list, and PanelsAPI). */
    listed: boolean;
    /** Opaque per-panel data a create() caller supplied (PanelsAPI.create's `params`); undefined for built-ins. It reaches PanelSummary.params; no behavior site here reads it. */
    params?: JsonValue;
    /** Where this entry sits in the row. Undefined only for History, the root; a hand-built record without one reads as anchored where it already stands, and useProvidePanels orders the row from the anchors, which writes that anchor. */
    anchor?: PanelAnchor;
    /** Which of the row's two stacking tiers this entry's slot sits in -- read ONLY by PanelRow's per-slot zIndex. Default 'base'. */
    layer?: 'base' | 'raised';
    /** Whether this entry's reappearance always resolves through the anchor formula (resolveEnterDirection) instead of unconditionally entering from the right -- read ONLY by PanelRow's enterDirection. Default false. */
    anchoredEnter?: boolean;
    /** How many phone-panel widths wide this entry is set to. Absent on a hand-built entry, which reads as one slot. */
    slots?: number;
    /** The slot count a panel rested at one phone by `tuning.shrinkUnfocused` goes back to when it is next active; absent otherwise. Saved as its `slots`. */
    restoreSlots?: number;
    /** The resolved settings this entry was created under, whose mirror fields (`collapsible`, `listed`, `layer`, `anchoredEnter`, `slots`) were written from them. Absent for a hand-built entry. */
    settings?: ResolvedPanelSettings;
    /** This entry's stable name, written once when it is created from settings; absent on a hand-built entry, whose `id` stands in. */
    key?: string;
    /** The stable identity written to the workspace file, set once by `appendPanel`; never the panel's key or its public id. Absent on a hand-built entry. */
    uid?: string;
    /** The instance settings layer this entry was created under, saved for an entry code does not re-declare so a restore resolves it the same way. Only workspace code writes it. */
    instance?: PanelSettings;
    /** What the person changed about this entry: where it sits, its slot count, whether it is parkable. Present, possibly empty, on an entry that owns only the keys it holds; absent on an entry restored from an older file, which owns its anchor and slot count. Written only by `recordOverride`, `clearOverrides` and a restore. */
    overrides?: {
        /** Where the person put the entry. */
        anchor?: PanelAnchor;
        /** The slot count the person chose. */
        slots?: number;
        /** Whether the person made the entry parkable. */
        parkable?: boolean;
    };
    /** The `placeOnAdd` value that placed this entry; an untouched entry keeps its saved place only while its resolved `placeOnAdd` still equals it. */
    applied?: {
        placeOnAdd: AddPlacement;
    };
    /** True for an entry created from a declaration in code, which code re-declares at every launch. */
    declared?: true;
    /** The engine id of the panel whose view opened this one, set once at create; when that panel leaves the row this takes its opener. Only `keepOpeners` and a move rewrite it. */
    openedBy?: string;
    /** A pin change waiting for this entry to become live, applied inside whichever path makes it live. Session only: never saved. */
    deferredPin?: DeferredPin;
    /** True only for the reserved '__root__' entry a row without a root keeps: it holds the anchor point, is never drawn and never counted as a column or a hop. */
    marker?: true;
}
/** History's own seeded entry: never collapsible (an always-shown column), never listed (it must not list itself), always live, never closed (the close path refuses the root); raised, so a left-exiting park slides under it; anchoredEnter, which against itself resolves 'right'; no anchor: it is the root every anchor leads to. Same default size as every other entry. @internal */
export declare function createHistoryPanel(rootId: string, title?: string): PanelWindow;
/**
 * Per-call metadata create() may set beyond a bare url. No raw `collapsible` key: `permanent`
 * is the only door to `collapsible:false` (see `appendPanel`'s own doc comment for what it forces).
 * @internal
 */
export interface AppendPanelOptions {
    /** The view that renders the new panel, becoming `PanelWindow.view`. Default 'web'; `useProvidePanels` always passes one. */
    view?: string;
    /** The new panel's title. */
    title?: string;
    /** Opaque per-panel data, copied through to `PanelWindow.params`. */
    params?: JsonValue;
    /** Copied through to the new entry's `hostData` unchanged; absent means the entry carries no `hostData` key at all (never an explicit `undefined`). */
    hostData?: JsonValue;
    /** Whether the new panel appears in `panelList`. Default true; a `permanent` panel is never listed. */
    listed?: boolean;
    /** `panel` defaults to History, `priority` to one past the far end of that side. Default \{ position: 'right' \}. */
    anchor?: {
        /** The panel to sit beside; absent means History. */
        panel?: string;
        /** Which side of `panel` the new panel sits on. */
        position: 'left' | 'right';
        /** Nearness to `panel` on that side; a lower number is nearer. Absent means the far end. */
        priority?: number;
    };
    /** The stacking tier of the new panel's slot, becoming `PanelWindow.layer`. Default 'base'. */
    layer?: 'base' | 'raised';
    /** Becomes `PanelWindow.anchoredEnter`. Default false. */
    anchoredEnter?: boolean;
    /** See `CreatePanelOptions.permanent` (hostApi.tsx) for the full contract; `appendPanel` is what enforces it. */
    permanent?: boolean;
    /** How many phone-panel widths wide the new panel is. Ignored for a permanent column, which is always one slot. Default 1. */
    slots?: number;
}
/** An anchor as a caller may give it: `panel` and `priority` are optional and filled in against the row. @internal */
export type AnchorRequest = NonNullable<AppendPanelOptions['anchor']>;
/** `id` re-anchored per `request` (defaults as for appendPanel), the row re-ordered to match. The SAME array for an unknown id or the root. @internal */
export declare function reanchorPanel(panels: PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[];
/** `id` anchored per `request` and the row ordered to match; the root is never anchored, so it comes back unchanged. @internal */
export declare function anchorPanel(panels: readonly PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[];
/**
 * Builds a brand-new, live 'extra' panel immutably and places it by `info.anchor` (default: right of
 * History, past every panel already there -- the row's far right end). History is seeded directly, never
 * through this function. `permanent` forces `collapsible:false` and `listed:false` (overriding any `info.listed`
 * passed) since such a column must supply its own close control, never the row's trash; that control
 * closes it through the developer's own `close`, which `closable` does not limit.
 * @internal
 */
export declare function appendPanel(panels: PanelWindow[], info: {
    url?: string;
} & AppendPanelOptions, id: string, rootId: string, uid?: string): PanelWindow[];
/** Whether the row may park `p` to make room: a collapsible entry whose `overflow` is 'park', which every hand-built collapsible entry reads as. Any other entry scrolls instead. @internal */
export declare function parksForRoom(p: PanelWindow | PanelRowEntry): boolean;
/** The park levers of `p`: its own `capacityReturn` when its `overflow` is 'park', 'auto' otherwise, because a panel the row never parks for room has no lever to pull. @internal */
export declare function parkLevers(p: PanelWindow): Pick<FixedBehaviour, 'evictionRank' | 'returnPriority'> & Pick<ResolvedPanelSettings, 'capacityReturn'>;
/**
 * The id of the live panel to park for room (one whose `overflow` is 'park'), or null with none live: the one with the
 * smallest `touchedAt`, a tie going to the lower index. `exclude` exempts the panel being opened or restored, already
 * live in `panels`, and any panel another action in the same update must keep live.
 * @internal
 */
export declare function leastRecentlyTouchedId(panels: PanelWindow[], touchedAt: (id: string) => number, exclude?: ReadonlySet<string>): string | null;
/**
 * Which side of the row a park/reveal at `id` reads as, for the exit/enter animation: 'left' when `id`'s
 * own array index sits below every OTHER live collapsible panel's index, 'right' otherwise (a parked panel
 * between two live ones included). Computed fresh from array position every time, never a persisted flag,
 * so an append's park always reads 'left' and a park for an open anchored nearest History reads 'right'.
 * @internal
 */
export declare function sideOfLiveRange(panels: PanelWindow[], id: string): 'left' | 'right';
/** The row-slot index of the LEFTMOST (lowest-index) live collapsible panel, or -1 if none are live. @internal */
export declare function leftmostLiveIndex(panels: PanelWindow[]): number;
/** The row-slot index of the RIGHTMOST (highest-index) live collapsible panel, or -1 if none are live. @internal */
export declare function rightmostLiveIndex(panels: PanelWindow[]): number;
/** The first PARKED collapsible panel strictly after `index` -- a rightward gesture's own "next one to bring in", or null with nothing parked on that side. @internal */
export declare function firstParkedAfter(panels: PanelWindow[], index: number): PanelWindow | null;
/** The last PARKED collapsible panel strictly before `index` -- a leftward gesture's own "next one to bring in", or null with nothing parked on that side. @internal */
export declare function lastParkedBefore(panels: PanelWindow[], index: number): PanelWindow | null;
/**
 * Activating ANY panel (live or parked) flips `live` in place, never moving the entry's array position.
 * Returns `null` for an unknown id or one already live (a legitimate no-op, not an error). When promoting
 * `id` would exceed `capacity`, demotes exactly one OTHER live panel: whichever `leastRecentlyTouchedId`
 * picks by `touchedAt`. Never demotes a `collapsible: false` entry or any id in `keep`.
 * @internal
 */
export declare function promoteToLive(panels: PanelWindow[], id: string, capacity: number, touchedAt: (id: string) => number, keep?: ReadonlySet<string>): PanelWindow[] | null;
/**
 * Closes one panel COMPLETELY: it leaves the array, live or parked, so it leaves the row and History
 * together. Returns what a caller needs to log it and to undo it -- the array without it, the panel itself
 * and the index it had -- or `null` for an unknown `id` (already closed, cleared): nothing to do, not an
 * error. Every panel anchored to it takes over its own anchor, so they close up in the place it held.
 * @internal
 */
export declare function closePanel(panels: PanelWindow[], id: string, rootId: string): {
    remaining: PanelWindow[];
    closed: PanelWindow;
    index: number;
} | null;
/**
 * Moves `id` one PRESENT slot (`isPresent`, PanelRow's filter) toward `direction`, past
 * whichever present panel sits there, History included; a parked panel between the two shifts one array slot,
 * keeping firstParkedAfter/lastParkedBefore/sideOfLiveRange meaningful. Every anchor is then re-read from the
 * new order. The SAME array for every no-op: unknown id, a parked panel, one already at that edge, or any array slot from the source to the target
 * (parked ones included) holding an entry whose `crossable` setting is false.
 * @internal
 */
export declare function movePanel(panels: PanelWindow[], id: string, direction: 'left' | 'right', rootId: string): PanelWindow[];
/**
 * `by` hops of `movePanel` in one go, negative to the left: it stops at the first hop that moves nothing (an edge, a
 * `crossable: false` entry), keeping the hops already made. The SAME array when no hop moved, `by` is 0 or not a whole number.
 * @internal
 */
export declare function movePanelBy(panels: PanelWindow[], id: string, by: number, rootId: string): PanelWindow[];
/**
 * How many movePanel hops a horizontal drag of `offsetX` px asks for (+right/-left). A hop past a neighbour
 * moves the dragged panel by that NEIGHBOUR's span (its width plus `gap`), so each hop lands `hopFraction` (default
 * half) of the way across the next neighbour's span, counted from where the previous hop ended; the dragged panel's
 * own width never enters it. Exactly that fraction of a span is a hop either way, and this never returns -0.
 * @public
 * @deprecated A view reads its hops with `usePanelReorderSteps()` or hands `DragToClose` `usePanelDragProps()`; both use the row's tuned gap and hop fraction.
 */
export declare function reorderStepsForOffset(offsetX: number, neighbors: NeighborWidths, gap: number, hopFraction?: number): number;
/** The slot count `p` stands at: its own, else one. @internal */
export declare const slotsOf: (p: Pick<PanelWindow, "slots">) => number;
/**
 * `id` at `slots` wide (clamped to 1 and its `maxSlots`). Returns the SAME
 * array reference for every no-op: an unknown id or a panel already at the clamped count; a fixed column's `maxSlots` of 1 clamps it. A parked panel may change slots and stays parked.
 * @internal
 */
export declare function setSlots(panels: PanelWindow[], id: string, slots: number): PanelWindow[];
/**
 * Copies each listed entry's CURRENT `key` value (its anchor, its slot count, or its `collapsible` as `parkable`) into its
 * `overrides`, skipping the root, a marker, an entry with no settings and one whose `rememberLayout` is false. The
 * SAME array when nothing changed, so no commit follows.
 * @internal
 */
export declare function recordOverride(entries: readonly PanelWindow[], key: 'anchor' | 'slots' | 'parkable', ids: readonly string[], rootId: string): PanelWindow[];
/**
 * Sets `overrides` to `{}` on each listed entry that carries settings. The SAME array only when every such entry
 * already holds `{}`.
 * @internal
 */
export declare function clearOverrides(entries: readonly PanelWindow[], ids: readonly string[]): PanelWindow[];
/**
 * Reverses closePanel for one panel: puts `panel` back at `index` (clamped to the current length, so a shorter
 * array still takes it), unchanged -- a pure spread, no `hostData` reset (the host's undo does that itself: only
 * it knows what "unmounted when it closed" means for the opaque blob). An id already present leaves `panels`
 * unchanged (a double undo never duplicates). Live or parked is whatever `panel.live` says. Anchors are
 * re-read from the result: its old anchor may no longer describe that index.
 * @internal
 */
export declare function restorePanel(panels: PanelWindow[], panel: PanelWindow, index: number, rootId: string): PanelWindow[];
