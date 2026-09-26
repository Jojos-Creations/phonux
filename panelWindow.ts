/**
 * The `PanelWindow` model -- one browsing panel in the unified row -- and every pure state-transition
 * function that operates on a `PanelWindow[]` array.
 */
import type { JsonValue, PanelSummary } from 'phonux';

/**
 * One browsing panel in the unified row. Every panel is parked and revived by the same capacity rules
 * (usePanelManager.ts, over this file's helpers) regardless of how it was opened. AdventurePanel.tsx renders
 * every entry in this array, live or parked -- never filtered to only parked ones.
 *
 * A panel is EITHER shown live in the row (`live: true`) or parked in the adventure card only
 * (`live: false`) -- never both -- and is never removed from this array just for being parked; only
 * `closePanel` (a drag-down close or a History-row trash) ever drops an entry.
 */
/** The seeded History entry's id -- every array this model governs carries exactly one. */
export const HISTORY_PANEL_ID = 'history';

export interface PanelWindow {
  id: string;
  url: string;
  title?: string;
  webContentsId: number | null;
  /** The guest `<webview>` this panel's own new-window request came FROM -- electron/main.ts's `pageId`. `-1` for a panel that was not opened FROM another page (History's "+" makes these). */
  sourceWebContentsId: number;
  /** Mounted live in the row right now. `false` means parked in the adventure card only -- still fully present in this array, just not rendered as a `<webview>`. */
  live: boolean;
  /** Whether DragToClose's drag-down gesture may close this panel at all. Every panel created by `appendPanel` is unlocked. */
  locked: boolean;
  /** Which component renders this entry (phonux's registry, resolveView) -- read ONLY by the rendering wrapper (LivePanels.tsx); every park/close site reads `collapsible`/`listed`/`locked` instead, never this. An open string, not a closed union: an unregistered value renders a placeholder, never a crash. */
  view: string;
  /** Capacity parks (an open, a revive, the row gesture, a capacity drop) may park this entry; `false` marks an always-shown column exempt from all of them. */
  collapsible: boolean;
  /** Appears in the public `panelList` (History's own row list, and PanelsAPI). */
  listed: boolean;
  /** Opaque per-panel data a create() caller supplied (PanelsAPI.create's `params`); undefined for built-ins. Threaded to PanelSummary.params by this file's own summarisePanel(); no behavior site here reads it. */
  params?: JsonValue;
  /** Where a NEW entry lands in the array -- read ONLY by insertPanelAt, at the moment this entry is inserted, never again afterward. 'start' = right after the last non-collapsible entry (e.g. History), never before one. Default 'end'. */
  insertAt?: 'start' | 'end';
  /** Which of the row's two stacking tiers this entry's slot sits in -- read ONLY by LivePanels.tsx's per-slot zIndex. Default 'base'. */
  layer?: 'base' | 'raised';
  /** Whether this entry's reappearance always resolves through the anchor formula (resolveEnterDirection) instead of unconditionally entering from the right -- read ONLY by LivePanels.tsx's enterDirection. Default false. */
  anchoredEnter?: boolean;
}

/** The one PanelWindow -> PanelSummary projection: every site that hands a panel to a VIEW (LivePanels.tsx's resolved component, useProvidePanels.ts's panelList/recentlyClosed) narrows through this SAME function, so a third-party or built-in view can never see a desktop-only field (webContentsId, collapsible, insertAt, layer, anchoredEnter, ...). */
export const summarisePanel = ({ id, url, title, live, locked, params }: PanelWindow): PanelSummary => ({ id, url, title, live, locked, params });

/** History's own seeded entry: never collapsible (an always-shown column), never listed (it must not list itself), always live, locked by default (usePanelClosing.ts's lock gate); raised/anchored so its slot and reappearance behave the way they always have. */
export function createHistoryPanel(): PanelWindow {
  return {
    id: HISTORY_PANEL_ID, url: '', title: 'History', webContentsId: null, sourceWebContentsId: -1, live: true, locked: true,
    view: 'history', collapsible: false, listed: false, insertAt: 'start', layer: 'raised', anchoredEnter: true,
  };
}

/** Per-call metadata create() may set beyond a bare url/source. Deliberately no `collapsible`/`locked` key: create() can never make a permanent column or an unclosable panel. */
export interface AppendPanelOptions {
  view?: string;
  title?: string;
  params?: JsonValue;
  listed?: boolean;
  insertAt?: 'start' | 'end';
  layer?: 'base' | 'raised';
  anchoredEnter?: boolean;
}

