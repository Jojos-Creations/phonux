/**
 * The app's implementation of PanelsAPI (shared/phone/phoneViewApi.tsx): the panel list, create / activate / close /
 * undo / clear-all. Wraps usePanelManager UNCHANGED, composes usePanelClosing (closing a view completely, its undo
 * window and the closed-page log) and owns the two host-level effects that belong to the panel list: bringing a
 * newly-live panel into view, and reporting the live count to the main process so it can grow the window.
 *
 * Never exposes setPanels, webContentsId or anything else a view has no use for: panelList and recentlyClosed hold
 * PanelSummary objects built here (a test pins their key set), never the app's own PanelWindow records. The hook
 * order and its arguments are the ones usePanelManager documents (its call-site ordering hazard): every ref and
 * value it takes is an INPUT here, declared by the host before useAppApis is called.
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { bridge } from '../../shared/ipc/bridge.js';
import type { MaxViewsSettings, PanelsAPI, PanelSummary } from '../../shared/phone/phoneViewApi.js';
import { GAP } from './LivePanelSlot.js';
import { appendPanel, type PanelWindow } from './panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';

/** What a view may see of a panel: exactly PanelSummary's keys (`title` is always one, undefined until the page has a title). Rebuilt every render, like the rest of the bag. */
const summarise = ({ id, url, title, live, locked }: PanelWindow): PanelSummary => ({ id, url, title, live, locked });

/** Ids for panels this app creates itself. A module counter, bumped only from event handlers (never from a state initialiser), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;

export interface PanelsInput {
  panels: PanelWindow[];
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
  maxViews: MaxViewsSettings;
  autoCollapse: boolean;
  phoneWidth: number;
  /** `count(!collapsible)` over the one panel list right now -- the host's own single source of truth (appApis.ts), passed through rather than recomputed here so usePanelManager and reportPanelCount below always agree with it. */
  fixedViewCount: number;
  rowOverflowing: boolean;
  rowRef: RefObject<HTMLDivElement | null>;
  overflowContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * PanelsAPI plus `closingIds`, kept OFF that interface on purpose: PanelsAPI is
 * the narrow surface a third-party view is written against (phoneViewApi.tsx's
 * own header comment), and `closingIds` is desktop-only exit-animation plumbing
 * (LivePanels.tsx/LivePanelSlot.tsx) that no view has a reason to see. Still
 * structurally a PanelsAPI, so every existing caller that only wants that
 * narrower type keeps working unchanged.
 */
export interface ProvidedPanels extends PanelsAPI {
  readonly closingIds: ReadonlySet<string>;
  /** ux-reveal-direction-and-fixed-column-animation: see usePanelManager.ts's `UsePanelManagerResult.enteringViaAnchorIds` for the full contract -- kept off PanelsAPI for the same reason `closingIds` is (desktop-only animation plumbing, LivePanels.tsx's own input). */
  readonly enteringViaAnchorIds: ReadonlySet<string>;
}

export function useProvidePanels(i: PanelsInput): ProvidedPanels {
  // Owner report: a newly-revealed panel (a brand-new "+" view, or an old
  // one reactivated from History) could land outside the currently-scrolled
  // area with nothing to bring it into view -- especially now that 'count'
  // mode can genuinely need to scroll (GoalFrontPage's overflow container).
  // Diffs the live-panel id set against the previous render's own snapshot
  // (`prevLiveIdsRef`, not state -- this must never itself trigger a
  // re-render) so this only fires for an id that just TURNED live, never on
  // every unrelated `panels` update (a close, a park). `data-panel-id` (on
  // each live LivePanel's PhoneFrame) is queried fresh each time rather than
  // kept in a ref map, since AnimatePresence unmounts/remounts these nodes
  // across collapse/reveal and a stale ref would go silently null.
  const prevLiveIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // `collapsible` excludes History: it never leaves the row to need scrolling back into view.
    const liveIds = new Set(i.panels.filter((p) => p.collapsible && p.live).map((p) => p.id));
    const prevLiveIds = prevLiveIdsRef.current;
    const newlyLiveIds = [...liveIds].filter((id) => !prevLiveIds.has(id));
    prevLiveIdsRef.current = liveIds;
    if (newlyLiveIds.length === 0) return;
    const targetId = newlyLiveIds[newlyLiveIds.length - 1];
    const container = i.overflowContainerRef.current;
    const target = container?.querySelector(`[data-panel-id="${targetId}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
  }, [i.panels]);

  const { revealPanelProactively, handleActivatePanel, forgetCollapsed, revealMostRecentlyCollapsed, enteringViaAnchorIds, markEnteringViaAnchor } = usePanelManager(
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

  // Tells the main process how many extra panels are open so it can grow the
  // window to fit a few more before rowOverflowing (GoalFrontPage) would
  // otherwise fire on the very first one -- see electron/main.ts's
  // 'window:report-panel-count' handler. Fire-and-forget on every live-count /
  // phoneWidth change. 'count' mode (MaxViewsSettings; adventureSettings.ts has
  // both modes' spec) skips this: it ignores window/screen width by design, so the window must never grow on its account.
  // `collapsible` excludes History (always live, never an "extra" panel) from this count.
  const liveExtraCount = i.panels.filter((p) => p.collapsible && p.live).length;
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
  // ux-reveal-most-recently-collapsed-panel: `onAfterClose` first forgets the just-closed id (in case it
  // was itself parked, e.g. a History trash click on a collapsed row -- see usePanelManager's own
  // `forgetCollapsed` doc comment), then offers the freed-up room to the most recently auto-collapsed
  // panel still on the stack, if any and if there's room for it.
  const closing = usePanelClosing(
    i.panels,
    i.setPanels,
    revealPanelProactively,
    (id, remaining) => {
      forgetCollapsed(id);
      revealMostRecentlyCollapsed(remaining);
    },
    markEnteringViaAnchor,
  );

  return {
    // `listed` excludes History: it must not list itself (AdventurePanel.tsx renders every entry here as a
    // clickable row).
    panelList: i.panels.filter((p) => p.listed).map(summarise),
    create: () => {
      const id = String(nextWindowId++);
      // Owner, 2026-09-23: "Panel N" for testing -- "about:blank" was stale
      // verbiage from the webview days and made every panel look identical.
      revealPanelProactively(i.panels, (prev) => appendPanel(prev, { sourceWebContentsId: -1, url: 'about:blank', title: `Panel ${id}` }, id));
    },
    activate: handleActivatePanel,
    close: closing.close,
    recentlyClosed: closing.recentlyClosed?.map(summarise) ?? null,
    undoClose: closing.undoClose,
    // Forgets every web panel, live or parked -- never History (`collapsible: false`, the one always-shown
    // column): "Clear all" empties the row list, not the column showing it.
    clearAll: () => i.setPanels((prev) => prev.filter((p) => !p.collapsible)),
    closingIds: closing.closingIds,
    enteringViaAnchorIds,
  };
}
