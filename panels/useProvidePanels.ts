/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (provide-panels.test.ts pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CreatePanelOptions, JsonValue, PanelsAPI } from '../hostApi.js';
import { summarisePanel } from '../panelRowEntry.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { appendPanel, reanchorPanel, type PanelWindow } from '../panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';

/** Ids for panels this app creates itself. A module counter, bumped only from event handlers (never from a state initialiser), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;

/**
 * Duck-typed (a `preventDefault` function): a bare `onClick={panels.create}` reference passes the click
 * event positionally, so this discards it rather than spreading `view` into the new panel (see DESIGN.md).
 */
function isEventLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { preventDefault?: unknown }).preventDefault === 'function';
}

/**
 * What an app hands `useProvidePanels`: the row's measured inputs, plus the behaviour only the host can decide
 * (where closes are logged, what `hostData` means).
 * @public
 */
export interface PanelsInput {
  /** The list the provider starts with, read once on mount (the host seeds its always-shown columns here); the provider owns the list from then on. Default: empty. */
  initialEntries?: readonly PanelWindow[];
  /** The id of the row's root entry, the one every anchor leads to -- threaded through to every panelWindow.ts call that needs it. */
  rootId: string;
  /** The stored "max panels on screen" choice (`null` = follow the fit count) -- SettingsAPI's own value. */
  storedMaxPanels: number | null;
  /** The phone frame's current width: the unit a default-sized panel is priced in. */
  phoneWidth: number;
  /** Overrides `count(!collapsible)` over the provider's own list, which is the default: a host that prices the row from a count it already holds passes it through so usePanelManager always agrees with it. */
  fixedViewCount?: number;
  /** useWorkspaceShell's own measured width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this, the same inputs SettingsAPI.fitCount uses. */
  containerWidth: number;
  /** The row's scroll container: the gesture's wheel listener attaches here. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /** Defaults to phonux's `noopCaptureTrigger`: a host that wants real pictures (appApis.ts) passes its own. */
  capture?: CaptureTrigger;
  /** Called when setFormFactor really resizes a panel (useWorkspaceShell's `morph`, so the row's margin glides with it). */
  onPanelResize?: () => void;
  /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
  onPanelsClosed?: (entry: { id: string; title: string; url: string; closedAt: string }) => void;
  /** Called once per undo batch with the log ids it restores. See usePanelClosing.ts. */
  onPanelsRestored?: (logIds: string[]) => void;
  /** Called once per restored panel; the return value becomes its `hostData` (`undefined` drops the key). Unset keeps what it closed with. phonux never reads inside `hostData`, so what needs resetting after an undo is the host's call. */
  resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined;
  /** Builds the `hostData` of every panel `create()` opens. Unset: new panels carry none. */
  defaultHostData?: () => JsonValue;
}

/**
 * PanelsAPI plus the desktop-only exit/enter animation inputs PanelRow reads, kept OFF PanelsAPI on
 * purpose: that interface is the narrow surface a third-party view is written against (hostApi.tsx's header).
 * @public
 */
export interface ProvidedPanels extends PanelsAPI {
  /** The provider's one panel list, raw (not summarised): the row's input, never part of PanelsAPI. */
  readonly entries: readonly PanelWindow[];
  /** Ids being closed: each exits DOWN before it leaves `entries`. */
  readonly closingIds: ReadonlySet<string>;
  /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. */
  readonly enteringViaAnchorIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.exitRightIds` for the full contract. */
  readonly exitRightIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.enterSideById` for the full contract. */
  readonly enterSideById: ReadonlyMap<string, 'left' | 'right'>;
}

/**
 * Builds the `PanelsAPI` an app hands its views. The provider owns the panel list, seeded once from `initialEntries`.
 * Call it with this render's inputs and never memoise the result: its handlers close over this render's list.
 * @public
 */