/** Inserts `entry` at the position its OWN `insertAt` says: 'end' (default) appends; 'start' lands right after the last non-collapsible entry (e.g. History), never before one. */
function insertPanelAt(panels: PanelWindow[], entry: PanelWindow): PanelWindow[] {
  if (entry.insertAt !== 'start') return [...panels, entry];
  let at = 0;
  for (let i = 0; i < panels.length; i++) if (!panels[i]!.collapsible) at = i + 1;
  return [...panels.slice(0, at), entry, ...panels.slice(at)];
}

/** Builds a brand-new, live 'extra' panel for a just-intercepted new-window request or a PanelsAPI.create() call, immutably, and inserts it per `info.insertAt` (default: appended to the END, to the right of any currently-open ones, not next to its source). History is seeded directly, never through this function, so it stays first with no extra invariant code here regardless of what else is inserted at 'start'. */
export function appendPanel(panels: PanelWindow[], info: { sourceWebContentsId: number; url: string } & AppendPanelOptions, id: string): PanelWindow[] {
  const entry: PanelWindow = {
    id,
    url: info.url,
    ...(info.title !== undefined ? { title: info.title } : {}),
    webContentsId: null,
    sourceWebContentsId: info.sourceWebContentsId,
    live: true,
    locked: false,
    view: info.view ?? 'web',
    collapsible: true,
    listed: info.listed ?? true,
    ...(info.params !== undefined ? { params: info.params } : {}),
    insertAt: info.insertAt ?? 'end',
    layer: info.layer ?? 'base',
    anchoredEnter: info.anchoredEnter ?? false,
  };
  return insertPanelAt(panels, entry);
}

/**
 * The id of the live collapsible panel farthest (by array index) from `fromIndex`, or null with none live.
 * Ties go to the lower index (the strict `>` keeps the first). From an append (`fromIndex` = the new length)
 * that is the LEFT end of the live range; from an `insertAt: 'start'` or a revive left of the range it is the
 * RIGHT end. promoteToLive and usePanelManager.ts's open/restore park both pick through this. `excludeId`
 * exempts the panel being opened or restored, which is already live in the array the caller passes.
 */
export function farthestLiveCollapsibleId(panels: PanelWindow[], fromIndex: number, excludeId?: string): string | null {
  let bestId: string | null = null;
  let bestDist = -1;
  panels.forEach((p, i) => {
    if (!p.collapsible || !p.live || p.id === excludeId) return;
    const dist = Math.abs(i - fromIndex);
    if (dist > bestDist) {
      bestDist = dist;
      bestId = p.id;
    }
  });
  return bestId;
}

/**
 * Which side of the row a park/reveal at `id` reads as, for the exit/enter animation: 'left' when `id`'s
 * own array index sits below every OTHER live collapsible panel's index, 'right' otherwise (a parked panel
 * between two live ones included). Computed fresh from array position every time, never a persisted flag,
 * so an append's park always reads 'left' and an `insertAt: 'start'` park always reads 'right'.
 */
export function sideOfLiveRange(panels: PanelWindow[], id: string): 'left' | 'right' {
  const ownIndex = panels.findIndex((p) => p.id === id);
  let firstOtherLiveIndex = Number.POSITIVE_INFINITY;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live && p.id !== id) firstOtherLiveIndex = Math.min(firstOtherLiveIndex, i);
  });
  return ownIndex < firstOtherLiveIndex ? 'left' : 'right';
}

/** The row-slot index of the LEFTMOST (lowest-index) live collapsible panel, or -1 if none are live. */
export function leftmostLiveIndex(panels: PanelWindow[]): number {
  for (let i = 0; i < panels.length; i++) if (panels[i]!.collapsible && panels[i]!.live) return i;
  return -1;
}

/** The row-slot index of the RIGHTMOST (highest-index) live collapsible panel, or -1 if none are live. */
export function rightmostLiveIndex(panels: PanelWindow[]): number {
  let found = -1;
  panels.forEach((p, i) => {
    if (p.collapsible && p.live) found = i;
  });
  return found;
}

/** The first PARKED collapsible panel strictly after `index` -- a rightward gesture's own "next one to bring in", or null with nothing parked on that side. */
export function firstParkedAfter(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index + 1; i < panels.length; i++) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/** The last PARKED collapsible panel strictly before `index` -- a leftward gesture's own "next one to bring in", or null with nothing parked on that side. */
export function lastParkedBefore(panels: PanelWindow[], index: number): PanelWindow | null {
  for (let i = index - 1; i >= 0; i--) if (panels[i]!.collapsible && !panels[i]!.live) return panels[i]!;
  return null;
}

