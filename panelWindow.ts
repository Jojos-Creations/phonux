/**
 * The `PanelWindow` model -- one browsing panel in the unified row -- and every pure state-transition
 * function that operates on a `PanelWindow[]` array.
 */
import { DEFAULT_LABELS } from './labels.js';
import type { JsonValue, PanelSize } from './hostApi.js';
import { isPresent, type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import type { PanelAnchor } from './panelRowOrder.js';
import { FIXED, effective } from './panelSettings.js';
import { newPanelUid } from './panelUid.js';
import type { AddPlacement, FixedBehaviour, PanelSettings, ResolvedPanelSettings } from './panelSettings.js';
import type { DeferredPin } from './panelTemplate.js';
import { DEFAULT_PANEL_SIZE, sizeOfSlots } from './panelTiers.js';
import { HOP_FRACTION } from './rowConstants.js';

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
  /** This panel's own rendered size (a host's panel component passes it to Panel/PanelFrame for a panel wider than one slot). createHistoryPanel/appendPanel always set it. Optional so a record built by hand without it still typechecks. */
  size?: PanelSize;
  /** How many phone-panel widths wide this entry is set to. Absent on a hand-built entry, which reads as one slot. */
  slots?: number;
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
  applied?: { placeOnAdd: AddPlacement };
  /** True for an entry created from a declaration in code, which code re-declares at every launch. */
  declared?: true;
  /** A pin change waiting for this entry to become live, applied inside whichever path makes it live. Session only: never saved. */
  deferredPin?: DeferredPin;
  /** True only for the reserved '__root__' entry a row without a root keeps: it holds the anchor point, is never drawn and never counted as a column or a hop. */
  marker?: true;
}

/** History's own seeded entry: never collapsible (an always-shown column), never listed (it must not list itself), always live, never closed (the close path refuses the root); raised, so a left-exiting park slides under it; anchoredEnter, which against itself resolves 'right'; no anchor: it is the root every anchor leads to. Same default size as every other entry. @internal */
export function createHistoryPanel(rootId: string, title: string = DEFAULT_LABELS.historyTitle): PanelWindow {
  return {
    id: rootId, url: '', title, live: true,
    view: 'history', collapsible: false, listed: false, layer: 'raised', anchoredEnter: true,
    size: DEFAULT_PANEL_SIZE,
  };
}

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
/** `request` with its defaults filled against `panels`: History, and one past the highest priority already on that side (`self` excluded). */
function fillAnchor(panels: readonly PanelWindow[], rootId: string, request: AnchorRequest, self?: string): PanelAnchor {
  const panel = request.panel ?? rootId;
  if (request.priority !== undefined) return { panel, position: request.position, priority: request.priority };
  const positional = new Map(deriveAnchorsFromOrder(panels, rootId).map((p) => [p.id, p.anchor]));
  let max = -1;
  for (const p of panels) {
    const a = p.anchor ?? positional.get(p.id);
    if (p.id !== self && p.id !== rootId && a && a.panel === panel && a.position === request.position) max = Math.max(max, a.priority);
  }
  return { panel, position: request.position, priority: max + 1 };
}

