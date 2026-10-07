/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import type { CreatePanelOptions, JsonValue, PanelsAPI } from '../hostApi.js';
import { computeRowNumbers, maxScrollOf, type RowNumbers } from '../rowNumbers.js';
import { rowScrollerFor } from '../rowScroller.js';
import { gestureTarget, scrollTargetFor } from '../scrollTargets.js';
import { isPresent, summarisePanel } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger, type CaptureTrigger } from '../snapshots.js';
import { LIBRARY_TUNING_DEFAULTS, effective, resolvePanelSettings } from '../panelSettings.js';
import type { PanelSettings, PanelSettingsResolution, ResolvedPanelSettings, ResolvedWorkspaceTuning, ScrollAlign, SettingNote, WorkspaceTuning } from '../panelSettings.js';
import type { PanelTemplate } from '../panelTemplate.js';
import { reportNotes } from '../panelPlacement.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { appendPanel, recordOverride, reanchorPanel, type PanelWindow } from '../panelWindow.js';
import { listTemplates } from '../viewRegistry.js';
import { conflictNotes, finishCreated } from '../workspacePlan.js';
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
  /** Called once per close with its closed-pages log entry; the host decides where that log lives. See usePanelClosing.ts. */
  onPanelsClosed?: (entry: {
    /** The log id, `<closedAt>#<panel id>`; the id `onPanelsRestored` reports back. */
    id: string;
    /** The panel's title, else its URL, else 'Untitled panel'. */
    title: string;
    /** The panel's URL. */
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
  /** The workspace's tuning leaves; each one left out, or out of range, takes the library default. The engine reads `rowGap`, `saveQuietMs`, `gestureLockMs`, `returnTieBreak` and `dropTieBreak` here; the row reads `dragToClose`, `slide` and `hopFraction` through the Workspace given the same value. */
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
  };
}

/** Whether a host-bag `create` of `template` may add another, given the entries as they stand: `hostCreatable`, `multiple` and `maxInstances`. */
function mayCreate(settings: ResolvedPanelSettings, templateId: string, entries: readonly PanelWindow[]): boolean {
  if (!settings.hostCreatable) return false;
  const have = entries.filter((p) => p.view === templateId).length;
  if (have > 0 && !settings.multiple) return false;
  return settings.maxInstances === 'unlimited' || have < settings.maxInstances;
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
  const [panels, setPanels] = useState<PanelWindow[]>(() => [...(i.initialEntries ?? [])]);
  const timing = timingTuning(i.tuning);
  const tuning = resolveWorkspaceTuning(i.tuning);
  const fixedViewCount = i.fixedViewCount ?? panels.filter((p) => !p.collapsible && p.marker !== true).length;
  // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
  const rowNumbers = computeRowNumbers({ entries: panels, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedItemCount: fixedViewCount });
  const { maxLiveWidth } = rowNumbers;
  const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth));
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
  } = usePanelManager(panels, setPanels, i.phoneWidth, i.containerWidth, fixedViewCount, i.rootId, {
    onNote: i.onNote,
    tuning: { rowGap: tuning.rowGap, returnTieBreak: timing.returnTieBreak, dropTieBreak: timing.dropTieBreak },
  });

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
      gap: tuning.rowGap,
      hidden,
    });
    if (step.kind === 'show') activatePanel(step.id);
    else if (step.kind === 'scroll') scroller.glideTo(step.to, { durationSec: tuning.slide.durationSec, instant: reducedMotion });
  };

  // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
  useRowScrollGesture(i.overflowContainerRef, stepRow, timing.gestureLockMs, tuning.rowGesture);

  const { restoreSettled } = useWorkspacePersistence({
    storage: i.storage,
    panels,
    setPanels,
    rootId: i.rootId,
    freshId,
    defaultHostData: i.defaultHostData,
    saveQuietMs: timing.saveQuietMs,
    templates: i.templates,
    declared: i.declared,
    workspaceDefaults: i.workspaceDefaults,
    onNote: i.onNote,
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
      const k = rowNumbers.ids.indexOf(where === 'root' ? i.rootId : where.panel);
      if (k >= 0) {
        const left = tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!;
        to = scrollTargetFor({ left, width: rowNumbers.widths[k]!, scrollLeft: 0, clientWidth: windowOf(el), maxScroll, gap: tuning.rowGap, align: 'start' });
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
    const to = scrollTargetFor({
      left: tuning.rowGap + rowNumbers.rowMarginLeft + rowNumbers.leftOffsets[k]!,
      width: rowNumbers.widths[k]!,
      scrollLeft: scroller.scrollLeft(),
      clientWidth: windowOf(el),
      maxScroll: maxScrollOf(rowNumbers),
      gap: tuning.rowGap,
      align,
    });
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
      const template = safeOptions?.view === undefined ? undefined : [...listTemplates().filter((t) => !(i.templates ?? []).some((g) => g.id === t.id)), ...(i.templates ?? [])].find((t) => t.id === safeOptions.view);
      const settingsOn = i.workspaceDefaults !== undefined || template !== undefined || (i.templates?.length ?? 0) > 0 || (i.declared?.length ?? 0) > 0;
      const plan = settingsOn ? planCreate(safeOptions, template, i.workspaceDefaults ?? {}) : undefined;
      const settings = plan?.resolution.value;
      // The gate reads the list as the updater will: this render's copy, then React's.
      if (template !== undefined && settings !== undefined && !mayCreate(settings, template.id, panels)) return;
      revealPanelProactively(panels, (prev) => {
        if (template !== undefined && settings !== undefined && !mayCreate(settings, template.id, prev)) return prev;
        const next = appendPanel(
          prev,
          {
            url: 'about:blank',
            hostData,
            params: template?.params,
            ...safeOptions,
            ...(template !== undefined ? { permanent: undefined } : {}),
            title: safeOptions?.title ?? `Panel ${id}`,
          },
          id,
          i.rootId,
        );
        if (plan === undefined || settings === undefined) return next;
        // A plain view's key is its id; a template's singleton is named by the template.
        const name = template === undefined ? undefined : settings.multiple ? `${template.id}~${id}` : template.id;
        return finishCreated({ row: next, id, settings, instance: plan.instance, name, callerPlaced: safeOptions?.anchor !== undefined, rootId: i.rootId });
      });
      if (plan !== undefined) {
        reportNotes(i.onNote, conflictNotes(id, plan.resolution.conflicts));
      }
      requestOpen(id, { fresh: true });
    },
    activate: activatePanel,
    move: reorderPanel,
    setFormFactor: (id, next) => {
      if (resizePanel(id, next)) {
        i.onPanelResize?.();
        followPanel(id);
      }
    },
    // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
    // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
    reanchor: (id, anchor) => {
      setPanels((prev) => {
        const next = reanchorPanel(prev, id, anchor, i.rootId);
        return next === prev ? prev : recordOverride(next, 'anchor', next.map((p) => p.id), i.rootId);
      });
      followPanel(id);
    },
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
