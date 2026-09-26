/**
 * The app's implementation of PanelsAPI (shared/phone/phoneViewApi.tsx): the panel list, create / activate / close /
 * undo / clear-all. Wraps usePanelManager UNCHANGED, composes usePanelClosing (closing a view completely, its undo
 * window and the closed-page log) and owns the row's scroll gesture (useRowScrollGesture.ts).
 *
 * Never exposes setPanels, webContentsId or anything else a view has no use for: panelList and recentlyClosed hold
 * PanelSummary objects built here (a test pins their key set), never the app's own PanelWindow records. The hook
 * order and its arguments are the ones usePanelManager documents (its call-site ordering hazard): every ref and
 * value it takes is an INPUT here, declared by the host before useAppApis is called.
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CreatePanelOptions, PanelsAPI } from 'phonux';
import { captureController, type CaptureTrigger } from '../capture/controller.js';
import { appendPanel, summarisePanel, type PanelWindow } from './panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';
import { useRowScrollGesture } from '../row/useRowScrollGesture.js';

/** Ids for panels this app creates itself. A module counter, bumped only from event handlers (never from a state initialiser), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;

/**
 * Duck-typed (a `preventDefault` function): a bare `onClick={panels.create}` reference passes the click
 * event positionally, so this discards it rather than spreading `view` into the new panel (see DESIGN.md).
 */
function isEventLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { preventDefault?: unknown }).preventDefault === 'function';
}

export interface PanelsInput {
  panels: PanelWindow[];
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>;
  /** The stored "max panels on screen" choice (`null` = follow the fit count) -- SettingsAPI's own value. */
  storedMaxPanels: number | null;
  phoneWidth: number;
  /** `count(!collapsible)` over the one panel list right now -- the host's own single source of truth (appApis.ts), passed through rather than recomputed here so usePanelManager always agrees with it. */
  fixedViewCount: number;
  /** useRowShell's own measured width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this, the same inputs SettingsAPI.fitCount uses. */
  containerWidth: number;
  /** The row's scroll container: the gesture's wheel listener attaches here. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /**
   * Optional so this hook's own tests (and every existing caller, e.g. useAppApis) need not supply one --
   * defaults to the app's one real capture controller (client/src/desktop/capture/controller.ts). A test
   * that wants to count calls passes its own fake instead.
   */
  capture?: CaptureTrigger;
}

/**
 * PanelsAPI plus the desktop-only exit/enter animation plumbing (LivePanels.tsx's own inputs), kept OFF
 * PanelsAPI on purpose: that interface is the narrow surface a third-party view is written against
 * (phoneViewApi.tsx's own header comment). Still structurally a PanelsAPI, so every existing caller that
 * only wants that narrower type keeps working unchanged.
 */
export interface ProvidedPanels extends PanelsAPI {
  readonly closingIds: ReadonlySet<string>;
  readonly enteringViaAnchorIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.exitRightIds` for the full contract. */
  readonly exitRightIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.enterSideById` for the full contract. */
  readonly enterSideById: ReadonlyMap<string, 'left' | 'right'>;
}

