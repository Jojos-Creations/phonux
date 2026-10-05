/**
 * The `PanelWindow` model -- one browsing panel in the unified row -- and every pure state-transition
 * function that operates on a `PanelWindow[]` array.
 */
import type { FormFactor, JsonValue, PanelSize } from './hostApi.js';
import { isPresent, type NeighborWidths } from './panelRowEntry.js';
import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import type { PanelAnchor } from './panelRowOrder.js';
import { effective } from './panelSettings.js';
import type { ResolvedPanelSettings } from './panelSettings.js';
import { DEFAULT_PANEL_SIZE, TIER_SIZES } from './panelTiers.js';

/**
 * One browsing panel in the unified row: either live in the row or parked, never both. Parking only flips
 * `live`; it never removes the entry from the array, only `closePanel` does.
 * @public
 */
export interface PanelWindow {
  id: string;
  url: string;
  title?: string;
  /** Host-supplied and opaque: every function here only copies it through, never reads or branches on it. Its
   * shape is a host-side agreement `JsonValue` cannot enforce. */
  hostData?: JsonValue;
  /** Mounted in the row right now. `false` means parked: still in this array, just not rendered. */
  live: boolean;
  /** Whether DragToClose's drag-down gesture may close this panel at all. Every panel created by `appendPanel` is unlocked. */
  locked: boolean;
  /** Which component renders this entry (phonux's registry, resolveView) -- read ONLY by the row (PanelRow); every park/close site reads `collapsible`/`listed`/`locked` instead, never this. An open string, not a closed union: an unregistered value renders a placeholder, never a crash. */
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
  /** This panel's own visual tier; createHistoryPanel/appendPanel always set it. Optional so a record built by hand without it still typechecks. */
  formFactor?: FormFactor;
  /** This panel's own rendered size (a host's panel component passes it to Panel/PanelFrame for a non-phone tier). Optional for the same reason as `formFactor`. */
  size?: PanelSize;
  /** The resolved settings this entry was created under, whose mirror fields (`locked`, `collapsible`, `listed`, `layer`, `anchoredEnter`, `formFactor`) were written from them. Absent for a hand-built entry, which behaves as it did before settings existed. */
  settings?: ResolvedPanelSettings;
  /** This entry's stable name, written once when it is created from settings; absent on a hand-built entry, whose `id` stands in. */
  key?: string;
  /** True only for the reserved '__root__' entry a row without a root keeps: it holds the anchor point, is never drawn and never counted as a column or a hop. */
  marker?: true;
}

/** History's own seeded entry: never collapsible (an always-shown column), never listed (it must not list itself), always live, locked by default (the host's close path honours `locked`); raised, so a left-exiting park slides under it; anchoredEnter, which against itself resolves 'right'; no anchor: it is the root every anchor leads to. Same default tier/size as every other entry: a permanent column carries a tier like any other. @internal */
export function createHistoryPanel(rootId: string): PanelWindow {
  return {
    id: rootId, url: '', title: 'History', live: true, locked: true,
    view: 'history', collapsible: false, listed: false, layer: 'raised', anchoredEnter: true,
    formFactor: 'phone', size: DEFAULT_PANEL_SIZE,
  };
}

/**
 * Per-call metadata create() may set beyond a bare url/source. No raw `collapsible`/`locked` key: `permanent`
 * is the only door to `collapsible:false` (see `appendPanel`'s own doc comment for what it forces), and
 * `locked` is never settable at all -- create() can never make an unclosable panel.
 * @internal
 */
export interface AppendPanelOptions {
  view?: string;
  title?: string;
  params?: JsonValue;
  /** Copied through to the new entry's `hostData` unchanged; absent means the entry carries no `hostData` key at all (never an explicit `undefined`). */
  hostData?: JsonValue;
  listed?: boolean;
  /** `panel` defaults to History, `priority` to one past the far end of that side. Default \{ position: 'right' \}. */
  anchor?: { panel?: string; position: 'left' | 'right'; priority?: number };
  layer?: 'base' | 'raised';
  anchoredEnter?: boolean;
  /** See `CreatePanelOptions.permanent` (hostApi.tsx) for the full contract; `appendPanel` is what enforces it. */
  permanent?: boolean;
  /** The new panel's tier. Ignored for a permanent column, which is always 'phone'. Default 'phone'. */
  formFactor?: FormFactor;
}

/** @internal */
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

