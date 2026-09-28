import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { bridge } from '../../shared/ipc/bridge.js';
import { closePanel, restorePanel, type PanelWindow } from './panelWindow.js';
import type { UsePanelManagerResult } from './usePanelManager.js';

/** The undo toast stays up for 10 seconds, one window, restarted by every close. */
export const UNDO_WINDOW_MS = 10_000;

/** A view closed inside the current undo window: the panel, where it sat, and the id of its entry in the background log. */
interface ClosedView {
  panel: PanelWindow;
  index: number;
  logId: string;
}

export interface UsePanelClosingResult {
  /** Closes a view completely and opens (or restarts) the 10 s undo window. Unknown or already-closed id: does nothing. */
  close: (id: string) => void;
  /** Restores every view closed inside the window, last closed first, each at its old index; a live one comes back live. */
  undoClose: () => void;
  /** The views closed inside the window, oldest first; non-null exactly while the window is open. */
  recentlyClosed: PanelWindow[] | null;
  /**
   * Ids leaving through THIS hook's `close()`, never usePanelManager's auto-collapse (which only flips `live`):
   * LivePanels.tsx reads it for each exiting PanelRowSlot's `exitDirection` (down for a close, left for a park).
   * See `close()` for why an id must land here BEFORE the panel leaves `panels`.
   */
  closingIds: ReadonlySet<string>;
}

/**
 * A close (drag down, or History's trash) removes the view COMPLETELY, logs a closed event (electron/dead-end-history.ts)
 * and offers Undo for 10 s. Takes the CURRENT render's values, so nothing here may be memoised, and `close` reads the
 * index from that render: two closes before one re-render would undo in the wrong order (discrete gestures re-render
 * between events), so a caller that batches closes needs one setPanels for the lot. Log ids are `<closedAt>#<panel id>`:
 * panel ids restart each launch, and undo's removeByIds would otherwise also delete an older launch's entry. The bridge
 * calls are best effort: a browser-only preview persists nothing.
 */
export function usePanelClosing(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  revealPanelProactively: UsePanelManagerResult['revealPanelProactively'],
  /**
   * Called once per successful close with the id that just left and `closePanel`'s `remaining`, the array right
   * after it, computed from THIS render's `panels` like everything else in `close()`.
   */
  onAfterClose?: (id: string, remaining: PanelWindow[]) => void,
  /**
   * Called per panel `undoClose` restores LIVE (the branch that calls `revealPanelProactively`): with
   * usePanelManager.ts's `revealMostRecentlyCollapsed`, one of the two paths that enter from the anchor's side.
   */
  onRestoreLive?: (id: string) => void,
  /**
   * Called with the ids the undo window's NATURAL elapse just finalized (Undo calls stopWindow() instead), so a
   * caller can tell a restored close from one nothing will ever undo.
   */
  onWindowElapsed?: (ids: string[]) => void,
): UsePanelClosingResult {
  const [closed, setClosed] = useState<ClosedView[]>([]);
  // Mirrors `closed` synchronously (never via an effect): the timer callback below fires from a closure
  // created at the LAST close() call, whose own render still saw `closed` BEFORE that call's own setClosed
  // took effect -- reading this ref instead always sees every entry the window is actually holding when it fires.
  const closedRef = useRef<ClosedView[]>([]);
  const setClosedBoth = (next: ClosedView[]): void => {
    closedRef.current = next;
    setClosed(next);
  };
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    claimed.current.clear();
  };

  const close = (id: string) => {
    const found = closePanel(panels, id);
    // History defaults locked (no unlock control exists yet): a locked entry's close is a no-op, the one
    // list's own lock gate -- every entry (History included) goes through this same close().
    if (!found || claimed.current.has(id) || found.closed.locked) return;
    claimed.current.add(id);
    // Commits ALONE, before the removal: AnimatePresence takes an exiting child's `exit` from its LAST props
    // before it left, and a plain setState would batch with the setPanels below into one commit that never
    // has the panel both present AND marked.
    flushSync(() => setClosingIds((prev) => new Set(prev).add(id)));
    const closedAt = new Date().toISOString();
    const logId = `${closedAt}#${id}`;
    setPanels((prev) => closePanel(prev, id)?.remaining ?? prev);
    onAfterClose?.(id, found.remaining);
    try {
      bridge()
        // A url-less custom panel has nothing sensible to fall back to: 'Untitled panel', never an empty string.
        .deadEnd.record([{ id: logId, title: found.closed.title || found.closed.url || 'Untitled panel', url: found.closed.url, closedAt }])
        .catch(() => {});
    } catch {
      // No desktop bridge (a browser-only preview build) -- the log simply never persists.
    }
    setClosedBoth([...closedRef.current, { panel: found.closed, index: found.index, logId }]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      claimed.current.clear();
      const elapsedIds = closedRef.current.map((e) => e.panel.id);
      setClosedBoth([]);
      onWindowElapsed?.(elapsedIds);
    }, UNDO_WINDOW_MS);
  };

  const undoClose = () => {
    if (closed.length === 0) return;
    const batch = closed;
    stopWindow();
    setClosedBoth([]);
    // Last closed first: each index was taken from the array as it was when THAT view closed, so undoing in reverse re-creates it.
    let working = panels;
    for (const { panel, index } of [...batch].reverse()) {
      if (working.some((p) => p.id === panel.id)) continue;
      if (panel.live) {
        // This restore is one of the two "reappearance" paths that enters from the anchor's side -- mark it
        // BEFORE revealPanelProactively's own setPanels call, same ordering reasoning as usePanelManager.ts's
        // own markEnteringViaAnchor call site.
        onRestoreLive?.(panel.id);
        // Through the same room-making rule as opening a view: the live view farthest from it is parked if the row is full.
        revealPanelProactively(working, (prev) => restorePanel(prev, panel, index));
      } else {
        setPanels((prev) => restorePanel(prev, panel, index));
      }
      working = restorePanel(working, panel, index);
    }
    // A restored id is no longer closing: a stale mark would slide a LATER park of it down instead of left. An
    // id never restored keeps its mark, harmlessly: ids never repeat in a session (useProvidePanels.ts's nextWindowId).
    setClosingIds((prev) => {
      const ids = batch.map((e) => e.panel.id).filter((restoredId) => prev.has(restoredId));
      if (ids.length === 0) return prev;
      const next = new Set(prev);
      for (const restoredId of ids) next.delete(restoredId);
      return next;
    });
    try {
      bridge()
        .deadEnd.undo(batch.map((e) => e.logId))
        .catch(() => {});
    } catch {
      // No desktop bridge -- nothing was persisted to undo either.
    }
  };

  return { close, undoClose, recentlyClosed: closed.length > 0 ? closed.map((e) => e.panel) : null, closingIds };
}
