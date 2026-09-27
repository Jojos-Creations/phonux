/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager UNCHANGED, composes usePanelClosing and owns the row's scroll gesture. Never
 * exposes setPanels, webContentsId or anything else a view has no use for: panelList and
 * recentlyClosed hold PanelSummary objects built here, never the app's own PanelWindow records
 * (provide-panels.test.ts's "holds EXACTLY the PanelSummary keys" tests pin their key set).
 */

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CreatePanelOptions, PanelsAPI } from 'phonux';
import { captureController, type CaptureTrigger } from '../capture/controller.js';
import { appendPanel, reanchorPanel, summarisePanel, type PanelWindow } from './panelWindow.js';
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
  /** Called when setFormFactor really resizes a panel (useRowShell's `morph`, so the row's margin glides with it). */
  onPanelResize?: () => void;
}

/**
 * PanelsAPI plus the desktop-only exit/enter animation plumbing (LivePanels.tsx's own inputs), kept OFF
 * PanelsAPI on purpose: that interface is the narrow surface a third-party view is written against
 * (hostApi.tsx's own header comment). Still structurally a PanelsAPI, so every existing caller that
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
    reorderPanel,
    resizePanel,
    enterSideById,
    exitRightIds,
  } = usePanelManager(i.panels, i.setPanels, i.storedMaxPanels, i.phoneWidth, i.containerWidth, i.fixedViewCount);

  // The row's own wheel/arrow-key gesture: lives off the host (GoalFrontPage.tsx's own acceptance grep
  // forbids useEffect/useRef there), wired here instead.
  useRowScrollGesture(i.overflowContainerRef, scrollRow);

  // Captures only at fixed moments (a park), never continuously. usePanelManager flips `live` false at
  // several independent call sites with no single "on park" hook (a per-site capture call would silently miss
  // any site not touched), so diffing the ONE array this hook receives finds every transition regardless of site.
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
    // A closed-and-not-restored panel's picture must not outlive its undo window; usePanelClosing.ts alone
    // knows which ids the window's NATURAL elapse (never Undo) just finalized.
    (ids) => {
      for (const id of ids) capture.evict(id);
    },
  );

  const api: ProvidedPanels = {
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
    move: reorderPanel,
    setFormFactor: (id, next) => {
      if (resizePanel(id, next)) i.onPanelResize?.();
    },
    // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
    // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
    reanchor: (id, anchor) => i.setPanels((prev) => reanchorPanel(prev, id, anchor)),
    close: (id: string) => {
      // Fires on every close() call regardless of whether this id actually leaves the array (an
      // unknown/locked id's close is already a no-op below) -- a harmless extra attempt costs nothing, and
      // gating it exactly would need a second callback into usePanelClosing.ts.
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

  // Real-Electron test access ONLY (the *-electron.test.ts files, over CDP Runtime.evaluate): no production UI
  // calls create({ permanent }) or reanchor(), so a real-window proof calls the real API on the mounted app.
  // Gated like capture/controller.ts: `MODE === 'test'` is set only by `electron-vite build --mode test`, never
  // a production build. An EFFECT, not a render-body assignment: StrictMode double-invokes render bodies. No
  // deps array: `api` is a fresh object every render, and a test must always reach the LATEST closure.
  useEffect(() => {
    if (typeof window === 'undefined' || import.meta.env?.MODE !== 'test') return;
    (window as unknown as { __panelsApiForTests?: ProvidedPanels }).__panelsApiForTests = api;
  });

  return api;
}