/** `id` re-anchored per `request` (defaults as for appendPanel), the row re-ordered to match. The SAME array for an unknown id or the root. @internal */
export function reanchorPanel(panels: PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[] {
  if (id === rootId || !panels.some((p) => p.id === id)) return panels;
  return anchorPanel(panels, id, request, rootId);
}

/** `id` anchored per `request` and the row ordered to match, with no check at all. @internal */
export function anchorPanel(panels: readonly PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[] {
  const anchor = fillAnchor(panels, rootId, request, id);
  return computeRowOrder(panels.map((p) => (p.id === id ? { ...p, anchor } : p)), rootId);
}

/**
 * Builds a brand-new, live 'extra' panel immutably and places it by `info.anchor` (default: right of
 * History, past every panel already there -- the row's far right end). History is seeded directly, never
 * through this function. `permanent` forces `collapsible:false` and `listed:false` (overriding any `info.listed`
 * passed) since such a column must supply its own close control, never the row's trash; that control
 * closes it through the developer's own `close`, which `closable` does not limit.
 * @internal
 */
export function appendPanel(panels: PanelWindow[], info: { url?: string } & AppendPanelOptions, id: string, rootId: string, uid: string = newPanelUid()): PanelWindow[] {
  const slots = info.permanent ? 1 : Math.max(1, Math.round(info.slots ?? 1));
  const entry: PanelWindow = {
    id,
    uid,
    url: info.url ?? '',
    ...(info.title !== undefined ? { title: info.title } : {}),
    ...(info.hostData !== undefined ? { hostData: info.hostData } : {}),
    live: true,
    view: info.view ?? 'web',
    collapsible: !info.permanent,
    listed: info.permanent ? false : (info.listed ?? true),
    ...(info.params !== undefined ? { params: info.params } : {}),
    anchor: fillAnchor(panels, rootId, info.anchor ?? { position: 'right' }),
    layer: info.layer ?? 'base',
    anchoredEnter: info.anchoredEnter ?? false,
    // Every entry carries its slot count; a permanent column's is always one.
    slots,
    size: sizeOfSlots(slots),
  };
  return computeRowOrder([...panels, entry], rootId);
}

/** Whether the row may park `p` to make room: a collapsible entry whose `overflow` is 'park', which every hand-built collapsible entry reads as. Any other entry scrolls instead. @internal */
export function parksForRoom(p: PanelWindow | PanelRowEntry): boolean {
  return p.collapsible && effective(p).overflow === 'park';
}

/** The park levers of `p`: its own `capacityReturn` when its `overflow` is 'park', 'auto' otherwise, because a panel the row never parks for room has no lever to pull. @internal */
export function parkLevers(p: PanelWindow): Pick<FixedBehaviour, 'evictionRank' | 'evictionOrder' | 'returnPriority'> & Pick<ResolvedPanelSettings, 'capacityReturn'> {
  const s = effective(p);
  return { evictionRank: FIXED.evictionRank, evictionOrder: FIXED.evictionOrder, returnPriority: FIXED.returnPriority, capacityReturn: s.overflow === 'park' ? s.capacityReturn : 'auto' };
}

/**
 * The id of the live panel to park for room (one whose `overflow` is 'park'), or null with none live: among the lowest `evictionRank`,
 * the one `order` picks by distance from `fromIndex` ('leftmost' and 'rightmost' ignore it); a tie goes to the lower
 * index. `exclude` exempts the panel being opened or restored, already live in `panels`, and any panel another
 * action in the same update must keep live.
 * @internal
 */
export function farthestLiveCollapsibleId(
  panels: PanelWindow[],
  fromIndex: number,
  exclude: ReadonlySet<string> = new Set(),
  order: FixedBehaviour['evictionOrder'] = 'farthest',
): string | null {
  const candidates: { id: string; index: number; rank: number }[] = [];
  panels.forEach((p, index) => {
    if (p.live && parksForRoom(p) && !exclude.has(p.id)) candidates.push({ id: p.id, index, rank: parkLevers(p).evictionRank });
  });
  if (candidates.length === 0) return null;
  const lowest = Math.min(...candidates.map((c) => c.rank));
  let best: { id: string; index: number } | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (c.rank !== lowest) continue;
    const distance = Math.abs(c.index - fromIndex);
    const score = order === 'farthest' ? distance : order === 'nearest' ? -distance : order === 'rightmost' ? c.index : -c.index;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best?.id ?? null;
}

/**
 * Which side of the row a park/reveal at `id` reads as, for the exit/enter animation: 'left' when `id`'s
 * own array index sits below every OTHER live collapsible panel's index, 'right' otherwise (a parked panel
 * between two live ones included). Computed fresh from array position every time, never a persisted flag,
 * so an append's park always reads 'left' and a park for an open anchored nearest History reads 'right'.
 * @internal
 */
export function sideOfLiveRange(panels: PanelWindow[], id: string): 'left' | 'right' {
  const ownIndex = panels.findIndex((p) => p.id === id);
  let firstOtherLiveIndex = Number.POSITIVE_INFINITY;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live && p.id !== id) firstOtherLiveIndex = Math.min(firstOtherLiveIndex, i);
  });
  return ownIndex < firstOtherLiveIndex ? 'left' : 'right';
}

/** The row-slot index of the LEFTMOST (lowest-index) live collapsible panel, or -1 if none are live. @internal */
export function leftmostLiveIndex(panels: PanelWindow[]): number {
  for (let i = 0; i < panels.length; i++) if (panels[i]!.collapsible && panels[i]!.live) return i;
  return -1;
}

/** The row-slot index of the RIGHTMOST (highest-index) live collapsible panel, or -1 if none are live. @internal */
export function rightmostLiveIndex(panels: PanelWindow[]): number {
  let found = -1;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live) found = i;
  });
  return found;
}

/** The first PARKED collapsible panel strictly after `index` -- a rightward gesture's own "next one to bring in", or null with nothing parked on that side. @internal */
export function firstParkedAfter(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index + 1; i < panels.length; i++) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/** The last PARKED collapsible panel strictly before `index` -- a leftward gesture's own "next one to bring in", or null with nothing parked on that side. @internal */
export function lastParkedBefore(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index - 1; i >= 0; i--) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/**
 * Activating ANY panel (live or parked) flips `live` in place, never moving the entry's array position.
 * Returns `null` for an unknown id or one already live (a legitimate no-op, not an error). When promoting
 * `id` would exceed `capacity`, demotes exactly one OTHER live panel: whichever `farthestLiveCollapsibleId`
 * picks from `id`'s own index by `id`'s own `evictionOrder`. Never demotes a
 * `collapsible: false` entry or any id in `keep`.
 * @internal
 */
