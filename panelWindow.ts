/**
 * The `PanelWindow` model -- one browsing panel in the unified row -- and every pure state-transition
 * function that operates on a `PanelWindow[]` array.
 */
import type { JsonValue, PanelSummary } from 'phonux';

/**
 * One browsing panel in the unified row. Every panel goes through the same overflow/collapse mechanism
 * (`autoCollapseOldest`, `promoteToLive`) regardless of how it was opened. AdventurePanel.tsx renders every
 * entry in this array, live or parked -- never filtered to only parked ones.
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
  /** Which component renders this entry (phonux's registry, resolvePanelView) -- read ONLY by the rendering wrapper (LivePanels.tsx); every overflow/collapse/close site reads `collapsible`/`listed`/`locked` instead, never this. An open string, not a closed union: an unregistered value renders a placeholder, never a crash. */
  view: string;
  /** Overflow/auto-collapse/promote-demotion may park this entry; `false` marks an always-shown column exempt from all three. */
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

/** Builds a brand-new, live 'extra' panel for a just-intercepted new-window request or a PanelsAPI.create() call, immutably, and inserts it per `info.insertAt` (default: appended to the END, "to the right of any currently-open ones" per this entry's own intent, not inserted next to its source). History is seeded directly, never through this function, so it stays first with no extra invariant code here regardless of what else is inserted at 'start'. */
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
 * Parks the SINGLE OLDEST live, collapsible panel, by array order -- space management, not a close: the
 * panel stays in the array. `null` when nothing eligible is live to park. `promoteToLive` below reuses this
 * exact same "oldest live, by array order" policy for its own demotion, so there is one demotion rule in
 * this file, not two that could silently drift apart. Never picks a `collapsible: false` entry (History):
 * an always-shown column is exempt from every overflow/auto-collapse site, this one included.
 */
export function autoCollapseOldest(panels: PanelWindow[]): PanelWindow[] | null {
  const oldest = panels.find((p) => p.collapsible && p.live);
  if (!oldest) return null;
  return panels.map((p) => (p.id === oldest.id ? { ...p, live: false } : p));
}

/**
 * Clicking ANY adventure-card row (live or parked alike) activates it. The live row's rendering order
 * always follows the array's natural order, so this never moves the target panel's position -- it only
 * flips `live` in place, on the same array entry.
 *
 * `null` for an unknown `id` -- nothing to do. Also `null` when the target is ALREADY live: clicking an
 * already-live row (every row, live or parked, is clickable) is a legitimate no-op, not an error.
 *
 * `wouldOverflow(liveCountAfter)` is the caller's own overflow prediction (src/panel-layout.ts's
 * `predictWouldOverflow` for 'screen-width' mode, or adventureSettings.ts's `countModeShouldCollapse` for
 * 'count' mode) -- `liveCountAfter` is how many panels would be live counting the one just activated. When
 * it returns true, this demotes exactly one OTHER live panel back to parked: the OLDEST other live one, by
 * array order -- the SAME policy `autoCollapseOldest` uses, so there is one demotion rule, not two that
 * could drift apart. When it returns false, no demotion happens. Never demotes a `collapsible: false` entry
 * (History): a manual activation must not bump an always-shown column.
 */
export function promoteToLive(
  panels: PanelWindow[],
  id: string,
  wouldOverflow: (liveCountAfter: number) => boolean,
): PanelWindow[] | null {
  const target = panels.find((p) => p.id === id);
  if (!target || target.live) return null;
  const liveCountAfter = panels.filter((p) => p.collapsible && p.live).length + 1;
  let next = panels.map((p) => (p.id === id ? { ...p, live: true } : p));
  if (wouldOverflow(liveCountAfter)) {
    const demote = next.find((p) => p.collapsible && p.live && p.id !== id);
    if (demote) {
      next = next.map((p) => (p.id === demote.id ? { ...p, live: false } : p));
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
