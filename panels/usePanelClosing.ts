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
   * Ids currently leaving through THIS hook's own `close()` -- never through
   * usePanelManager's auto-collapse, which flips `live` false but never touches
   * this set. LivePanels.tsx reads it to give each exiting LivePanelSlot an
   * `exitDirection` (down for a close, left for an auto-collapse); see this
   * file's `close()` for why the id must land here BEFORE the panel leaves
   * `panels`, not after.
   */
  closingIds: ReadonlySet<string>;
}

/**
 * A view closed by dragging it down or by the trash icon on a History row is removed COMPLETELY (row and
 * History), a closed event is appended to the background log (electron/dead-end-history.ts: deadEnd.record)
 * and a toast offers Undo for 10 s (undo restores the view and removes the log entry).
 *
 * `panels` / `setPanels` / `revealPanelProactively` are the panel manager's (one owner of the array:
 * usePanelManager merges by id across async writers). Called with the values of the CURRENT render: the
 * handlers close over them, so nothing here may be memoised. That is also why `close` takes a view's index
 * from that render's array: two close() calls before ONE re-render would index the second against an array
 * that still holds the first, and Undo would then restore the pair in the wrong relative order. Discrete
 * gestures (a drag release, a click) re-render between events, so nothing reaches that today; a caller that
 * batches closes needs one setPanels for the lot.
 *
 * Every close writes ONE log entry whose id is `<closedAt>#<panel id>`: panel ids restart at 1 each launch,
 * and the store's removeByIds (the undo path) would otherwise also delete an older launch's entry with the
 * same id. The bridge calls are best effort: with no desktop bridge (a browser-only preview) nothing is persisted.
 */
export function usePanelClosing(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  revealPanelProactively: UsePanelManagerResult['revealPanelProactively'],
  /**
   * Called once per successful close, with the id that just left `panels` and the array immediately after
   * (`closePanel`'s own `remaining` -- computed synchronously above, from THIS render's `panels`, same as
   * everything else in `close()`). Optional (a close of a `collapsible: false` entry, i.e. History, has
   * nothing to forget or reveal); useProvidePanels.ts, the one caller, wires it to usePanelManager's
   * `forgetCollapsed`/`revealMostRecentlyCollapsed`.
   */
  onAfterClose?: (id: string, remaining: PanelWindow[]) => void,
  /**
   * Called once per panel `undoClose` restores through the "comes back LIVE" branch below (the same branch
   * that calls `revealPanelProactively`) -- this, and usePanelManager.ts's own `revealMostRecentlyCollapsed`,
   * are the two "reappearance" paths that enter from the anchor panel's side. Optional, same convention as
   * `onAfterClose`; useProvidePanels.ts, the one caller, wires this to usePanelManager's `markEnteringViaAnchor`.
   */
  onRestoreLive?: (id: string) => void,
): UsePanelClosingResult {
  const [closed, setClosed] = useState<ClosedView[]>([]);
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
    // Commits ALONE, before the removal below: AnimatePresence takes an exiting
    // child's `exit` animation from its LAST props before it left `live`, and
    // there is no render of it AFTER removal to fix this up. A plain setState
    // here would batch with the setPanels below (React 18) into one commit that
    // never has the panel both present AND marked -- flushSync forces this one
    // to land first, so the next commit (the removal) is the one AnimatePresence
    // captures, and it already says closingIds.has(id).
    flushSync(() => setClosingIds((prev) => new Set(prev).add(id)));
    const closedAt = new Date().toISOString();
    const logId = `${closedAt}#${id}`;
    setPanels((prev) => closePanel(prev, id)?.remaining ?? prev);
    onAfterClose?.(id, found.remaining);
    try {
      bridge()
        .deadEnd.record([{ id: logId, title: found.closed.title || found.closed.url, url: found.closed.url, closedAt }])
        .catch(() => {});
    } catch {
      // No desktop bridge (a browser-only preview build) -- the log simply never persists.
    }
    setClosed((prev) => [...prev, { panel: found.closed, index: found.index, logId }]);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      claimed.current.clear();
      setClosed([]);
    }, UNDO_WINDOW_MS);
  };

  const undoClose = () => {
    if (closed.length === 0) return;
    const batch = closed;
    stopWindow();
    setClosed([]);
    // Last closed first: each index was taken from the array as it was when THAT view closed, so undoing in reverse re-creates it.
    let working = panels;
    for (const { panel, index } of [...batch].reverse()) {
      if (working.some((p) => p.id === panel.id)) continue;
      if (panel.live) {
        // This restore is one of the two "reappearance" paths that enters from the anchor's side -- mark it
        // BEFORE revealPanelProactively's own setPanels call, same ordering reasoning as usePanelManager.ts's
        // own markEnteringViaAnchor call site.
        onRestoreLive?.(panel.id);
        // Through the same room-making rule as opening a view: the oldest live view is parked if the row is full.
        revealPanelProactively(working, (prev) => restorePanel(prev, panel, index));
      } else {
        setPanels((prev) => restorePanel(prev, panel, index));
      }
      working = restorePanel(working, panel, index);
    }
    // A restored id is no longer closing: leaving it marked would wrongly slide
    // a LATER auto-collapse of the same id down instead of left. An id that is
    // never restored (its window just elapses) keeps its entry here forever,
    // harmlessly -- ids never repeat within a session (useProvidePanels.ts's
    // nextWindowId), so a stale `true` can never be read by a live panel again.
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