/**
 * Clicking ANY adventure-card row (live or parked alike) activates it. The live row's rendering order
 * always follows the array's natural order, so this never moves the target panel's position -- it only
 * flips `live` in place, on the same array entry.
 *
 * `null` for an unknown `id` -- nothing to do. Also `null` when the target is ALREADY live: clicking an
 * already-live row (every row, live or parked, is clickable) is a legitimate no-op, not an error.
 *
 * `capacity` is how many live collapsible panels the row may hold at once (usePanelManager.ts's own
 * `max(1, effectiveMax - fixedColumnCount)`). When promoting `id` would exceed it, this demotes exactly one
 * OTHER live panel back to parked: the one `farthestLiveCollapsibleId` picks from `id`'s OWN index, the same
 * far rule an open or restore parks by. Never demotes a `collapsible: false` entry (History): a manual
 * activation must not bump an always-shown column.
 */
export function promoteToLive(panels: PanelWindow[], id: string, capacity: number): PanelWindow[] | null {
  const target = panels.find((p) => p.id === id);
  if (!target || target.live) return null;
  const ownIndex = panels.findIndex((p) => p.id === id);
  const liveCountAfter = panels.filter((p) => p.collapsible && p.live).length + 1;
  let next = panels.map((p) => (p.id === id ? { ...p, live: true } : p));
  if (liveCountAfter > capacity) {
    // `panels` (pre-promotion): `id` itself still reads live:false there, so it is naturally excluded
    // from the search without needing `excludeId`.
    const demote = farthestLiveCollapsibleId(panels, ownIndex);
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
 * error.
 */
export function closePanel(panels: PanelWindow[], id: string): { remaining: PanelWindow[]; closed: PanelWindow; index: number } | null {
  const index = panels.findIndex((p) => p.id === id);
  if (index < 0) return null;
  return { remaining: panels.filter((p) => p.id !== id), closed: panels[index]!, index };
}

/**
 * Moves `id` one PRESENT slot toward `direction` (present = `!collapsible || live`, the SAME filter
 * LivePanels.tsx renders), swapping past whichever OTHER present panel currently sits there; every entry's
 * relative order is otherwise untouched -- a parked panel physically between the two present panels simply
 * shifts by one array slot, which is what keeps firstParkedAfter/lastParkedBefore/sideOfLiveRange meaningful
 * after a reorder (a single present-hop can cross several parked array slots at once; this is the "moving a
 * live panel across parked entries" case). Returns the SAME array reference (never a copy) for every no-op:
 * an unknown id, a `collapsible: false` entry (e.g. History -- an always-shown column is never a reorder
 * source OR TARGET: a `collapsible:false` neighbor must also block the swap, or a live panel could displace
 * a fixed column out of its seeded slot), a panel that is not currently present (parked, never a drag
 * source), or one already at that edge of the present range.
 */
export function movePanel(panels: PanelWindow[], id: string, direction: 'left' | 'right'): PanelWindow[] {
  const present = panels.filter((p) => !p.collapsible || p.live);
  const presentIndex = present.findIndex((p) => p.id === id);
  if (presentIndex < 0 || !present[presentIndex]!.collapsible) return panels;
  const neighbor = present[direction === 'left' ? presentIndex - 1 : presentIndex + 1];
  if (!neighbor || !neighbor.collapsible) return panels;
  const from = panels.findIndex((p) => p.id === id);
  const to = panels.findIndex((p) => p.id === neighbor.id);
  const next = panels.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry!);
  return next;
}

/**
 * How many movePanel hops a horizontal drag of `offsetX` px asks for (+right/-left), one per `slotWidth`:
 * past a sibling's midpoint is one hop. Rounds the MAGNITUDE, so an exact half slot is a hop either way
 * (`Math.round(-0.5)` is -0, which would drop a leftward tie), and never returns -0.
 */
export function reorderStepsForOffset(offsetX: number, slotWidth: number): number {
  const steps = Math.round(Math.abs(offsetX) / slotWidth);
  return steps === 0 ? 0 : Math.sign(offsetX) * steps;
}

/**
 * Reverses closePanel for one panel: puts `panel` back at `index` (clamped to
 * the current length, so a shorter array still takes it), `webContentsId` reset
 * because whatever it pointed at was unmounted when it closed. An id that is
 * already present leaves `panels` unchanged (a double undo never duplicates).
 * Whether it comes back live or parked is the caller's choice: it is whatever
 * `panel.live` says.
 */
export function restorePanel(panels: PanelWindow[], panel: PanelWindow, index: number): PanelWindow[] {
  if (panels.some((p) => p.id === panel.id)) return panels;
  const at = Math.max(0, Math.min(index, panels.length));
  return [...panels.slice(0, at), { ...panel, webContentsId: null }, ...panels.slice(at)];
}
