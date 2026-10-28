/**
 * The app's implementation of PanelsAPI: the panel list, create/activate/close/undo/clear-all. Wraps
 * usePanelManager, composes usePanelClosing and owns the row's scroll gesture. panelList and recentlyClosed hold
 * PanelSummary objects built here, never PanelWindow records (phonux-app's provide-panels test pins their key set); `entries`
 * is the raw list, hostData included, for the app and PanelRow only: an app keeps it out of the bag its views read,
 * and the row's numbers (fixedViewCount, liveWidths, maxLiveWidth) beside it.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReducedMotionConfig } from 'motion/react';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import { minWorkspaceWidth } from '../minWorkspaceWidth.js';
import { computeRowNumbers, maxScrollOf, nearestStop, snapToStop, snapToStopIndex } from '../rowNumbers.js';
import { resolveLabels } from '../labels.js';
import { rowScrollerFor } from '../rowScroller.js';
import { stepGlide } from '../rowFastScroll.js';
import { createRestWatch } from './restWatch.js';
import { gestureTarget, scrollTargetFor } from '../scrollTargets.js';
import { isPresent, summarisePanel } from '../panelRowEntry.js';
import { entryNamed } from '../panelIds.js';
import { panelWidthOf } from '../panelTiers.js';
import { noopCaptureTrigger } from '../snapshots.js';
import { PANEL_RECT_EVENT, panelRectEvent } from '../panelChrome.js';
import { applyConfigure } from '../panelConfigure.js';
import { accepted, refused } from '../panelManager.js';
import { FIXED, LIBRARY_TUNING_DEFAULTS, applyTemplate, effective, panelKey, resolvePanelSettings } from '../panelSettings.js';
import { reportNotes } from '../panelPlacement.js';
import { resolveWorkspaceTuning } from '../panelTuning.js';
import { appendPanel, clearOverrides, closePanel, recordOverride, reanchorPanel, slotsOf } from '../panelWindow.js';
import { bindingOf } from '../workspaceCore.js';
import { conflictNotes, finishCreated } from '../workspacePlan.js';
import { usePanelClosing } from './usePanelClosing.js';
import { usePanelManager } from './usePanelManager.js';
import { createPanelList } from './panelList.js';
import { isParkLive, rowPricing, settleKeeping } from './rowSettle.js';
import { useRowScrollGesture } from './useRowScrollGesture.js';
import { useWorkspacePersistence } from './useWorkspacePersistence.js';
import { keepOpeners } from '../panelOpener.js';
/** Whether the host's CaptureTrigger is asked for a picture at `event`: a panel is captured at both. */
const asksForPicture = (event) => FIXED.snapshot === 'both' || FIXED.snapshot === event;
/** How long the row must stand still, in ms, before it counts as at rest: a glide's last frame and a momentum tail are not rest. */
const REST_QUIET_MS = 150;
/** The index in `n.stops` of the stop nearest `at`, the earliest on a tie; -1 when the row has no stops. */
function nearestStopIndex(n, at) {
    let best = -1;
    for (const [k, stop] of n.stops.entries())
        if (best < 0 || Math.abs(stop - at) < Math.abs(n.stops[best] - at))
            best = k;
    return best;
}
/** The rest of the row at stop `k`, as a saved mark names it: the first drawn entry the stop shows, and the stop's offset from that entry's left edge in phone widths. */
function markOfStop(n, k, step) {
    const index = n.stopSpans[k].first;
    return { panel: n.ids[index], offset: (n.stops[k] - (n.stripStart + n.leftOffsets[index])) / step };
}
/** The stop a saved mark names: the stop that shows its panel nearest the panel's left edge moved by the offset. Null when the panel is not drawn or no stop shows it. */
function stopOfMark(n, mark, step) {
    if (mark === null)
        return null;
    const index = n.ids.indexOf(mark.panel);
    if (index < 0)
        return null;
    const k = snapToStopIndex(n, index, n.stripStart + n.leftOffsets[index] + mark.offset * step);
    return k < 0 ? null : n.stops[k];
}
/**
 * Duck-typed (a `preventDefault` function): a bare `onClick={panels.create}` reference passes the click
 * event positionally, so this discards it rather than spreading `view` into the new panel (see DESIGN.md).
 */
function isEventLike(value) {
    return typeof value === 'object' && value !== null && typeof value.preventDefault === 'function';
}
/** `options` resolved against the workspace defaults and, for a template view, the template's own layer. A permanent column is a plain view's own ask; a template's panel cannot ask it, which the resolver records as a conflict. */
function planCreate(options, template, defaults) {
    const permanent = options?.permanent === true;
    const host = {
        ...(options?.title !== undefined ? { title: options.title } : {}),
        ...(!permanent && options?.listed !== undefined ? { listed: options.listed } : {}),
        ...(options?.layer !== undefined ? { layer: options.layer } : {}),
        ...(options?.anchoredEnter === true ? { enterFrom: 'anchor' } : {}),
        ...(!permanent && options?.slots !== undefined ? { slots: options.slots } : {}),
        ...(permanent && template !== undefined ? { parkable: false } : {}),
    };
    // A view cannot set `parkable`, so a permanent plain column is the library's own ask, on the instance layer.
    const own = permanent && template === undefined ? { parkable: false } : {};
    const { parkable: _asked, ...saved } = host;
    return {
        resolution: resolvePanelSettings({ workspace: defaults, ...(template !== undefined ? { template: template.settings } : {}), host, instance: own }),
        instance: { ...saved, ...own },
        host: saved,
    };
}
/** Whether a host-bag `create` of `template` may add another, given the entries as they stand: `hostCreatable`, `multiple` and `maxInstances`. */
function mayCreate(settings, templateId, entries) {
    if (!settings.hostCreatable)
        return false;
    const have = entries.filter((p) => p.view === templateId).length;
    if (have > 0 && !settings.multiple)
        return false;
    return settings.maxInstances === 'unlimited' || have < settings.maxInstances;
}
/** `prev` with a panel of `a.template` appended and placed where its `placeOnAdd` says; `declared` marks one code declares again at every launch, which the file saves without an instance layer. */
function appendFromTemplate(prev, a) {
    const { value } = resolvePanelSettings({ ...(a.defaults !== undefined ? { workspace: a.defaults } : {}), template: a.template.settings, ...(a.settings !== undefined ? { instance: a.settings } : {}) }, { lenient: true });
    const params = a.params ?? a.template.params;
    const next = appendPanel(prev, {
        url: a.url ?? '',
        view: a.template.id,
        title: value.title ?? a.fallbackTitle,
        ...(params !== undefined ? { params } : {}),
        ...(a.hostData !== undefined ? { hostData: a.hostData } : {}),
        listed: value.listed,
        layer: value.layer,
        slots: value.slots,
        permanent: !value.parkable,
    }, a.id, a.rootId);
    const made = finishCreated({ row: next, id: a.id, settings: value, instance: a.settings ?? {}, name: a.name, callerPlaced: a.rowEnd === true, rootId: a.rootId, ...(a.order !== undefined ? { order: a.order } : {}), ...(a.place !== undefined ? { place: a.place } : {}) });
    if (!a.declared)
        return made;
    return made.map((p) => {
        if (p.id !== a.id)
            return p;
        const { instance: _saved, ...rest } = p;
        return { ...rest, declared: true };
    });
}
/** The four timing leaves of `tuning`, each at its library default when unset or unusable. */
function timingTuning(tuning) {
    const ms = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);
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
/** Commits a request for a panel not in the row waits before it is dropped. */
const REQUEST_WAIT_COMMITS = 2;
/** Which panels the row draws and where in the strip: it changes when a slot slides, and never for a window resize alone. */
const slotsKey = (n) => `${n.ids.join(',')}|${n.leftOffsets.join(',')}`;
/**
 * Builds the `PanelsAPI` an app hands its views. The provider owns the panel list, seeded once from `initialEntries`.
 * Call it with this render's inputs and never memoise the result: its handlers close over this render's list.
 * @public
 */
