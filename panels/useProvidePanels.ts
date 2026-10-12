/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import type { CreatePanelOptions, FormFactor, JsonValue, PanelsAPI } from '../hostApi.js';
import { computeRowNumbers, maxScrollOf, nearestStop, snapToStop, type RowNumbers } from '../rowNumbers.js';
import { resolveLabels, type PhonuxLabels } from '../labels.js';
import { rowScrollerFor } from '../rowScroller.js';
import { gestureTarget, scrollTargetFor } from '../scrollTargets.js';
import { isPresent, summarisePanel } from '../panelRowEntry.js';
import { TIER_SIZES, panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { PanelManagerError } from '../panelManagerError.js';
import { applyConfigure } from '../panelConfigure.js';
import { accepted, refused, type ConfigureResult, type PanelOpSource, type PanelResult } from '../panelManager.js';
import { decidePinChange, type PinChange, type PinStatus } from '../panelPin.js';
import { LIBRARY_TUNING_DEFAULTS, applyTemplate, effective, panelKey, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelSettingsResolution, ResolvedPanelSettings, ResolvedWorkspaceTuning, ScrollAlign, SettingNote, WorkspaceTuning } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { reportNotes } from '../panelPlacement.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { appendPanel, clearOverrides, recordOverride, reanchorPanel, slotsOf, type AnchorRequest, type PanelWindow } from '../panelWindow.js';
import { listTemplates } from '../viewRegistry.js';
import { bindingOf, nextEngineId, type CreateRequest, type EngineOps, type WorkspaceHandle } from '../workspaceCore.js';
import { conflictNotes, finishCreated } from '../workspacePlan.js';
import { usePanelClosing, type Reapplied } from './usePanelClosing.js';
import { usePanelManager, type GateKind } from './usePanelManager.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';
import { useWorkspacePersistence } from './useWorkspacePersistence.js';
import type { WorkspaceStorage } from '../workspaceState.js';

const NO_SUBSCRIBE = (): (() => void) => () => {};

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
  /** The workspace this hook feeds. Given, the workspace supplies the root, the storage, the templates, the declared panels, the defaults, the tuning and the ids, and `rootId` is ignored; `storage` and `initialEntries` beside it throw `invalid-options`. One workspace feeds one hook. */
  workspace?: WorkspaceHandle;
  /** The list the provider starts with, read once on mount (the host seeds its always-shown columns here); the provider owns the list from then on. With `tuning.maxLivePanels` set, the first render already has the excess live panels parked. Default: empty. */
  initialEntries?: readonly PanelWindow[];
  /** The id of the row's root entry, the one every anchor leads to -- threaded through to every panelWindow.ts call that needs it. */
  rootId: string;
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
  /** Called when setFormFactor really resizes a panel, so the host can glide the row's margin with it. */
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
  /** Where the workspace is kept between launches: loaded once at mount, then saved after every change that settles. Unset: nothing is loaded or saved. */
  storage?: WorkspaceStorage;
  /** Called with each note the engine raises while it works (a runtime diagnostic, never an error): whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
  /** The workspace's tuning leaves; each one left out, or out of range, takes the library default. The engine reads `rowGap`, `saveQuietMs`, `gestureLockMs`, `returnTieBreak`, `dropTieBreak` and `maxLivePanels` here; the row reads `dragToClose`, `slide` and `hopFraction` through the Workspace given the same value. */
  tuning?: WorkspaceTuning;
  /**
   * The workspace's panel settings (every key except `tuning`). Given, a panel made by `create()` and a panel restored from
   * `storage` is resolved against them and carries its settings: it scrolls instead of parking unless its `overflow` is
   * 'park'. Absent: a panel is built as in 0.1.0, with no settings, and parks at capacity.
   */
  workspaceDefaults?: Omit<PanelSettings, 'tuning'>;
  /** The panel templates a saved panel and a host-bag `create({ view })` may name, over the ones registered. A `create` naming one obeys its `hostCreatable`, `multiple` and `maxInstances`; a restore is exempt. */
  templates?: readonly PanelTemplate[];
  /** The panels code declares: each is created at launch unless the saved file already holds it or the person dismissed it, and is never saved with an instance layer because code gives it again. */
  declared?: readonly { id: string; templateId: string; settings?: PanelSettings; params?: JsonValue; url?: string }[];
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
function planCreate(options: CreatePanelOptions | undefined, template: PanelTemplate | undefined, defaults: Omit<PanelSettings, 'tuning'>): CreatePlan {
  const permanent = options?.permanent === true;
  const host: PanelSettings = {
    ...(options?.title !== undefined ? { title: options.title } : {}),
    ...(!permanent && options?.listed !== undefined ? { listed: options.listed } : {}),
    ...(options?.layer !== undefined ? { layer: options.layer } : {}),
    ...(options?.anchoredEnter === true ? { enterFrom: 'anchor' as const } : {}),
    ...(!permanent && options?.formFactor !== undefined ? { formFactor: options.formFactor } : {}),
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
    defaults: Omit<PanelSettings, 'tuning'> | undefined;
    rootId: string;
    order: (() => readonly string[]) | undefined;
    declared: boolean;
  },
): PanelWindow[] {
  const { value } = resolvePanelSettings({ ...(a.defaults !== undefined ? { workspace: a.defaults } : {}), template: a.template.settings, ...(a.settings !== undefined ? { instance: a.settings } : {}) }, { lenient: true });
  const params = a.params ?? a.template.params;
  const next = appendPanel(
    prev,
    {
      url: a.url ?? '',
      view: a.template.id,
      ...(value.title !== undefined ? { title: value.title } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(a.hostData !== undefined ? { hostData: a.hostData } : {}),
      listed: value.listed,
      layer: value.layer,
      formFactor: value.formFactor,
      permanent: !value.parkable,
    },
    a.id,
    a.rootId,
  );
  const made = finishCreated({ row: next, id: a.id, settings: value, instance: a.settings ?? {}, name: a.name, callerPlaced: false, rootId: a.rootId, ...(a.order !== undefined ? { order: a.order } : {}) });
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
  /** The provider's one panel list, raw (not summarised): the row's input, never part of PanelsAPI. */
  readonly entries: readonly PanelWindow[];
  /** How many always-rendered columns the row has: `PanelsInput.fixedViewCount` when passed, else `count(!collapsible)` over `entries`. Capacity is priced from it. */
  readonly fixedViewCount: number;
  /** Each live collapsible panel's own width in row order, capped at `maxLiveWidth`: the row's centring margin reads the same array the park capacity is priced from. */
  readonly liveWidths: readonly number[];
  /** The widest one live panel can be in this row; `Infinity` until the row is measured (`containerWidth` 0). */
  readonly maxLiveWidth: number;
  /** Whether the row scrolls: any drawn entry carries settings whose `overflow` is 'scroll'. Hand it to a Workspace's `rowScroll`. */
  readonly rowScroll: boolean;
  /** The row's one set of numbers, the same value the shell, the row and the capacity are priced from. Hand it to a Workspace's and a PanelRow's `rowNumbers`. */
  readonly rowNumbers: RowNumbers;
  /** `PanelsInput.tuning` over the library defaults, leaf by leaf: the one value this render's capacity and widths were priced from. Hand it to a Workspace's `tuning`. */
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
  const labels = resolveLabels(i.labels);
  // The first workspace given is the one this hook serves for its whole life; a later one is reported, never followed.
  const boundWorkspace = useRef(i.workspace).current;
  const core = boundWorkspace === undefined ? undefined : bindingOf(boundWorkspace);
  if (core !== undefined && (i.storage !== undefined || i.initialEntries !== undefined)) {
    throw new PanelManagerError('invalid-options', `useProvidePanels: ${i.storage !== undefined ? 'storage' : 'initialEntries'} beside workspace; give the storage or the root to createWorkspace instead`);
  }
  useEffect(() => {
    if (i.workspace !== boundWorkspace) console.error('useProvidePanels: the workspace changed while mounted and the first one stays attached; give the component a key so a new workspace remounts it.');
  }, [i.workspace, boundWorkspace]);
  const rootId = core?.rootId ?? i.rootId;
  const [panels, setPanels] = useState<PanelWindow[]>(() => (core !== undefined ? core.initialEntries() : [...(i.initialEntries ?? [])]));
  const tuningInput = core?.tuningInput ?? i.tuning;
  const timing = timingTuning(tuningInput);
  const workspaceTuning = useSyncExternalStore(core?.subscribe ?? NO_SUBSCRIBE, () => core?.tuning, () => core?.tuning);
  const tuning = workspaceTuning ?? resolveWorkspaceTuning(tuningInput);
  const freshId = core?.newId ?? nextEngineId;
  const workspaceDefaults = core?.defaults ?? i.workspaceDefaults;
  const ownTemplates = (): readonly PanelTemplate[] => (core !== undefined ? core.templates() : (i.templates ?? []));
  const templateList = (): PanelTemplate[] => {
    const own = ownTemplates();
    return [...listTemplates().filter((t) => !own.some((g) => g.id === t.id)), ...own];
  };
  const fixedViewCount = i.fixedViewCount ?? panels.filter((p) => !p.collapsible && p.marker !== true).length;
  // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
  const rowNumbers = computeRowNumbers({ entries: panels, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedItemCount: fixedViewCount, wholePanels: tuning.rowGesture === 'step' });
  const { maxLiveWidth } = rowNumbers;
  const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, tuning.rowGap));
  const reducedMotion = useReducedMotionConfig() === true;
  const pendingScrollRef = useRef<ScrollRequest | null>(null);
  const [, bumpScroll] = useState(0);
  const scrollNote = (code: string, panelId: string, message: string): void => {
    try {
      i.onNote?.({ code, panelId, message });
    } catch {
      // A reporter that throws must not break the scroll that raised the note.
    }
  };
  // The container's width as laid out; before layout the host's measurement stands in for it.
  const windowOf = (el: HTMLElement): number => (el.clientWidth > 0 ? el.clientWidth : i.containerWidth);
  const requestScroll = (request: Omit<ScrollRequest, 'misses'>): boolean => {
    const el = i.overflowContainerRef.current;
    if (el === null) return false;
    if (rowScrollerFor(el).claimHeld()) {
      scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
      return false;
    }
    pendingScrollRef.current = { ...request, misses: 0 };
    // A request on a panel that is already shown changes no state, so nothing else would commit for it to run in.
    bumpScroll((n) => n + 1);
    return true;
  };
  const followPanel = (id: string): void => {
    const el = i.overflowContainerRef.current;
    const entry = panels.find((p) => p.id === id);
    const k = rowNumbers.ids.indexOf(id);
    if (el === null || entry === undefined || k < 0 || effective(entry).scrollOnMove !== 'follow') return;
    const left = tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!;
    const inView = left < el.scrollLeft + windowOf(el) - tuning.rowGap && left + rowNumbers.widths[k]! > el.scrollLeft + tuning.rowGap;
    if (inView) requestScroll({ id, kind: 'move', align: null, forced: false, fresh: false });
  };
  const requestOpen = (id: string, over: Partial<Pick<ScrollRequest, 'align' | 'forced' | 'fresh'>> = {}): boolean => requestScroll({ id, kind: 'open', align: null, forced: false, fresh: false, ...over });

  /** Where the container would scroll to put panel `id` at `align`, or null when the row is not laid out for it. */
  const scrollTargetOf = (id: string, align: ScrollAlign): number | null => {
    const el = i.overflowContainerRef.current;
    const k = rowNumbers.ids.indexOf(id);
    if (el === null || k < 0) return null;
    const raw = scrollTargetFor({
      left: tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!,
      width: rowNumbers.widths[k]!,
      scrollLeft: rowScrollerFor(el).scrollLeft(),
      clientWidth: windowOf(el),
      maxScroll: maxScrollOf(rowNumbers),
      gap: tuning.rowGap,
      align,
    });
    return snapToStop(rowNumbers, k, raw);
  };
  /** Whether a scroll to `align` would move the container: false when it is already there or the row has nothing to scroll. */
  const wouldScroll = (id: string, align: ScrollAlign): boolean => {
    const to = scrollTargetOf(id, align);
    const el = i.overflowContainerRef.current;
    return to !== null && el !== null && Math.abs(to - rowScrollerFor(el).scrollLeft()) >= 0.5;
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
    releaseHold,
    heldIds,
    holdPanel,
    wouldEmptyRow,
    placeAt,
    landPanel,
    previewPin,
    pinPanel,
    recordPin,
    deferPin,
    resetPanels,
    gate,
  } = usePanelManager(panels, setPanels, i.phoneWidth, i.containerWidth, fixedViewCount, rootId, {
    onNote: i.onNote,
    tuning: { rowGap: tuning.rowGap, returnTieBreak: timing.returnTieBreak, dropTieBreak: timing.dropTieBreak, maxLivePanels: tuning.maxLivePanels },
    ...(core?.order !== undefined ? { order: core.order } : {}),
    ...(core !== undefined ? { resolveWith: core.resolveWith, resolveDefaults: core.resolveDefaults } : {}),
  });

  core?.observe(panels, heldIds);

  // A shown panel the page asked for, whether it was parked or already live out of view, is scrolled to once it is in.
  const activatePanel = (id: string): void => {
    const known = panels.some((p) => p.id === id);
    handleActivatePanel(id);
    if (known) requestOpen(id);
  };

  // One step of the gesture. A row with nothing to scroll toward keeps 0.1.0's swap: the parked panel beside the live range comes in.
  const stepRow = (direction: 'left' | 'right'): void => {
    const el = i.overflowContainerRef.current;
    if (el === null) return;
    const scroller = rowScrollerFor(el);
    if (scroller.claimHeld()) return;
    const maxScroll = maxScrollOf(rowNumbers);
    if (!rowNumbers.rowScroll || maxScroll <= 0) {
      scrollRow(direction);
      return;
    }
    let liveBefore = 0;
    const hidden = [];
    for (const p of panels) {
      if (isPresent(p)) liveBefore += 1;
      else if (p.marker !== true) hidden.push({ id: p.id, liveBefore, held: heldIds.has(p.id), policy: effective(p).revealOnScroll });
    }
    const step = gestureTarget({
      direction,
      base: scroller.glideTarget() ?? scroller.scrollLeft(),
      clientWidth: windowOf(el),
      maxScroll,
      liveStarts: rowNumbers.leftOffsets.map((offset) => rowNumbers.rowMarginLeft + offset),
      liveWidths: rowNumbers.widths,
      stops: rowNumbers.stops,
      gap: tuning.rowGap,
      hidden,
    });
    if (step.kind === 'show') activatePanel(step.id);
    else if (step.kind === 'scroll') scroller.glideTo(step.to, { durationSec: tuning.slide.durationSec, instant: reducedMotion });
  };

  // The window, a pin, a close or a reorder moves the stops: a row left between two is brought to the nearest one.
  // The glide's own target is the base, so a settle never fights a step in flight. Never while a drag holds the row.
  useLayoutEffect(() => {
    const el = i.overflowContainerRef.current;
    if (el === null || tuning.rowGesture !== 'step' || rowNumbers.stops.length === 0) return;
    const scroller = rowScrollerFor(el);
    if (scroller.claimHeld()) return;
    const base = scroller.glideTarget() ?? scroller.scrollLeft();
    const to = nearestStop(rowNumbers, base);
    if (Math.abs(to - base) < 0.5) return;
    scroller.glideTo(to, { durationSec: tuning.slide.durationSec, instant: reducedMotion });
  }, [rowNumbers.stops.join(','), rowNumbers.rowMarginLeft, rowNumbers.endPad]);

  // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
  useRowScrollGesture(i.overflowContainerRef, stepRow, timing.gestureLockMs, tuning.rowGesture);

  const { restoreSettled, dismiss, undismiss, isDismissed } = useWorkspacePersistence({
    storage: core?.storage ?? i.storage,
    panels,
    setPanels,
    rootId,
    freshId,
    defaultHostData: i.defaultHostData,
    saveQuietMs: timing.saveQuietMs,
    templates: core !== undefined ? ownTemplates : i.templates,
    declared: core !== undefined ? core.declared : i.declared,
    workspaceDefaults,
    onNote: i.onNote,
    order: core?.order,
    onError: core?.reportError,
    replay: core !== undefined,
  });

  const createFromWorkspace = (req: CreateRequest): void => {
    const template = templateList().find((t) => t.id === req.templateId);
    if (template === undefined) return;
    // Built here, outside the updater below: React may run an updater twice and the host's builder is not required to be pure.
    const hostData = i.defaultHostData?.();
    const build = (prev: PanelWindow[]): PanelWindow[] =>
      prev.some((p) => panelKey(p) === req.id)
        ? prev
        : appendFromTemplate(prev, { template, id: req.engineId, name: req.id, settings: req.settings, params: req.params, url: req.url, hostData, defaults: workspaceDefaults, rootId, order: core?.order, declared: req.declared === true });
    // A pin change stored while the panel was closed lands as the panel is added: placement, then the `parkable` flip.
    const withPin = (row: PanelWindow[]): PanelWindow[] => (req.deferredPin === undefined || !row.some((p) => p.id === req.engineId) ? row : landPanel(row, req.engineId, 'in-place', req.deferredPin).row);
    if (req.deferredPin !== undefined && build(panels).some((p) => p.id === req.engineId)) reportNotes(i.onNote, landPanel(build(panels), req.engineId, 'in-place', req.deferredPin).notes);
    revealPanelProactively(panels, (prev) => withPin(build(prev)));
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
      for (const d of core?.declared() ?? []) {
        if (d.templateId !== t.id || next.some((p) => panelKey(p) === d.id)) continue;
        const resolved = resolvePanelSettings({ ...(workspaceDefaults !== undefined ? { workspace: workspaceDefaults } : {}), template: t.settings, ...(d.settings !== undefined ? { instance: d.settings } : {}) }, { lenient: true }).value;
        if (isDismissed(d.id) && resolved.closable && resolved.afterClose === 'stay-closed') continue;
        next = appendFromTemplate(next, { template: t, id: freshId(), name: d.id, settings: d.settings, params: d.params, url: d.url, hostData: i.defaultHostData?.(), defaults: workspaceDefaults, rootId, order: core?.order, declared: true });
      }
      return next;
    });
  };

  // Every commit rebinds, so the sink always reads the latest onNote.
  useLayoutEffect(() => {
    core?.bindNotes((note) => reportNotes(i.onNote, [note]));
    return () => core?.bindNotes(undefined);
  });
  const attachOwner = useRef({});
  useLayoutEffect(() => {
    if (core === undefined) return;
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

  // A wheel or pointer-down on the row before the first scroll means the person already chose where to look.
  const touchedRef = useRef(false);
  useEffect(() => {
    const touch = (e: Event): void => {
      const el = i.overflowContainerRef.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) touchedRef.current = true;
    };
    window.addEventListener('wheel', touch, { capture: true, passive: true });
    window.addEventListener('pointerdown', touch, true);
    return () => {
      window.removeEventListener('wheel', touch, true);
      window.removeEventListener('pointerdown', touch, true);
    };
    // Mount only: the container ref object never changes.
  }, []);

  // Once per mount, at the first commit that is measured, has an entry and follows the restore.
  const initialScrollDoneRef = useRef(false);
  useLayoutEffect(() => {
    const el = i.overflowContainerRef.current;
    if (initialScrollDoneRef.current || !restoreSettled || el === null || i.containerWidth === 0 || rowNumbers.ids.length === 0) return;
    initialScrollDoneRef.current = true;
    const scroller = rowScrollerFor(el);
    if (touchedRef.current || scroller.glideTarget() !== null || el.scrollLeft !== 0) return;
    const where = tuning.initialScroll;
    const maxScroll = maxScrollOf(rowNumbers);
    let to = 0;
    if (where === 'end') {
      to = maxScroll;
    } else if (where !== 'start') {
      const k = rowNumbers.ids.indexOf(where === 'root' ? rootId : where.panel);
      if (k >= 0) {
        const left = tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!;
        to = snapToStop(rowNumbers, k, scrollTargetFor({ left, width: rowNumbers.widths[k]!, scrollLeft: 0, clientWidth: windowOf(el), maxScroll, gap: tuning.rowGap, align: 'start' }));
      }
    }
    if (to !== 0) scroller.glideTo(to, { durationSec: 0, instant: true });
  });

  // Runs the pending request against this commit's numbers: the target margin is the one about to be drawn.
  useLayoutEffect(() => {
    const request = pendingScrollRef.current;
    if (request === null) return;
    const el = i.overflowContainerRef.current;
    const entry = panels.find((p) => p.id === request.id);
    const k = rowNumbers.ids.indexOf(request.id);
    if (el === null || (k < 0 && request.fresh && entry !== undefined)) {
      pendingScrollRef.current = null;
      return;
    }
    if (k < 0 || entry === undefined) {
      if (request.misses + 1 < REQUEST_WAIT_COMMITS) {
        pendingScrollRef.current = { ...request, misses: request.misses + 1 };
        bumpScroll((n) => n + 1);
      } else {
        pendingScrollRef.current = null;
        scrollNote('scroll-request-dropped', request.id, `A scroll to panel ${request.id} was dropped: it was not in the row after ${REQUEST_WAIT_COMMITS} commits.`);
      }
      return;
    }
    pendingScrollRef.current = null;
    const settings = effective(entry);
    let align: ScrollAlign | null = 'into-view';
    if (request.kind === 'open') align = request.align ?? (settings.scrollOnOpen !== 'none' ? settings.scrollOnOpen : request.forced ? 'into-view' : null);
    if (align === null) return;
    const scroller = rowScrollerFor(el);
    const to = snapToStop(
      rowNumbers,
      k,
      scrollTargetFor({
        left: tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!,
        width: rowNumbers.widths[k]!,
        scrollLeft: scroller.scrollLeft(),
        clientWidth: windowOf(el),
        maxScroll: maxScrollOf(rowNumbers),
        gap: tuning.rowGap,
        align,
      }),
    );
    if (Math.abs(to - scroller.scrollLeft()) < 0.5) return;
    if (!scroller.glideTo(to, { durationSec: tuning.slide.durationSec, instant: reducedMotion || !settings.animated })) {
      scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
    }
  });

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

  // A layout effect, never the configure updater: React may run an updater twice and the host's evict notifies other components.
  const prevSnapshotRef = useRef<ReadonlyMap<string, ResolvedPanelSettings['snapshot']>>(new Map());
  useLayoutEffect(() => {
    const prev = prevSnapshotRef.current;
    for (const p of panels) {
      const was = prev.get(p.id);
      if (was !== undefined && was !== 'never' && effective(p).snapshot === 'never') capture.evict(p.id);
    }
    prevSnapshotRef.current = new Map(panels.map((p) => [p.id, effective(p).snapshot]));
  }, [panels, capture]);

  // clearAll only records ids here: React may run its updater during render, where evict would notify other components.
  const clearedIds = useRef(new Set<string>());
  useEffect(() => {
    for (const id of clearedIds.current) capture.evict(id);
    clearedIds.current.clear();
  }, [panels, capture]);

  // With a workspace an undo restores the entry as its layers resolve now, so a template or default that changed while it
  // was closed applies; an entry built without settings has nothing to re-resolve.
  const reapply =
    core === undefined
      ? undefined
      : (p: PanelWindow): Reapplied => {
          if (p.settings === undefined || p.marker === true) return { panel: p, placeAs: effective(p).undoPlacement };
          const value = core.resolved(p);
          // A pin change stored on the closed panel's record applies as the undo restores it.
          const waiting = core.takeDeferredPin(panelKey(p));
          const layer = p.declared === true ? undefined : core.layerOf(p);
          return { panel: { ...applyTemplate(p, value, 'reconfigure'), ...(layer !== undefined ? { instance: layer } : {}), ...(waiting !== undefined ? { deferredPin: waiting } : {}) }, placeAs: value.undoPlacement };
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
      for (const p of closed) if (effective(p).snapshot !== 'never') capture.evict(p.id);
    },
    i.onPanelsClosed,
    i.onPanelsRestored,
    i.resetHostDataOnRestore,
    i.onNote,
    core?.order,
    reapply,
    (row, id) => landPanel(row, id, 'in-place'),
  );

  /** `close` as a person's gesture and the manager's `close` verb both run it: the picture, then the close. True when the close was accepted. */
  const closeNow = (id: string): boolean => {
    // A close the gate in usePanelClosing.ts will refuse (an unknown or locked id) takes no picture.
    const target = panels.find((p) => p.id === id);
    if (target && !target.locked && asksForPicture(target, 'close')) capture.capture(id);
    return closing.close(id);
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

  /** The one scroll request a show records, whether the panel was parked or live out of view. */
  const scrollForShow = (engineId: string): boolean => requestOpen(engineId);

  /** The panel the engine holds under `engineId`, or the refusal for one that is gone. */
  const held = (engineId: string): PanelWindow | PanelResult => panels.find((p) => p.id === engineId) ?? refused('is-closed', `panel '${engineId}' is closed`);
  const busy = (p: PanelWindow): PanelResult => refused('busy', `panel '${panelKey(p)}' already has an operation in this turn`);
  const isEntry = (found: PanelWindow | PanelResult): found is PanelWindow => 'id' in found;

  /** The manager's verbs on a panel the engine holds, each gated and each refusing before it touches the row. */
  /** A resize by tier or by slot count, after the in-flight gate and the panel's own permissions. */
  const resizeOp = (engineId: string, next: FormFactor | number, source: PanelOpSource): PanelResult => {
    const target = held(engineId);
    if (!isEntry(target)) return target;
    if (gate.busy([engineId], 'other')) return busy(target);
    const settings = effective(target);
    if (!settings.resizable) return refused('not-resizable', `panel '${panelKey(target)}' cannot be resized`);
    if (typeof next === 'string' && !settings.formFactors.includes(next)) return refused('tier-not-allowed', `panel '${panelKey(target)}' does not allow the ${next} tier`);
    const token = gate.take([engineId], 'other')!;
    const changed = resizePanel(engineId, next, source === 'person');
    if (changed) {
      i.onPanelResize?.();
      followPanel(engineId);
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
      if (target.live && settings.hideWhenLast === 'refuse' && wouldEmptyRow([engineId])) return refused('would-empty-row', `panel '${panelKey(target)}' is the last one the row shows`);
      const token = gate.take([engineId], 'hide')!;
      const changed = holdPanel(engineId, settings.hideStickiness);
      gate.release(token);
      return accepted(changed);
    },
    close: (engineId) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'close')) return busy(target);
      if (target.locked || !effective(target).closable) return refused('not-closable', `panel '${panelKey(target)}' cannot be closed`);
      const token = gate.take([engineId], 'close')!;
      const changed = closeNow(engineId);
      gate.release(token);
      return accepted(changed);
    },
    open: (engineId) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      return gate.busy([engineId], 'other') ? busy(target) : accepted(false);
    },
    move: (engineId, direction, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (!effective(target).draggable) return refused('not-draggable', `panel '${panelKey(target)}' cannot be moved`);
      const token = gate.take([engineId], 'other')!;
      const changed = reorderPanel(engineId, direction, source === 'person');
      if (changed) followPanel(engineId);
      gate.release(token);
      return accepted(changed);
    },
    place: (engineId, value, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      if (!effective(target).placeable) return refused('not-placeable', `panel '${panelKey(target)}' cannot be placed`);
      const token = gate.take([engineId], 'other')!;
      const changed = placeAt(engineId, value, source === 'person');
      if (changed) followPanel(engineId);
      gate.release(token);
      return accepted(changed);
    },
    setFormFactor: (engineId, next, source) => resizeOp(engineId, next, source),
    setSlots: (engineId, slots, source) => resizeOp(engineId, slots, source),
    scrollTo: (engineId, align) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      const to = align ?? (effective(target).scrollOnOpen === 'none' ? 'into-view' : (effective(target).scrollOnOpen as ScrollAlign));
      return accepted(requestOpen(engineId, { align: align ?? null, forced: true }) && wouldScroll(engineId, to));
    },
    pin: (engineId, by, source) => {
      const target = held(engineId);
      if (!isEntry(target)) return target;
      if (gate.busy([engineId], 'other')) return busy(target);
      const change: PinChange = { by };
      const status: PinStatus = target.live ? 'live' : heldIds.has(engineId) ? 'hidden' : 'parked';
      const decision = decidePinChange(target, status, effective(target).pinningWhenNotLive, change);
      const preview = previewPin(engineId, change);
      if (decision.kind === 'refuse') return refused(decision.code!, `panel '${panelKey(target)}' is not live and its pinningWhenNotLive does not let ${by}() reshape the row`);
      if (!preview.ok) return { ...refused(preview.code, preview.message), ...(preview.setting === undefined ? {} : { setting: preview.setting }) };
      const token = gate.take([engineId], 'other')!;
      try {
        if (decision.kind === 'defer') {
          // A call that leaves the panel reading as it does cancels what waits; any other replaces it.
          const equal = !preview.changed;
          const stored = target.deferredPin;
          const next = equal ? undefined : change;
          const moved = JSON.stringify(stored) !== JSON.stringify(next);
          if (moved) deferPin(engineId, next ?? null);
          return { ...accepted(moved), deferred: !equal };
        }
        if (decision.kind === 'show') {
          handleActivatePanel(engineId, change);
          if (source === 'person') recordPin(engineId, change);
          scrollForShow(engineId);
          return { ...accepted(true), shown: true };
        }
        const done = pinPanel(engineId, change, source === 'person');
        const changed = done.ok && done.changed;
        if (changed) followPanel(engineId);
        return accepted(changed);
      } finally {
        gate.release(token);
      }
    },
    reset: (engineIds, follow) => {
      const named = engineIds.map((id) => held(id)).filter(isEntry);
      if (gate.busy(panels.map((p) => p.id), 'other')) return refused('busy', 'a panel already has an operation in this turn');
      const token = gate.take(engineIds, 'other')!;
      const done = resetPanels(engineIds);
      gate.release(token);
      if (done.changed && follow && engineIds.length === 1) followPanel(engineIds[0]!);
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
      if (outcome.show !== undefined) {
        handleActivatePanel(engineId, outcome.show, applyConfigure(panels, target, outcome.next));
        scrollForShow(engineId);
      }
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
        if (core === undefined || panel.settings === undefined) return panel;
        const value = core.resolveDefaults(panel).value;
        const defaults = applyTemplate(panel, value, 'reconfigure');
        return clearOverrides([{ ...defaults, ...(slotsOf(panel) === value.slots ? {} : { slots: value.slots, formFactor: value.formFactor, size: { ...TIER_SIZES[value.formFactor] } }), applied: { placeOnAdd: value.placeOnAdd } }], [panel.id])[0]!;
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
    core?.publish({ entries: panels, held: heldIds, settled: restoreSettled, create: createFromWorkspace, lateRegister, ops });
  });

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
      // Every panel needs a distinguishable title, for testing. options?.title overrides it; the explicit `title:`
      // below (after the spread) is what makes that override win either way.
      const viewKey = safeOptions?.view ?? i.defaultView;
      const template = viewKey === undefined ? undefined : templateList().find((t) => t.id === viewKey);
      const settingsOn = core !== undefined || workspaceDefaults !== undefined || template !== undefined || (i.templates?.length ?? 0) > 0 || (i.declared?.length ?? 0) > 0;
      const plan = settingsOn ? planCreate(safeOptions, template, workspaceDefaults ?? {}) : undefined;
      const settings = plan?.resolution.value;
      // The gate reads the list as the updater will: this render's copy, then React's.
      if (template !== undefined && settings !== undefined && !mayCreate(settings, template.id, panels)) return;
      if (plan !== undefined && Object.keys(plan.host).length > 0) core?.hostAsked(id, plan.host);
      revealPanelProactively(panels, (prev) => {
        if (template !== undefined && settings !== undefined && !mayCreate(settings, template.id, prev)) return prev;
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
        if (plan === undefined || settings === undefined) return next;
        // A plain view's key is its id; a template's singleton is named by the template.
        const name = template === undefined ? undefined : settings.multiple ? `${template.id}~${id}` : template.id;
        return finishCreated({ row: next, id, settings, instance: plan.instance, name, callerPlaced: safeOptions?.anchor !== undefined, rootId, ...(core?.order !== undefined ? { order: core.order } : {}) });
      });
      if (plan !== undefined) {
        reportNotes(i.onNote, conflictNotes(id, plan.resolution.conflicts));
      }
      requestOpen(id, { fresh: true });
    },
    activate: raw((id: string) => [id], 'other', activatePanel),
    move: raw(
      (id: string, _direction: 'left' | 'right') => [id],
      'other',
      (id, direction) => void reorderPanel(id, direction),
    ),
    setFormFactor: raw(
      (id: string, _next: FormFactor) => [id],
      'other',
      (id, next) => {
        if (resizePanel(id, next)) {
          i.onPanelResize?.();
          followPanel(id);
        }
      },
    ),
    setSlots: raw(
      (id: string, _slots: number) => [id],
      'other',
      (id, slots) => {
        if (resizePanel(id, slots)) {
          i.onPanelResize?.();
          followPanel(id);
        }
      },
    ),
    // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
    // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
    reanchor: raw(
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
    close: raw((id: string) => [id], 'close', (id) => void closeNow(id)),
    recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
    undoClose: raw(() => closing.closedIds(), 'other', closing.undoClose),
    // Drops every clearable panel: never History, a fixed column or a locked one. Its picture goes now, not at an
    // undo window: a dropped panel can never be shown again. The ids come from the updater's own list, because
    // this render's `panels` misses a panel created earlier in the same batch.
    clearAll: () => {
      // A panel it removes answers `busy` to a manager call later in the turn; clearAll itself is never held back.
      const token = gate.takeFree(panels.filter((p) => effective(p).clearable).map((p) => p.id), 'other');
      setPanels((prev) => {
        for (const p of prev) if (effective(p).clearable && effective(p).snapshot !== 'never') clearedIds.current.add(p.id);
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
    scrollTo: (id, align) => requestOpen(id, { align: align ?? null, forced: true }),
    followPanel,
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