export function useProvidePanels(i: PanelsInput): ProvidedPanels {
  const capture = i.capture ?? noopCaptureTrigger;
  const [panels, setPanels] = useState<PanelWindow[]>(() => [...(i.initialEntries ?? [])]);
  const fixedViewCount = i.fixedViewCount ?? panels.filter((p) => !p.collapsible).length;
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
  } = usePanelManager(panels, setPanels, i.storedMaxPanels, i.phoneWidth, i.containerWidth, fixedViewCount, i.rootId);

  // The row's wheel/arrow-key gesture is wired here, not in the host: phone-boundary.test.ts forbids
  // useEffect/useRef in GoalFrontPage.tsx.
  useRowScrollGesture(i.overflowContainerRef, scrollRow);

  // Captures only at fixed moments (a park), never continuously. usePanelManager flips `live` false at
  // several independent call sites with no single "on park" hook (a per-site capture call would silently miss
  // any site not touched), so diffing the ONE array this hook receives finds every transition regardless of site.
  const prevLiveRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    const prev = prevLiveRef.current;
    for (const p of panels) {
      if (prev.get(p.id) === true && !p.live) capture.capture(p.id);
    }
    prevLiveRef.current = new Map(panels.map((p) => [p.id, p.live]));
  }, [panels, capture]);

  // After usePanelManager: undo makes room for a live view through its revealPanelProactively. `onAfterClose`
  // forgets the closed id (it may have been parked), then offers the freed room to the most recently parked panel.
  const closing = usePanelClosing(
    panels,
    setPanels,
    revealPanelProactively,
    i.rootId,
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
    i.onPanelsClosed,
    i.onPanelsRestored,
    i.resetHostDataOnRestore,
  );

  const api: ProvidedPanels = {
    // `listed` excludes History: it must not list itself (AdventurePanel.tsx renders every entry here as a
    // clickable row).
    panelList: panels.filter((p) => p.listed).map(summarisePanel),
    create: (options?: CreatePanelOptions) => {
      // `options` is explicitly optional here (not left to infer from `create`'s own overloaded interface
      // member) -- an implementation inferred as requiring it would no longer satisfy the zero-arg overload.
      const safeOptions = isEventLike(options) ? undefined : options;
      const id = String(nextWindowId++);
      // Built here, outside the updater below: React may run an updater twice, and the host's builder is not required to be pure.
      const hostData = i.defaultHostData?.();
      // "Panel N", not "about:blank": every panel needs a distinguishable title, for testing. options?.title
      // overrides it; the explicit `title:` below (after the spread) is what makes that override win either way.
      revealPanelProactively(panels, (prev) =>
        appendPanel(
          prev,
          { url: 'about:blank', hostData, ...safeOptions, title: safeOptions?.title ?? `Panel ${id}` },
          id,
          i.rootId,
        ),
      );
    },
    activate: handleActivatePanel,
    move: reorderPanel,
    setFormFactor: (id, next) => {
      if (resizePanel(id, next)) i.onPanelResize?.();
    },
    // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
    // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
    reanchor: (id, anchor) => setPanels((prev) => reanchorPanel(prev, id, anchor, i.rootId)),
    close: (id: string) => {
      // Fires on every close() call, even an unknown or locked id's no-op below: a harmless extra attempt,
      // and gating it exactly would need a second callback into usePanelClosing.ts.
      capture.capture(id);
      closing.close(id);
    },
    recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
    undoClose: closing.undoClose,
    // Forgets every web panel, live or parked -- never History (`collapsible: false`, the one always-shown
    // column): "Clear all" empties the row list, not the column showing it.
    clearAll: () => setPanels((prev) => prev.filter((p) => !p.collapsible)),
    entries: panels,
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
    // Structural cast: the package builds without Vite's ambient types, so `import.meta.env` is untyped here.
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (typeof window === 'undefined' || mode !== 'test') return;
    (window as unknown as { __panelsApiForTests?: ProvidedPanels }).__panelsApiForTests = api;
  });

  return api;
}
