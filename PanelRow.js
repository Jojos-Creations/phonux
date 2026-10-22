import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */
import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { AutoMountContext } from './autoMountContext.js';
import { useHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { LandingContext, usePhoneSize } from './phoneFit.js';
import { isPresent, summarisePanel } from './panelRowEntry.js';
import { pinnedIds } from './panelPin.js';
import { anchorTargetOf, resolveEnterDirection } from './panelRowOrder.js';
import { PanelSlotContext } from './panelSlotContext.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { HEADER_ROW_ATTRIBUTE, headerButtonsOf } from './panelHeaderButtons.js';
import { FIXED, LIBRARY_TUNING_DEFAULTS, effective, panelKey, resolvePanelSettings } from './panelSettings.js';
import { PanelRowSlot } from './PanelRowSlot.js';
import { steerEntry, steerSentinel, steerTab, useTabPress } from './panelRowTabOrder.js';
import { ChromeStoreContext, createChromeStore } from './panelChrome.js';
import { slotTuning } from './panelTuning.js';
import { reorderStepsForOffset } from './panelWindow.js';
import { RowDropContext, dropParts, partShifts, useRowDrop } from './panelRowDrop.js';
import { maxScrollOf } from './rowNumbers.js';
import { panelWidthOf } from './panelTiers.js';
import { fitSlots, slotWidth } from './rowConstants.js';
import { ROW_LAYER_Z } from './rowConstants.js';
import { resolveViewIn } from './templateView.js';
import { bindingOf, viewContextOf } from './workspaceCore.js';
import { useViewState } from './viewState.js';
const EMPTY_SET = new Set();
const EMPTY_MAP = new Map();
const NO_NEIGHBORS = { left: [], right: [] };
/** Whether keyboard focus sits in the header row that panel `panelId`'s declared header buttons mark: where a removed last button leaves it. */
function focusInHeaderRow(panelId) {
    if (typeof document === 'undefined')
        return false;
    return document.activeElement?.closest(`[${HEADER_ROW_ATTRIBUTE}]`)?.getAttribute(HEADER_ROW_ATTRIBUTE) === panelId;
}
/**
 * How an entry enters. The panel's own `enterFrom` (or the `anchoredEnter` flag, read as 'anchor') wins over the
 * workspace's `tuning.defaultEnterFrom` unless it is 'auto'. A side, 'fade' or 'expand' is a constant that beats every mark.
 * Otherwise an explicit mark from the engine wins, then the anchor formula for an entry that always uses it ('anchor')
 * or is entering via an anchor, then the right.
 */
export function enterDirectionOf(from, anchoredEnter, mark, viaAnchor, formula, workspace = 'auto') {
    const own = from === 'auto' && anchoredEnter ? 'anchor' : from;
    const chosen = own === 'auto' ? workspace : own;
    if (chosen !== 'auto' && chosen !== 'anchor')
        return chosen;
    return mark ?? (chosen === 'anchor' || viaAnchor ? formula() : 'right');
}
/**
 * How an entry leaves. The panel's own `exitTo` wins over the workspace's `tuning.defaultExitTo` unless it is 'auto'; when
 * both are 'auto' a close drops down on the close timing and a park leaves by the side the row marked, else the left.
 */
export function exitStyleOf(own, workspace, closing, parkRight) {
    const chosen = own === 'auto' ? workspace : own;
    if (chosen !== 'auto')
        return chosen;
    return closing ? FIXED.closeExit : parkRight ? 'right' : 'left';
}
/** The view's summary with `size` at the width and height the row draws the slot, so a view passing `panel.size` to Panel stays inside its slot. */
function renderedSummary(p, width, height, drawnSlots, fitSlots) {
    const summary = summarisePanel(p);
    return { ...summary, ...(p.slots !== undefined ? { drawnSlots, fitSlots } : {}), size: { width, height } };
}
/** What a view mounted outside any row is told: the library defaults, which `resolvePanelSettings` fills in for the derived keys too. */
const OUTSIDE_ROW = resolvePanelSettings().value;
/**
 * What this panel lets a person do with it by gesture: close it (`closable`), move it (`movable`) and resize it
 * (`resizable`), and the most slots it may take. `closable` is false for an always-shown column even when its
 * setting is true, since the row's close gesture never offers one. These limit only the person's gestures, never the
 * developer's own calls. Outside a row: the library defaults.
 * @public
 */
export const usePanelCapabilities = () => {
    const inRow = React.useContext(PanelSlotContext);
    const slot = inRow ?? OUTSIDE_ROW;
    return { closable: slot.closable && (inRow?.collapsible ?? true), movable: slot.movable, resizable: slot.resizable, maxSlots: slot.maxSlots };
};
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export const usePanelNeighborWidths = () => React.useContext(PanelSlotContext)?.neighborWidths ?? NO_NEIGHBORS;
const OUTSIDE_ROW_TUNING = slotTuning(LIBRARY_TUNING_DEFAULTS);
const OUTSIDE_ROW_VIEW_TUNING = OUTSIDE_ROW_TUNING.view;
/**
 * The workspace's row-wide `rowGap`, `dragToClose`, `slide`, `hopFraction` and `edgeScroll`: every panel reads the same
 * values, since a panel carries no tuning of its own. Outside a row: the library defaults.
 * @public
 */
export const usePanelTuning = () => {
    const tuning = React.useContext(PanelSlotContext)?.tuning;
    return tuning === undefined ? OUTSIDE_ROW_VIEW_TUNING : tuning.view;
};
/**
 * The hops a horizontal drag of this panel asks for: `steps(offsetX)` is reorderStepsForOffset over this slot's
 * neighbours, the row's gap and this panel's hop fraction. Outside a row there are no neighbours, so it is 0.
 * @public
 */
export const usePanelReorderSteps = () => {
    const slot = React.useContext(PanelSlotContext);
    return (offsetX) => reorderStepsForOffset(offsetX, slot?.neighborWidths ?? NO_NEIGHBORS, (slot?.tuning ?? OUTSIDE_ROW_TUNING).rowGap, (slot?.tuning ?? OUTSIDE_ROW_TUNING).hopFraction);
};
/** What `PanelState.pinned` says for the panel (its `pinning` definition against the row), so a drag across the root changes it too. Unprovided: false.
 * @public */
export const usePanelPinned = () => {
    const slot = React.useContext(PanelSlotContext);
    const handle = slot?.handle;
    const fallback = slot?.pinned ?? false;
    return React.useSyncExternalStore(handle === undefined ? NO_SUBSCRIPTION : handle.subscribe, () => (handle === undefined ? fallback : handle.getState().pinned), () => fallback);
};
const NO_SUBSCRIPTION = () => () => { };
/**
 * The row: every present entry in its own animated slot, in the array's order, each rendered by its template's view.
 * @public
 */
export function PanelRow({ entries, rootId, closingIds, enteringViaAnchorIds, exitRightIds = EMPTY_SET, enterSideById = EMPTY_MAP, maxLiveWidth = Number.POSITIVE_INFINITY, rowNumbers, workspace, }) {
    const { panels, labels: givenLabels } = useHost();
    const labels = resolveLabels(givenLabels);
    const phoneSize = usePhoneSize();
    const binding = bindingOf(workspace);
    // The restored panels arrive with the settle, after the row mounted. The row is not ready until the commit after it, and
    // a slot that mounts before then starts at its rest, so restored panels skip their enter and later ones animate.
    const restoreSettled = React.useSyncExternalStore(workspace.panels.subscribe, () => workspace.panels.getSnapshot().status === 'ready', () => false);
    const autoMountOf = React.useContext(AutoMountContext);
    const handMounted = binding.autoMounted && autoMountOf !== workspace;
    React.useEffect(() => {
        if (handMounted)
            binding.warnHandMounted();
    }, [handMounted, binding]);
    const templateOf = (id) => binding.template(id);
    const workspaceTuning = React.useSyncExternalStore(binding.subscribe, () => binding.tuning, () => binding.tuning);
    const gap = workspaceTuning.rowGap;
    const tabPress = useTabPress();
    const inheritedChrome = React.useContext(ChromeStoreContext);
    const [ownChrome] = React.useState(createChromeStore);
    const chrome = inheritedChrome ?? ownChrome;
    const phoneWidth = phoneSize.width;
    const phoneHeight = phoneSize.height;
    // View state is held by the key, the id a recentlyClosed summary carries, so a closed panel's state survives until its undo window ends.
    useViewState.useRetainOnly([...entries.map((p) => panelKey(p)), ...(panels.recentlyClosed ?? []).map((p) => p.id)]);
    const present = entries.filter(isPresent);
    const pinned = pinnedIds(entries, rootId);
    chrome.setKeys(new Map(entries.map((p) => [p.id, panelKey(p)])));
    // A panel this row showed and no longer shows (closed or parked) stops being the active or dragged one.
    const presentBefore = React.useRef(new Set());
    // A panel's DOM position is the order it first appeared in, never its reading order: React moves the nodes a reorder
    // leaves behind, and a moved node restarts what it hosts (a web view reloads). Position on screen comes from leftOffset.
    const birth = React.useRef({ seq: 0, byId: new Map() });
    for (const p of present)
        if (!birth.current.byId.has(p.id))
            birth.current.byId.set(p.id, birth.current.seq++);
    const domOrder = [...present].sort((a, b) => birth.current.byId.get(a.id) - birth.current.byId.get(b.id));
    React.useEffect(() => {
        const now = new Set(present.map((p) => p.id));
        for (const id of presentBefore.current) {
            if (now.has(id))
                continue;
            if (chrome.active() === id)
                chrome.setActive(null);
            chrome.setDragging(id, false);
            // The row never keeps holding for a drag whose panel is gone.
            if (chrome.resizing() === id)
                chrome.setResizing(id, false);
        }
        presentBefore.current = now;
    });
    // Every present entry's OWN width, in row order. An always-shown column needs no special case: setSlots
    // no-ops on a collapsible:false id, so panelWidthOf gives it `phoneWidth`.
    const numberAt = (p) => (rowNumbers === undefined ? -1 : rowNumbers.ids.indexOf(p.id));
    // While a host resizes a panel by hand every other panel keeps the width it was last drawn at, so nothing moves under the grabber.
    const resizingId = React.useSyncExternalStore(chrome.subscribeResizing, chrome.resizing, () => null);
    const heldWidthsRef = React.useRef(null);
    const drawnBeforeRef = React.useRef(new Map());
    if (resizingId === null)
        heldWidthsRef.current = null;
    else if (heldWidthsRef.current === null)
        heldWidthsRef.current = drawnBeforeRef.current;
    const held = heldWidthsRef.current;
    const baseWidths = present.map((p) => (held !== null && p.id !== resizingId ? held.get(p.id) : undefined) ?? rowNumbers?.widths[numberAt(p)] ?? panelWidthOf(p, phoneWidth, maxLiveWidth, gap));
    // The width a host draws the resized panel at, held between one slot and the most that fit. It lives here and in the slot
    // context only: the stops, capacity and the live set read the stored slots, so a drag across the whole range parks nothing.
    const drawnNow = React.useSyncExternalStore(chrome.subscribeDrawn, chrome.drawn, () => null);
    const drawnIndex = drawnNow === null ? -1 : present.findIndex((p) => p.id === drawnNow.id);
    const drawnEntry = drawnIndex < 0 ? undefined : present[drawnIndex];
    const mostSlots = drawnEntry === undefined ? 1 : Math.max(1, Math.min(effective(drawnEntry).maxSlots, fitSlots(maxLiveWidth, phoneWidth, gap)));
    const wanted = drawnNow !== null && drawnEntry !== undefined;
    const drawnPx = !wanted ? undefined : Math.min(slotWidth(mostSlots, phoneWidth, gap), Math.max(phoneWidth, drawnNow.px));
    // How much wider the override draws the panel than its stored slots do (negative when narrower).
    const growth = drawnPx === undefined ? 0 : drawnPx - baseWidths[drawnIndex];
    const tracking = wanted;
    // A slot's moves snap while the row lands its first measured size, as they do while a width is held.
    const landing = React.useContext(LandingContext);
    // Until the row is measured and the restore has settled, a slot's moves take no time, so a reload draws panels where they belong.
    const [ready, setReady] = React.useState(false);
    const measuredNow = rowNumbers === undefined || Number.isFinite(rowNumbers.windowWidth);
    React.useLayoutEffect(() => {
        if (measuredNow && restoreSettled)
            setReady(true);
    }, [measuredNow, restoreSettled]);
    const slotTracking = tracking || landing || !ready;
    const widths = baseWidths.map((width, index) => (index === drawnIndex && drawnPx !== undefined ? drawnPx : width));
    React.useLayoutEffect(() => {
        drawnBeforeRef.current = new Map(present.map((p, index) => [p.id, baseWidths[index]]));
    });
    // Each slot's rest x: every PRECEDING item's own width plus one gap, so a wider item pushes the rest right. Pinned at the end, the
    // whole strip sits `growth` further left, so the panel's right edge and everything after it stay where they were.
    const pinShift = tracking && drawnNow.pin === 'end' ? growth : 0;
    const leftOffsets = [];
    let runningOffset = 0;
    for (const [index, width] of widths.entries()) {
        leftOffsets.push((held === null ? rowNumbers?.leftOffsets[numberAt(present[index])] : undefined) ?? runningOffset - pinShift);
        runningOffset += width + gap;
    }
    // A panel is as many slots wide as its width spans, a half slot rounding up.
    // A stored width is a whole number of slots, so only the override is ever between two.
    const slotsOfWidth = (width) => Math.max(1, Math.round((width + gap) / (phoneWidth + gap)));
    const fitSlotsNow = fitSlots(maxLiveWidth, phoneWidth, gap);
    const rowHeight = phoneHeight;
    const rowScroll = rowNumbers?.rowScroll ?? false;
    // While a width is held the row box is never shorter than it was: the browser would clamp the scroll to a shorter strip and move the row under the pointer.
    const reservedWidth = Math.max(0, widths.reduce((sum, width) => sum + width + gap, 0) - gap - pinShift, tracking ? baseWidths.reduce((sum, width) => sum + width + gap, 0) - gap : 0);
    const maxScroll = rowNumbers === undefined ? 0 : maxScrollOf(rowNumbers);
    const stops = rowNumbers === undefined ? [] : rowNumbers.stops.length > 0 ? rowNumbers.stops : rowNumbers.leftOffsets.map((offset) => rowNumbers.rowMarginLeft + offset);
    const widthById = new Map(present.map((p, index) => [p.id, widths[index]]));
    // Nearest first on each side, an always-shown column included: movePanel swaps past one like any neighbour. The
    // walk is over every array slot and stops at the first entry that is not crossable, a parked one included,
    // because that is where movePanel refuses the hop.
    const neighborsAt = (entry) => {
        const at = entries.indexOf(entry);
        const side = (step) => {
            const out = [];
            for (let i = at + step; i >= 0 && i < entries.length; i += step) {
                const next = entries[i];
                if (!effective(next).crossable)
                    break;
                const width = widthById.get(next.id);
                if (width !== undefined)
                    out.push({ id: next.id, width });
            }
            return out;
        };
        return { left: side(-1), right: side(1) };
    };
    const neighborWidthsAt = (entry) => {
        const { left, right } = neighborsAt(entry);
        return { left: left.map((n) => n.width), right: right.map((n) => n.width) };
    };
    // Per panel, and searched in `present`: each slot's own `index` below counts in that same array.
    const anchorIndexOf = (p) => present.findIndex((x) => x.id === anchorTargetOf(p, rootId));
    const viewContext = viewContextOf(workspace);
    const rowTuning = slotTuning(workspaceTuning);
    // The one hop rule: the header drag and a drag that starts outside the row both count their hops through it.
    const stepsFor = (entry, offset) => reorderStepsForOffset(offset, neighborWidthsAt(entry), gap, rowTuning.hopFraction);
    const dragScroll = rowScroll
        ? { mode: FIXED.scrollOnDrag, zonePx: rowTuning.edgeScroll.zonePx, maxPxPerSec: rowTuning.edgeScroll.maxPxPerSec, reducedStepMs: rowTuning.edgeScroll.reducedStepMs, maxScroll, stops, settleStops: rowNumbers === undefined ? [] : rowNumbers.stops, settleSec: rowTuning.slide.durationSec, settleEase: rowTuning.slide.glideEase }
        : undefined;
    // A horizontal drag's live hop count. Only the slots' drawn positions follow it; the order changes at the drop.
    const [dragging, setDragging] = React.useState(null);
    // A dragged panel that left the row (closed by other means) takes its preview with it.
    const draggedGone = dragging !== null && !present.some((x) => x.id === dragging.id);
    React.useEffect(() => {
        if (draggedGone)
            setDragging(null);
    }, [draggedGone]);
    const leftById = new Map(present.map((p, index) => [p.id, leftOffsets[index]]));
    const widthFor = (entry) => widthById.get(entry.id) ?? panelWidthOf(entry, phoneWidth, maxLiveWidth, gap);
    const boxRef = React.useRef(null);
    const dropRowOf = (entry) => ({ entries, rowGap: gap, widthById, leftById, width: widthFor(entry), walk: neighborsAt(entry) });
    const { preview: drop, controller: rowDrop } = useRowDrop({
        workspace,
        rootId,
        entries,
        chrome,
        boxRef,
        walkOf: neighborsAt,
        stepsFor,
        dragScroll,
        centreOf: (entry, hidden) => (hidden ? (dropParts({ id: entry.id, steps: 0, hidden: true }, dropRowOf(entry)).gap?.left ?? 0) + widthFor(entry) / 2 : (leftById.get(entry.id) ?? 0) + widthFor(entry) / 2),
    });
    const shiftById = new Map();
    const draggedEntry = dragging === null ? undefined : present.find((x) => x.id === dragging.id);
    if (dragging !== null && draggedEntry !== undefined && dragging.steps !== 0 && effective(draggedEntry).movable) {
        for (const [id, by] of partShifts(neighborsAt(draggedEntry), dragging.steps, widthById.get(draggedEntry.id) + gap))
            shiftById.set(id, by);
    }
    const dropEntry = drop === null ? undefined : entries.find((x) => x.id === drop.id);
    const dropPartsNow = drop === null || dropEntry === undefined ? undefined : dropParts(drop, dropRowOf(dropEntry));
    if (dropPartsNow !== undefined)
        for (const [id, by] of dropPartsNow.shifts)
            shiftById.set(id, by);
    const gapSpan = dropPartsNow?.gap == null ? 0 : dropPartsNow.gap.width + gap;
    return (_jsx(ChromeStoreContext.Provider, { value: chrome, children: _jsx(PanelViewContextValue.Provider, { value: viewContext, children: _jsx(RowDropContext.Provider, { value: rowDrop, children: _jsxs(Box, { ref: boxRef, onKeyDown: (event) => steerTab(event, event.currentTarget, present.map((p) => p.id)), onFocus: (event) => {
                        const ids = present.map((p) => p.id);
                        steerSentinel(event, event.currentTarget, ids);
                        steerEntry(event, event.currentTarget, ids, tabPress.current);
                    }, sx: {
                        position: 'relative',
                        flexShrink: 0,
                        height: rowHeight,
                        display: present.length > 0 ? 'block' : 'none',
                        width: reservedWidth + gapSpan,
                    }, children: [dropPartsNow?.gap == null ? null : _jsx(Box, { "aria-hidden": true, "data-panel-row-drop-gap": "", sx: { position: 'absolute', top: 0, left: dropPartsNow.gap.left, width: dropPartsNow.gap.width, height: rowHeight, pointerEvents: 'none' } }), _jsx(AnimatePresence, { initial: false, children: domOrder.map((p) => {
                                const presentIndex = present.indexOf(p);
                                const rest = { leftOffset: leftOffsets[presentIndex], width: widths[presentIndex] };
                                const Component = resolveViewIn(templateOf, p.view);
                                const { closable, movable, resizable, maxSlots, enterFrom, exitTo, layer, headerButtons } = effective(p);
                                const own = rowTuning;
                                const handle = viewContext.handleFor(panelKey(p));
                                const report = binding.reportError;
                                const note = binding.reportNote;
                                // A panel whose last button was just removed while it held focus still gets the slot context for that one commit, so the hook that moves focus runs.
                                const headerButtonSlots = headerButtonsOf(headerButtons, handle, report, note) ?? (handle !== undefined && focusInHeaderRow(handle.id) ? { slots: {}, handle, report, note } : undefined);
                                return (_jsx(PanelSlotContext.Provider, { value: {
                                        collapsible: p.collapsible,
                                        closable,
                                        movable,
                                        resizable,
                                        maxSlots,
                                        id: p.id,
                                        tracking: slotTracking,
                                        setDragging: (on) => chrome.setDragging(p.id, on),
                                        neighborWidths: neighborWidthsAt(p),
                                        drawn: { width: rest.width, height: phoneHeight },
                                        handle,
                                        pinned: pinned.has(p.id),
                                        tuning: own,
                                        dragScroll,
                                        headerButtonSlots,
                                        dragHops: (offset) => stepsFor(p, offset) !== 0,
                                        previewReorder: (offset) => setDragging((now) => {
                                            if (offset === null)
                                                return now?.id === p.id ? null : now;
                                            const steps = stepsFor(p, offset);
                                            return now?.id === p.id && now.steps === steps ? now : { id: p.id, steps };
                                        }),
                                    }, children: _jsx(PanelRowSlot, { panelId: p.id, label: labels.panelPosition(p.title || labels.untitledPanel, presentIndex + 1, present.length), leftOffset: rest.leftOffset + (shiftById.get(p.id) ?? 0), width: rest.width, phoneHeight: rowHeight, height: p.slots === undefined ? undefined : phoneHeight, enterDirection: enterDirectionOf(enterFrom, p.anchoredEnter ?? false, enterSideById.get(p.id), enteringViaAnchorIds.has(p.id), () => resolveEnterDirection(anchorIndexOf(p), presentIndex), workspaceTuning.defaultEnterFrom), exitDirection: exitStyleOf(exitTo, workspaceTuning.defaultExitTo, closingIds.has(p.id), exitRightIds.has(p.id)), zIndex: dragging?.id === p.id || drop?.id === p.id ? ROW_LAYER_Z.DRAGGED : layer === 'raised' ? ROW_LAYER_Z.RAISED : ROW_LAYER_Z.BASE, tracking: slotTracking, gap: gap, slide: own.slide, rowScroll: rowScroll, previewing: dragging !== null || drop !== null, onActivate: () => {
                                            chrome.setActive(p.id);
                                            binding.touch(p.id);
                                        }, dragged: dragging?.id === p.id, children: _jsx(useViewState.Provider, { value: panelKey(p), children: _jsx(Component, { panel: renderedSummary(p, rest.width, phoneHeight, slotsOfWidth(rest.width), fitSlotsNow) }) }) }) }, p.id));
                            }) })] }) }) }) }));
}