export function promoteToLive(panels: PanelWindow[], id: string, capacity: number, keep: ReadonlySet<string> = new Set()): PanelWindow[] | null {
  const target = panels.find((p) => p.id === id);
  if (!target || target.live) return null;
  const ownIndex = panels.findIndex((p) => p.id === id);
  const liveCountAfter = panels.filter((p) => p.live && parksForRoom(p)).length + (parksForRoom(target) ? 1 : 0);
  let next = panels.map((p) => (p.id === id ? { ...p, live: true } : p));
  if (liveCountAfter > capacity) {
    // `panels` (pre-promotion): `id` itself still reads live:false there, so it is naturally excluded
    // from the search without needing `keep`.
    const demote = farthestLiveCollapsibleId(panels, ownIndex, keep, parkLevers(target).evictionOrder);
    if (demote) {
      next = next.map((p) => (p.id === demote ? { ...p, live: false } : p));
    }
  }
  return next;
}

/**
 * Closes one panel COMPLETELY: it leaves the array, live or parked, so it leaves the row and History
 * together. Returns what a caller needs to log it and to undo it -- the array without it, the panel itself
 * and the index it had -- or `null` for an unknown `id` (already closed, cleared): nothing to do, not an
 * error. Every panel anchored to it takes over its own anchor, so they close up in the place it held.
 * @internal
 */
export function closePanel(panels: PanelWindow[], id: string, rootId: string): { remaining: PanelWindow[]; closed: PanelWindow; index: number } | null {
  const index = panels.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const closed = panels[index]!;
  const inherited = closed.anchor ?? deriveAnchorsFromOrder(panels, rootId)[index]!.anchor;
  const rest = panels.filter((p) => p.id !== id).map((p) => (inherited && p.anchor?.panel === id ? { ...p, anchor: { ...inherited } } : p));
  return { remaining: computeRowOrder(rest, rootId), closed, index };
}

/**
 * Moves `id` one PRESENT slot (`isPresent`, PanelRow's filter) toward `direction`, past
 * whichever present panel sits there, History included; a parked panel between the two shifts one array slot,
 * keeping firstParkedAfter/lastParkedBefore/sideOfLiveRange meaningful. Every anchor is then re-read from the
 * new order. The SAME array for every no-op: unknown id, the root, a parked panel, one already at that edge, or any array slot from the source to the target
 * (parked ones included) holding an entry whose `crossable` setting is false.
 * @internal
 */
export function movePanel(panels: PanelWindow[], id: string, direction: 'left' | 'right', rootId: string): PanelWindow[] {
  const present = panels.filter(isPresent);
  const presentIndex = present.findIndex((p) => p.id === id);
  if (presentIndex < 0 || id === rootId) return panels;
  const neighbor = present[direction === 'left' ? presentIndex - 1 : presentIndex + 1];
  if (!neighbor) return panels;
  const from = panels.findIndex((p) => p.id === id);
  const to = panels.findIndex((p) => p.id === neighbor.id);
  const step = to > from ? 1 : -1;
  for (let i = from + step; i !== to + step; i += step) if (!effective(panels[i]!).crossable) return panels;
  const next = panels.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return deriveAnchorsFromOrder(next, rootId);
}

/**
 * `by` hops of `movePanel` in one go, negative to the left: it stops at the first hop that moves nothing (an edge, a
 * `crossable: false` entry), keeping the hops already made. The SAME array when no hop moved, `by` is 0 or not a whole number.
 * @internal
 */
export function movePanelBy(panels: PanelWindow[], id: string, by: number, rootId: string): PanelWindow[] {
  if (!Number.isInteger(by) || by === 0) return panels;
  const direction = by > 0 ? 'right' : 'left';
  let row = panels;
  for (let i = Math.abs(by); i > 0; i -= 1) {
    const next = movePanel(row, id, direction, rootId);
    if (next === row) break;
    row = next;
  }
  return row;
}

/**
 * How many movePanel hops a horizontal drag of `offsetX` px asks for (+right/-left). A hop past a neighbour
 * moves the dragged panel by that NEIGHBOUR's span (its width plus `gap`), so each hop lands `hopFraction` (default
 * half) of the way across the next neighbour's span, counted from where the previous hop ended; the dragged panel's
 * own width never enters it. Exactly that fraction of a span is a hop either way, and this never returns -0.
 * @public
 * @deprecated A view reads its hops with `usePanelReorderSteps()` or hands `DragToClose` `usePanelDragProps()`; both use the row's tuned gap and hop fraction.
 */
