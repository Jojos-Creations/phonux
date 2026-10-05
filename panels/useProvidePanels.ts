/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CreatePanelOptions, JsonValue, PanelsAPI } from '../hostApi.js';
import { GAP } from '../PanelRowSlot.js';
import { computeMaxLiveWidth } from '../panelRowLayout.js';
import { summarisePanel } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { effective } from '../panelSettings.js';
import { appendPanel, reanchorPanel, type PanelWindow } from '../panelWindow.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';
import { useWorkspacePersistence } from './useWorkspacePersistence.js';
import type { WorkspaceStorage } from '../workspaceState.js';

/** Ids for panels this app creates itself. A module counter, bumped only from event handlers and the restore callback (never from a state initialiser or updater), so StrictMode's double invocation cannot skip one. */
let nextWindowId = 1;
const freshId = (): string => String(nextWindowId++);

/** Whether `p`'s `snapshot` setting asks the host's CaptureTrigger for a picture at `event`. */
const asksForPicture = (p: PanelWindow, event: 'park' | 'close'): boolean => {
  const { snapshot } = effective(p);
  return snapshot === 'both' || snapshot === event;
};

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
  /** The host's measured row width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this, the same inputs SettingsAPI.fitCount uses. */
  containerWidth: number;
  /** The row's scroll container: the gesture's wheel listener attaches here. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /** Defaults to phonux's `noopCaptureTrigger`: a host that wants real pictures passes its own. */
  capture?: CaptureTrigger;
  /** Called when setFormFactor really resizes a panel, so the host can glide the row's margin with it. */
  onPanelResize?: () => void;
  /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
  onPanelsClosed?: (entry: { id: string; title: string; url: string; closedAt: string }) => void;
  /** Called once per undo batch with the log ids it restores. See usePanelClosing.ts. */
  onPanelsRestored?: (logIds: string[]) => void;
  /** Called once per restored panel; the return value becomes its `hostData` (`undefined` drops the key). Unset keeps what it closed with. phonux never reads inside `hostData`, so what needs resetting after an undo is the host's call. */
  resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined;
  /** Builds the `hostData` of every panel `create()` opens, and of every panel restored from `storage`. Unset: new panels carry none. */
  defaultHostData?: () => JsonValue;
  /** Where the workspace is kept between launches: loaded once at mount, then saved after every change that settles. Unset: nothing is loaded or saved. */
  storage?: WorkspaceStorage;
}

/**
 * PanelsAPI plus the inputs PanelRow and the workspace read: the raw list, the exit/enter animation sets and the
 * row's numbers. They stay OFF PanelsAPI on purpose: that interface is the narrow surface a third-party view is
 * written against (hostApi.tsx's header).
 * @public
 */
export interface ProvidedPanels extends PanelsAPI {
  /** The provider's one panel list, raw (not summarised): the row's input, never part of PanelsAPI. */
  readonly entries: readonly PanelWindow[];
  /** How many always-rendered columns the row has: `PanelsInput.fixedViewCount` when passed, else `count(!collapsible)` over `entries`. Capacity and `SettingsAPI.fitCount` are priced from it. */
  readonly fixedViewCount: number;
  /** Each live collapsible panel's own width in row order, capped at `maxLiveWidth`: the row's centring margin and `SettingsAPI.fitCount` read the same array capacity is priced from. */
  readonly liveWidths: readonly number[];
  /** The widest one live panel can be in this row; `Infinity` until the row is measured (`containerWidth` 0). */
  readonly maxLiveWidth: number;
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
  // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
  const maxLiveWidth = computeMaxLiveWidth({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: GAP, fixedItemCount: fixedViewCount });
  const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth));
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

  // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
  useRowScrollGesture(i.overflowContainerRef, scrollRow);

  useWorkspacePersistence({ storage: i.storage, panels, setPanels, rootId: i.rootId, freshId, defaultHostData: i.defaultHostData });

  // Diffs the one list instead of capturing per call site: usePanelManager parks from several sites with no single
  // "on park" hook, and a per-site call would silently miss any site not touched.
  const prevLiveRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    const prev = prevLiveRef.current;
    for (const p of panels) {
      if (prev.get(p.id) === true && !p.live && asksForPicture(p, 'park')) capture.capture(p.id);
    }
    prevLiveRef.current = new Map(panels.map((p) => [p.id, p.live]));
  }, [panels, capture]);

  // clearAll only records ids here: React may run its updater during render, where evict would notify other components.
  const clearedIds = useRef(new Set<string>());
  useEffect(() => {
    for (const id of clearedIds.current) capture.evict(id);
    clearedIds.current.clear();
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
    (closed) => {
      for (const p of closed) if (effective(p).snapshot !== 'never') capture.evict(p.id);
    },
    i.onPanelsClosed,
    i.onPanelsRestored,
    i.resetHostDataOnRestore,
  );

  const api: ProvidedPanels = {
    // `listed` excludes History: it must not list itself (a host's history column renders every entry here as a
    // clickable row).
    panelList: panels.filter((p) => p.listed).map(summarisePanel),
    create: (options?: CreatePanelOptions) => {
      // `options` is explicitly optional here (not left to infer from `create`'s own overloaded interface
      // member) -- an implementation inferred as requiring it would no longer satisfy the zero-arg overload.
      const safeOptions = isEventLike(options) ? undefined : options;
      const id = freshId();
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
      // A close the gate in usePanelClosing.ts will refuse (an unknown or locked id) takes no picture.
      const target = panels.find((p) => p.id === id);
      if (target && !target.locked && asksForPicture(target, 'close')) capture.capture(id);
      closing.close(id);
    },
    recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
    undoClose: closing.undoClose,
    // Drops every clearable panel: never History, a fixed column or a locked one. Its picture goes now, not at an
    // undo window: a dropped panel can never be shown again. The ids come from the updater's own list, because
    // this render's `panels` misses a panel created earlier in the same batch.
    clearAll: () =>
      setPanels((prev) => {
        for (const p of prev) if (effective(p).clearable && effective(p).snapshot !== 'never') clearedIds.current.add(p.id);
        return prev.filter((p) => !effective(p).clearable);
      }),
    entries: panels,
    fixedViewCount,
    liveWidths,
    maxLiveWidth,
    closingIds: closing.closingIds,
    enteringViaAnchorIds,
    exitRightIds,
    enterSideById,
  };

  // Test-only hook: a host's end-to-end tests reach the API here, since no production UI calls create({ permanent })
  // or reanchor(). Gated on MODE 'test', which only a host's test build sets. An effect with no deps array, not a
  // render-body assignment: StrictMode double-invokes render bodies, and a test must always reach the LATEST closure.
  useEffect(() => {
    // Structural cast: the package builds without Vite's ambient types, so `import.meta.env` is untyped here.
    const mode = (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE;
    if (typeof window === 'undefined' || mode !== 'test') return;
    (window as unknown as { __panelsApiForTests?: ProvidedPanels }).__panelsApiForTests = api;
  });

  return api;
}
