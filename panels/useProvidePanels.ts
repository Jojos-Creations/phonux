/**
 * The app's implementation of PanelsAPI (shared/phone/phoneViewApi.tsx): the
 * panel list, create / activate / close / undo / clear-all. Wraps usePanelManager
 * UNCHANGED, composes usePanelClosing (closing a view completely, its undo window
 * and the closed-page log) and owns the
 * two host-level effects that belong to the panel list: bringing a
 * newly-live panel into view, and reporting the live count to the main process
 * so it can grow the window.
 *
 * Never exposes setPanels, webContentsId or anything else a view has no use
 * for. The hook order and its arguments are the ones usePanelManager documents
 * (its call-site ordering hazard): every ref and value it takes is an INPUT
 * here, declared by the host before useAppApis is called.
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { bridge } from '../../shared/ipc/bridge.js';
import type { MaxViewsSettings, PanelsAPI } from '../../shared/phone/phoneViewApi.js';
import { GAP } from './LivePanelSlot.js';
import { appendPanel, type PanelWindow } from './panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';

/** Ids for panels this app creates itself. A module counter, bumped only from event handlers (never from a state initialiser), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;

export interface PanelsInput {
  panels: PanelWindow[];
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
  maxViews: MaxViewsSettings;
  autoCollapse: boolean;
  phoneWidth: number;
  /** The number of always-present columns on screen NOW (it changes when the Settings column is shown or hidden). */
  fixedViewCount: number;
  rowOverflowing: boolean;
  rowRef: RefObject<HTMLDivElement | null>;
  overflowContainerRef: RefObject<HTMLDivElement | null>;
}

export function useProvidePanels(i: PanelsInput): PanelsAPI {
  // Owner report: a newly-revealed panel (a brand-new "+" view, or an old
  // one reactivated from History) could land outside the currently-scrolled
  // area with nothing to bring it into view -- especially now that 'count'
  // mode can genuinely need to scroll (see the overflowX fix above). Diffs
  // the live-panel id set against the previous render's own snapshot
  // (`prevLiveIdsRef`, not state -- this must never itself trigger a
  // re-render) so this only fires for an id that just TURNED live, never on
  // every unrelated `panels` update (a close, a park). `data-panel-id` (set on each live panel's own
  // PhoneFrame below) is queried fresh each time rather than kept in a ref
  // map, since AnimatePresence unmounts/remounts these nodes across
  // collapse/reveal and a stale ref would go silently null.
  const prevLiveIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const liveIds = new Set(i.panels.filter((p) => p.live).map((p) => p.id));
    const prevLiveIds = prevLiveIdsRef.current;
    const newlyLiveIds = [...liveIds].filter((id) => !prevLiveIds.has(id));
    prevLiveIdsRef.current = liveIds;
    if (newlyLiveIds.length === 0) return;
    const targetId = newlyLiveIds[newlyLiveIds.length - 1];
    const container = i.overflowContainerRef.current;
    const target = container?.querySelector(`[data-panel-id="${targetId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
  }, [i.panels]);

  const { revealPanelProactively, handleActivatePanel } = usePanelManager(
    i.panels,
    i.setPanels,
    i.maxViews,
    i.phoneWidth,
    i.rowOverflowing,
    i.autoCollapse,
    i.rowRef,
    i.overflowContainerRef,
    i.fixedViewCount,
  );

  // Tells the main process how many extra panels are open so it can grow
  // the window to fit a few more before rowOverflowing (above) would
  // otherwise fire on the very first one -- see electron/main.ts's
  // 'window:report-panel-count' handler and this record's own design
  // point 3. Fire-and-forget on every live-extra-count/phoneWidth change.
  // 'count' mode (adventureSettings.ts's MaxViewsSettings) skips this
  // entirely -- it ignores window/screen width by design, so the window
  // must never grow on its account.
  const liveExtraCount = i.panels.filter((p) => p.live).length;
  useEffect(() => {
    if (i.maxViews.mode !== 'screen-width') return;
    try {
      bridge().reportPanelCount(liveExtraCount, i.phoneWidth, GAP, i.fixedViewCount);
    } catch {
      // No desktop bridge (a browser-only preview build) -- the window
      // simply never grows, same as every other bridge-only feature.
    }
  }, [liveExtraCount, i.phoneWidth, i.maxViews.mode, i.fixedViewCount]);

  // Closing a view completely (History trash or the live panel's drag-down), its 10 s undo window and the log entry.
  // After usePanelManager: undo makes room for a live view through its revealPanelProactively.
  const closing = usePanelClosing(i.panels, i.setPanels, revealPanelProactively);

  return {
    panelList: i.panels,
    create: () => {
      const id = String(nextWindowId++);
      revealPanelProactively(i.panels, (prev) => appendPanel(prev, { sourceWebContentsId: -1, url: 'about:blank' }, id));
    },
    activate: handleActivatePanel,
    close: closing.close,
    recentlyClosed: closing.recentlyClosed,
    undoClose: closing.undoClose,
    clearAll: () => i.setPanels([]),
  };
}
