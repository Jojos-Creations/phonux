/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { CreatePanelOptions, JsonValue, PanelsAPI, PanelSummary } from '../hostApi.js';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import { minWorkspaceWidth } from '../minWorkspaceWidth.js';
import { computeRowNumbers, type RowNumbers } from '../rowNumbers.js';
import { resolveLabels, type PhonuxLabels } from '../labels.js';
import { isPresent, summarisePanel } from '../panelRowEntry.js';
import { entryNamed } from '../panelIds.js';
import { panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { PANEL_RECT_EVENT, panelRectEvent, type PanelRectDetail, type PanelRectEvent } from '../panelChrome.js';
import { applyConfigure } from '../panelConfigure.js';
import { accepted, refused, type ConfigureResult, type PanelOpSource, type PanelResult } from '../panelManager.js';
import { FIXED, LIBRARY_TUNING_DEFAULTS, applyTemplate, effective, panelKey, resolvePanelSettings } from '../panelSettings.js';
import type { AddPlacement, PanelSettings, PanelSettingsResolution, ResolvedPanelSettings, ResolvedWorkspaceTuning, ScrollAlign, SettingNote, WorkspaceTuning } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { reportNotes } from '../panelPlacement.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { appendPanel, clearOverrides, closePanel, recordOverride, reanchorPanel, slotsOf, type AnchorRequest, type PanelWindow } from '../panelWindow.js';
import { bindingOf, type CreateRequest, type EngineOps, type WorkspaceHandle } from '../workspaceCore.js';
import { conflictNotes, finishCreated } from '../workspacePlan.js';
import { usePanelClosing, type Reapplied } from './usePanelClosing.js';
import { usePanelManager, type GateKind } from './usePanelManager.js';
import { createPanelList } from './panelList.js';
import type { RootView } from '../panelManager.js';
import { emblaDrawnOf, emblaOf, emblaStripOf, emblaSummonMove, emblaTargetOf, endEmblaWheel, noteEmblaMove, noteEmblaPlace, emblaWouldShow, showOnEmbla, whenEmblaFree, wholeInView } from '../emblaRow.js';
import { useWorkspacePersistence } from './useWorkspacePersistence.js';
import { keepOpeners } from '../panelOpener.js';

/** Whether the host's CaptureTrigger is asked for a picture at `event`: a panel is captured at both. */
const asksForPicture = (event: 'park' | 'close'): boolean => FIXED.snapshot === 'both' || FIXED.snapshot === event;

/**
 * Duck-typed (a `preventDefault` function): a bare `onClick={panels.create}` reference passes the click
 * event positionally, so this discards it rather than spreading `view` into the new panel (see DESIGN.md).
 */
function isEventLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && typeof (value as { preventDefault?: unknown }).preventDefault === 'function';
}

/**
 * What an app hands `useProvidePanels`: the row's measured inputs, plus the behavior only the host can decide
 * (where closes are logged, what `hostData` means).
 * @public
 */
