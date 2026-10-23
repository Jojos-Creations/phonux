import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { createPanelList } from './panelList.js';
import { flushSync } from 'react-dom';
import type { JsonValue } from '../hostApi.js';
import { reportNotes, restorePlaced } from '../panelPlacement.js';
import { FIXED, effective, panelKey } from '../panelSettings.js';
import type { AddPlacement, SettingNote } from '../panelSettings.js';
import { closePanel, sideOfLiveRange, type PanelWindow } from '../panelWindow.js';
import type { UsePanelManagerResult } from './usePanelManager.js';

/** `panel` carrying `hostData`; `undefined` leaves no `hostData` key at all, the same shape appendPanel produces. */
function withHostData(panel: PanelWindow, hostData: JsonValue | undefined): PanelWindow {
  const next: PanelWindow = { ...panel };
  if (hostData === undefined) delete next.hostData;
  else next.hostData = hostData;
  return next;
}

/** A view closed inside the current undo window: the panel, where it sat, the id of its entry in the background log, and whether that entry was reported to the host. */
interface ClosedView {
  panel: PanelWindow;
  index: number;
  logId: string;
  reported: boolean;
  /** True once a reset marked it: an undo then restores it by its defaults, placed by its `placeOnAdd`. */
  reset?: true;
}

/** What `undoClose` restores in place of the entry that closed: the entry as the workspace would build it now, and where it goes. */
export type Reapplied = { panel: PanelWindow; placeAs: 'old-slot' | AddPlacement };

export interface UsePanelClosingResult {
  /** Closes a view completely and opens the undo window, or extends it to at least the panel's `undoWindowMs` from now (a panel with 0 is final at once). Unknown, root or already-closed id: does nothing and answers false. */
  close: (id: string) => boolean;
  /** Drops the views closed inside the window whose key is `key`, so an undo has nothing to skip or report for them. True when one was dropped. */
  forgetClosed: (key: string) => boolean;
  /** The ids of the views closed inside the window now, even when no render has seen the close yet. */
  closedIds: () => string[];
  /** Restores every view closed inside the window, last closed first, each at its old index; a live one comes back live. */
  undoClose: () => void;
  /** Marks the view closed inside the window under `id` as reset: `reset` rewrites its entry to the cascade's defaults, and an undo places it by its `placeOnAdd`. False when no such view is in the window. */
  markReset: (id: string, reset: (panel: PanelWindow) => PanelWindow) => boolean;
  /** The views closed inside the window, oldest first; non-null exactly while the window is open. */
  recentlyClosed: PanelWindow[] | null;
  /**
   * Ids leaving through THIS hook's `close()`, never usePanelManager's auto-collapse (which only flips `live`):
   * PanelRow reads it for each exiting PanelRowSlot's `exitDirection` (down for a close, left for a park).
   * See `close()` for why an id must land here BEFORE the panel leaves `panels`.
   */
  closingIds: ReadonlySet<string>;
}

/**
 * A close (drag down, or History's trash) removes the view COMPLETELY, reports it through `onPanelsClosed` unless its
 * `reportClose` is false, and offers Undo until the one shared window ends: it ends at the latest of the closes' own
 * `undoWindowMs` after each close, and no close shortens it. Takes the CURRENT render's values, so nothing here may be memoised, and `close` reads the index from
 * that render: two closes before one re-render would undo in the wrong order (discrete gestures re-render between
 * events), so a caller that batches closes needs one setPanels for the lot. Log ids are `<closedAt>#<panel id>`: panel
 * ids restart each launch, and a host undoing by id would otherwise also delete an older launch's entry.
 */