export function reorderStepsForOffset(offsetX: number, neighbors: NeighborWidths, gap: number, hopFraction: number = HOP_FRACTION): number {
  const distance = Math.abs(offsetX);
  let travelled = 0;
  let steps = 0;
  for (const width of offsetX > 0 ? neighbors.right : neighbors.left) {
    const span = width + gap;
    if (distance < travelled + span * hopFraction) break;
    travelled += span;
    steps++;
  }
  return steps === 0 ? 0 : Math.sign(offsetX) * steps;
}

/** The slot count `p` stands at: its own, else one. @internal */
export const slotsOf = (p: Pick<PanelWindow, 'slots'>): number => p.slots ?? 1;

/**
 * `id` at `slots` wide (clamped to 1 and its `maxSlots`), its `size` REPLACED by the size of that slot count. Returns the SAME
 * array reference for every no-op: an unknown id or a panel already at the clamped count; a fixed column's `maxSlots` of 1 clamps it. A parked panel may change size and stays parked.
 * @internal
 */
export function setSlots(panels: PanelWindow[], id: string, slots: number): PanelWindow[] {
  const target = panels.find((p) => p.id === id);
  if (!target || !Number.isFinite(slots)) return panels;
  const allowed = effective(target);
  const next = Math.max(1, Math.min(Math.round(slots), allowed.maxSlots));
  if (slotsOf(target) === next) return panels;
  return panels.map((p) => (p.id === id ? { ...p, slots: next, size: sizeOfSlots(next) } : p));
}

/** Whether `p` records the person's changes at all: it carries settings. */
const remembers = (p: PanelWindow, rootId: string): boolean => p.id !== rootId && p.marker !== true && p.settings !== undefined && FIXED.rememberLayout;

/**
 * Copies each listed entry's CURRENT `key` value (its anchor, its slot count, or its `collapsible` as `parkable`) into its
 * `overrides`, skipping the root, a marker, an entry with no settings and one whose `rememberLayout` is false. The
 * SAME array when nothing changed, so no commit follows.
 * @internal
 */
export function recordOverride(entries: readonly PanelWindow[], key: 'anchor' | 'slots' | 'parkable', ids: readonly string[], rootId: string): PanelWindow[] {
  const wanted = new Set(ids);
  const positional = new Map(deriveAnchorsFromOrder(entries, rootId).map((p) => [p.id, p.anchor]));
  let changed = false;
  const next = entries.map((p): PanelWindow => {
    if (!wanted.has(p.id) || !remembers(p, rootId)) return p;
    const from = p.anchor ?? positional.get(p.id);
    if (key === 'anchor') {
      const held = p.overrides?.anchor;
      if (from === undefined || (held !== undefined && held.panel === from.panel && held.position === from.position && held.priority === from.priority)) return p;
      changed = true;
      return { ...p, overrides: { ...p.overrides, anchor: { panel: from.panel, position: from.position, priority: from.priority } } };
    }
    const value = key === 'slots' ? slotsOf(p) : p.collapsible;
    if (p.overrides?.[key] === value) return p;
    changed = true;
    return { ...p, overrides: { ...p.overrides, [key]: value } };
  });
  return changed ? next : (entries as PanelWindow[]);
}

/**
 * Sets `overrides` to `{}` on each listed entry that carries settings. The SAME array only when every such entry
 * already holds `{}`.
 * @internal
 */
export function clearOverrides(entries: readonly PanelWindow[], ids: readonly string[]): PanelWindow[] {
  const wanted = new Set(ids);
  let changed = false;
  const next = entries.map((p): PanelWindow => {
    if (!wanted.has(p.id) || p.settings === undefined || (p.overrides !== undefined && Object.keys(p.overrides).length === 0)) return p;
    changed = true;
    return { ...p, overrides: {} };
  });
  return changed ? next : (entries as PanelWindow[]);
}

/**
 * Reverses closePanel for one panel: puts `panel` back at `index` (clamped to the current length, so a shorter
 * array still takes it), unchanged -- a pure spread, no `hostData` reset (the host's undo does that itself: only
 * it knows what "unmounted when it closed" means for the opaque blob). An id already present leaves `panels`
 * unchanged (a double undo never duplicates). Live or parked is whatever `panel.live` says. Anchors are
 * re-read from the result: its old anchor may no longer describe that index.
 * @internal
 */
export function restorePanel(panels: PanelWindow[], panel: PanelWindow, index: number, rootId: string): PanelWindow[] {
  if (panels.some((p) => p.id === panel.id)) return panels;
  const at = Math.max(0, Math.min(index, panels.length));
  return deriveAnchorsFromOrder([...panels.slice(0, at), { ...panel }, ...panels.slice(at)], rootId);
}
