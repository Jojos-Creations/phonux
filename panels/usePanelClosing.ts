import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { bridge } from '../../shared/ipc/bridge.js';
import { closePanel, restorePanel, type PanelWindow } from './panelWindow.js';
import type { UsePanelManagerResult } from './usePanelManager.js';

/** Owner's own spec: "a toast to undo the action should appear for 10 seconds." One window, restarted by every close. */
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
}

/**
 * Owner, 2026-09-20: a view closed by dragging it down or by the trash icon on a History row is removed
 * COMPLETELY (row and History), a closed event is appended to the background log
 * (electron/dead-end-history.ts: deadEnd.record) and a toast offers Undo for 10 s (undo restores the view
 * and removes the log entry). This replaces useDeadEndActions (stage / confirm / undo of a checked batch).
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
): UsePanelClosingResult {
  const [closed, setClosed] = useState<ClosedView[]>([]);
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
    if (!found || claimed.current.has(id)) return;
    claimed.current.add(id);
    const closedAt = new Date().toISOString();
    const logId = `${closedAt}#${id}`;
    setPanels((prev) => closePanel(prev, id)?.remaining ?? prev);
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
        // Through the same room-making rule as opening a view: the oldest live view is parked if the row is full.
        revealPanelProactively(working, 'extra', (prev) => restorePanel(prev, panel, index));
      } else {
        setPanels((prev) => restorePanel(prev, panel, index));
      }
      working = restorePanel(working, panel, index);
    }
    try {
      bridge()
        .deadEnd.undo(batch.map((e) => e.logId))
        .catch(() => {});
    } catch {
      // No desktop bridge -- nothing was persisted to undo either.
    }
  };

  return { close, undoClose, recentlyClosed: closed.length > 0 ? closed.map((e) => e.panel) : null };
}