export function usePanelClosing(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  revealPanelProactively: UsePanelManagerResult['revealPanelProactively'],
  rootId: string,
  /**
   * Called once per successful close with the id that just left and `closePanel`'s `remaining`, the array right
   * after it, computed from THIS render's `panels` like everything else in `close()`.
   */
  onAfterClose?: (id: string, remaining: PanelWindow[]) => void,
  /**
   * Called per panel `undoClose` restores LIVE (the branch that calls `revealPanelProactively`): with
   * usePanelManager.ts's `revealMostRecentlyCollapsed`, one of the two paths that enter from the anchor's side.
   * `side` is set when its `undoPlacement` moved it: the side of the row it landed on, which the anchor cannot say.
   */
  onRestoreLive?: (id: string, side?: 'left' | 'right') => void,
  /**
   * Called with the panels the undo window's NATURAL elapse just finalized (Undo calls stopWindow() instead), and
   * at once with a panel whose `undoWindowMs` is 0, so a caller can tell a restored close from one nothing will
   * ever undo.
   */
  onWindowElapsed?: (panels: PanelWindow[]) => void,
  /** Called once per successful close with the log entry: `id` is the log id, `title` is the panel's own, the empty string when it has none: the host decides what to show for that. */
  onPanelsClosed?: (entry: { id: string; title: string; url: string; closedAt: string }) => void,
  /** Called once per `undoClose` batch with the log ids of the closes it restores that were reported, in close order; not called when there are none. */
  onPanelsRestored?: (logIds: string[]) => void,
  /**
   * Called once per restored panel with the `hostData` it closed carrying; its return value is what the panel comes
   * back with (`undefined` drops the key). Unset leaves `hostData` exactly as it closed: only the host knows what
   * the opaque blob pointed at, and whether that outlived the close.
   */
  resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined,
  /** Receives each note an undo raises (a placement that fell back); whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void,
  /** The developer's panel order, read by an undo whose `undoPlacement` is `'order'`. */
  order?: () => readonly string[],
  /**
   * Rebuilds a closed entry at undo: the entry to restore and where to put it. Unset, the entry comes back as it
   * closed and `undoPlacement` is the one it carries, which for an entry with no settings is 'old-slot'.
   */
  reapply?: (panel: PanelWindow) => Reapplied,
  /** Lands a restored entry that carries a pin change it waited with: the change is applied in the update that restores it. */
  settle?: (row: PanelWindow[], id: string) => { row: PanelWindow[]; notes: SettingNote[] },
): UsePanelClosingResult {
  // Plain stores: a read in the timer below sees every entry the window holds, whichever closure made the last write.
  const [closedStore] = useState(() => createPanelList<ClosedView[]>([]));
  const closed = useSyncExternalStore(closedStore.subscribe, closedStore.get, closedStore.get);
  const [closingStore] = useState(() => createPanelList<ReadonlySet<string>>(new Set()));
  const closingIds = useSyncExternalStore(closingStore.subscribe, closingStore.get, closingStore.get);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the open window ends, ms since the epoch: a later close may move it later, never earlier.
  const windowEnd = useRef<number | null>(null);
  // Ids closed in the current window: a second close of the same id (a gesture callback that outlived a trash click) is ignored.
  const claimed = useRef<Set<string>>(new Set());
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const stopWindow = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    windowEnd.current = null;
    claimed.current.clear();
  };

  const close = (id: string): boolean => {
    const found = closePanel(panels, id, rootId);
    // The root's close is a no-op: the one gate every close goes through.
    if (!found || claimed.current.has(id) || id === rootId) return false;
    claimed.current.add(id);
    const settings = effective(found.closed);
    // Commits ALONE, before the removal: AnimatePresence takes an exiting child's `exit` from its LAST props
    // before it left, and a plain setState would batch with the setPanels below into one commit that never
    // has the panel both present AND marked.
    flushSync(() => closingStore.set((prev) => new Set(prev).add(id)));
    const closedAt = new Date().toISOString();
    const logId = `${closedAt}#${id}`;
    setPanels((prev) => closePanel(prev, id, rootId)?.remaining ?? prev);
    onAfterClose?.(id, found.remaining);
    if (FIXED.reportClose) onPanelsClosed?.({ id: logId, title: found.closed.title ?? '', url: found.closed.url, closedAt });
    if (FIXED.undoWindowMs === 0) {
      onWindowElapsed?.([found.closed]);
      return true;
    }
    // A pin change the entry waited with dies with it; the one a closed panel waits with is on its record.
    const { deferredPin: _dropped, ...closedPanel } = found.closed;
    closedStore.set([...closedStore.get(), { panel: closedPanel, index: found.index, logId, reported: FIXED.reportClose }]);
    const now = Date.now();
    const end = Math.max(windowEnd.current ?? 0, now + FIXED.undoWindowMs);
    windowEnd.current = end;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      windowEnd.current = null;
      claimed.current.clear();
      const elapsed = closedStore.get().map((e) => e.panel);
      closedStore.set([]);
      onWindowElapsed?.(elapsed);
    }, end - now);
    return true;
  };

  const forgetClosed = (key: string): boolean => {
    const dropped = closedStore.get().filter((e) => panelKey(e.panel) === key);
    if (dropped.length === 0) return false;
    const kept = closedStore.get().filter((e) => panelKey(e.panel) !== key);
    closedStore.set(kept);
    if (kept.length === 0) stopWindow();
    // Nothing can undo these any more, so their pictures go as they do when the window elapses.
    onWindowElapsed?.(dropped.map((e) => e.panel));
    return true;
  };

  const undoClose = () => {
    // The ref, not this render's `closed`: a second call in the same handler must find the batch already taken.
    const batch = closedStore.get();
    if (batch.length === 0) return;
    stopWindow();
    closedStore.set([]);
    // Last closed first: each index was taken from the array as it was when THAT view closed, so undoing in reverse re-creates it.
    let working = panels;
    const restoredIds = new Set<string>();
    for (const { panel, index, reset } of [...batch].reverse()) {
      if (working.some((p) => p.id === panel.id || panelKey(p) === panelKey(panel))) continue;
      const { panel: rebuilt, placeAs: ownPlacement } = reapply === undefined ? { panel, placeAs: FIXED.undoPlacement } : reapply(panel);
      const placeAt = reset === true ? effective(rebuilt).placeOnAdd : ownPlacement;
      // restorePanel is a pure spread and phonux never reads inside hostData, so the host's own reset runs
      // here, once per panel, and its result is what every call below restores.
      const restoringPanel = resetHostDataOnRestore ? withHostData(rebuilt, resetHostDataOnRestore(rebuilt.hostData, rebuilt)) : rebuilt;
      const at = { rootId, fallback: FIXED.placeFallback, ...(order !== undefined ? { order } : {}) };
      const restoreInto = (row: PanelWindow[]): PanelWindow[] => {
        const restored = restorePlaced(row, restoringPanel, index, placeAt, at).row;
        return settle === undefined ? restored : settle(restored, panel.id).row;
      };
      const placedBack = restorePlaced(working, restoringPanel, index, placeAt, at);
      const settledBack = settle === undefined ? undefined : settle(placedBack.row, panel.id);
      const landed = { row: settledBack?.row ?? placedBack.row, notes: [...placedBack.notes, ...(settledBack?.notes ?? [])] };
      reportNotes(onNote, landed.notes);
      if (rebuilt.live) {
        // This restore is one of the two "reappearance" paths that enters from the anchor's side -- mark it
        // BEFORE revealPanelProactively's own setPanels call, same ordering reasoning as usePanelManager.ts's
        // own markEnteringViaAnchor call site.
        onRestoreLive?.(panel.id, placeAt === 'old-slot' ? undefined : sideOfLiveRange(landed.row, panel.id));
        // Through the same room-making rule as opening a view: the live view touched longest ago is parked if the row is full.
        revealPanelProactively(working, restoreInto);
      } else {
        setPanels(restoreInto);
      }
      working = landed.row;
      restoredIds.add(panel.id);
    }
    // A restored id is no longer closing: a stale mark would slide a LATER park of it down instead of left. An
    // id never restored keeps its mark, harmlessly: ids never repeat in a session (useProvidePanels.ts's nextWindowId).
    closingStore.set((prev) => {
      const ids = batch.map((e) => e.panel.id).filter((restoredId) => prev.has(restoredId));
      if (ids.length === 0) return prev;
      const next = new Set(prev);
      for (const restoredId of ids) next.delete(restoredId);
      return next;
    });
    const restoredLogIds = batch.filter((e) => e.reported && restoredIds.has(e.panel.id)).map((e) => e.logId);
    if (restoredLogIds.length > 0) onPanelsRestored?.(restoredLogIds);
  };

  const markReset = (id: string, reset: (panel: PanelWindow) => PanelWindow): boolean => {
    if (!closedStore.get().some((e) => e.panel.id === id)) return false;
    closedStore.set(closedStore.get().map((e) => (e.panel.id === id ? { ...e, panel: reset(e.panel), reset: true as const } : e)));
    return true;
  };

  return { close, forgetClosed, closedIds: () => closedStore.get().map((e) => e.panel.id), undoClose, markReset, recentlyClosed: closed.length > 0 ? closed.map((e) => e.panel) : null, closingIds };
}