/** `id` re-anchored per `request` (defaults as for appendPanel), the row re-ordered to match. The SAME array for an unknown id or an entry whose `placeable` setting is false (a fixed column by default). @internal */
export function reanchorPanel(panels: PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[] {
  const target = panels.find((p) => p.id === id);
  if (!target || !effective(target).placeable) return panels;
  return anchorPanel(panels, id, request, rootId);
}

/** `id` anchored per `request` and the row ordered to match, with no `placeable` check: a placement setting is the developer's own ask, not a person's re-anchor. @internal */
export function anchorPanel(panels: readonly PanelWindow[], id: string, request: AnchorRequest, rootId: string): PanelWindow[] {
  const anchor = fillAnchor(panels, rootId, request, id);
  return computeRowOrder(panels.map((p) => (p.id === id ? { ...p, anchor } : p)), rootId);
}

/**
 * Builds a brand-new, live 'extra' panel immutably and places it by `info.anchor` (default: right of
 * History, past every panel already there -- the row's far right end). History is seeded directly, never
 * through this function. `permanent` forces `collapsible:false` and `listed:false` (overriding any `info.listed`
 * passed) since such a column must supply its own close control, never the row's trash; `locked`
 * stays false regardless so that control keeps working with no extra plumbing (the host's close path gates
 * only on `locked`).
 * @internal
 */
export function appendPanel(panels: PanelWindow[], info: { url: string } & AppendPanelOptions, id: string, rootId: string): PanelWindow[] {
  const formFactor = info.permanent ? 'phone' : (info.formFactor ?? 'phone');
  const entry: PanelWindow = {
    id,
    url: info.url,
    ...(info.title !== undefined ? { title: info.title } : {}),
    ...(info.hostData !== undefined ? { hostData: info.hostData } : {}),
    live: true,
    locked: false,
    view: info.view ?? 'web',
    collapsible: !info.permanent,
    listed: info.permanent ? false : (info.listed ?? true),
    ...(info.params !== undefined ? { params: info.params } : {}),
    anchor: fillAnchor(panels, rootId, info.anchor ?? { position: 'right' }),
    layer: info.layer ?? 'base',
    anchoredEnter: info.anchoredEnter ?? false,
    // Every entry carries a tier; a permanent column's is always 'phone'.
    formFactor,
    size: formFactor === 'phone' ? DEFAULT_PANEL_SIZE : { ...TIER_SIZES[formFactor] },
  };
  return computeRowOrder([...panels, entry], rootId);
}

/** The park-lever settings of `p`: its own when its `overflow` is 'park', the library defaults otherwise, because a panel the row never parks for room has no lever to pull. @internal */
export function parkLevers(p: PanelWindow): Pick<ResolvedPanelSettings, 'evictionRank' | 'evictionOrder' | 'returnPriority' | 'capacityReturn'> {
  const s = effective(p);
  return s.overflow === 'park' ? s : { evictionRank: 0, evictionOrder: 'farthest', returnPriority: 0, capacityReturn: 'auto' };
}

/**
 * The id of the live collapsible panel to park for room, or null with none live: among the lowest `evictionRank`,
 * the one `order` picks by distance from `fromIndex` ('leftmost' and 'rightmost' ignore it); a tie goes to the lower
 * index. `exclude` exempts the panel being opened or restored, already live in `panels`, and any panel another
 * action in the same update must keep live.
 * @internal
 */
export function farthestLiveCollapsibleId(
  panels: PanelWindow[],
  fromIndex: number,
  exclude: ReadonlySet<string> = new Set(),
  order: ResolvedPanelSettings['evictionOrder'] = 'farthest',
): string | null {
  const candidates: { id: string; index: number; rank: number }[] = [];
  panels.forEach((p, index) => {
    if (p.collapsible && p.live && !exclude.has(p.id)) candidates.push({ id: p.id, index, rank: parkLevers(p).evictionRank });
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
  const liveCountAfter = panels.filter((p) => p.collapsible && p.live).length + 1;
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
 * new order. The SAME array for every no-op: unknown id, a source whose `draggable` setting is false (a fixed
 * column by default), a parked panel, one already at that edge, or any array slot from the source to the target
 * (parked ones included) holding an entry whose `crossable` setting is false.
 * @internal
 */
export function movePanel(panels: PanelWindow[], id: string, direction: 'left' | 'right', rootId: string): PanelWindow[] {
  const present = panels.filter(isPresent);
  const presentIndex = present.findIndex((p) => p.id === id);
  if (presentIndex < 0 || !effective(present[presentIndex]!).draggable) return panels;
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
 * How many movePanel hops a horizontal drag of `offsetX` px asks for (+right/-left). A hop past a neighbour
 * moves the dragged panel by that NEIGHBOUR's span (its width plus `gap`), so each hop lands half-way across
 * the next neighbour's span, counted from where the previous hop ended; the dragged panel's own width never
 * enters it. Exactly half a span is a hop either way, and this never returns -0.
 * @public
 */
export function reorderStepsForOffset(offsetX: number, neighbors: NeighborWidths, gap: number): number {
  const distance = Math.abs(offsetX);
  let travelled = 0;
  let steps = 0;
  for (const width of offsetX > 0 ? neighbors.right : neighbors.left) {
    const span = width + gap;
    if (distance < travelled + span / 2) break;
    travelled += span;
    steps++;
  }
  return steps === 0 ? 0 : Math.sign(offsetX) * steps;
}

/**
 * `id` at `next`'s tier, its `size` REPLACED by a fresh copy of that tier's TIER_SIZES entry. Returns the SAME
 * array reference for every no-op: an unknown id, an entry whose `resizable` setting is false (History or a
 * permanent column by default) or whose `formFactors` lacks `next`, or a panel already at `next`. A parked panel
 * may change tier and stays parked.
 * @internal
 */
export function setFormFactor(panels: PanelWindow[], id: string, next: FormFactor): PanelWindow[] {
  const target = panels.find((p) => p.id === id);
  if (!target) return panels;
  const allowed = effective(target);
  if (!allowed.resizable || !allowed.formFactors.includes(next) || (target.formFactor ?? 'phone') === next) return panels;
  return panels.map((p) => (p.id === id ? { ...p, formFactor: next, size: { ...TIER_SIZES[next] } } : p));
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
