/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import type { CreatePanelOptions, JsonValue, PanelsAPI, PanelSummary } from '../hostApi.js';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import { minWorkspaceWidth } from '../minWorkspaceWidth.js';
import { computeRowNumbers, gridEdgesOf, maxScrollOf, nearestStop, rootStepsAside, rowAnchor, slotSpanAt, snapToStop, snapToStopIndex, type RowNumbers } from '../rowNumbers.js';
import { resolveLabels, type PhonuxLabels } from '../labels.js';
import { ROW_BUMP_PX, ROW_BUMP_SEC, rowScrollerFor } from '../rowScroller.js';
import { applyRowIntent } from '../rowIntents.js';
import { createRestWatch } from './restWatch.js';
import { gestureTarget, scrollTargetFor } from '../scrollTargets.js';
import { isPresent, summarisePanel } from '../panelRowEntry.js';
import { registerRowKeys } from '../rowStep.js';
import { halfRest, isHalfOff, restStep, type RestStepInput, type RowRest } from '../rowRest.js';
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
import { appendPanel, clearOverrides, closePanel, parkedToReveal, parksForRoom, recordOverride, reanchorPanel, slotsOf, type AnchorRequest, type PanelWindow } from '../panelWindow.js';
import { bindingOf, type CreateRequest, type EngineOps, type WorkspaceHandle } from '../workspaceCore.js';
import { conflictNotes, finishCreated } from '../workspacePlan.js';
import { usePanelClosing, type Reapplied } from './usePanelClosing.js';
import { usePanelManager, type GateKind } from './usePanelManager.js';
import { createPanelList } from './panelList.js';
import { isParkLive, rowPricing, settleKeeping, type RowEnv } from './rowSettle.js';
import type { RootView } from '../panelManager.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';

import { useWorkspacePersistence, type RestMark } from './useWorkspacePersistence.js';
import { keepOpeners } from '../panelOpener.js';

/** Whether the host's CaptureTrigger is asked for a picture at `event`: a panel is captured at both. */
const asksForPicture = (event: 'park' | 'close'): boolean => FIXED.snapshot === 'both' || FIXED.snapshot === event;

/** How long the row must stand still, in ms, before it counts as at rest: a glide's last frame and a momentum tail are not rest. */
const REST_QUIET_MS = 150;

/** The index in `n.stops` of the stop nearest `at`, the earliest on a tie; -1 when the row has no stops. */
function nearestStopIndex(n: RowNumbers, at: number): number {
  let best = -1;
  for (const [k, stop] of n.stops.entries()) if (best < 0 || Math.abs(stop - at) < Math.abs(n.stops[best]! - at)) best = k;
  return best;
}

/** The rest of the row at stop `k`, as a saved mark names it: the first drawn entry the stop shows, and the stop's offset from that entry's left edge in phone widths. */
function markOfStop(n: RowNumbers, k: number, step: number): RestMark {
  const index = n.stopSpans[k]!.first;
  return { panel: n.ids[index]!, offset: (n.stops[k]! - (n.stripStart + n.leftOffsets[index]!)) / step };
}

/** The stop a saved mark names: the stop that shows its panel nearest the panel's left edge moved by the offset. Null when the panel is not drawn or no stop shows it. */
function stopOfMark(n: RowNumbers, mark: RestMark | null, step: number): number | null {
  if (mark === null) return null;
  const index = n.ids.indexOf(mark.panel);
  if (index < 0) return null;
  const target = n.stripStart + n.leftOffsets[index]! + mark.offset * step;
  // A mark saved at a rest names that rest exactly, whatever the panel it names shows there.
  const exact = n.stops.find((stop) => Math.abs(stop - target) < 1);
  if (exact !== undefined) return exact;
  const k = snapToStopIndex(n, index, target);
  return k < 0 ? null : n.stops[k]!;
}

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
const drawnAside = (p: PanelWindow): PanelWindow => ({ ...p, live: false, collapsible: true });

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
type RootSummon = { side: 'left' | 'right'; returns: readonly string[]; from: number | null; wasLive: ReadonlyMap<string, boolean> };

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

