import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { closePanel, restorePanel } from '../panelWindow.js';
/** The undo toast stays up for 10 seconds, one window, restarted by every close. */
export const UNDO_WINDOW_MS = 10_000;
/** `panel` carrying `hostData`; `undefined` leaves no `hostData` key at all, the same shape appendPanel produces. */
function withHostData(panel, hostData) {
    const next = { ...panel };
    if (hostData === undefined)
        delete next.hostData;
    else
        next.hostData = hostData;
    return next;
}
/**
 * A close (drag down, or History's trash) removes the view COMPLETELY, reports it through `onPanelsClosed` and offers
 * Undo for 10 s. Takes the CURRENT render's values, so nothing here may be memoised, and `close` reads the index from
 * that render: two closes before one re-render would undo in the wrong order (discrete gestures re-render between
 * events), so a caller that batches closes needs one setPanels for the lot. Log ids are `<closedAt>#<panel id>`: panel
 * ids restart each launch, and a host undoing by id would otherwise also delete an older launch's entry.
 */
export function usePanelClosing(panels, setPanels, revealPanelProactively, rootId, 
/**
 * Called once per successful close with the id that just left and `closePanel`'s `remaining`, the array right
 * after it, computed from THIS render's `panels` like everything else in `close()`.
 */
onAfterClose, 
/**
 * Called per panel `undoClose` restores LIVE (the branch that calls `revealPanelProactively`): with
 * usePanelManager.ts's `revealMostRecentlyCollapsed`, one of the two paths that enter from the anchor's side.
 */
onRestoreLive, 
/**
 * Called with the ids the undo window's NATURAL elapse just finalized (Undo calls stopWindow() instead), so a
 * caller can tell a restored close from one nothing will ever undo.
 */
onWindowElapsed, 
/** Called once per successful close with the log entry: `id` is the log id, `title` already falls back to the url, then 'Untitled panel'. */
onPanelsClosed, 
/** Called once per `undoClose` batch with the log ids of every close the batch restores, in close order. */
onPanelsRestored, 
/**
 * Called once per restored panel with the `hostData` it closed carrying; its return value is what the panel comes
 * back with (`undefined` drops the key). Unset leaves `hostData` exactly as it closed: only the host knows what
 * the opaque blob pointed at, and whether that outlived the close.
 */
resetHostDataOnRestore) {
    const [closed, setClosed] = useState([]);
    // Mirrors `closed` synchronously (never via an effect): the timer callback below fires from a closure
    // created at the LAST close() call, whose own render still saw `closed` BEFORE that call's own setClosed
    // took effect -- reading this ref instead always sees every entry the window is actually holding when it fires.
    const closedRef = useRef([]);
    const setClosedBoth = (next) => {
        closedRef.current = next;
        setClosed(next);
    };
    const [closingIds, setClosingIds] = useState(new Set());
    const timer = useRef(null);
    // Ids closed in the current window: a second close of the same id (a gesture callback that outlived a trash click) is ignored.
    const claimed = useRef(new Set());
    useEffect(() => () => {
        if (timer.current)
            clearTimeout(timer.current);
    }, []);
    const stopWindow = () => {
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = null;
        claimed.current.clear();
    };
    const close = (id) => {
        const found = closePanel(panels, id, rootId);
        // History defaults locked (no unlock control exists yet): a locked entry's close is a no-op, the one
        // list's own lock gate -- every entry (History included) goes through this same close().
        if (!found || claimed.current.has(id) || found.closed.locked)
            return;
        claimed.current.add(id);
        // Commits ALONE, before the removal: AnimatePresence takes an exiting child's `exit` from its LAST props
        // before it left, and a plain setState would batch with the setPanels below into one commit that never
        // has the panel both present AND marked.
        flushSync(() => setClosingIds((prev) => new Set(prev).add(id)));
        const closedAt = new Date().toISOString();
        const logId = `${closedAt}#${id}`;
        setPanels((prev) => closePanel(prev, id, rootId)?.remaining ?? prev);
        onAfterClose?.(id, found.remaining);
        // A url-less custom panel has nothing sensible to fall back to: 'Untitled panel', never an empty string.
        onPanelsClosed?.({ id: logId, title: found.closed.title || found.closed.url || 'Untitled panel', url: found.closed.url, closedAt });
        setClosedBoth([...closedRef.current, { panel: found.closed, index: found.index, logId }]);
        if (timer.current)
            clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            claimed.current.clear();
            const elapsedIds = closedRef.current.map((e) => e.panel.id);
            setClosedBoth([]);
            onWindowElapsed?.(elapsedIds);
        }, UNDO_WINDOW_MS);
    };
    const undoClose = () => {
        if (closed.length === 0)
            return;
        const batch = closed;
        stopWindow();
        setClosedBoth([]);
        // Last closed first: each index was taken from the array as it was when THAT view closed, so undoing in reverse re-creates it.
        let working = panels;
        for (const { panel, index } of [...batch].reverse()) {
            if (working.some((p) => p.id === panel.id))
                continue;
            // restorePanel is a pure spread and phonux never reads inside hostData, so the host's own reset runs
            // here, once per panel, and its result is what every call below restores.
            const restoringPanel = resetHostDataOnRestore ? withHostData(panel, resetHostDataOnRestore(panel.hostData, panel)) : panel;
            if (panel.live) {
                // This restore is one of the two "reappearance" paths that enters from the anchor's side -- mark it
                // BEFORE revealPanelProactively's own setPanels call, same ordering reasoning as usePanelManager.ts's
                // own markEnteringViaAnchor call site.
                onRestoreLive?.(panel.id);
                // Through the same room-making rule as opening a view: the live view farthest from it is parked if the row is full.
                revealPanelProactively(working, (prev) => restorePanel(prev, restoringPanel, index, rootId));
            }
            else {
                setPanels((prev) => restorePanel(prev, restoringPanel, index, rootId));
            }
            working = restorePanel(working, restoringPanel, index, rootId);
        }
        // A restored id is no longer closing: a stale mark would slide a LATER park of it down instead of left. An
        // id never restored keeps its mark, harmlessly: ids never repeat in a session (useProvidePanels.ts's nextWindowId).
        setClosingIds((prev) => {
            const ids = batch.map((e) => e.panel.id).filter((restoredId) => prev.has(restoredId));
            if (ids.length === 0)
                return prev;
            const next = new Set(prev);
            for (const restoredId of ids)
                next.delete(restoredId);
            return next;
        });
        onPanelsRestored?.(batch.map((e) => e.logId));
    };
    return { close, undoClose, recentlyClosed: closed.length > 0 ? closed.map((e) => e.panel) : null, closingIds };
}