export function useProvidePanels(i: PanelsInput): ProvidedPanels {
  const capture = i.capture ?? captureController;
  const {
    revealPanelProactively,
    handleActivatePanel,
    forgetCollapsed,
    revealMostRecentlyCollapsed,
    enteringViaAnchorIds,
    markEnteringViaAnchor,
    clearEnterSide,
    scrollRow,
    enterSideById,
    exitRightIds,
  } = usePanelManager(i.panels, i.setPanels, i.storedMaxPanels, i.phoneWidth, i.containerWidth, i.fixedViewCount);

  // The row's own wheel/arrow-key gesture: lives off the host (GoalFrontPage.tsx's own acceptance grep
  // forbids useEffect/useRef there), wired here instead.
  useRowScrollGesture(i.overflowContainerRef, scrollRow);

  // v1's "capture only at fixed moments" policy, park half: usePanelManager flips `live` false at 7
  // independent call sites (autoCollapseOldest and friends) with no single "on park" hook of its own -- a
  // per-site capture call would need all 7 touched and one missed site breaks the contract silently. Diffing
  // the ONE array this hook already receives, at the ONE place that composes every panel-array writer, finds
  // every transition regardless of which of the 7 sites caused it.
  const prevLiveRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    const prev = prevLiveRef.current;
    for (const p of i.panels) {
      if (prev.get(p.id) === true && !p.live) capture.capture(p.id);
    }
    prevLiveRef.current = new Map(i.panels.map((p) => [p.id, p.live]));
  }, [i.panels, capture]);

  // Closing a view completely (History trash or the live panel's drag-down), its 10 s undo window and the log entry.
  // After usePanelManager: undo makes room for a live view through its revealPanelProactively.
  // `onAfterClose` first forgets the just-closed id (in case it was itself parked, e.g. a History trash
  // click on a collapsed row -- see usePanelManager's own `forgetCollapsed` doc comment), then offers the
  // freed-up room to the most recently parked panel still on the stack, if any and if there's room for it.
  const closing = usePanelClosing(
    i.panels,
    i.setPanels,
    revealPanelProactively,
    (id, remaining) => {
      forgetCollapsed(id);
      revealMostRecentlyCollapsed(remaining);
    },
    // A restored LIVE panel can carry a stale gesture-enter-side/exit-right mark from an earlier park of
    // the same id; clear it before marking entering-via-anchor (usePanelManager's own clear-then-mark order).
    (id) => {
      clearEnterSide(id);
      markEnteringViaAnchor(id);
    },
    // v1's 5th accepted default: a closed-and-not-restored panel's picture must not outlive its undo window.
    // usePanelClosing.ts alone knows exactly which ids the window's NATURAL elapse (never Undo) just
    // finalized, so eviction is keyed off this callback rather than re-deriving it here.
    (ids) => {
      for (const id of ids) capture.evict(id);
    },
  );

  return {
    // `listed` excludes History: it must not list itself (AdventurePanel.tsx renders every entry here as a
    // clickable row).
    panelList: i.panels.filter((p) => p.listed).map(summarisePanel),
    create: (options?: CreatePanelOptions) => {
      // `options` is explicitly optional here (not left to infer from `create`'s own overloaded interface
      // member) -- an implementation inferred as requiring it would no longer satisfy the zero-arg overload.
      const safeOptions = isEventLike(options) ? undefined : options;
      const id = String(nextWindowId++);
      // "Panel N", not "about:blank": every panel needs a distinguishable title, for testing. options?.title
      // overrides it; the explicit `title:` below (after the spread) is what makes that override win either way.
      revealPanelProactively(i.panels, (prev) =>
        appendPanel(prev, { sourceWebContentsId: -1, url: 'about:blank', ...safeOptions, title: safeOptions?.title ?? `Panel ${id}` }, id),
      );
    },
    activate: handleActivatePanel,
    close: (id: string) => {
      // v1's "capture only at fixed moments" policy, close half: fires on every close() call, whether or not
      // this particular id actually leaves the array (an unknown or locked id's close is already a no-op one
      // line down) -- a harmless extra attempt costs nothing, and keeping this unconditional avoids a second
      // callback into usePanelClosing.ts just to gate it exactly.
      capture.capture(id);
      closing.close(id);
    },
    recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
    undoClose: closing.undoClose,
    // Forgets every web panel, live or parked -- never History (`collapsible: false`, the one always-shown
    // column): "Clear all" empties the row list, not the column showing it.
    clearAll: () => i.setPanels((prev) => prev.filter((p) => !p.collapsible)),
    closingIds: closing.closingIds,
    enteringViaAnchorIds,
    exitRightIds,
    enterSideById,
  };
}