export function useProvidePanels(i) {
    const capture = i.capture ?? noopCaptureTrigger;
    const onPanelRect = useRef(i.onPanelRect);
    onPanelRect.current = i.onPanelRect;
    // Every id this provider has rendered, mapped to its key. Kept after a panel leaves so its exit still reports under its key.
    const keyById = useRef(new Map());
    const labels = resolveLabels(i.labels);
    // The first workspace given is the one this hook serves for its whole life; a later one is reported, never followed.
    const boundWorkspace = useRef(i.workspace).current;
    const core = bindingOf(boundWorkspace);
    useEffect(() => {
        if (i.workspace !== boundWorkspace)
            console.error('useProvidePanels: the workspace changed while mounted and the first one stays attached; give the component a key so a new workspace remounts it.');
    }, [i.workspace, boundWorkspace]);
    const rootId = core.rootId;
    const [list] = useState(() => createPanelList(core.initialEntries()));
    const rawPanels = useSyncExternalStore(list.subscribe, list.get, list.get);
    // Every change to the list passes here, so a panel that leaves by any path hands its children to its own opener.
    const [setPanels] = useState(() => (next) => list.set((prev) => keepOpeners(prev, typeof next === 'function' ? next(prev) : next)));
    const tuningInput = core.tuningInput;
    const timing = timingTuning(tuningInput);
    const workspaceTuning = useSyncExternalStore(core.subscribe, () => core.tuning, () => core.tuning);
    const tuning = workspaceTuning ?? resolveWorkspaceTuning(tuningInput);
    const freshId = core.newId;
    const workspaceDefaults = core.defaults;
    const templateList = () => [...core.templates()];
    const fixedViewCount = i.fixedViewCount ?? rawPanels.filter((p) => !p.collapsible && p.marker !== true).length;
    // The cap settles the row before anything reads it, so no committed row holds more live panels than the cap, not even for one frame.
    const keepLiveRef = useRef(new Map());
    const capParkedRef = useRef([]);
    const maxLive = tuning.maxLivePanels ?? null;
    const settleEnv = { phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedColumnCount: fixedViewCount, maxLive, dropTieBreak: timing.dropTieBreak };
    const acted = [...keepLiveRef.current].filter(([, seen]) => seen !== rawPanels).map(([id]) => id);
    const panels = maxLive === null ? rawPanels : settleKeeping(settleEnv, rawPanels, acted);
    if (panels !== rawPanels) {
        const parked = rawPanels.filter((p, k) => p.live && !panels[k].live).map((p) => p.id);
        capParkedRef.current = [...capParkedRef.current.filter((id) => !parked.includes(id)), ...parked];
    }
    useLayoutEffect(() => {
        if (panels !== rawPanels)
            setPanels((current) => settleKeeping(settleEnv, current, acted));
    });
    // Filters over the whole list, never an array position: a panel anchored left of History changes none of these.
    const stopsOnGrid = tuning.rowGesture === 'step';
    const rowInput = { entries: panels, phoneWidth: i.phoneWidth, containerWidth: i.containerWidth, gap: tuning.rowGap, fixedItemCount: fixedViewCount, wholePanels: stopsOnGrid };
    const rowNumbers = computeRowNumbers(rowInput);
    const restedRef = useRef(false);
    const { maxLiveWidth } = rowNumbers;
    const fitCount = rowFitCount({ containerWidth: i.containerWidth, phoneWidth: i.phoneWidth, gap: tuning.rowGap, fixedColumnCount: fixedViewCount, liveWidths: [] });
    const maxFitPanels = fitCount === null ? null : effectiveMaxPanels(fitCount, fixedViewCount);
    // A host-fed phone width that is not a positive finite number leaves the value unset: the function throws on it, and a number the host only reads must not take the row down.
    const minWidth = !(i.phoneWidth > 0) || !Number.isFinite(i.phoneWidth) ? undefined : minWorkspaceWidth({ phoneWidth: i.phoneWidth, fixedColumnCount: fixedViewCount, gap: tuning.rowGap });
    const liveWidths = panels.filter((p) => p.collapsible && p.live).map((p) => panelWidthOf(p, i.phoneWidth, maxLiveWidth, tuning.rowGap));
    const reducedMotion = useReducedMotionConfig() === true;
    const slotsWarnedRef = useRef(new Set());
    // A template that asks for more than its maxSlots warns once; a call to setSlots does the same instead of clamping silently.
    const warnSlotsClamped = (target, asked) => {
        const max = effective(target).maxSlots;
        if (asked <= max)
            return;
        const key = panelKey(target);
        const warned = `${key}\u0000${asked}`;
        if (slotsWarnedRef.current.has(warned))
            return;
        slotsWarnedRef.current.add(warned);
        console.warn(`panel '${key}': setSlots(${asked}) is above its maxSlots (${max}); the panel is made ${max} wide`);
    };
    // The pending request is a plain store. Subscribing makes each set re-render the row, as the old counter did.
    const [pendingScroll] = useState(() => createPanelList(null));
    useSyncExternalStore(pendingScroll.subscribe, pendingScroll.get, pendingScroll.get);
    const scrollNote = (code, panelId, message) => {
        try {
            i.onNote?.({ code, panelId, message });
        }
        catch {
            // A reporter that throws must not break the scroll that raised the note.
        }
    };
    // The container's width as laid out; before layout the host's measurement stands in for it.
    const windowOf = (el) => (el.clientWidth > 0 ? el.clientWidth : i.containerWidth);
    const requestScroll = (request) => {
        const el = i.overflowContainerRef.current;
        if (el === null)
            return false;
        if (rowScrollerFor(el).claimHeld()) {
            // A host's scrollTo during a resize hold is kept: the resize's release settles the row, then the scroll runs. Automatic
            // scrolls stay dropped, as a drag drops them.
            if (request.forced && rowScrollerFor(el).deferUntilRelease(() => pendingScroll.set({ ...request, misses: 0 })))
                return true;
            scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
            return false;
        }
        // A request on a panel that is already shown changes no state, so nothing else would commit for it to run in.
        pendingScroll.set({ ...request, misses: 0 });
        return true;
    };
    const followPanel = (id) => {
        const el = i.overflowContainerRef.current;
        const entry = panels.find((p) => p.id === id);
        const k = rowNumbers.ids.indexOf(id);
        if (el === null || entry === undefined || k < 0 || effective(entry).scrollOnMove !== 'follow')
            return;
        const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k];
        const inView = left < rowScrollerFor(el).scrollLeft() + windowOf(el) - tuning.rowGap && left + rowNumbers.widths[k] > rowScrollerFor(el).scrollLeft() + tuning.rowGap;
        if (inView)
            requestScroll({ id, kind: 'move', align: null, forced: false, fresh: false });
    };
    const requestOpen = (id, over = {}) => requestScroll({ id, kind: 'open', align: null, forced: false, fresh: false, ...over });
    const snapped = (k, raw) => snapToStop(rowNumbers, k, raw);
    /** Where the container would scroll to put panel `id` at `align`, or null when the row is not laid out for it. */
    const scrollTargetOf = (id, align) => {
        const el = i.overflowContainerRef.current;
        const k = rowNumbers.ids.indexOf(id);
        if (el === null || k < 0)
            return null;
        const raw = scrollTargetFor({
            left: tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k],
            width: rowNumbers.widths[k],
            scrollLeft: rowScrollerFor(el).scrollLeft(),
            clientWidth: windowOf(el),
            maxScroll: maxScrollOf(rowNumbers),
            gap: tuning.rowGap,
            align,
        });
        return snapped(k, raw);
    };
    /** Whether a scroll to `align` would move the container: false when it is already there or the row has nothing to scroll. */
    const wouldScroll = (id, align) => {
        const to = scrollTargetOf(id, align);
        const el = i.overflowContainerRef.current;
        return to !== null && el !== null && Math.abs(to - rowScrollerFor(el).scrollLeft()) >= 0.5;
    };
    const { revealPanelProactively, handleActivatePanel, forgetCollapsed, revealMostRecentlyCollapsed, enteringViaAnchorIds, markEnteringViaAnchor, markEnterSide, clearEnterSide, scrollRow, reorderPanel, resizePanel, enterSideById, exitRightIds, swapExitIds, swapPanels, releaseHold, heldIds, holdPanel, wouldEmptyRow, placeAt, landAt, landPanel, resetPanels, gate, touchPanel, } = usePanelManager(panels, setPanels, i.phoneWidth, i.containerWidth, fixedViewCount, rootId, {
        onNote: i.onNote,
        keepLiveRef,
        capParkedRef,
        tuning: { rowGap: tuning.rowGap, returnTieBreak: timing.returnTieBreak, dropTieBreak: timing.dropTieBreak, maxLivePanels: tuning.maxLivePanels },
        ...(core.order !== undefined ? { order: core.order } : {}),
        resolveDefaults: core.resolveDefaults,
    });
    core.observe(panels, heldIds);
    // A shown panel the page asked for, whether it was parked or already live out of view, is scrolled to once it is in.
    const activatePanel = (id) => {
        const known = panels.some((p) => p.id === id);
        handleActivatePanel(id);
        if (known)
            requestOpen(id);
    };
    // Set once the persistence hook is called, below: the rest watch restores the saved state the hook owns.
    const [restWatcher] = useState(() => createRestWatch({ quietMs: REST_QUIET_MS, pointerHeld: () => pointerHeldRef.current, settled: () => settledRef.current }));
    // A pointer down on the row until it is let go, the scrollbar thumb included: a rest is not called while it is held.
    const pointerHeldRef = useRef(false);
    // The last swap: when its enter and exit end, and its direction. A swap back over one in flight reverses half-run
    // animations, and a fast back-and-forth turns into panels growing and shrinking in place, so a reversal waits for the
    // swap before it to land. Swaps the same way stay as fast as the input.
    const lastSwapRef = useRef(null);
    const swapAllowed = (direction) => {
        const now = performance.now();
        const last = lastSwapRef.current;
        if (last !== null && last.direction !== direction && now < last.ends)
            return false;
        lastSwapRef.current = { ends: reducedMotion ? 0 : now + tuning.slide.durationSec * 1000, direction };
        return true;
    };
    // One step of the gesture. A row with nothing to scroll toward swaps: the parked panel beside the live range comes in.
    const stepRow = (direction) => {
        const el = i.overflowContainerRef.current;
        if (el === null)
            return;
        watchRest();
        const scroller = rowScrollerFor(el);
        scroller.noteInput();
        if (scroller.claimHeld())
            return;
        scroller.noteMove();
        const maxScroll = maxScrollOf(rowNumbers);
        if (!rowNumbers.rowScroll || maxScroll <= 0) {
            if (swapAllowed(direction))
                scrollRow(direction);
            return;
        }
        let liveBefore = 0;
        const hidden = [];
        for (const p of panels) {
            if (isPresent(p))
                liveBefore += 1;
            else if (p.marker !== true)
                hidden.push({ id: p.id, liveBefore, held: heldIds.has(p.id), policy: effective(p).revealOnScroll });
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
        });
        if (step.kind === 'show') {
            if (swapAllowed(direction))
                activatePanel(step.id);
        }
        else if (step.kind === 'scroll') {
            stepGlide(scroller, step.to, { mode: tuning.fastScroll, durationSec: tuning.slide.durationSec, ease: tuning.slide.glideEase, instant: reducedMotion, windowWidth: windowOf(el) });
        }
    };
    // The slots the last commit drew, read by the settle below before this commit's are recorded.
    const drawnSlotsRef = useRef('');
    const settledNumbersRef = useRef(undefined);
    const endWidthRef = useRef(undefined);
    // The window, a close or a reorder moves the stops: a row left between two is brought to the nearest one.
    // The glide's own target is the base, so a settle never fights a step in flight. Never while a drag holds the row.
    useLayoutEffect(() => {
        const el = i.overflowContainerRef.current;
        if (el === null || tuning.rowGesture !== 'step' || !Number.isFinite(rowNumbers.windowWidth))
            return;
        const scroller = rowScrollerFor(el);
        // A resize's settle owns the rest while its margin glides; a stop that moved in that wait is settled onto when it ends.
        if (scroller.claimHeld() || scroller.settling())
            return;
        const base = scroller.glideTarget() ?? scroller.scrollLeft();
        const before = settledNumbersRef.current;
        settledNumbersRef.current = rowNumbers;
        // A wider window can bring a parked panel back a commit after the new width, when the row fits for one commit in between.
        const wasAtEnd = before !== undefined && before.windowWidth !== rowNumbers.windowWidth && before.stepStops.length > 1 && Math.abs(base - before.stepStops.at(-1)) < 1;
        if (wasAtEnd)
            endWidthRef.current = rowNumbers.windowWidth;
        else if (endWidthRef.current !== rowNumbers.windowWidth)
            endWidthRef.current = undefined;
        // When the slots slid (a close, an open, a reorder) the settle rides their own curve: on another, a panel that both slides and
        // scrolls lurches back and forth.
        const ease = slotsKey(rowNumbers) === drawnSlotsRef.current ? tuning.slide.glideEase : [...tuning.slide.ease];
        // A row that fits has one rest, 0: a close that brings the whole row into view glides there with the close.
        if (rowNumbers.stepStops.length === 0) {
            if (base >= 0.5)
                scroller.glideTo(0, { durationSec: tuning.slide.durationSec, instant: reducedMotion || (before !== undefined && before.windowWidth !== rowNumbers.windowWidth), ease });
            return;
        }
        // The settle lands on a step stop, so the next step is a whole phone width; the whole-panel stops can sit between grid points.
        // A new window width rescales every stop, so a row resting at an end stays at that end rather than at the nearest pixel.
        const atEnd = endWidthRef.current === rowNumbers.windowWidth;
        endWidthRef.current = undefined;
        const to = atEnd ? rowNumbers.stepStops.at(-1) : nearestStop({ ...rowNumbers, stops: rowNumbers.stepStops }, base);
        // The first stop is not 0 once another stop needs room left of it; opening the row there is not a movement to animate.
        const opening = !restedRef.current;
        restedRef.current = true;
        // A window step lands at once, as the row's margin does: a glide per step would trail the window's edge.
        const windowStep = before !== undefined && before.windowWidth !== rowNumbers.windowWidth;
        if (Math.abs(to - base) < 0.5)
            return;
        scroller.glideTo(to, { durationSec: tuning.slide.durationSec, instant: reducedMotion || opening || windowStep, ease });
    }, [rowNumbers.stepStops.join(','), rowNumbers.stripStart, rowNumbers.endPad]);
    useLayoutEffect(() => {
        drawnSlotsRef.current = slotsKey(rowNumbers);
    });
    // The row's wheel/arrow-key gesture is wired here, not in the host, so a host stays free of effects and refs.
    useRowScrollGesture(i.overflowContainerRef, stepRow, timing.gestureLockMs, tuning.rowGesture, tuning.gestureQuietMs, i.phoneWidth + tuning.rowGap);
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
        restAtPhone: () => shrinkUnfocusedRef.current,
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
    const watchRest = () => {
        const el = i.overflowContainerRef.current;
        if (el !== null)
            restWatcher.watch(el, restAt);
    };
    const restAt = (at) => {
        const n = rowNumbersRef.current;
        const k = nearestStopIndex(n, at);
        if (k < 0)
            return;
        const mark = markOfStop(n, k, stepRef.current);
        setScroll((prev) => (prev !== null && prev.panel === mark.panel && prev.offset === mark.offset ? prev : mark));
    };
    useEffect(() => () => restWatcher.cancel(), [restWatcher]);
    /** `row` with `leaves` parked when the row's live panels no longer fit, so the open's chosen panel goes rather than the cap's pick. */
    const makeRoom = (row, leaves) => {
        const live = row.filter(isParkLive);
        if (rowPricing(settleEnv, row).settles(live) || !live.some((p) => p.id === leaves))
            return row;
        return row.map((p) => (p.id === leaves ? { ...p, live: false } : p));
    };
    const createFromWorkspace = (req) => {
        const template = templateList().find((t) => t.id === req.templateId);
        if (template === undefined)
            return;
        // Built here, outside the updater below: React may run an updater twice and the host's builder is not required to be pure.
        const hostData = i.defaultHostData?.();
        const carried = req.carried;
        const build = (prev) => {
            if (prev.some((p) => panelKey(p) === req.id))
                return prev;
            const made = appendFromTemplate(prev, { template, id: req.engineId, name: req.id, settings: req.settings, params: req.params, url: req.url, hostData, defaults: workspaceDefaults, rootId, order: core.order, declared: req.declared === true, fallbackTitle: labels.panelTitle(req.engineId), rowEnd: carried !== undefined, ...(req.place !== undefined ? { place: req.place } : {}) });
            const roomed = req.leaves === undefined ? made : makeRoom(made, req.leaves);
            const opened = req.openedBy === undefined ? roomed : roomed.map((p) => (p.id === req.engineId ? { ...p, openedBy: req.openedBy } : p));
            if (carried === undefined)
                return opened;
            // The panel keeps its identity, name and size; its place in the old row means nothing here.
            const kept = opened.map((p) => (p.id === req.engineId ? { ...p, ...(carried.uid !== undefined ? { uid: carried.uid } : {}), ...(carried.title !== undefined ? { title: carried.title } : {}), ...(carried.slots !== undefined ? { slots: carried.slots } : {}) } : p));
            return carried.sized ? recordOverride(kept, 'slots', [req.engineId], rootId) : kept;
        };
        revealPanelProactively(panels, build);
        requestOpen(req.engineId, { fresh: true });
    };
    // A template registered after the restore settled: its placeholder entries are rebuilt from it, and the panels code declared for it are created.
    const lateRegister = (t) => {
        setPanels((prev) => {
            let next = prev;
            const rebuilt = prev.map((p) => {
                if (p.view !== t.id || p.key !== undefined || p.marker === true || p.id === rootId)
                    return p;
                const { value } = resolvePanelSettings({ ...(workspaceDefaults !== undefined ? { workspace: workspaceDefaults } : {}), template: t.settings, ...(p.instance !== undefined ? { instance: p.instance } : {}) }, { lenient: true });
                return { ...applyTemplate(p, value, 'reconfigure'), key: value.multiple ? `${t.id}~${p.id}` : t.id };
            });
            if (rebuilt.some((p, k) => p !== prev[k]))
                next = rebuilt;
            for (const d of core.declared()) {
                if (d.templateId !== t.id || next.some((p) => panelKey(p) === d.id))
                    continue;
                const resolved = resolvePanelSettings({ ...(workspaceDefaults !== undefined ? { workspace: workspaceDefaults } : {}), template: t.settings, ...(d.settings !== undefined ? { instance: d.settings } : {}) }, { lenient: true }).value;
                if (isDismissed(d.id) && resolved.closable && resolved.afterClose === 'stay-closed')
                    continue;
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
    // A move of the row picks its own rest; a blur keeps the panel it shrinks in view.
    const restAtPhone = (except, keepInView = except !== null) => {
        if (!tuning.shrinkUnfocused)
            return;
        const grown = new Map(panels.filter((p) => p.id !== except && p.marker !== true && slotsOf(p) > 1).map((p) => [p.id, slotsOf(p)]));
        if (grown.size === 0)
            return;
        for (const id of grown.keys())
            resizePanel(id, 1, false);
        setPanels((prev) => prev.map((p) => (grown.has(p.id) && slotsOf(p) === 1 ? { ...p, savedSlots: grown.get(p.id) } : p)));
        // A wide panel shrinks toward its left edge, which may be past the window's: the row glides with it so it rests in view.
        const el = i.overflowContainerRef.current;
        if (!keepInView || el === null)
            return;
        const shown = [...grown.keys()].find((id) => {
            const k = rowNumbers.ids.indexOf(id);
            if (k < 0)
                return false;
            const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k];
            return left < rowScrollerFor(el).scrollLeft() + windowOf(el) && left + rowNumbers.widths[k] > rowScrollerFor(el).scrollLeft();
        });
        // A frame later: a glide started inside the press is stopped by that same press reaching the row.
        if (shown !== undefined)
            requestAnimationFrame(() => requestScroll({ id: shown, kind: 'move', align: null, forced: false, fresh: false }));
    };
    // Read even with the tuning off, so turning it off never leaves a panel stuck at one phone.
    // A panel back at its width is centered as near as the row allows, a frame later for the same reason as the rest above.
    const restoreWidth = (id) => {
        const width = panels.find((p) => p.id === id)?.savedSlots;
        if (width === undefined)
            return false;
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
    const restAtPhoneRef = useRef(restAtPhone);
    restAtPhoneRef.current = restAtPhone;
    useEffect(() => {
        const el = i.overflowContainerRef.current;
        return el === null ? undefined : rowScrollerFor(el).subscribeMoves(() => restAtPhoneRef.current(null));
    }, [i.overflowContainerRef]);
    const attachOwner = useRef({});
    useLayoutEffect(() => {
        core.attach(attachOwner.current);
        return () => core.detach(attachOwner.current);
        // Mount only: the workspace this hook serves never changes.
    }, []);
    // A declared panel that left the list while its `afterClose` is 'stay-closed' is remembered; one that is back is forgotten. An unmount is not a close: nothing runs on cleanup.
    const lastListRef = useRef(null);
    useLayoutEffect(() => {
        if (!restoreSettled)
            return;
        const before = lastListRef.current;
        lastListRef.current = panels;
        if (before === null || before === panels)
            return;
        const keys = new Set(panels.map(panelKey));
        dismiss(before.filter((p) => p.declared === true && !keys.has(panelKey(p)) && effective(p).afterClose === 'stay-closed').map(panelKey));
        undismiss([...keys]);
    });
    // A wheel or pointer-down on the row before the first scroll means the person already chose where to look.
    const touchedRef = useRef(false);
    useEffect(() => {
        const touch = (e) => {
            const el = i.overflowContainerRef.current;
            if (el !== null && e.target instanceof Node && el.contains(e.target)) {
                touchedRef.current = true;
                if (e.type === 'pointerdown')
                    pointerHeldRef.current = true;
                watchRest();
            }
        };
        const release = () => {
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
        if (initialScrollDoneRef.current || !restoreSettled || el === null || i.containerWidth === 0 || rowNumbers.ids.length === 0)
            return;
        initialScrollDoneRef.current = true;
        const scroller = rowScrollerFor(el);
        if (touchedRef.current || scroller.glideTarget() !== null || rowScrollerFor(el).scrollLeft() !== 0)
            return;
        const where = tuning.initialScroll;
        const maxScroll = maxScrollOf(rowNumbers);
        let to = rowNumbers.stops[0] ?? 0;
        // A saved rest wins over initialScroll: the row was left where the person put it.
        const rested = stopOfMark(rowNumbers, scroll, i.phoneWidth + tuning.rowGap);
        if (rested !== null) {
            to = rested;
        }
        else if (where === 'end') {
            to = maxScroll;
        }
        else if (where !== 'start') {
            const k = rowNumbers.ids.indexOf(where === 'root' ? rootId : engineIdOf(where.panel));
            if (k >= 0) {
                const left = tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k];
                to = snapped(k, scrollTargetFor({ left, width: rowNumbers.widths[k], scrollLeft: 0, clientWidth: windowOf(el), maxScroll, gap: tuning.rowGap, align: 'start' }));
            }
        }
        if (to !== 0)
            scroller.glideTo(to, { durationSec: 0, instant: true, ease: tuning.slide.glideEase });
    });
    // Runs the pending request against this commit's numbers: the target margin is the one about to be drawn.
    useLayoutEffect(() => {
        const request = pendingScroll.get();
        if (request === null)
            return;
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
            }
            else {
                pendingScroll.set(null);
                scrollNote('scroll-request-dropped', request.id, `A scroll to panel ${request.id} was dropped: it was not in the row after ${REQUEST_WAIT_COMMITS} commits.`);
            }
            return;
        }
        pendingScroll.set(null);
        const settings = effective(entry);
        let align = 'into-view';
        if (request.kind === 'open')
            align = request.align ?? (settings.scrollOnOpen !== 'none' ? settings.scrollOnOpen : request.forced ? 'into-view' : null);
        if (align === null)
            return;
        const scroller = rowScrollerFor(el);
        const to = snapped(k, scrollTargetFor({
            left: tuning.rowGap + rowNumbers.stripStart + rowNumbers.leftOffsets[k],
            width: rowNumbers.widths[k],
            scrollLeft: scroller.scrollLeft(),
            clientWidth: windowOf(el),
            maxScroll: maxScrollOf(rowNumbers),
            gap: tuning.rowGap,
            align,
        }));
        if (Math.abs(to - scroller.scrollLeft()) < 0.5)
            return;
        if (!scroller.glideTo(to, { durationSec: tuning.slide.durationSec, instant: reducedMotion, ease: tuning.slide.glideEase })) {
            scrollNote('scroll-dropped-during-drag', request.id, `A scroll to panel ${request.id} was dropped: a drag holds the row.`);
        }
    });
    for (const p of panels)
        keyById.current.set(p.id, panelKey(p));
    // Diffs the one list instead of capturing per call site: usePanelManager parks from several sites with no single
    // "on park" hook, and a per-site call would silently miss any site not touched.
    const prevLiveRef = useRef(new Map());
    const slideMsRef = useRef(0);
    slideMsRef.current = tuning.slide.durationSec * 1000;
    // A newly opened panel is pictured once its opening motion has landed: a picture is rasterized on the main thread, so one
    // taken mid-motion holds back its frames. A slide, or a parked panel coming back, changes nothing a picture shows.
    const openTimers = useRef(new Map());
    useEffect(() => {
        const prev = prevLiveRef.current;
        const timers = openTimers.current;
        for (const p of panels) {
            if (prev.get(p.id) === true && !p.live && asksForPicture('park'))
                capture.capture(panelKey(p));
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
            for (const t of timers.values())
                clearTimeout(t);
            timers.clear();
        };
    }, []);
    // The slots report through window events (see panelChrome.ts); a provider hears only the ids it rendered.
    useEffect(() => {
        const keyOf = (id) => keyById.current.get(id);
        const onRect = (e) => {
            const d = e.detail;
            const key = keyOf(d.id);
            if (key !== undefined)
                onPanelRect.current?.(panelRectEvent(key, d));
        };
        window.addEventListener(PANEL_RECT_EVENT, onRect);
        return () => {
            window.removeEventListener(PANEL_RECT_EVENT, onRect);
        };
    }, []);
    // clearAll only records ids here: React may run its updater during render, where evict would notify other components.
    const clearedIds = useRef(new Set());
    useEffect(() => {
        for (const id of clearedIds.current)
            capture.evict(id);
        clearedIds.current.clear();
    }, [panels, capture]);
    // An undo restores the entry as its layers resolve now, so a template or default that changed while it was closed
    // applies; an entry built without settings has nothing to re-resolve.
    const reapply = (p) => {
        if (p.settings === undefined || p.marker === true)
            return { panel: p, placeAs: FIXED.undoPlacement };
        const value = core.resolved(p);
        const layer = p.declared === true ? undefined : core.layerOf(p);
        return { panel: { ...applyTemplate(p, value, 'reconfigure'), ...(layer !== undefined ? { instance: layer } : {}) }, placeAs: FIXED.undoPlacement };
    };
    // After usePanelManager: undo makes room for a live view through its revealPanelProactively. `onAfterClose`
    // forgets the closed id (it may have been parked), then offers the freed room to the most recently parked panel.
    const closing = usePanelClosing(panels, setPanels, revealPanelProactively, rootId, (id, remaining) => {
        forgetCollapsed(id);
        releaseHold(id);
        revealMostRecentlyCollapsed(remaining);
    }, 
    // A restored LIVE panel can carry a stale gesture-enter-side/exit-right mark from an earlier park of
    // the same id; clear it before marking entering-via-anchor (usePanelManager's own clear-then-mark order).
    (id, side) => {
        clearEnterSide(id);
        if (side === undefined)
            markEnteringViaAnchor(id);
        else
            markEnterSide(id, side);
        requestOpen(id);
    }, 
    // A closed-and-not-restored panel's picture must not outlive its undo window; usePanelClosing.ts alone
    // knows which ids the window's NATURAL elapse (never Undo) just finalized.
    (closed) => {
        for (const p of closed)
            if (FIXED.snapshot !== 'never')
                capture.evict(panelKey(p));
    }, i.onPanelsClosed, i.onPanelsRestored, i.resetHostDataOnRestore, i.onNote, core.order, reapply);
    /** `close` as a person's gesture and the manager's `close` verb both run it: the picture, then the close. True when the close was accepted. */
    const closeNow = (id) => {
        // A close the gate in usePanelClosing.ts will refuse (an unknown id or the root) takes no picture.
        const target = panels.find((p) => p.id === id);
        if (target && id !== rootId && asksForPicture('close'))
            capture.capture(panelKey(target));
        return closing.close(id);
    };
    /** `fn` as a raw mutator: it takes a raw token on `ids`, never refuses, and does nothing on a panel a manager call holds. */
    const raw = (idsOf, kind, fn) => (...a) => {
        const token = gate.takeRaw(idsOf(...a), kind);
        if (token === undefined)
            return;
        fn(...a);
        gate.release(token);
    };
    /** The engine id of the panel a caller names: its key, which is its public id, or a counter id from before the key was the only one. */
    const engineIdOf = (name) => entryNamed(panels, name)?.id ?? name;
    /** A `PanelsAPI` verb that takes a panel's id: it is given the engine id of the panel the caller names. */
    const named = (fn) => (id, ...rest) => fn(engineIdOf(id), ...rest);
    /** The one scroll request a show records, whether the panel was parked or live out of view. */
    const scrollForShow = (engineId) => requestOpen(engineId);
    /** The panel the engine holds under `engineId`, or the refusal for one that is gone. */
    const held = (engineId) => panels.find((p) => p.id === engineId) ?? refused('is-closed', `panel '${engineId}' is closed`);
    const busy = (p) => refused('busy', `panel '${panelKey(p)}' already has an operation in this turn`);
    const isEntry = (found) => 'id' in found;
    /** The manager's verbs on a panel the engine holds, each gated and each refusing before it touches the row. */
    /** A resize to a slot count, after the in-flight gate and the panel's own permissions. */
    const resizeOp = (engineId, next, source) => {
        const target = held(engineId);
        if (!isEntry(target))
            return target;
        if (gate.busy([engineId], 'other'))
            return busy(target);
        if (source === 'person' && !effective(target).resizable)
            return refused('not-resizable', `panel '${panelKey(target)}' cannot be resized`);
        if (source !== 'person')
            warnSlotsClamped(target, next);
        const token = gate.take([engineId], 'other');
        const changed = resizePanel(engineId, next, source === 'person');
        if (changed) {
            i.onPanelResize?.();
            followPanel(engineId);
        }
        gate.release(token);
        return accepted(changed);
    };
    const ops = {
        show: (engineId) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'other'))
                return busy(target);
            if (target.live) {
                // A live panel is shown by scrolling to it, and only when part of it is out of view and its scrollOnOpen scrolls at all.
                if (effective(target).scrollOnOpen === 'none' || !wouldScroll(engineId, 'into-view'))
                    return accepted(false);
                const scrolling = gate.take([engineId], 'other');
                const requested = scrollForShow(engineId);
                gate.release(scrolling);
                return accepted(requested);
            }
            const token = gate.take([engineId], 'other');
            handleActivatePanel(engineId);
            scrollForShow(engineId);
            gate.release(token);
            return accepted(true);
        },
        hide: (engineId) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'hide'))
                return busy(target);
            const settings = effective(target);
            if (!settings.parkable)
                return refused('not-parkable', `panel '${panelKey(target)}' is a fixed column and cannot be parked`);
            if (target.live && FIXED.hideWhenLast === 'refuse' && wouldEmptyRow([engineId]))
                return refused('would-empty-row', `panel '${panelKey(target)}' is the last one the row shows`);
            const token = gate.take([engineId], 'hide');
            const changed = holdPanel(engineId, settings.hideStickiness);
            gate.release(token);
            return accepted(changed);
        },
        release: (engineIds, run) => {
            const targets = [];
            for (const engineId of engineIds) {
                const target = held(engineId);
                if (!isEntry(target))
                    return target;
                targets.push(target);
            }
            const blocked = targets.find((t) => gate.busy([t.id], 'close'));
            if (blocked !== undefined)
                return busy(blocked);
            if (!run)
                return accepted(false);
            // One token for the whole set: a close holds the turn, so a second release in the same turn would answer busy.
            const token = gate.take(engineIds, 'close');
            const without = (row) => engineIds.reduce((rest, engineId) => closePanel(rest, engineId, rootId)?.remaining ?? rest, row);
            const remaining = without(panels);
            setPanels(without);
            for (const target of targets) {
                forgetCollapsed(target.id);
                releaseHold(target.id);
                if (FIXED.snapshot !== 'never')
                    capture.evict(panelKey(target));
            }
            revealMostRecentlyCollapsed(remaining);
            gate.release(token);
            return accepted(true);
        },
        close: (engineId, source) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'close'))
                return busy(target);
            if (engineId === rootId || (source === 'person' && !effective(target).closable))
                return refused('not-closable', `panel '${panelKey(target)}' cannot be closed`);
            const token = gate.take([engineId], 'close');
            const changed = closeNow(engineId);
            gate.release(token);
            return accepted(changed);
        },
        open: (engineId) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            return gate.busy([engineId], 'other') ? busy(target) : accepted(false);
        },
        move: (engineId, by, source) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'other'))
                return busy(target);
            if (source === 'person' && !effective(target).movable)
                return refused('not-movable', `panel '${panelKey(target)}' cannot be moved`);
            const token = gate.take([engineId], 'other');
            const changed = reorderPanel(engineId, by, source === 'person');
            if (changed)
                followPanel(engineId);
            gate.release(token);
            return accepted(changed);
        },
        place: (engineId, value, source) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'other'))
                return busy(target);
            if (engineId === rootId)
                return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
            if (source === 'person' && !effective(target).movable)
                return refused('not-movable', `panel '${panelKey(target)}' cannot be placed`);
            const token = gate.take([engineId], 'other');
            const changed = placeAt(engineId, value, source === 'person');
            if (changed)
                followPanel(engineId);
            gate.release(token);
            return accepted(changed);
        },
        swap: (show, hideIds) => {
            const leaving = [];
            for (const engineId of hideIds) {
                const target = held(engineId);
                if (!isEntry(target))
                    return target;
                if (!effective(target).parkable)
                    return refused('not-parkable', `panel '${panelKey(target)}' is a fixed column and cannot be parked`);
                leaving.push(target);
            }
            const arriving = [];
            for (const { engineId } of show) {
                const target = held(engineId);
                if (!isEntry(target))
                    return target;
                if (engineId === rootId)
                    return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
                arriving.push(target);
            }
            const showIds = show.map((s) => s.engineId);
            if (gate.busy(hideIds, 'hide') || gate.busy(showIds, 'other'))
                return refused('busy', 'a panel already has an operation in this turn');
            if (arriving.every((p) => p.live) && FIXED.hideWhenLast === 'refuse' && wouldEmptyRow(hideIds))
                return refused('would-empty-row', 'the swap would leave no panel in the row');
            // Two tokens: the hides count as leaving for the empty-row rule, the shows do not.
            const hiding = gate.take(hideIds, 'hide');
            const showing = gate.take(showIds, 'other');
            const changed = swapPanels(leaving.map((p) => ({ id: p.id, stickiness: effective(p).hideStickiness })), show.map(({ engineId, place }) => (place === undefined ? { id: engineId } : { id: engineId, place })));
            gate.release(hiding);
            gate.release(showing);
            return accepted(changed);
        },
        land: (engineId, value, source) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'other'))
                return busy(target);
            if (engineId === rootId)
                return refused('root-fixed', `panel '${panelKey(target)}' is the root and cannot be placed`);
            if (source === 'person' && !effective(target).movable)
                return refused('not-movable', `panel '${panelKey(target)}' cannot be placed`);
            const token = gate.take([engineId], 'other');
            const changed = target.live ? placeAt(engineId, value, source === 'person') : landAt(engineId, value, source === 'person');
            if (changed)
                scrollForShow(engineId);
            gate.release(token);
            return accepted(changed);
        },
        setSlots: (engineId, slots, source) => resizeOp(engineId, slots, source),
        scrollTo: (engineId, align) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            const to = align ?? (effective(target).scrollOnOpen === 'none' ? 'into-view' : effective(target).scrollOnOpen);
            return accepted(requestOpen(engineId, { align: align ?? null, forced: true }) && wouldScroll(engineId, to));
        },
        reset: (engineIds, follow) => {
            const named = engineIds.map((id) => held(id)).filter(isEntry);
            if (gate.busy(panels.map((p) => p.id), 'other'))
                return refused('busy', 'a panel already has an operation in this turn');
            const token = gate.take(engineIds, 'other');
            const done = resetPanels(engineIds);
            gate.release(token);
            if (done.changed && follow && engineIds.length === 1)
                followPanel(engineIds[0]);
            const keyOf = (id) => {
                const p = panels.find((q) => q.id === id);
                return p === undefined ? id : panelKey(p);
            };
            return { ...accepted(done.changed), panels: named.map(panelKey), parked: done.parked.map(keyOf), returned: done.returned.map(keyOf) };
        },
        configure: (engineId, plan) => {
            const target = held(engineId);
            if (!isEntry(target))
                return target;
            if (gate.busy([engineId], 'other'))
                return busy(target);
            const status = target.live ? 'live' : heldIds.has(engineId) ? 'hidden' : 'parked';
            const outcome = plan(target, status);
            if (!('next' in outcome))
                return outcome.done;
            const token = gate.take([engineId], 'other');
            reportNotes(i.onNote, [...outcome.done.notes]);
            setPanels((prev) => {
                const now = prev.find((p) => p.id === engineId);
                if (now === target)
                    return applyConfigure(prev, target, outcome.next);
                // Another update in the turn rebuilt the entry: the patch applies to what it left, and a panel it removed stays removed.
                if (now === undefined)
                    return prev;
                const again = plan(now, status);
                return 'next' in again ? applyConfigure(prev, now, again.next) : prev;
            });
            gate.release(token);
            return outcome.done;
        },
        reprice: (change) => {
            const ids = panels.map((p) => p.id);
            if (gate.busy(ids, 'other'))
                return refused('busy', 'a panel already has an operation in this turn');
            const token = gate.take(ids, 'other');
            change();
            gate.release(token);
            return accepted(true);
        },
        inUndoWindow: (engineId) => closing.closedIds().includes(engineId),
        resetClosed: (engineId) => closing.markReset(engineId, (panel) => {
            if (panel.settings === undefined)
                return panel;
            const value = core.resolveDefaults(panel).value;
            const defaults = applyTemplate(panel, value, 'reconfigure');
            return clearOverrides([{ ...defaults, ...(slotsOf(panel) === value.slots ? {} : { slots: value.slots }), applied: { placeOnAdd: value.placeOnAdd } }], [panel.id])[0];
        }),
        reopen: (req) => {
            // The closed views are tokened too: a raw undoClose in this turn restores the very key this call would add.
            const touched = [req.engineId, ...closing.closedIds()];
            if (gate.busy(touched, 'other'))
                return refused('busy', `panel '${req.id}' already has an operation in this turn`);
            const token = gate.take(touched, 'other');
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
    const api = {
        // `listed` excludes History: it must not list itself (a host's history column renders every entry here as a
        // clickable row).
        panelList: panels.filter((p) => p.listed).map(summarisePanel),
        maxFitPanels,
        minWorkspaceWidth: minWidth,
        create: (options) => {
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
            if (template !== undefined && !mayCreate(settings, template.id, panels))
                return;
            if (Object.keys(plan.host).length > 0)
                core.hostAsked(id, plan.host);
            revealPanelProactively(panels, (prev) => {
                if (template !== undefined && !mayCreate(settings, template.id, prev))
                    return prev;
                const next = appendPanel(prev, {
                    hostData,
                    params: template?.params,
                    ...safeOptions,
                    view: viewKey ?? '',
                    ...(template !== undefined ? { permanent: undefined } : {}),
                    title: safeOptions?.title ?? labels.panelTitle(id),
                }, id, rootId);
                // A plain view's key is its id; a template's singleton is named by the template.
                const name = template === undefined ? undefined : settings.multiple ? `${template.id}~${id}` : template.id;
                return finishCreated({ row: next, id, settings, instance: plan.instance, name, callerPlaced: safeOptions?.anchor !== undefined, rootId, ...(core.order !== undefined ? { order: core.order } : {}) });
            });
            reportNotes(i.onNote, conflictNotes(id, plan.resolution.conflicts));
            requestOpen(id, { fresh: true });
        },
        activate: named(raw((id) => [id], 'other', activatePanel)),
        move: named(raw((id, _direction) => [id], 'other', (id, direction) => void reorderPanel(id, direction))),
        setSlots: named(raw((id, _slots) => [id], 'other', (id, slots) => {
            const target = panels.find((p) => p.id === id);
            if (target !== undefined)
                warnSlotsClamped(target, slots);
            if (resizePanel(id, slots)) {
                i.onPanelResize?.();
                followPanel(id);
            }
        })),
        // No keep-live mark and no settle step: settles() reads only the live set's widths and count, never its
        // order, so a reorder cannot unsettle a row, and a DROP later in the handler may park this panel as any other.
        reanchor: named(raw((id, _anchor) => [id], 'other', (id, anchor) => {
            setPanels((prev) => {
                const next = reanchorPanel(prev, id, anchor, rootId);
                return next === prev ? prev : recordOverride(next, 'anchor', next.map((p) => p.id), rootId);
            });
            followPanel(id);
        })),
        close: named(raw((id) => [id], 'close', (id) => void closeNow(id))),
        recentlyClosed: closing.recentlyClosed?.map(summarisePanel) ?? null,
        undoClose: raw(() => closing.closedIds(), 'other', closing.undoClose),
        // Drops every clearable panel: never History, a fixed column or an unclearable one. Its picture goes now, not at an
        // undo window: a dropped panel can never be shown again. The ids come from the updater's own list, because
        // this render's `panels` misses a panel created earlier in the same batch.
        clearAll: () => {
            // A panel it removes answers `busy` to a manager call later in the turn; clearAll itself is never held back.
            const token = gate.takeFree(panels.filter((p) => effective(p).clearable).map((p) => p.id), 'other');
            setPanels((prev) => {
                for (const p of prev)
                    if (effective(p).clearable && FIXED.snapshot !== 'never')
                        clearedIds.current.add(panelKey(p));
                return prev.filter((p) => !effective(p).clearable);
            });
            if (token !== undefined)
                gate.release(token);
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