export interface PanelsInput {
  /** The workspace this hook feeds: it supplies the root, the storage, the templates, the declared panels, the defaults, the tuning and the ids. One workspace feeds one hook. */
  workspace: WorkspaceHandle;
  /** The phone frame's current width: the unit a default-sized panel is priced in. */
  phoneWidth: number;
  /** Overrides `count(!collapsible)` over the provider's own list, which is the default: a host that prices the row from a count it already holds passes it through so usePanelManager always agrees with it. */
  fixedViewCount?: number;
  /** The host's measured row width (0 before the first measurement) -- usePanelManager derives the fit count and capacity from this. */
  containerWidth: number;
  /** The row's scroll container: the gesture's wheel listener attaches here. */
  overflowContainerRef: RefObject<HTMLDivElement | null>;
  /** Defaults to phonux's `noopCaptureTrigger`: a host that wants real pictures passes its own. */
  capture?: CaptureTrigger;
  /**
   * Called with a panel's box while it moves: `moving` on each change, then one `settled` with the box it stopped at. A
   * native view a host draws over a panel follows these; phonux draws nothing itself. Panels are keyed by their public key.
   */
  onPanelRect?: (event: PanelRectEvent) => void;
  /** Called when setSlots really resizes a panel, so the host can glide the row's margin with it. */
  onPanelResize?: () => void;
  /** The view a `create()` without a `view` opens. Unset: such a panel has no view and renders the unregistered-view placeholder, which is also what an unregistered key renders. */
  defaultView?: string;
  /** Overrides of the library's visible strings that this hook writes into the panels it makes (see `PhonuxLabels`); a key left out keeps its English default. */
  labels?: Partial<PhonuxLabels>;
  /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
  onPanelsClosed?: (entry: {
    /** The log id, `<closedAt>#<panel id>`; the id `onPanelsRestored` reports back. */
    id: string;
    /** The panel's own title; the empty string when it had none, which the host replaces with whatever it shows for an untitled entry. */
    title: string;
    /** The panel's URL; the empty string when it had none. */
    url: string;
    /** When the panel closed, as an ISO 8601 timestamp. */
    closedAt: string;
  }) => void;
  /** Called once per undo batch with the log ids it restores. See usePanelClosing.ts. */
  onPanelsRestored?: (logIds: string[]) => void;
  /** Called once per restored panel; the return value becomes its `hostData` (`undefined` drops the key). Unset keeps what it closed with. phonux never reads inside `hostData`, so what needs resetting after an undo is the host's call. */
  resetHostDataOnRestore?: (hostData: JsonValue | undefined, panel: PanelWindow) => JsonValue | undefined;
  /** Builds the `hostData` of every panel `create()` opens, and of every panel restored from `storage`. Unset: new panels carry none. */
  defaultHostData?: () => JsonValue;
  /** Called with each note the engine raises while it works (a runtime diagnostic, never an error): whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
}

/** What a host-bag `create` resolved to before any panel exists: the cascade's answer and the layer to save. */
interface CreatePlan {
  resolution: PanelSettingsResolution;
  /** The host and instance asks merged into the one layer the file keeps. */
  instance: PanelSettings;
  /** What the view asked for, apart: the workspace keeps it under the instance layer for the session. */
  host: PanelSettings;
}

/** `options` resolved against the workspace defaults and, for a template view, the template's own layer. A permanent column is a plain view's own ask; a template's panel cannot ask it, which the resolver records as a conflict. */
function planCreate(options: CreatePanelOptions | undefined, template: PanelTemplate | undefined, defaults: PanelSettings): CreatePlan {
  const permanent = options?.permanent === true;
  const host: PanelSettings = {
    ...(options?.title !== undefined ? { title: options.title } : {}),
    ...(!permanent && options?.listed !== undefined ? { listed: options.listed } : {}),
    ...(options?.layer !== undefined ? { layer: options.layer } : {}),
    ...(options?.anchoredEnter === true ? { enterFrom: 'anchor' as const } : {}),
    ...(!permanent && options?.slots !== undefined ? { slots: options.slots } : {}),
    ...(permanent && template !== undefined ? { parkable: false } : {}),
  };
  // A view cannot set `parkable`, so a permanent plain column is the library's own ask, on the instance layer.
  const own: PanelSettings = permanent && template === undefined ? { parkable: false } : {};
  const { parkable: _asked, ...saved } = host;
  return {
    resolution: resolvePanelSettings({ workspace: defaults, ...(template !== undefined ? { template: template.settings } : {}), host, instance: own }),
    instance: { ...saved, ...own },
    host: saved,
  };
}

/** The root as the row draws it while it has stepped aside: a parked panel, in the drawn entries only, never on the list. */

/** Whether a host-bag `create` of `template` may add another, given the entries as they stand: `hostCreatable`, `multiple` and `maxInstances`. */
function mayCreate(settings: ResolvedPanelSettings, templateId: string, entries: readonly PanelWindow[]): boolean {
  if (!settings.hostCreatable) return false;
  const have = entries.filter((p) => p.view === templateId).length;
  if (have > 0 && !settings.multiple) return false;
  return settings.maxInstances === 'unlimited' || have < settings.maxInstances;
}

/** `prev` with a panel of `a.template` appended and placed where its `placeOnAdd` says; `declared` marks one code declares again at every launch, which the file saves without an instance layer. */
function appendFromTemplate(
  prev: PanelWindow[],
  a: {
    template: PanelTemplate;
    id: string;
    name: string;
    settings: PanelSettings | undefined;
    params: JsonValue | undefined;
    url: string | undefined;
    hostData: JsonValue | undefined;
    defaults: PanelSettings | undefined;
    rootId: string;
    order: (() => readonly string[]) | undefined;
    declared: boolean;
    /** The title a panel gets when no settings layer names one. */
    fallbackTitle: string;
    /** True to put the panel at the end of the row whatever its `placeOnAdd` says. */
    rowEnd?: boolean;
    /** Where this one open lands, in place of its `placeOnAdd`. */
    place?: AddPlacement;
  },
): PanelWindow[] {
  const { value } = resolvePanelSettings({ ...(a.defaults !== undefined ? { workspace: a.defaults } : {}), template: a.template.settings, ...(a.settings !== undefined ? { instance: a.settings } : {}) }, { lenient: true });
  const params = a.params ?? a.template.params;
  const next = appendPanel(
    prev,
    {
      url: a.url ?? '',
      view: a.template.id,
      title: value.title ?? a.fallbackTitle,
      ...(params !== undefined ? { params } : {}),
      ...(a.hostData !== undefined ? { hostData: a.hostData } : {}),
      listed: value.listed,
      layer: value.layer,
      slots: value.slots,
      permanent: !value.parkable,
    },
    a.id,
    a.rootId,
  );
  const made = finishCreated({ row: next, id: a.id, settings: value, instance: a.settings ?? {}, name: a.name, callerPlaced: a.rowEnd === true, rootId: a.rootId, ...(a.order !== undefined ? { order: a.order } : {}), ...(a.place !== undefined ? { place: a.place } : {}) });
  if (!a.declared) return made;
  return made.map((p) => {
    if (p.id !== a.id) return p;
    const { instance: _saved, ...rest } = p;
    return { ...rest, declared: true as const };
  });
}

/** The four timing leaves of `tuning`, each at its library default when unset or unusable. */
function timingTuning(tuning: WorkspaceTuning | undefined): Required<Pick<WorkspaceTuning, 'saveQuietMs' | 'gestureLockMs' | 'returnTieBreak' | 'dropTieBreak'>> {
  const ms = (value: number | undefined, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);
  const defaults = LIBRARY_TUNING_DEFAULTS;
  const returnTieBreak = tuning?.returnTieBreak;
  const dropTieBreak = tuning?.dropTieBreak;
  return {
    saveQuietMs: ms(tuning?.saveQuietMs, defaults.saveQuietMs),
    gestureLockMs: ms(tuning?.gestureLockMs, defaults.gestureLockMs),
    returnTieBreak: returnTieBreak === 'earliest-first' || returnTieBreak === 'row-order' ? returnTieBreak : defaults.returnTieBreak,
    dropTieBreak: dropTieBreak === 'rightmost' ? dropTieBreak : defaults.dropTieBreak,
  };
}

/** A scroll the row owes after a commit; one is pending at a time and the last recorded wins. */
/** A root brought into the view: the side it stands on, the panels it parked, the scroll to go back to, null when the row draws it only for the summon, and which panels were live when it came. */

type ScrollRequest = {
  id: string;
  kind: 'open' | 'move';
  /** The alignment `scrollTo` asked for; null reads the panel's `scrollOnOpen`. */
  align: ScrollAlign | null;
  /** True for `scrollTo`: a panel whose `scrollOnOpen` is 'none' is still scrolled to, into view. */
  forced: boolean;
  /** True for a panel `create` just made: one that exists but is not shown was made hidden and is not waited for. */
  fresh: boolean;
  /** Commits this request has seen without its panel in the row. */
  misses: number;
};

/** Commits a request for a panel not in the row waits before it is dropped. */
const REQUEST_WAIT_COMMITS = 2;

/**
 * PanelsAPI plus the inputs PanelRow and the workspace read: the raw list, the exit/enter animation sets and the
 * row's numbers. They stay OFF PanelsAPI on purpose: that interface is the narrow surface a third-party view is
 * written against (hostApi.tsx's header).
 * @public
 */
export interface ProvidedPanels extends PanelsAPI {
  /** `PanelsAPI.setSlots`, always present on the library's own provider. */
  setSlots(id: string, slots: number): void;
  /** The provider's one panel list, raw (not summarized): the row's input, never part of PanelsAPI. */
  readonly entries: readonly PanelWindow[];
  /** The views in `recentlyClosed` the person closed (source `'person'`), oldest first; null when there are none. What the undo-close toast shows. */
  readonly closedByPerson: readonly PanelSummary[] | null;
  /** How many always-rendered columns the row has: `PanelsInput.fixedViewCount` when passed, else `count(!collapsible)` over `entries`. Capacity is priced from it. */
  readonly fixedViewCount: number;
  /** Each live collapsible panel's own width in row order, capped at `maxLiveWidth`: the row's centering margin reads the same array the park capacity is priced from. */
  readonly liveWidths: readonly number[];
  /** The widest one live panel can be in this row; `Infinity` until the row is measured (`containerWidth` 0). */
  readonly maxLiveWidth: number;
  /** Whether the row scrolls: any drawn entry carries settings whose `overflow` is 'scroll'. Hand it to a Workspace's `rowScroll`. */
  readonly rowScroll: boolean;
  /** The row's one set of numbers, the same value the shell, the row and the capacity are priced from. Hand it to a Workspace's and a PanelRow's `rowNumbers`. */
  readonly rowNumbers: RowNumbers;
  /** the workspace's tuning over the library defaults, leaf by leaf: the one value this render's capacity and widths were priced from. Hand it to `usePhoneFit`. */
  readonly tuning: ResolvedWorkspaceTuning;
  /**
   * Asks the row to scroll to panel `id` after the next commit, at `align` (default: the panel's `scrollOnOpen`, else
   * 'into-view'). True when the request was recorded; false, scrolling nothing, while a drag holds the row or when the
   * row has no scroll container. A panel not yet in the row is waited for over two commits.
   */
  scrollTo(id: string, align?: ScrollAlign): boolean;
  /**
   * Tells the row panel `id` was just moved, placed or resized. When it was in view and its `scrollOnMove` is
   * 'follow', the row scrolls the least distance that shows it whole again after the next commit.
   */
  followPanel(id: string): void;
  /** Ids being closed: each exits DOWN before it leaves `entries`. */
  readonly closingIds: ReadonlySet<string>;
  /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. */
  readonly enteringViaAnchorIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.exitRightIds` for the full contract. */
  readonly exitRightIds: ReadonlySet<string>;
  /** See usePanelManager.ts's `UsePanelManagerResult.swapExitIds` for the full contract. */
  readonly swapExitIds: ReadonlySet<string>;
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
  const onPanelRect = useRef(i.onPanelRect);
  onPanelRect.current = i.onPanelRect;
  // Every id this provider has rendered, mapped to its key. Kept after a panel leaves so its exit still reports under its key.
  const keyById = useRef(new Map<string, string>());
  const labels = resolveLabels(i.labels);
  // The first workspace given is the one this hook serves for its whole life; a later one is reported, never followed.
  const boundWorkspace = useRef(i.workspace).current;
  const core = bindingOf(boundWorkspace);
  useEffect(() => {
    if (i.workspace !== boundWorkspace) console.error('useProvidePanels: the workspace changed while mounted and the first one stays attached; give the component a key so a new workspace remounts it.');
  }, [i.workspace, boundWorkspace]);
  const rootId = core.rootId;
  const [list] = useState(() => createPanelList<PanelWindow[]>(core.initialEntries()));
  const rawPanels = useSyncExternalStore(list.subscribe, list.get, list.get);
  // Every change to the list passes here, so a panel that leaves by any path hands its children to its own opener.
  const [setPanels] = useState((): typeof list.set => (next) => list.set((prev) => keepOpeners(prev, typeof next === 'function' ? next(prev) : next)));
  const tuningInput = core.tuningInput;
  const timing = timingTuning(tuningInput);
  const workspaceTuning = useSyncExternalStore(core.subscribe, () => core.tuning, () => core.tuning);
  const tuning = workspaceTuning ?? resolveWorkspaceTuning(tuningInput);
  const freshId = core.newId;
  const workspaceDefaults = core.defaults;
  const templateList = (): PanelTemplate[] => [...core.templates()];
  const fixedViewCount = i.fixedViewCount ?? rawPanels.filter((p) => !p.collapsible && p.marker !== true).length;
  // The cap settles the row before anything reads it, so no committed row holds more live panels than the cap, not even for one frame.
  const keepLiveRef = useRef<ReadonlyMap<string, PanelWindow[]>>(new Map());
  const capParkedRef = useRef<string[]>([]);
  // The row is one continuous strip (Embla): nothing parks for room or for the cap, so the list is the row as it is.
  const panels = rawPanels;
  // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
  const rowInput = { entries: panels, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedItemCount: fixedViewCount, wholePanels: tuning.rowGesture === 'step' };
  const rowNumbers = ((): RowNumbers => {
    return computeRowNumbers(rowInput);
  })();
  const { maxLiveWidth } = rowNumbers;
  const fitCount = rowFitCount({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: tuning.rowGap, fixedColumnCount: fixedViewCount, liveWidths: [] });
  const maxFitPanels = fitCount === null ? null : effectiveMaxPanels(fitCount, fixedViewCount);
  // A host-fed phone width that is not a positive finite number leaves the value unset: the function throws on it, and a number the host only reads must not take the row down.
  const minWidth = !(i.phoneWidth > 0) || !Number.isFinite(i.phoneWidth) ? undefined : minWorkspaceWidth({ phoneWidth: i.phoneWidth, fixedColumnCount: fixedViewCount, gap: tuning.rowGap });
  const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, tuning.rowGap));
  const slotsWarnedRef = useRef(new Set<string>());
  // A template that asks for more than its maxSlots warns once; a call to setSlots does the same instead of clamping silently.
  const warnSlotsClamped = (target: PanelWindow, asked: number): void => {
    const max = effective(target).maxSlots;
    if (asked <= max) return;
    const key = panelKey(target);
    const warned = `${key}\u0000${asked}`;
    if (slotsWarnedRef.current.has(warned)) return;
    slotsWarnedRef.current.add(warned);
    console.warn(`panel '${key}': setSlots(${asked}) is above its maxSlots (${max}); the panel is made ${max} wide`);
  };
  // The pending request is a plain store. Subscribing makes each set re-render the row, as the old counter did.
  const [pendingScroll] = useState(() => createPanelList<ScrollRequest | null>(null));
  useSyncExternalStore(pendingScroll.subscribe, pendingScroll.get, pendingScroll.get);
  const scrollNote = (code: string, panelId: string, message: string): void => {
    try {
      i.onNote?.({ code, panelId, message });
    } catch {
      // A reporter that throws must not break the scroll that raised the note.
    }
  };
  const requestScroll = (request: Omit<ScrollRequest, 'misses'>): boolean => {
    const el = i.overflowContainerRef.current;
    if (el === null) return false;
    // A gesture holding the Embla row defers the scroll to its release (`showOnEmbla`).
    pendingScroll.set({ ...request, misses: 0 });
    return true;
  };
  /** Whether panel `id` shows in the window of the strip Embla draws now. */
  const drawnInView = (el: HTMLElement, id: string): boolean => {
    const embla = emblaOf(el);
    const drawn = emblaStripOf(el);
    const j = drawn === undefined ? -1 : drawn.layout.ids.indexOf(id);
    if (embla === undefined || drawn === undefined || j < 0) return false;
    const at = emblaDrawnOf(embla);
    const l = drawn.layout.lefts[j]!;
    return l + drawn.layout.widths[j]! > at + 0.5 && l < at + drawn.windowWidth - 0.5;
  };
  const followPanel = (id: string, sized = false): void => {
    const el = i.overflowContainerRef.current;
    const entry = panels.find((p) => p.id === id);
    if (el === null || entry === undefined || !rowNumbers.ids.includes(id) || effective(entry).scrollOnMove !== 'follow') return;
    // A width change is the keep-still rule's (docs/embla-row.md step 5): the pages that do not change stay where they are.
    if (sized) return;
    // "In view" is read off the strip Embla draws now.
    if (drawnInView(el, id)) requestScroll({ id, kind: 'move', align: null, forced: false, fresh: false });
  };
  const requestOpen = (id: string, over: Partial<Pick<ScrollRequest, 'align' | 'forced' | 'fresh'>> = {}): boolean => requestScroll({ id, kind: 'open', align: null, forced: false, fresh: false, ...over });

  /** Whether a scroll to `align` would move the row, against where the Embla row is heading: false when it is already there or the row has nothing to scroll. */
  const wouldScroll = (id: string, align: ScrollAlign): boolean => {
    const el = i.overflowContainerRef.current;
    const emblaRow = el === null ? undefined : emblaOf(el);
    return emblaRow === undefined ? false : (emblaWouldShow(emblaRow, id, align) ?? false);
  };

  const {
    revealPanelProactively,
    handleActivatePanel,
    forgetCollapsed,
    revealMostRecentlyCollapsed,
    enteringViaAnchorIds,
    markEnteringViaAnchor,
    markEnterSide,
    clearEnterSide,
    scrollRow,
    reorderPanel,
    resizePanel,
    enterSideById,
    exitRightIds,
    swapExitIds,
    swapPanels,
    releaseHold,
    heldIds,
    holdPanel,
    wouldEmptyRow,
    placeAt,
    landAt,
    landPanel,
    resetPanels,
    gate,
    touchPanel,
  } = usePanelManager(panels, setPanels, i.phoneWidth, i.containerWidth, fixedViewCount, rootId, {
    onNote: i.onNote,
    keepLiveRef,
    capParkedRef,
    tuning: { rowGap: tuning.rowGap, returnTieBreak: timing.returnTieBreak, dropTieBreak: timing.dropTieBreak, maxLivePanels: tuning.maxLivePanels },
    ...(core.order !== undefined ? { order: core.order } : {}),
    resolveDefaults: core.resolveDefaults,
  });

  // The attach token, made before the first observe: a hook that renders while another holds the workspace (and then fails to
  // attach) must not replace that row's list, or every view the row draws afterwards finds no handle.
  const attachOwner = useRef({});
  if (!core.heldByOther(attachOwner.current)) core.observe(panels, heldIds);

  // A shown panel the page asked for, whether it was parked or already live out of view, is scrolled to once it is in.
  const activatePanel = (id: string): void => {
    const known = panels.some((p) => p.id === id);
    handleActivatePanel(id);
    if (known) requestOpen(id);
  };

  // The root on a strip (Embla) is an ordinary page  // The root on a strip (Embla) is an ordinary page (owner ruling 2026-11-09): it scrolls with the row and stays where it is put. A
  // summon moves it in the page order to the slot just outside the view, on the side it lies on (`emblaSummonMove`), as a person's
  // move that the order records, and the row's glide then brings it in, as a scroll to any page does. Nothing is undone later.
  const stripNow = (): { el: HTMLElement; layout: { ids: readonly string[]; lefts: readonly number[]; widths: readonly number[] }; windowWidth: number; at: number } | null => {
    const el = i.overflowContainerRef.current;
    const embla = el === null ? undefined : emblaOf(el);
    const s = el === null ? undefined : emblaStripOf(el);
    if (el === null || embla === undefined || s === undefined) return null;
    return { el, layout: s.layout, windowWidth: s.windowWidth, at: emblaTargetOf(embla) };
  };
  const stripRootView = (): RootView => {
    const now = stripNow();
    const k = now === null ? -1 : now.layout.ids.indexOf(rootId);
    return now === null || k < 0 || wholeInView(now.layout, k, now.at, now.windowWidth) ? 'shown' : 'away';
  };
  // The move and the glide, read off the strip and the order as they are when the row is free to move. The view is the one drawn
  // now: mid-glide the root goes next to what is on screen, so it never appears inside the view, and the glide turns to bring it in.
  const stripSummonNow = (): void => {
    const now = stripNow();
    const embla = now === null ? undefined : emblaOf(now.el);
    if (now === null || embla === undefined) return;
    const move = emblaSummonMove(now.layout, emblaDrawnOf(embla), now.windowWidth, rootId);
    if (move === null) {
      requestScroll({ id: rootId, kind: 'move', align: 'into-view', forced: true, fresh: false });
      return;
    }
    const present = panels.filter(isPresent).map((p) => p.id);
    const from = present.indexOf(rootId);
    const others = present.filter((id) => id !== rootId);
    const at = move.beside === null ? (move.side === 'left' ? 0 : others.length) : others.indexOf(move.beside) + (move.side === 'left' ? 0 : 1);
    if (from < 0 || (move.beside !== null && at - (move.side === 'left' ? 0 : 1) < 0)) return;
    if (at !== from) {
      // The commit that draws the move snaps the slots it moves: they are all out of the view, and the root must stand at its new
      // place before the glide brings it in.
      noteEmblaMove(now.el, rootId);
      reorderPanel(rootId, at - from, true);
    }
    requestScroll({ id: rootId, kind: 'move', align: 'into-view', forced: true, fresh: false });
  };
  const stripSummonNowRef = useRef(stripSummonNow);
  stripSummonNowRef.current = stripSummonNow;
  const stripSummonRoot = (): boolean => {
    const el = i.overflowContainerRef.current;
    const embla = el === null ? undefined : emblaOf(el);
    if (el === null || embla === undefined || stripRootView() !== 'away') return false;
    // A wheel gesture's hold ends where the row is drawn, as a key step ends it; a person's drag holding the row defers the summon
    // to its release.
    endEmblaWheel(embla);
    whenEmblaFree(embla, () => stripSummonNowRef.current());
    return true;
  };

  /** Where the root stands now: in the view or out of it. The scroll the row is heading for counts, so a press during a glide answers for where the row will rest. */
  const rootView = (): RootView => stripRootView();

  /** Moves a root that is out of the view to the slot just outside it and glides it in. False when there is nothing to do. */
  const summonRoot = (): boolean => stripSummonRoot();

  /** Nothing is undone: the root stays where the summon put it, as any page stays where it was moved. Always false. */
  const dismissRoot = (): boolean => false;

  const shrinkUnfocusedRef = useRef(tuning.shrinkUnfocused);
  shrinkUnfocusedRef.current = tuning.shrinkUnfocused;
  const { restoreSettled, dismiss, undismiss, isDismissed } = useWorkspacePersistence({
    storage: core.storage,
    panels,
    setPanels,
    rootId,
    freshId,
    defaultHostData: i.defaultHostData,
    saveQuietMs: timing.saveQuietMs,
    templates: core.templates,
    declared: core.declared,
    workspaceDefaults,
    onNote: i.onNote,
    order: core.order,
    panelTitle: labels.panelTitle,
    onError: core.reportError,
    replay: true,
  });

  const createFromWorkspace = (req: CreateRequest): void => {
    const template = templateList().find((t) => t.id === req.templateId);
    if (template === undefined) return;
    // Built here, outside the updater below: React may run an updater twice and the host's builder is not required to be pure.
    const hostData = i.defaultHostData?.();
    const carried = req.carried;
    const build = (prev: PanelWindow[]): PanelWindow[] => {
      if (prev.some((p) => panelKey(p) === req.id)) return prev;
      const made = appendFromTemplate(prev, { template, id: req.engineId, name: req.id, settings: req.settings, params: req.params, url: req.url, hostData, defaults: workspaceDefaults, rootId, order: core.order, declared: req.declared === true, fallbackTitle: labels.panelTitle(req.engineId), rowEnd: carried !== undefined, ...(req.place !== undefined ? { place: req.place } : {}) });
      const opened = req.openedBy === undefined ? made : made.map((p) => (p.id === req.engineId ? { ...p, openedBy: req.openedBy } : p));
      if (carried === undefined) return opened;
      // The panel keeps its identity, name and size; its place in the old row means nothing here.
      const kept = opened.map((p) => (p.id === req.engineId ? { ...p, ...(carried.uid !== undefined ? { uid: carried.uid } : {}), ...(carried.title !== undefined ? { title: carried.title } : {}), ...(carried.slots !== undefined ? { slots: carried.slots } : {}) } : p));
      return carried.sized ? recordOverride(kept, 'slots', [req.engineId], rootId) : kept;
    };
    revealPanelProactively(panels, build);
    requestOpen(req.engineId, { fresh: true });
  };

  // A template registered after the restore settled: its placeholder entries are rebuilt from it, and the panels code declared for it are created.
  const lateRegister = (t: PanelTemplate): void => {
    setPanels((prev) => {
      let next = prev;
      const rebuilt = prev.map((p) => {
        if (p.view !== t.id || p.key !== undefined || p.marker === true || p.id === rootId) return p;
        const { value } = resolvePanelSettings({ ...(workspaceDefaults !== undefined ? { workspace: workspaceDefaults } : {}), template: t.settings, ...(p.instance !== undefined ? { instance: p.instance } : {}) }, { lenient: true });
        return { ...applyTemplate(p, value, 'reconfigure'), key: value.multiple ? `${t.id}~${p.id}` : t.id };
      });
      if (rebuilt.some((p, k) => p !== prev[k])) next = rebuilt;
      for (const d of core.declared()) {
        if (d.templateId !== t.id || next.some((p) => panelKey(p) === d.id)) continue;
        const resolved = resolvePanelSettings({ ...(workspaceDefaults !== undefined ? { workspace: workspaceDefaults } : {}), template: t.settings, ...(d.settings !== undefined ? { instance: d.settings } : {}) }, { lenient: true }).value;
        if (isDismissed(d.id) && resolved.closable && resolved.afterClose === 'stay-closed') continue;
        const engineId = freshId();
        next = appendFromTemplate(next, { template: t, id: engineId, name: d.id, settings: d.settings, params: d.params, url: d.url, hostData: i.defaultHostData?.(), defaults: workspaceDefaults, rootId, order: core.order, declared: true, fallbackTitle: labels.panelTitle(engineId) });
      }
      return next;
    });
  };

  // Every commit rebinds, so the sink always reads the latest onNote.
  useLayoutEffect(() => {
    core.bindNotes((note) => reportNotes(i.onNote, [note]));
    return () => core.bindNotes(undefined);
  });
  // tuning.shrinkUnfocused: every panel wider than one phone but `except` rests at one phone, and keeps the width it goes back to.
  // A blur keeps the panel it shrinks in view. A move of the row rests nothing: a wide panel slides past the Workspace panel at its width, cut at that edge.
  const restAtPhone = (except: string | null, keepInView = except !== null): void => {
    if (!tuning.shrinkUnfocused) return;
    const grown = new Map(panels.filter((p) => p.id !== except && p.marker !== true && slotsOf(p) > 1).map((p) => [p.id, slotsOf(p)]));
    if (grown.size === 0) return;
    for (const id of grown.keys()) resizePanel(id, 1, false);
    setPanels((prev) => prev.map((p) => (grown.has(p.id) && slotsOf(p) === 1 ? { ...p, savedSlots: grown.get(p.id)! } : p)));
    // A wide panel shrinks toward its left edge, which may be past the window's: the row glides with it so it rests in view.
    const el = i.overflowContainerRef.current;
    if (!keepInView || el === null) return;
    const shown = [...grown.keys()].find((id) => drawnInView(el, id));
    // A frame later: a glide started inside the press is stopped by that same press reaching the row.
    if (shown !== undefined) requestAnimationFrame(() => requestScroll({ id: shown, kind: 'move', align: null, forced: false, fresh: false }));
  };
  // Read even with the tuning off, so turning it off never leaves a panel stuck at one phone.
  // A panel back at its width is centered as near as the row allows, a frame later for the same reason as the rest above.
  const restoreWidth = (id: string): boolean => {
    const width = panels.find((p) => p.id === id)?.savedSlots;
    if (width === undefined) return false;
    if (resizePanel(id, width, false)) {
      i.onPanelResize?.();
      requestAnimationFrame(() => requestOpen(id, { align: 'center', forced: true }));
      return true;
    }
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, savedSlots: undefined } : p)));
    return false;
  };
  useLayoutEffect(() => {
    core.bindTouch((id, control) => {
      touchPanel(id);
      // A header button acts on the panel as it is drawn (a close must not grow it first), so only its content brings the width back.
      // The centering of the panel in use wins over keeping the one it leaves in view.
      restAtPhone(id, control || !restoreWidth(id));
    });
    return () => core.bindTouch(undefined);
  });
  useLayoutEffect(() => {
    core.bindBlur(() => restAtPhone(null, true));
    return () => core.bindBlur(undefined);
  });
  useLayoutEffect(() => {
    core.bindCycle((direction, keepId) => scrollRow(direction, keepId));
    return () => core.bindCycle(undefined);
  });
  useLayoutEffect(() => {
    core.bindSummon({ view: rootView, summon: summonRoot, dismiss: dismissRoot });
    return () => core.bindSummon(undefined);
  });
  useLayoutEffect(() => {
    core.attach(attachOwner.current);
    return () => core.detach(attachOwner.current);
    // Mount only: the workspace this hook serves never changes.
  }, []);
  // A declared panel that left the list while its `afterClose` is 'stay-closed' is remembered; one that is back is forgotten. An unmount is not a close: nothing runs on cleanup.
  const lastListRef = useRef<readonly PanelWindow[] | null>(null);
  useLayoutEffect(() => {
    if (!restoreSettled) return;
    const before = lastListRef.current;
    lastListRef.current = panels;
    if (before === null || before === panels) return;
    const keys = new Set(panels.map(panelKey));
    dismiss(before.filter((p) => p.declared === true && !keys.has(panelKey(p)) && effective(p).afterClose === 'stay-closed').map(panelKey));
    undismiss([...keys]);
  });

  // Runs the pending request against this commit's numbers  // Runs the pending request against this commit's numbers: the target margin is the one about to be drawn.
  useLayoutEffect(() => {
    const request = pendingScroll.get();
    if (request === null) return;
    const el = i.overflowContainerRef.current;
    const entry = panels.find((p) => p.id === request.id);
    const k = rowNumbers.ids.indexOf(request.id);
    // A panel the row holds at an edge is in view at every scroll: there is nothing to move to.
    if (k < 0 && rowNumbers.held.some((h) => h.id === request.id)) {
      pendingScroll.set(null);
      return;
    }
    if (el === null || (k < 0 && request.fresh && entry !== undefined)) {
      pendingScroll.set(null);
      return;
    }
    if (k < 0 || entry === undefined) {
      if (request.misses + 1 < REQUEST_WAIT_COMMITS) {
        pendingScroll.set({ ...request, misses: request.misses + 1 });
      } else {
        pendingScroll.set(null);
        scrollNote('scroll-request-dropped', request.id, `A scroll to panel ${request.id} was dropped: it was not in the row after ${REQUEST_WAIT_COMMITS} commits.`);
      }
      return;
    }
    pendingScroll.set(null);
    const settings = effective(entry);
    let align: ScrollAlign | null = 'into-view';
    if (request.kind === 'open') align = request.align ?? (settings.scrollOnOpen !== 'none' ? settings.scrollOnOpen : request.forced ? 'into-view' : null);
    if (align === null) return;
    // The Embla row glides to the stop that shows the panel, from where it is heading, and waits for a gesture holding the row to let go.
    const emblaRow = emblaOf(el);
    // The strip this commit drew may not carry the panel yet: wait a commit, as for a panel not yet in the row.
    if (emblaRow !== undefined && !showOnEmbla(emblaRow, request.id, align) && request.misses + 1 < REQUEST_WAIT_COMMITS) pendingScroll.set({ ...request, misses: request.misses + 1 });
  });

  for (const p of panels) keyById.current.set(p.id, panelKey(p));
  // Diffs the one list instead of capturing per call site: usePanelManager parks from several sites with no single
  // "on park" hook, and a per-site call would silently miss any site not touched.
  const prevLiveRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  const slideMsRef = useRef(0);
  slideMsRef.current = tuning.slide.durationSec * 1000;
  // A newly opened panel is pictured once its opening motion has landed: a picture is rasterized on the main thread, so one
  // taken mid-motion holds back its frames. A slide, or a parked panel coming back, changes nothing a picture shows.
  const openTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const prev = prevLiveRef.current;
    const timers = openTimers.current;
    for (const p of panels) {
      if (prev.get(p.id) === true && !p.live && asksForPicture('park')) capture.capture(panelKey(p));
      if (!prev.has(p.id) && p.live && p.id !== rootId && FIXED.snapshot === 'both') {
        const key = panelKey(p);
        clearTimeout(timers.get(key));
        timers.set(key, setTimeout(() => {
          timers.delete(key);
          capture.capture(key);
        }, slideMsRef.current + 100));
      }
    }
    prevLiveRef.current = new Map(panels.map((p) => [p.id, p.live]));
  }, [panels, capture, rootId]);
  useEffect(() => {
    const timers = openTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // The slots report through window events (see panelChrome.ts); a provider hears only the ids it rendered.
  useEffect(() => {
    const keyOf = (id: string): string | undefined => keyById.current.get(id);
    const onRect = (e: Event): void => {
      const d = (e as CustomEvent<PanelRectDetail>).detail;
      const key = keyOf(d.id);
      if (key !== undefined) onPanelRect.current?.(panelRectEvent(key, d));
    };
    window.addEventListener(PANEL_RECT_EVENT, onRect);
    return () => {
      window.removeEventListener(PANEL_RECT_EVENT, onRect);
    };
  }, []);

  // clearAll only records ids here: React may run its updater during render, where evict would notify other components.
  const clearedIds = useRef(new Set<string>());
  useEffect(() => {
    for (const id of clearedIds.current) capture.evict(id);
    clearedIds.current.clear();
  }, [panels, capture]);

  // An undo restores the entry as its layers resolve now, so a template or default that changed while it was closed
  // applies; an entry built without settings has nothing to re-resolve.
  const reapply = (p: PanelWindow): Reapplied => {
    if (p.settings === undefined || p.marker === true) return { panel: p, placeAs: FIXED.undoPlacement };
    const value = core.resolved(p);
    const layer = p.declared === true ? undefined : core.layerOf(p);
    return { panel: { ...applyTemplate(p, value, 'reconfigure'), ...(layer !== undefined ? { instance: layer } : {}) }, placeAs: FIXED.undoPlacement };
  };

  // After usePanelManager: undo makes room for a live view through its revealPanelProactively. `onAfterClose`
  // forgets the closed id (it may have been parked), then offers the freed room to the most recently parked panel.
  const closing = usePanelClosing(
    panels,
    setPanels,
    revealPanelProactively,
    rootId,
    (id, remaining) => {
      forgetCollapsed(id);
      releaseHold(id);
      revealMostRecentlyCollapsed(remaining);
    },
    // A restored LIVE panel can carry a stale gesture-enter-side/exit-right mark from an earlier park of
    // the same id; clear it before marking entering-via-anchor (usePanelManager's own clear-then-mark order).
    (id, side) => {
      clearEnterSide(id);
      if (side === undefined) markEnteringViaAnchor(id);
      else markEnterSide(id, side);
      requestOpen(id);
    },
    // A closed-and-not-restored panel's picture must not outlive its undo window; usePanelClosing.ts alone
    // knows which ids the window's NATURAL elapse (never Undo) just finalized.
    (closed) => {
      for (const p of closed) if (FIXED.snapshot !== 'never') capture.evict(panelKey(p));
    },
    i.onPanelsClosed,
    i.onPanelsRestored,
    i.resetHostDataOnRestore,
    i.onNote,
    core.order,
    reapply,
  );

  /** `close` as a person's gesture and the manager's `close` verb both run it: the picture, then the close. True when the close was accepted. */
  const closeNow = (id: string, byPerson: boolean): boolean => {
    // A close the gate in usePanelClosing.ts will refuse (an unknown id or the root) takes no picture.
    const target = panels.find((p) => p.id === id);
    if (target && id !== rootId && asksForPicture('close')) capture.capture(panelKey(target));
    return closing.close(id, byPerson);
  };

  /** `fn` as a raw mutator: it takes a raw token on `ids`, never refuses, and does nothing on a panel a manager call holds. */
  const raw =
    <A extends unknown[]>(idsOf: (...a: A) => readonly string[], kind: GateKind, fn: (...a: A) => void) =>
    (...a: A): void => {
      const token = gate.takeRaw(idsOf(...a), kind);
      if (token === undefined) return;
      fn(...a);
      gate.release(token);
    };

  /** The engine id of the panel a caller names: its key, which is its public id, or a counter id from before the key was the only one. */
  const engineIdOf = (name: string): string => entryNamed(panels, name)?.id ?? name;
  /** A `PanelsAPI` verb that takes a panel's id: it is given the engine id of the panel the caller names. */
  const named =
    <R extends unknown[]>(fn: (id: string, ...rest: R) => void) =>
    (id: string, ...rest: R): void =>
      fn(engineIdOf(id), ...rest);

  /** The one scroll request a show records, whether the panel was parked or live out of view. */
  const scrollForShow = (engineId: string): boolean => requestOpen(engineId);

  /** The panel the engine holds under `engineId`, or the refusal for one that is gone. */
  const held = (engineId: string): PanelWindow | PanelResult => panels.find((p) => p.id === engineId) ?? refused('is-closed', `panel '${engineId}' is closed`);
  const busy = (p: PanelWindow): PanelResult => refused('busy', `panel '${panelKey(p)}' already has an operation in this turn`);
  const isEntry = (found: PanelWindow | PanelResult): found is PanelWindow => 'id' in found;

  /** The manager's verbs on a panel the engine holds, each gated and each refusing before it touches the row. */
  /** A resize to a slot count, after the in-flight gate and the panel's own permissions. */
  const resizeOp = (engineId: string, next: number, source: PanelOpSource): PanelResult => {
    const target = held(engineId);
    if (!isEntry(target)) return target;
    if (gate.busy([engineId], 'other')) return busy(target);
    if (source === 'person' && !effective(target).resizable) return refused('not-resizable', `panel '${panelKey(target)}' cannot be resized`);
    if (source !== 'person') warnSlotsClamped(target, next);
    const token = gate.take([engineId], 'other')!;
    const changed = resizePanel(engineId, next, source === 'person');
    if (changed) {
      i.onPanelResize?.();
      followPanel(engineId, true);
    }
    gate.release(token);
    return accepted(changed);
  };
  const ops: EngineOps = {
    show: (engineId) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (target.live) {
        // A live panel is shown by scrolling to it, and only when part of it is out of view and its scrollOnOpen scrolls at all.
        if (effective(target).scrollOnOpen === 'none' || !wouldScroll(engineId, 'into-view')) return accepted(false);
        const scrolling = gate.take([engineId], 'other')!;
        const requested = scrollForShow(engineId);
        gate.release(scrolling);
        return accepted(requested);
      }
      const token = gate.take([engineId], 'other')!;
      handleActivatePanel(engineId);
      scrollForShow(engineId);
      gate.release(token);
      return accepted(true);
    },
    hide: (engineId) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'hide')) return busy(target);
      const settings = effective(target);
      if (!settings.parkable) return refused('not-parkable', `panel '${panelKey(target)}' is a fixed column and cannot be parked`);
      if (target.live && FIXED.hideWhenLast === 'refuse' && wouldEmptyRow([engineId])) return refused('would-empty-row', `panel '${panelKey(target)}' is the last one the row shows`);
      const token = gate.take([engineId], 'hide')!;
      const changed = holdPanel(engineId, settings.hideStickiness);
      gate.release(token);
      return accepted(changed);
    },
    release: (engineIds, run) => {
      const targets: PanelWindow[] = [];
      for (const engineId of engineIds) {
        const target = held(engineId);
        if (!isEntry(target)) return target;
        targets.push(target);
      }
      const blocked = targets.find((t) => gate.busy([t.id], 'close'));
      if (blocked !== undefined) return busy(blocked);
      if (!run) return accepted(false);
      // One token for the whole set: a close holds the turn, so a second release in the same turn would answer busy.
      const token = gate.take(engineIds, 'close')!;
      const without = (row: PanelWindow[]): PanelWindow[] => engineIds.reduce((rest, engineId) => closePanel(rest, engineId, rootId)?.remaining ?? rest, row);
      const remaining = without(panels);
      setPanels(without);
      for (const target of targets) {
        forgetCollapsed(target.id);
        releaseHold(target.id);
        if (FIXED.snapshot !== 'never') capture.evict(panelKey(target));
      }
      revealMostRecentlyCollapsed(remaining);
      gate.release(token);
      return accepted(true);
    },
    close: (engineId, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'close')) return busy(target);
      if (engineId === rootId || (source === 'person' && !effective(target).closable)) return refused('not-closable', `panel '${panelKey(target)}' cannot be closed`);
      const token = gate.take([engineId], 'close')!;
      const changed = closeNow(engineId, source === 'person');
      gate.release(token);
      return accepted(changed);
    },
    open: (engineId) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      return gate.busy([engineId], 'other') ? busy(target) : accepted(false);
    },
    move: (engineId, by, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (source === 'person' && !effective(target).movable) return refused('not-movable', `panel '${panelKey(target)}' cannot be moved`);
      const token = gate.take([engineId], 'other')!;
      const changed = reorderPanel(engineId, by, source === 'person');
      if (changed) followPanel(engineId);
      gate.release(token);
      return accepted(changed);
    },
    place: (engineId, value, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (engineId === rootId) return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
      if (source === 'person' && !effective(target).movable) return refused('not-movable', `panel '${panelKey(target)}' cannot be placed`);
      const token = gate.take([engineId], 'other')!;
      const changed = placeAt(engineId, value, source === 'person');
      // A place by code (a reorder rule, a restore) leaves the view where it is: only a person's own place follows the panel.
      if (changed && source === 'person') followPanel(engineId);
      else if (changed && i.overflowContainerRef.current !== null) noteEmblaPlace(i.overflowContainerRef.current, engineId);
      gate.release(token);
      return accepted(changed);
    },
    swap: (show, hideIds) => {
      const leaving: PanelWindow[] = [];
      for (const engineId of hideIds) {
        const target = held(engineId);
        if (!isEntry(target)) return target;
        if (!effective(target).parkable) return refused('not-parkable', `panel '${panelKey(target)}' is a fixed column and cannot be parked`);
        leaving.push(target);
      }
      const arriving: PanelWindow[] = [];
      for (const { engineId } of show) {
        const target = held(engineId);
        if (!isEntry(target)) return target;
        if (engineId === rootId) return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
        arriving.push(target);
      }
      const showIds = show.map((s) => s.engineId);
      if (gate.busy(hideIds, 'hide') || gate.busy(showIds, 'other')) return refused('busy', 'a panel already has an operation in this turn');
      if (arriving.every((p) => p.live) && FIXED.hideWhenLast === 'refuse' && wouldEmptyRow(hideIds)) return refused('would-empty-row', 'the swap would leave no panel in the row');
      // Two tokens: the hides count as leaving for the empty-row rule, the shows do not.
      const hiding = gate.take(hideIds, 'hide')!;
      const showing = gate.take(showIds, 'other')!;
      const changed = swapPanels(
        leaving.map((p) => ({ id: p.id, stickiness: effective(p).hideStickiness })),
        show.map(({ engineId, place }) => (place === undefined ? { id: engineId } : { id: engineId, place })),
      );
      gate.release(hiding);
      gate.release(showing);
      return accepted(changed);
    },
    land: (engineId, value, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (engineId === rootId) return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
      if (source === 'person' && !effective(target).movable) return refused('not-movable', `panel '${panelKey(target)}' cannot be placed`);
      const token = gate.take([engineId], 'other')!;
      const changed = target.live ? placeAt(engineId, value, source === 'person') : landAt(engineId, value, source === 'person');
      if (changed) scrollForShow(engineId);
      gate.release(token);
      return accepted(changed);
    },
    setSlots: (engineId, slots, source) => resizeOp(engineId, slots, source),
    scrollTo: (engineId, align) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      const to = align ?? (effective(target).scrollOnOpen === 'none' ? 'into-view' : (effective(target).scrollOnOpen as ScrollAlign));
      return accepted(requestOpen(engineId, { align: align ?? null, forced: true }) && wouldScroll(engineId, to));
    },
    reset: (engineIds, follow) => {
      const named = engineIds.map((id) => held(id)).filter(isEntry);
      if (gate.busy(panels.map((p) => p.id), 'other')) return refused('busy', 'a panel already has an operation in this turn');
      const token = gate.take(engineIds, 'other')!;
      const done = resetPanels(engineIds);
      gate.release(token);
      if (done.changed && follow && engineIds.length === 1) followPanel(engineIds[0]!, true);
      const keyOf = (id: string): string => {
        const p = panels.find((q) => q.id === id);
        return p === undefined ? id : panelKey(p);
      };
      return { ...accepted(done.changed), panels: named.map(panelKey), parked: done.parked.map(keyOf), returned: done.returned.map(keyOf) };
    },
    configure: (engineId, plan) => {
      const target = held(engineId);
      if (!isEntry(target)) return target as Extract<ConfigureResult, { ok: false }>;
      if (gate.busy([engineId], 'other')) return busy(target) as Extract<ConfigureResult, { ok: false }>;
      const status = target.live ? 'live' : heldIds.has(engineId) ? 'hidden' : 'parked';
      const outcome = plan(target, status);
      if (!('next' in outcome)) return outcome.done;
      const token = gate.take([engineId], 'other')!;
      reportNotes(i.onNote, [...outcome.done.notes]);
      setPanels((prev) => {
        const now = prev.find((p) => p.id === engineId);
        if (now === target) return applyConfigure(prev, target, outcome.next);
        // Another update in the turn rebuilt the entry: the patch applies to what it left, and a panel it removed stays removed.
        if (now === undefined) return prev;
        const again = plan(now, status);
        return 'next' in again ? applyConfigure(prev, now, again.next) : prev;
      });
      gate.release(token);
      return outcome.done;
    },
    reprice: (change) => {
      const ids = panels.map((p) => p.id);
      if (gate.busy(ids, 'other')) return refused('busy', 'a panel already has an operation in this turn');
      const token = gate.take(ids, 'other')!;
      change();
      gate.release(token);
      return accepted(true);
    },
    inUndoWindow: (engineId) => closing.closedIds().includes(engineId),
    resetClosed: (engineId) =>
      closing.markReset(engineId, (panel) => {
        if (panel.settings === undefined) return panel;
        const value = core.resolveDefaults(panel).value;
        const defaults = applyTemplate(panel, value, 'reconfigure');
        return clearOverrides([{ ...defaults, ...(slotsOf(panel) === value.slots ? {} : { slots: value.slots }), applied: { placeOnAdd: value.placeOnAdd } }], [panel.id])[0]!;
      }),
    reopen: (req) => {
      // The closed views are tokened too: a raw undoClose in this turn restores the very key this call would add.
      const touched = [req.engineId, ...closing.closedIds()];
      if (gate.busy(touched, 'other')) return refused('busy', `panel '${req.id}' already has an operation in this turn`);
      const token = gate.take(touched, 'other')!;
      closing.forgetClosed(req.id);
      createFromWorkspace(req);
      gate.release(token);
      return accepted(true);
    },
  };

  // A pointer to the newest committed controls, written after every commit and never during render.
  useLayoutEffect(() => {
    core.publish({ entries: panels, held: heldIds, settled: restoreSettled, create: createFromWorkspace, lateRegister, ops });
  });

  const api: ProvidedPanels = {
    // `listed` excludes History: it must not list itself (a host's history column renders every entry here as a
    // clickable row).
    panelList: panels.filter((p) => p.listed).map(summarisePanel),
    maxFitPanels,
    minWorkspaceWidth: minWidth,
    create: (options?: CreatePanelOptions) => {
      // `options` is explicitly optional here (not left to infer from `create`'s own overloaded interface
      // member) -- an implementation inferred as requiring it would no longer satisfy the zero-arg overload.
      const safeOptions = isEventLike(options) ? undefined : options;
      const id = freshId();
      // Built here, outside the updater below: React may run an updater twice, and the host's builder is not required to be pure.
      const hostData = i.defaultHostData?.();
      // Every panel needs a distinguishable title, for testing. options?.title overrides it; the explicit `title:`
      // below (after the spread) is what makes that override win either way.
      const viewKey = safeOptions?.view ?? i.defaultView;
      const template = viewKey === undefined ? undefined : templateList().find((t) => t.id === viewKey);
      const plan = planCreate(safeOptions, template, workspaceDefaults ?? {});
      const settings = plan.resolution.value;
      // The gate reads the list as the updater will: this render's copy, then React's.
      if (template !== undefined && !mayCreate(settings, template.id, panels)) return;
      if (Object.keys(plan.host).length > 0) core.hostAsked(id, plan.host);
      revealPanelProactively(panels, (prev) => {
        if (template !== undefined && !mayCreate(settings, template.id, prev)) return prev;
        const next = appendPanel(
          prev,
          {
            hostData,
            params: template?.params,
            ...safeOptions,
            view: viewKey ?? '',
            ...(template !== undefined ? { permanent: undefined } : {}),
            title: safeOptions?.title ?? labels.panelTitle(id),
          },
          id,
          rootId,
        );
        // A plain view's key is its id; a template's singleton is named by the template.
        const name = template === undefined ? undefined : settings.multiple ? `${template.id}~${id}` : template.id;
        return finishCreated({ row: next, id, settings, instance: plan.instance, name, callerPlaced: safeOptions?.anchor !== undefined, rootId, ...(core.order !== undefined ? { order: core.order } : {}) });
      });
      reportNotes(i.onNote, conflictNotes(id, plan.resolution.conflicts));
      requestOpen(id, { fresh: true });
    },
    activate: named(raw((id: string) => [id], 'other', activatePanel)),
    move: named(
      raw(
        (id: string, _direction: 'left' | 'right') => [id],
        'other',
        (id, direction) => void reorderPanel(id, direction),
      ),
    ),
    setSlots: named(
      raw(
        (id: string, _slots: number) => [id],
        'other',
        (id, slots) => {
          const target = panels.find((p) => p.id === id);
          if (target !== undefined) warnSlotsClamped(target, slots);
          if (resizePanel(id, slots)) {
            i.onPanelResize?.();
            followPanel(id, true);
          }
        },
      ),
    ),
    // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
    // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
    reanchor: named(
      raw(
        (id: string, _anchor: AnchorRequest) => [id],
        'other',
        (id, anchor) => {
          setPanels((prev) => {
            const next = reanchorPanel(prev, id, anchor, rootId);
            return next === prev ? prev : recordOverride(next, 'anchor', next.map((p) => p.id), rootId);
          });
          followPanel(id);
        },
      ),
    ),
    // A host called this for its own close control, so it counts as the person's.
    close: named(raw((id: string) => [id], 'close', (id) => void closeNow(id, true))),
    recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
    closedByPerson: closing.closedByPerson?.map(summarisePanel) ?? null,
    undoClose: raw(() => closing.closedIds(), 'other', closing.undoClose),
    // Drops every clearable panel: never History, a fixed column or an unclearable one. Its picture goes now, not at an
    // undo window: a dropped panel can never be shown again. The ids come from the updater's own list, because
    // this render's `panels` misses a panel created earlier in the same batch.
    clearAll: () => {
      // A panel it removes answers `busy` to a manager call later in the turn; clearAll itself is never held back.
      const token = gate.takeFree(panels.filter((p) => effective(p).clearable).map((p) => p.id), 'other');
      setPanels((prev) => {
        for (const p of prev) if (effective(p).clearable && FIXED.snapshot !== 'never') clearedIds.current.add(panelKey(p));
        return prev.filter((p) => !effective(p).clearable);
      });
      if (token !== undefined) gate.release(token);
    },
    entries: panels,
    fixedViewCount,
    liveWidths,
    maxLiveWidth,
    rowScroll: rowNumbers.rowScroll,
    rowNumbers,
    tuning,
    scrollTo: (id, align) => requestOpen(engineIdOf(id), { align: align ?? null, forced: true }),
    followPanel: (id) => followPanel(engineIdOf(id)),
    closingIds: closing.closingIds,
    enteringViaAnchorIds,
    exitRightIds,
    swapExitIds,
    enterSideById,
  };

  return api;
}