/** Which panels the row draws and where in the strip: it changes when a slot slides, and never for a window resize alone. */
const slotsKey = (n: RowNumbers): string => `${n.ids.join(',')}|${n.leftOffsets.join(',')}`;

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
  const maxLive = tuning.maxLivePanels ?? null;
  // A rest lives only for the row and the window it was made for: anything else that changes either ends it, and capacity refills its blanks.
  const [restHeld, setRestHeld] = useState<{ rest: RowRest; madeFor: string } | null>(null);
  const restKeyOf = (row: readonly PanelWindow[]): string => `${i.containerWidth}|${i.phoneWidth}|${row.filter(isPresent).map((p) => p.id).join(' ')}`;
  const rest = restHeld !== null && restHeld.madeFor === restKeyOf(rawPanels) ? restHeld.rest : null;
  const settleEnv: RowEnv = { phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedColumnCount: fixedViewCount, maxLive, dropTieBreak: timing.dropTieBreak, rest };
  const acted = [...keepLiveRef.current].filter(([, seen]) => seen !== rawPanels).map(([id]) => id);
  const panels = maxLive === null ? rawPanels : settleKeeping(settleEnv, rawPanels, acted);
  if (panels !== rawPanels) {
    const parked = rawPanels.filter((p, k) => p.live && !panels[k]!.live).map((p) => p.id);
    capParkedRef.current = [...capParkedRef.current.filter((id) => !parked.includes(id)), ...parked];
  }
  useLayoutEffect(() => {
    if (panels !== rawPanels) setPanels((current) => settleKeeping(settleEnv, current, acted));
  });
  // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
  const stopsOnGrid = tuning.rowGesture === 'step';
  // Capacity goes on pricing the list beside the root, so a panel that stepped it aside takes no neighbor; only the row draws it as parked.
  const rootAsideIn = (row: readonly PanelWindow[]): boolean => rootStepsAside({ entries: row, rootId, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap });
  // A root that was summoned stands in the row whatever the row would otherwise do with it.
  const [summoned, setSummoned] = useState<RootSummon | null>(null);
  const rootAside = summoned === null && rootAsideIn(panels);
  const drawnPanels = rootAside ? panels.map((p) => (p.id === rootId ? drawnAside(p) : p)) : panels;
  const rowInput = { entries: drawnPanels, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedItemCount: fixedViewCount - (rootAside ? 1 : 0), wholePanels: stopsOnGrid, rest };
  const drawnNumbersRef = useRef<RowNumbers | undefined>(undefined);
  // The direction of a step that swaps panels, until the commit that draws the swap.
  const swapStepRef = useRef<'left' | 'right' | null>(null);
  // Where the settle takes the row in the commit a summon changes the list: the scroll goes with the slots' own slide, so the panels that stay stand still on screen.
  const summonAimRef = useRef<number | null>(null);
  const rowNumbers = ((): RowNumbers => {
    const n = computeRowNumbers(rowInput);
    const el = i.overflowContainerRef.current;
    const scroller = el === null ? null : rowScrollerFor(el);
    if (scroller === null || tuning.rowGesture !== 'step' || scroller.claimHeld()) return n;
    const anchor = rowAnchor(drawnNumbersRef.current, n, scroller.glideTarget() ?? scroller.scrollLeft(), swapStepRef.current !== null);
    return anchor === undefined ? n : { ...n, anchor };
  })();
  const restedRef = useRef(false);
  const { maxLiveWidth } = rowNumbers;
  const fitCount = rowFitCount({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: tuning.rowGap, fixedColumnCount: fixedViewCount, liveWidths: [] });
  const maxFitPanels = fitCount === null ? null : effectiveMaxPanels(fitCount, fixedViewCount);
  // A host-fed phone width that is not a positive finite number leaves the value unset: the function throws on it, and a number the host only reads must not take the row down.
  const minWidth = !(i.phoneWidth > 0) || !Number.isFinite(i.phoneWidth) ? undefined : minWorkspaceWidth({ phoneWidth: i.phoneWidth, fixedColumnCount: fixedViewCount, gap: tuning.rowGap });
  const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, tuning.rowGap));
  const reducedMotion = useReducedMotionConfig() === true;
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
  // The container's width as laid out; before layout the host's measurement stands in for it.
  const windowOf = (el: HTMLElement): number => (el.clientWidth > 0 ? el.clientWidth : i.containerWidth);
  const requestScroll = (request: Omit<ScrollRequest, 'misses'>): boolean => {
    const el = i.overflowContainerRef.current;
    if (el === null) return false;
    if (rootAside && request.id === rootId && !rowScrollerFor(el).claimHeld()) showRoot(sideOfRoot());
    if (rowScrollerFor(el).claimHeld()) {
      // A host's scrollTo during a resize hold is kept: the resize's release settles the row, then the scroll runs. Automatic
      // scrolls stay dropped, as a drag drops them.
      if (request.forced && rowScrollerFor(el).deferUntilRelease(() => pendingScroll.set({ ...request, misses: 0 }))) return true;
      scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
      return false;
    }
    // A request on a panel that is already shown changes no state, so nothing else would commit for it to run in.
    pendingScroll.set({ ...request, misses: 0 });
    return true;
  };
  const followPanel = (id: string): void => {
    const el = i.overflowContainerRef.current;
    const entry = panels.find((p) => p.id === id);
    const k = rowNumbers.ids.indexOf(id);
    if (el === null || entry === undefined || k < 0 || effective(entry).scrollOnMove !== 'follow') return;
    const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k]!;
    const inView = left < rowScrollerFor(el).scrollLeft() + windowOf(el) - tuning.rowGap && left + rowNumbers.widths[k]! > rowScrollerFor(el).scrollLeft() + tuning.rowGap;
    if (inView) requestScroll({ id, kind: 'move', align: null, forced: false, fresh: false });
  };
  const requestOpen = (id: string, over: Partial<Pick<ScrollRequest, 'align' | 'forced' | 'fresh'>> = {}): boolean => requestScroll({ id, kind: 'open', align: null, forced: false, fresh: false, ...over });

  const snapped = (k: number, raw: number): number => snapToStop(rowNumbers, k, raw);
  /** Where the container would scroll to put panel `id` at `align`, or null when the row is not laid out for it. */
  const scrollTargetOf = (id: string, align: ScrollAlign): number | null => {
    const el = i.overflowContainerRef.current;
    const k = rowNumbers.ids.indexOf(id);
    if (el === null || k < 0) return null;
    const raw = scrollTargetFor({
      left: tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k]!,
      width: rowNumbers.widths[k]!,
      scrollLeft: rowScrollerFor(el).scrollLeft(),
      clientWidth: windowOf(el),
      maxScroll: maxScrollOf(rowNumbers),
      gap: tuning.rowGap,
      align,
    });
    return snapped(k, raw);
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
    restRow,
    showRoot,
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
    rest,
    rootAsideIn,
    setRest: (next, row) => setRestHeld(next.lead === 0 && next.tail === 0 && (next.head ?? 0) === 0 ? null : { rest: next, madeFor: restKeyOf(row) }),
  });

  core.observe(panels, heldIds);

  // A shown panel the page asked for, whether it was parked or already live out of view, is scrolled to once it is in.
  const activatePanel = (id: string): void => {
    const known = panels.some((p) => p.id === id);
    handleActivatePanel(id);
    if (known) requestOpen(id);
  };

  // Set once the persistence hook is called, below: the rest watch restores the saved state the hook owns.
  const [restWatcher] = useState(() => createRestWatch({ quietMs: REST_QUIET_MS, pointerHeld: () => pointerHeldRef.current, settled: () => settledRef.current }));
  // A pointer down on the row until it is let go, the scrollbar thumb included: a rest is not called while it is held.
  const pointerHeldRef = useRef(false);

  // The last swap: when its enter and exit end, and its direction. A swap back over one in flight reverses half-run
  // animations, and a fast back-and-forth turns into panels growing and shrinking in place, so a reversal waits for the
  // swap before it to land. Swaps the same way stay as fast as the input.
  const lastSwapRef = useRef<{ ends: number; direction: 'left' | 'right' } | null>(null);
  const swapAllowed = (direction: 'left' | 'right'): boolean => {
    const now = performance.now();
    const last = lastSwapRef.current;
    if (last !== null && last.direction !== direction && now < last.ends) return false;
    lastSwapRef.current = { ends: reducedMotion ? 0 : now + tuning.slide.durationSec * 1000, direction };
    return true;
  };

  /** The side of the drawn panels the root is on. */
  const sideOfRoot = (): 'left' | 'right' => (panels.findIndex((p) => p.id === rootId) < panels.findIndex(isParkLive) ? 'left' : 'right');
  /** Whether a step `direction` reaches the root that stepped aside: it is on that side, and no parked panel a step brings in lies between. */
  const rootIsNext = (direction: 'left' | 'right'): boolean => {
    if (!rootAside || sideOfRoot() !== direction) return false;
    const reveal = parkedToReveal(panels, direction);
    if (reveal === null) return true;
    const between = panels.indexOf(reveal) - panels.findIndex((p) => p.id === rootId);
    return direction === 'left' ? between < 0 : between > 0;
  };

  /** What a rest step reads from the row as drawn now. */
  const restInput = (direction: 'left' | 'right'): RestStepInput => {
    const n = rowNumbers;
    const slot = i.phoneWidth + tuning.rowGap;
    const last = n.ids.length - 1;
    const lastOff = last < 0 ? 0 : n.stripStart + n.leftOffsets[last]! + n.widths[last]! / 2 - n.stripWindow / 2;
    const drawn = panels.filter((p) => isPresent(p) && parksForRoom(p));
    const first = drawn[0];
    const firstAt = first === undefined ? -1 : n.ids.indexOf(first.id);
    const full = n.stripWidth + slot > n.stripWindow;
    const returns = first !== undefined && effective(first).revealOnScroll !== 'never';
    const left = parkedToReveal(panels, 'left');
    const rootAt = n.ids.findIndex((id) => { const p = panels.find((e) => e.id === id); return p !== undefined && !parksForRoom(p); });
    const lastDrawn = drawn.at(-1);
    const lastAt = lastDrawn === undefined ? -1 : n.ids.indexOf(lastDrawn.id);
    return {
      direction,
      rest,
      lastOff,
      slot,
      canLeft: left !== null,
      canRight: parkedToReveal(panels, 'right') !== null,
      revealSlots: left === null ? 1 : Math.max(1, left.slots ?? 1),
      parkable: drawn.length >= 2 && full && returns && firstAt >= 0 ? n.widths[firstAt]! + tuning.rowGap : null,
      rootOff: rootAt < 0 ? null : n.stripStart + n.leftOffsets[rootAt]! + n.widths[rootAt]! / 2 - n.stripWindow / 2,
      lastParkable: lastDrawn !== undefined && lastAt >= 0 && effective(lastDrawn).revealOnScroll !== 'never' ? n.widths[lastAt]! + tuning.rowGap : null,
      roomy: !full,
    };
  };

  // The rest that centers panel `id` when it sits half a slot off, parking the end panel it pushes out. Never the panel itself.
  const restOnHalf = (id: string): boolean => {
    const n = rowNumbers;
    const k = n.ids.indexOf(id);
    if (k < 0 || maxScrollOf(n) > 0 || (rest?.lead ?? 0) > 0) return false;
    const slot = i.phoneWidth + tuning.rowGap;
    const off = n.stripStart + n.leftOffsets[k]! + n.widths[k]! / 2 - n.stripWindow / 2;
    const drawn = panels.filter((p) => isPresent(p) && parksForRoom(p));
    if (!drawn.some((p) => p.id === id)) {
      // The root: the half step opens before it, and the slot it takes comes off the right end.
      if (!isHalfOff(off, slot) || off > 0 || (rest?.head ?? 0) % 1 !== 0) return false;
      const full = n.stripWidth + slot > n.stripWindow;
      const last = drawn.at(-1);
      if (full && (last === undefined || effective(last).revealOnScroll === 'never')) return false;
      const halved = { lead: 0, tail: (rest?.tail ?? 0) + 0.5, head: (rest?.head ?? 0) + 0.5 };
      restRow(full ? { park: 'right', rest: halved } : { rest: halved });
      return true;
    }
    if (!isHalfOff(off, slot) || n.stripWidth + slot <= n.stripWindow || (rest?.head ?? 0) > 0) return false;
    const end = off > 0 ? drawn[0] : drawn.at(-1);
    if (drawn.length < 2 || end === undefined || end.id === id || !drawn.some((p) => p.id === id)) return false;
    if (effective(end).revealOnScroll === 'never') return false;
    restRow({ park: off > 0 ? 'left' : 'right', rest: halfRest(rest) });
    return true;
  };
  const restOnHalfRef = useRef(restOnHalf);
  restOnHalfRef.current = restOnHalf;
  // Registered once per element: a cleanup on every commit would leave the row without it while the dot bar's effects run.
  const rowEl = i.overflowContainerRef.current;
  useEffect(() => (rowEl === null ? undefined : registerRowKeys(rowEl, { half: (id) => restOnHalfRef.current(id) })), [rowEl]);

  /** Whether the root stands whole in the view with the row at `at`. A row that does not draw it has nothing to answer for. */
  const rootInViewAt = (n: RowNumbers, at: number): boolean => {
    const k = n.ids.indexOf(rootId);
    if (k < 0) return true;
    const span = slotSpanAt(n, k, at);
    const grid = gridEdgesOf(n);
    return span.left >= grid.lo - 1 && span.right <= grid.hi + 1;
  };

  /**
   * Where the root stands now: in the view, summoned there, or out of it. The scroll it is heading for counts, so a press during a glide answers for where the row will rest.
   * A held root is always in view.
   */
  const rootView = (): RootView => {
    if (summoned !== null) return 'summoned';
    if (rootAside) return 'away';
    const el = i.overflowContainerRef.current;
    if (el === null) return 'shown';
    const scroller = rowScrollerFor(el);
    return rootInViewAt(rowNumbers, scroller.glideTarget() ?? scroller.scrollLeft()) ? 'shown' : 'away';
  };

  /**
   * Brings a root that is out of the view to the edge it is nearest: the panels in that edge's slot, and any between it and the root, park, and the rest of the view stays still.
   * A wide panel in that slot does not park: the row slides it over by one slot, so it runs off the far edge. False when there is nothing to do.
   */
  const summonRoot = (): boolean => {
    const el = i.overflowContainerRef.current;
    if (el === null || rootView() !== 'away') return false;
    const scroller = rowScrollerFor(el);
    if (scroller.claimHeld()) return false;
    const n = rowNumbers;
    const k = n.ids.indexOf(rootId);
    if (rootAside) {
      // The row draws the root again beside the panel that stepped it aside, which slides over as a wide panel does.
      swapStepRef.current = 'left';
      setSummoned({ side: sideOfRoot(), returns: [], from: null, wasLive: new Map() });
      return true;
    }
    const at = scroller.glideTarget() ?? scroller.scrollLeft();
    const slot = i.phoneWidth + tuning.rowGap;
    const grid = gridEdgesOf(n);
    const side = slotSpanAt(n, k, at).left < grid.lo ? 'left' : 'right';
    const hide: string[] = [];
    for (let j = k + (side === 'left' ? 1 : -1); j >= 0 && j < n.ids.length; j += side === 'left' ? 1 : -1) {
      const span = slotSpanAt(n, j, at);
      if (side === 'left' ? span.left >= grid.lo + slot - 1 : span.right <= grid.hi - slot + 1) break;
      if (side === 'left' ? span.right > grid.lo + slot + 1 : span.left < grid.hi - slot - 1) break;
      hide.push(n.ids[j]!);
    }
    // On the right the panels that park stand left of the root, so it rests that much further left.
    const parkedSpan = hide.reduce((sum, id) => sum + n.widths[n.ids.indexOf(id)]! + tuning.rowGap, 0);
    const rootRest = n.stripStart + n.leftOffsets[k]! + (side === 'left' ? -grid.lo : n.widths[k]! - grid.hi - parkedSpan);
    setSummoned({ side, returns: hide, from: at, wasLive: new Map(panels.filter(parksForRoom).map((p) => [p.id, p.live])) });
    if (hide.length > 0) {
      summonAimRef.current = rootRest;
      swapPanels(hide.map((id) => ({ id, stickiness: 'sticky' as const })), []);
      return true;
    }
    return applyRowIntent(scroller, { kind: 'summon', to: nearestStop({ ...n, stops: n.stepStops }, rootRest), durationSec: tuning.slide.durationSec, instant: reducedMotion, ease: tuning.slide.glideEase });
  };

  /** Sends a summoned root back out: what it parked returns where it stood, and the row is as it was. False when no summon stands. */
  const dismissRoot = (): boolean => {
    if (summoned === null) return false;
    const el = i.overflowContainerRef.current;
    setSummoned(null);
    // A step toward the root swaps panels while the summon stands, so the row goes back to what was live when it came, not only to what the summon parked.
    const shows = panels.filter((p) => summoned.wasLive.get(p.id) === true && !p.live);
    const hides = panels.filter((p) => summoned.wasLive.get(p.id) === false && p.live);
    if (shows.length + hides.length > 0) {
      summonAimRef.current = summoned.from;
      swapPanels(hides.map((p) => ({ id: p.id, stickiness: 'until-room' as const })), shows.map((p) => ({ id: p.id, place: 'in-place' as const })));
    } else if (summoned.from !== null && el !== null) {
      applyRowIntent(rowScrollerFor(el), { kind: 'summon', to: summoned.from, durationSec: tuning.slide.durationSec, instant: reducedMotion, ease: tuning.slide.glideEase });
    }
    return true;
  };

  // However the row carries a summoned root out, by a dot, a scroll to a panel or a step past it, what the summon parked comes back and the summon is over.
  const leaveSummonRef = useRef<(at: number) => void>(() => undefined);
  leaveSummonRef.current = (at) => {
    if (summoned === null || rootInViewAt(rowNumbers, at)) return;
    const k = rowNumbers.ids.indexOf(rootId);
    const grid = gridEdgesOf(rowNumbers);
    const returns = summoned.returns.filter((id) => panels.some((p) => p.id === id && !p.live));
    // They return beside the root: past it the strip grows, so a row left of them stays and a row right of them follows.
    const widthOf = (id: string): number => panelWidthOf(panels.find((p) => p.id === id)!, i.phoneWidth, maxLiveWidth, tuning.rowGap);
    const grows = slotSpanAt(rowNumbers, k, at).left < grid.lo ? returns.reduce((sum, id) => sum + widthOf(id) + tuning.rowGap, 0) : 0;
    setSummoned(null);
    if (returns.length === 0) return;
    summonAimRef.current = at + grows;
    swapPanels([], returns.map((id) => ({ id, place: 'in-place' as const })));
  };
  const summonStands = summoned !== null;
  useEffect(() => {
    const el = i.overflowContainerRef.current;
    if (!summonStands || el === null) return undefined;
    const scroller = rowScrollerFor(el);
    return scroller.subscribe(() => {
      if (!scroller.claimHeld()) leaveSummonRef.current(scroller.glideTarget() ?? scroller.scrollLeft());
    });
  }, [summonStands, i.overflowContainerRef]);

  // One step of the gesture. A row with nothing to scroll toward swaps: the parked panel beside the live range comes in.
  // `paceSec`: a swipe's step asked while the last one glides, with the time the swipe took to travel it; the retarget may take that long, so the row moves at the swipe's pace.
  const stepRow = (direction: 'left' | 'right', paceSec?: number): void => {
    const el = i.overflowContainerRef.current;
    if (el === null) return;
    watchRest();
    const scroller = rowScrollerFor(el);
    if (scroller.claimHeld()) return;
    if (summoned !== null) {
      // A step away sends a summoned root back, which is that step; a step toward it goes on as any step, and the summon stands until the root leaves the view.
      if (direction !== summoned.side) {
        dismissRoot();
        return;
      }
    }
    const maxScroll = maxScrollOf(rowNumbers);
    // A step with nowhere to go gives the iOS rubber band instead of nothing.
    const bump = (): void => {
      if (!reducedMotion) scroller.bump(direction, { distancePx: ROW_BUMP_PX, durationSec: ROW_BUMP_SEC, holdMs: tuning.gestureQuietMs });
    };
    if (!rowNumbers.rowScroll || maxScroll <= 0) {
      const gate = lastSwapRef.current;
      if (!swapAllowed(direction)) return;
      if (rootIsNext(direction)) {
        swapStepRef.current = direction;
        showRoot(direction);
        return;
      }
      const plan = restStep(restInput(direction));
      swapStepRef.current = direction;
      if (plan !== null) {
        restRow(plan);
        return;
      }
      if (scrollRow(direction)) return;
      swapStepRef.current = null;
      // Nothing came in, so no swap holds the gate against a step back.
      lastSwapRef.current = gate;
      bump();
      return;
    }
    let liveBefore = 0;
    const hidden = [];
    for (const p of panels) {
      if (rowNumbers.ids.includes(p.id)) liveBefore += 1;
      else if (!isPresent(p) && p.marker !== true) hidden.push({ id: p.id, liveBefore, held: heldIds.has(p.id), policy: effective(p).revealOnScroll });
    }
    const step = gestureTarget({
      direction,
      base: scroller.glideTarget() ?? scroller.scrollLeft(),
      clientWidth: windowOf(el),
      // The strip is padded so every stop is reachable, which puts the browser's end past the last stop.
      maxScroll,
      liveStarts: rowNumbers.leftOffsets.map((offset) => rowNumbers.stripStart + offset),
      liveWidths: rowNumbers.widths,
      stops: rowNumbers.stepStops,
      gap: tuning.rowGap,
      hidden,
      phoneWidth: i.phoneWidth,
      rootAt: rowNumbers.ids.indexOf(rootId),
      ...(Number.isFinite(rowNumbers.windowWidth) ? { grid: gridEdgesOf(rowNumbers) } : {}),
    });
    if (step.kind === 'show') {
      if (!swapAllowed(direction)) return;
      // The panel beside the run comes in as it does at the row's end, parking the far end, so a step never parks a panel in the middle of the view.
      if (parkedToReveal(panels, direction)?.id === step.id) {
        swapStepRef.current = direction;
        if (scrollRow(direction)) return;
        swapStepRef.current = null;
      }
      activatePanel(step.id);
    }
    else if (step.kind === 'none') {
      // An end of a parking row wider than its window: the parked panels past it come in as they do in a row that fits.
      const gate = lastSwapRef.current;
      swapStepRef.current = direction;
      if (panels.filter((p) => isPresent(p) && !parksForRoom(p)).length <= fixedViewCount && swapAllowed(direction) && scrollRow(direction)) return;
      swapStepRef.current = null;
      lastSwapRef.current = gate;
      bump();
    }
    else if (step.kind === 'scroll') {
      applyRowIntent(scroller, { kind: 'step', to: step.to, mode: tuning.fastScroll, durationSec: Math.max(tuning.slide.durationSec, paceSec ?? 0), ease: tuning.slide.glideEase, instant: reducedMotion, windowWidth: windowOf(el) });
    }
  };

  // The slots the last commit drew, read by the settle below before this commit's are recorded.
  const drawnSlotsRef = useRef('');
  const settledNumbersRef = useRef<RowNumbers | undefined>(undefined);
  const endWidthRef = useRef<number | undefined>(undefined);
  // The window, a close or a reorder moves the stops: a row left between two is brought to the nearest one.
  // The glide's own target is the base, so a settle never fights a step in flight. Never while a drag holds the row.
  useLayoutEffect(() => {
    const el = i.overflowContainerRef.current;
    if (el === null || tuning.rowGesture !== 'step' || !Number.isFinite(rowNumbers.windowWidth)) return;
    const scroller = rowScrollerFor(el);
    if (scroller.claimHeld()) return;
    let base = scroller.glideTarget() ?? scroller.scrollLeft();
    if (rowNumbers.anchor !== undefined) {
      base = Math.max(0, base + rowNumbers.anchor);
      if (rowNumbers.stepStops.length === 0 && base < 1) base = 0;
      applyRowIntent(scroller, { kind: 'place', to: base, ease: tuning.slide.glideEase });
    }
    const before = settledNumbersRef.current;
    settledNumbersRef.current = rowNumbers;
    // A wider window can bring a parked panel back a commit after the new width, when the row fits for one commit in between.
    const wasAtEnd = before !== undefined && before.windowWidth !== rowNumbers.windowWidth && before.stepStops.length > 1 && Math.abs(base - before.stepStops.at(-1)!) < 1;
    if (wasAtEnd) endWidthRef.current = rowNumbers.windowWidth;
    else if (endWidthRef.current !== rowNumbers.windowWidth) endWidthRef.current = undefined;
    // When the slots slid (a close, an open, a reorder) the settle rides their own curve: on another, a panel that both slides and
    // scrolls lurches back and forth.
    const ease = slotsKey(rowNumbers) === drawnSlotsRef.current ? tuning.slide.glideEase : ([...tuning.slide.ease] as [number, number, number, number]);
    // A row that fits has one rest, 0: a close that brings the whole row into view glides there with the close.
    if (rowNumbers.stepStops.length === 0) {
      if (base >= 0.5) applyRowIntent(scroller, { kind: 'settle', to: 0, durationSec: tuning.slide.durationSec, instant: reducedMotion || (before !== undefined && before.windowWidth !== rowNumbers.windowWidth), ease });
      return;
    }
    // The settle lands on a step stop, so the next step is a whole phone width; the whole-panel stops can sit between grid points.
    // A new window width rescales every stop, so a row resting at an end stays at that end rather than at the nearest pixel.
    const atEnd = endWidthRef.current === rowNumbers.windowWidth;
    endWidthRef.current = undefined;
    // A step that swapped panels goes on to move the row its one slot, from where the anchor left it.
    const stepped = rowNumbers.anchor === undefined || swapStepRef.current === null ? 0 : (swapStepRef.current === 'left' ? -1 : 1) * (i.phoneWidth + tuning.rowGap);
    const aim = summonAimRef.current;
    summonAimRef.current = null;
    const to = atEnd ? rowNumbers.stepStops.at(-1)! : nearestStop({ ...rowNumbers, stops: rowNumbers.stepStops }, aim ?? base + stepped);
    // The first stop is not 0 once another stop needs room left of it; opening the row there is not a movement to animate.
    const opening = !restedRef.current;
    restedRef.current = true;
    // A window step lands at once, as the row's margin does: a glide per step would trail the window's edge.
    const windowStep = before !== undefined && before.windowWidth !== rowNumbers.windowWidth;
    if (Math.abs(to - base) < 0.5) return;
    applyRowIntent(scroller, { kind: 'settle', to, durationSec: tuning.slide.durationSec, instant: reducedMotion || opening || windowStep, ease });
  }, [rowNumbers.stepStops.join(','), rowNumbers.stripStart, rowNumbers.endPad, rowNumbers.anchor]);
  useLayoutEffect(() => {
    drawnSlotsRef.current = slotsKey(rowNumbers);
    // A swap can take a commit of its own to mark its exits first, so the step is kept until the panels themselves change.
    if (drawnNumbersRef.current?.ids.join(' ') !== rowNumbers.ids.join(' ')) swapStepRef.current = null;
    drawnNumbersRef.current = rowNumbers;
  });

  // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
  // Every wheel event and finger move keeps a bump at the end held, so the row springs back only once the scrolling stops.
  const keepBump = (direction: 'left' | 'right'): void => {
    const el = i.overflowContainerRef.current;
    if (el !== null) rowScrollerFor(el).keepBump(direction, tuning.gestureQuietMs);
  };
  useRowScrollGesture(i.overflowContainerRef, stepRow, timing.gestureLockMs, tuning.rowGesture, tuning.gestureQuietMs, i.phoneWidth + tuning.rowGap, keepBump);

  const shrinkUnfocusedRef = useRef(tuning.shrinkUnfocused);
  shrinkUnfocusedRef.current = tuning.shrinkUnfocused;
  const { restoreSettled, dismiss, undismiss, isDismissed, scroll, setScroll } = useWorkspacePersistence({
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

  // A row a person moves is saved where it comes to rest. A wheel or pointer-down on the row and a step (a key or a
  // wheel gesture) call `restWatch`: it watches the row until it has stood still for REST_QUIET_MS, and if it moved,
  // records the stop it rests on. It adds no listener, so the row's listener budget is the gesture's own. Nothing runs at open.
  const settledRef = useRef(restoreSettled);
  settledRef.current = restoreSettled;
  const rowNumbersRef = useRef(rowNumbers);
  rowNumbersRef.current = rowNumbers;
  const stepRef = useRef(0);
  stepRef.current = i.phoneWidth + tuning.rowGap;
  const watchRest = (): void => {
    const el = i.overflowContainerRef.current;
    if (el !== null) restWatcher.watch(el, restAt);
  };
  const restAt = (at: number): void => {
    const n = rowNumbersRef.current;
    const k = nearestStopIndex(n, at);
    if (k < 0) return;
    const mark = markOfStop(n, k, stepRef.current);
    setScroll((prev) => (prev !== null && prev.panel === mark.panel && prev.offset === mark.offset ? prev : mark));
  };
  useEffect(() => () => restWatcher.cancel(), [restWatcher]);

  /** `row` with `leaves` parked when the row's live panels no longer fit, so the open's chosen panel goes rather than the cap's pick. */
  const makeRoom = (row: PanelWindow[], leaves: string): PanelWindow[] => {
    const live = row.filter(isParkLive);
    if (rowPricing(settleEnv, row).settles(live) || !live.some((p) => p.id === leaves)) return row;
    return row.map((p) => (p.id === leaves ? { ...p, live: false } : p));
  };
  const createFromWorkspace = (req: CreateRequest): void => {
    const template = templateList().find((t) => t.id === req.templateId);
    if (template === undefined) return;
    // Built here, outside the updater below: React may run an updater twice and the host's builder is not required to be pure.
    const hostData = i.defaultHostData?.();
    const carried = req.carried;
    const build = (prev: PanelWindow[]): PanelWindow[] => {
      if (prev.some((p) => panelKey(p) === req.id)) return prev;
      const made = appendFromTemplate(prev, { template, id: req.engineId, name: req.id, settings: req.settings, params: req.params, url: req.url, hostData, defaults: workspaceDefaults, rootId, order: core.order, declared: req.declared === true, fallbackTitle: labels.panelTitle(req.engineId), rowEnd: carried !== undefined, ...(req.place !== undefined ? { place: req.place } : {}) });
      const roomed = req.leaves === undefined ? made : makeRoom(made, req.leaves);
      const opened = req.openedBy === undefined ? roomed : roomed.map((p) => (p.id === req.engineId ? { ...p, openedBy: req.openedBy } : p));
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
    const shown = [...grown.keys()].find((id) => {
      const k = rowNumbers.ids.indexOf(id);
      if (k < 0) return false;
      const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k]!;
      return left < rowScrollerFor(el).scrollLeft() + windowOf(el) && left + rowNumbers.widths[k]! > rowScrollerFor(el).scrollLeft();
    });
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
  const attachOwner = useRef({});
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

  // A wheel or pointer-down on the row before the first scroll means the person already chose where to look.
  const touchedRef = useRef(false);
  useEffect(() => {
    const touch = (e: Event): void => {
      const el = i.overflowContainerRef.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) {
        touchedRef.current = true;
        if (e.type === 'pointerdown') pointerHeldRef.current = true;
        watchRest();
      }
    };
    const release = (): void => {
      pointerHeldRef.current = false;
    };
    window.addEventListener('wheel', touch, { capture: true, passive: true });
    window.addEventListener('pointerdown', touch, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('wheel', touch, true);
      window.removeEventListener('pointerdown', touch, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
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
    if (touchedRef.current || scroller.glideTarget() !== null || rowScrollerFor(el).scrollLeft() !== 0) return;
    const where = tuning.initialScroll;
    const maxScroll = maxScrollOf(rowNumbers);
    let to = rowNumbers.stops[0] ?? 0;
    // A saved rest wins over initialScroll: the row was left where the person put it.
    const rested = stopOfMark(rowNumbers, scroll, i.phoneWidth + tuning.rowGap);
    if (rested !== null) {
      to = rested;
    } else if (where === 'end') {
      to = maxScroll;
    } else if (where !== 'start') {
      const k = rowNumbers.ids.indexOf(where === 'root' ? rootId : engineIdOf(where.panel));
      if (k >= 0) {
        const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k]!;
        to = snapped(k, scrollTargetFor({ left, width: rowNumbers.widths[k]!, scrollLeft: 0, clientWidth: windowOf(el), maxScroll, gap: tuning.rowGap, align: 'start' }));
      }
    }
    if (to !== 0) applyRowIntent(scroller, { kind: 'place', to, ease: tuning.slide.glideEase });
  });

  // Runs the pending request against this commit's numbers: the target margin is the one about to be drawn.
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
    const scroller = rowScrollerFor(el);
    // Where a glide in flight is heading, not where it passes: the panel is brought into view of the row as it will rest.
    const from = scroller.glideTarget() ?? scroller.scrollLeft();
    const to = snapped(
      k,
      scrollTargetFor({
        left: tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k]!,
        width: rowNumbers.widths[k]!,
        scrollLeft: from,
        clientWidth: windowOf(el),
        maxScroll: maxScrollOf(rowNumbers),
        gap: tuning.rowGap,
        align,
      }),
    );
    if (Math.abs(to - from) < 0.5) return;
    if (!applyRowIntent(scroller, { kind: 'show', to, durationSec: tuning.slide.durationSec, instant: reducedMotion, ease: tuning.slide.glideEase })) {
      scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
    }
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
      if (changed) followPanel(engineId);
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
            followPanel(id);
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
    entries: drawnPanels,
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
