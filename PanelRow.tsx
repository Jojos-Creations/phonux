/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { useHost } from './hostApi.js';
import { isPresent, summarisePanel, type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import { anchorTargetOf, resolveEnterDirection, type EnterDirection } from './panelRowOrder.js';
import { PanelHiddenContext, PanelSlotContext, type DragScroll } from './panelSlotContext.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { HEADER_ROW_ATTRIBUTE, headerButtonsOf } from './panelHeaderButtons.js';
import { LIBRARY_TUNING_DEFAULTS, effective, resolvePanelSettings } from './panelSettings.js';
import type { ChromeTuning, ResolvedPanelSettings, ResolvedPanelTuning, WorkspaceTuning } from './panelSettings.js';
import { PanelRowSlot } from './PanelRowSlot.js';
import { ChromeStoreContext, createChromeStore } from './panelChrome.js';
import { RowHeightContext, WorkspaceTuningContext, lookTuningDiffers, resolveWorkspaceTuning, slotTuning, type SlotTuning } from './panelTuning.js';
import { reorderStepsForOffset, type PanelWindow } from './panelWindow.js';
import { maxScrollOf, type RowNumbers } from './rowNumbers.js';
import { panelWidthOf } from './panelTiers.js';
import { fitSlots, slotHeight } from './rowConstants.js';
import { ROW_LAYER_Z } from './rowConstants.js';
import { resolveView } from './viewRegistry.js';
import { bindingOf, viewContextOf, type WorkspaceHandle } from './workspaceCore.js';
import { useViewState } from './viewState.js';

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, 'left' | 'right'> = new Map();
const NO_NEIGHBORS: NeighborWidths = { left: [], right: [] };
const NO_SUBSCRIBE = (): (() => void) => () => {};

/** Whether keyboard focus sits in the header row that panel `panelId`'s declared header buttons mark: where a removed last button leaves it. */
function focusInHeaderRow(panelId: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.activeElement?.closest(`[${HEADER_ROW_ATTRIBUTE}]`)?.getAttribute(HEADER_ROW_ATTRIBUTE) === panelId;
}

/**
 * The side an entry slides in from. 'left' and 'right' are constants that beat every mark. Otherwise an explicit mark
 * from the engine wins, then the anchor formula for an entry that always uses it ('anchor', or the
 * `anchoredEnter` flag) or is entering via an anchor, then the right.
 */
export function enterDirectionOf(from: ResolvedPanelSettings['enterFrom'], anchoredEnter: boolean, mark: EnterDirection | undefined, viaAnchor: boolean, formula: () => EnterDirection): EnterDirection {
  if (from === 'left' || from === 'right') return from;
  return mark ?? (from === 'anchor' || anchoredEnter || viaAnchor ? formula() : 'right');
}

/** The view's summary with `size.width` at the width the row renders it, so a view passing `panel.size` to Panel stays inside its slot. */
function renderedSummary(p: PanelRowEntry, width: number, height: number | undefined, drawnSlots: number | undefined, fitSlots: number | undefined) {
  const summary = summarisePanel(p);
  if (p.slots !== undefined) return { ...summary, drawnSlots, fitSlots, size: summary.size && { ...summary.size, width, height: height ?? summary.size.height } };
  return summary.size && summary.size.width !== width && (p.formFactor ?? 'phone') !== 'phone' ? { ...summary, size: { ...summary.size, width } } : summary;
}

/** What a view mounted outside any row is told: the library defaults, which `resolvePanelSettings` fills in for the derived keys too. */
const OUTSIDE_ROW = resolvePanelSettings().value;
/**
 * True only for an entry whose `draggable` setting is true (a plain web panel by default): an always-shown column
 * (the root, or a `permanent:true` custom column) is never a reorder source. Unprovided resolves to false: a view
 * mounted with no `PanelRow` above it never reorders.
 * @public
 */
export const usePanelReorderEligible = (): boolean => React.useContext(PanelSlotContext)?.draggable ?? false;
/**
 * False for an always-shown column (`collapsible:false`) and for an entry whose `closable` setting is false: the
 * built-in 'web' view must never wrap either in a framework close handle (CreatePanelOptions.permanent's 'own
 * control only' guarantee, and a locked panel's refusal). Unprovided resolves to true: a view mounted directly
 * (as tests do) is an ordinary closable panel.
 * @public
 */
export const usePanelCloseEligible = (): boolean => {
  const slot = React.useContext(PanelSlotContext);
  return slot === undefined ? true : slot.collapsible && slot.closable;
};
/**
 * What this panel's own settings let a person do with it: close, drag, re-anchor and resize it, and which tiers it
 * may take. Outside a row: the library defaults.
 * @public
 */
export const usePanelCapabilities = (): Pick<ResolvedPanelSettings, 'closable' | 'draggable' | 'placeable' | 'resizable' | 'formFactors'> => {
  const slot = React.useContext(PanelSlotContext) ?? OUTSIDE_ROW;
  return { closable: slot.closable, draggable: slot.draggable, placeable: slot.placeable, resizable: slot.resizable, formFactors: slot.formFactors };
};
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export const usePanelNeighborWidths = (): NeighborWidths => React.useContext(PanelSlotContext)?.neighborWidths ?? NO_NEIGHBORS;
const OUTSIDE_ROW_TUNING: SlotTuning = slotTuning(LIBRARY_TUNING_DEFAULTS, undefined);
/**
 * This panel's look tuning: its own dragToClose, slide, hopFraction and edgeScroll, and the workspace's rowGap and chrome.
 * Outside a row: the library defaults.
 * @public
 */
export const usePanelTuning = (): ResolvedPanelTuning & { readonly rowGap: number; readonly chrome: ChromeTuning } => React.useContext(PanelSlotContext)?.tuning ?? OUTSIDE_ROW_TUNING;
/**
 * The hops a horizontal drag of this panel asks for: `steps(offsetX)` is reorderStepsForOffset over this slot's
 * neighbours, the row's gap and this panel's hop fraction. Outside a row there are no neighbours, so it is 0.
 * @public
 */
export const usePanelReorderSteps = (): ((offsetX: number) => number) => {
  const slot = React.useContext(PanelSlotContext);
  return (offsetX) => reorderStepsForOffset(offsetX, slot?.neighborWidths ?? NO_NEIGHBORS, (slot?.tuning ?? OUTSIDE_ROW_TUNING).rowGap, (slot?.tuning ?? OUTSIDE_ROW_TUNING).hopFraction);
};
/**
 * True while this panel is parked and its view is kept mounted but hidden (`keepMounted`): a view may pause its own
 * work then. False while the panel is live, even scrolled out of view, while it slides out, and outside a row.
 * @public
 */
export const usePanelHidden = (): boolean => React.useContext(PanelHiddenContext);
/** Anchored left of the row's root, read from the anchor every render so a drag across the root changes it too. Unprovided: false.
 * @public */
export const usePanelPinned = (): boolean => React.useContext(PanelSlotContext)?.pinned ?? false;

/**
 * The row: every present entry in its own animated slot, in the array's order, each rendered by its registered view.
 * @public
 */
export function PanelRow({
  entries,
  rootId,
  closingIds,
  enteringViaAnchorIds,
  exitRightIds = EMPTY_SET,
  enterSideById = EMPTY_MAP,
  maxLiveWidth = Number.POSITIVE_INFINITY,
  tuning,
  rowNumbers,
  workspace,
}: {
  /** The raw one-list array (PanelRowEntry, not PanelSummary): `view` alone picks the component (resolveView
   * never returns nothing), independent of `layer` (stacking) and `anchoredEnter` (enter direction). */
  entries: readonly PanelRowEntry[];
  /** The row's root entry: an entry with no anchor orients against it, and `usePanelPinned` means left of it. */
  rootId: string;
  /** Ids being closed: each exits DOWN. Kept off PanelsAPI on purpose. */
  closingIds: ReadonlySet<string>;
  /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. Any other entry
   * enters from the right unless its own `anchoredEnter` says otherwise. */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Ids parking with an exit to the RIGHT; every other park exits LEFT. */
  exitRightIds?: ReadonlySet<string>;
  /** An explicit enter side per id, winning over the anchor formula: a scroll gesture knows which side a reveal
   * must enter from, which the boolean anchor formula cannot express. */
  enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
  /** The widest one live panel can be in this row (ProvidedPanels.maxLiveWidth). Omitted: no cap. */
  maxLiveWidth?: number;
  /** The workspace tuning this row renders with. Omitted: the enclosing Workspace's, else the library defaults. A value that differs from the Workspace's warns once in development. */
  tuning?: WorkspaceTuning;
  /** The row's numbers (ProvidedPanels.rowNumbers): every width and rest is read from them, and a park exits relative to its rest when `rowScroll` is true. Omitted: the row computes its own from `maxLiveWidth`. */
  rowNumbers?: RowNumbers;
  /** The workspace this row renders. Given, each template view receives its own handle and the reader of every panel, and the row's tuning is the workspace's unless `tuning` is given. */
  workspace?: WorkspaceHandle;
}): React.ReactElement {
  const { device, panels } = useHost();
  const inherited = React.useContext(WorkspaceTuningContext);
  const given = tuning === undefined ? undefined : resolveWorkspaceTuning(tuning);
  const binding = workspace === undefined ? undefined : bindingOf(workspace);
  const fromWorkspace = React.useSyncExternalStore(binding?.subscribe ?? NO_SUBSCRIBE, () => binding?.tuning, () => binding?.tuning);
  const workspaceTuning = given ?? fromWorkspace ?? inherited ?? LIBRARY_TUNING_DEFAULTS;
  const gap = workspaceTuning.rowGap;
  const disagrees = given !== undefined && inherited !== undefined && lookTuningDiffers(given, inherited);
  const warned = React.useRef(false);
  React.useEffect(() => {
    if (!disagrees || warned.current || typeof process === 'undefined' || process.env.NODE_ENV === 'production') return;
    warned.current = true;
    console.warn('PanelRow: its tuning prop differs from the Workspace tuning above it; the row renders with its own, but the Workspace and the capacity still price the row with theirs.');
  }, [disagrees]);
  const inheritedChrome = React.useContext(ChromeStoreContext);
  const [ownChrome] = React.useState(createChromeStore);
  const chrome = inheritedChrome ?? ownChrome;
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
  const availableHeight = React.useContext(RowHeightContext);
  // The live flags of the previous commit, and per parked entry whether its park released its view state. The latch
  // is read from the entry's setting at the commit that parks it, so changing the setting later reaches the next park only.
  const liveBeforeRef = React.useRef<ReadonlyMap<string, boolean>>(new Map());
  const releasedAtParkRef = React.useRef<ReadonlyMap<string, boolean>>(new Map());
  const parkReleases = (p: PanelRowEntry): boolean => {
    if (!p.collapsible || p.live) return false;
    return liveBeforeRef.current.get(p.id) === true ? effective(p).viewState === 'reset-on-park' : releasedAtParkRef.current.get(p.id) === true;
  };
  // The latch is computed from the previous commit's live flags, so it must be assigned before they are overwritten.
  React.useLayoutEffect(() => {
    releasedAtParkRef.current = new Map(entries.filter((p) => p.collapsible && !p.live).map((p) => [p.id, parkReleases(p)]));
    keptAtParkRef.current = new Map(entries.filter(keepsMounted).map((p) => [p.id, true]));
    liveBeforeRef.current = new Map(entries.map((p) => [p.id, p.live]));
    // A parked entry keeps the rest it slid out from, which is what its slot needs to slide back to.
    const rests = new Map(restRef.current);
    for (const [index, p] of present.entries()) rests.set(p.id, { leftOffset: leftOffsets[index]!, width: widths[index]! });
    restRef.current = rests;
  });
  // Whether a parked entry keeps its view mounted: latched at the commit that parks it, like the view state latch above.
  // Dropping the setting later unmounts it at once; turning it on later reaches the next park only.
  const keptAtParkRef = React.useRef<ReadonlyMap<string, boolean>>(new Map());
  const restRef = React.useRef<ReadonlyMap<string, { leftOffset: number; width: number }>>(new Map());
  const keepsMounted = (p: PanelRowEntry): boolean => {
    if (!p.collapsible || p.live || p.marker === true) return false;
    const settings = effective(p);
    if (!settings.keepMounted || settings.viewState === 'reset-on-park') return false;
    return liveBeforeRef.current.get(p.id) === true || keptAtParkRef.current.get(p.id) === true;
  };
  // Ids never repeat, so a panel in neither list can never be shown again and its view state is released.
  useViewState.useRetainOnly([...entries.filter((p) => !parkReleases(p)), ...(panels.recentlyClosed ?? [])].map((p) => p.id));
  const present = entries.filter(isPresent);
  // A panel this row showed and no longer shows (closed or parked) stops being the active or dragged one.
  const presentBefore = React.useRef<ReadonlySet<string>>(new Set());
  React.useEffect(() => {
    const now = new Set(present.map((p) => p.id));
    for (const id of presentBefore.current) {
      if (now.has(id)) continue;
      if (chrome.active() === id) chrome.setActive(null);
      chrome.setDragging(id, false);
    }
    presentBefore.current = now;
  });
  // Layout, capacity and neighbours are computed over `present` alone: a kept entry occupies a slot but no width.
  const rendered = entries.filter((p) => isPresent(p) || keepsMounted(p));
  // Every present entry's OWN width, in row order. An always-shown column needs no special case: setFormFactor
  // no-ops on a collapsible:false id, so panelWidthOf gives it `phoneWidth`.
  const numberAt = (p: PanelRowEntry): number => (rowNumbers === undefined ? -1 : rowNumbers.ids.indexOf(p.id));
  const widths = present.map((p) => rowNumbers?.widths[numberAt(p)] ?? panelWidthOf(p, phoneWidth, maxLiveWidth, gap));
  // Each slot's rest x: every PRECEDING item's own width plus one gap, so a wider item pushes the rest right.
  const leftOffsets: number[] = [];
  let runningOffset = 0;
  for (const [index, width] of widths.entries()) {
    leftOffsets.push(rowNumbers?.leftOffsets[numberAt(present[index]!)] ?? runningOffset);
    runningOffset += width + gap;
  }
  // A panel is as many slots wide as its width spans; each slot past the first adds `heightPerSlot`, up to the room the row has.
  const slotsOfWidth = (width: number): number => Math.max(1, Math.round((width + gap) / (phoneWidth + gap)));
  const heights = present.map((p, index) => (p.slots === undefined ? phoneHeight : slotHeight(slotsOfWidth(widths[index]!), phoneHeight, workspaceTuning.heightPerSlot, availableHeight)));
  const fitSlotsNow = fitSlots(maxLiveWidth, phoneWidth, gap);
  const rowHeight = Math.max(phoneHeight, ...heights);
  const alignedTop = (height: number): number => (workspaceTuning.rowAlign === 'top' ? 0 : workspaceTuning.rowAlign === 'bottom' ? rowHeight - height : Math.round((rowHeight - height) / 2));
  const rowScroll = rowNumbers?.rowScroll ?? false;
  const reservedWidth = Math.max(0, widths.reduce((sum, width) => sum + width + gap, 0) - gap);
  const maxScroll = rowNumbers === undefined ? 0 : maxScrollOf(rowNumbers);
  const stops = rowNumbers === undefined ? [] : rowNumbers.stops.length > 0 ? rowNumbers.stops : rowNumbers.leftOffsets.map((offset) => rowNumbers.rowMarginLeft + offset);
  const widthById = new Map(present.map((p, index) => [p.id, widths[index]!]));
  // Nearest first on each side, an always-shown column included: movePanel swaps past one like any neighbour. The
  // walk is over every array slot and stops at the first entry that is not crossable, a parked one included,
  // because that is where movePanel refuses the hop.
  const neighborsAt = (entry: PanelRowEntry): { left: Array<{ id: string; width: number }>; right: Array<{ id: string; width: number }> } => {
    const at = entries.indexOf(entry);
    const side = (step: 1 | -1) => {
      const out: Array<{ id: string; width: number }> = [];
      for (let i = at + step; i >= 0 && i < entries.length; i += step) {
        const next = entries[i]!;
        if (!effective(next).crossable) break;
        const width = widthById.get(next.id);
        if (width !== undefined) out.push({ id: next.id, width });
      }
      return out;
    };
    return { left: side(-1), right: side(1) };
  };
  const neighborWidthsAt = (entry: PanelRowEntry): NeighborWidths => {
    const { left, right } = neighborsAt(entry);
    return { left: left.map((n) => n.width), right: right.map((n) => n.width) };
  };
  // Per panel, and searched in `present`: each slot's own `index` below counts in that same array.
  const anchorIndexOf = (p: PanelRowEntry): number => present.findIndex((x) => x.id === anchorTargetOf(p, rootId));
  const viewContext = workspace === undefined ? undefined : viewContextOf(workspace);
  // A horizontal drag's live hop count. Only the slots' drawn positions follow it; the order changes at the drop.
  const [dragging, setDragging] = React.useState<{ id: string; steps: number } | null>(null);
  // A dragged panel that left the row (closed by other means) takes its preview with it.
  const draggedGone = dragging !== null && !present.some((x) => x.id === dragging.id);
  React.useEffect(() => {
    if (draggedGone) setDragging(null);
  }, [draggedGone]);
  const shiftById = new Map<string, number>();
  const draggedEntry = dragging === null ? undefined : present.find((x) => x.id === dragging.id);
  if (dragging !== null && draggedEntry !== undefined && dragging.steps !== 0 && effective(draggedEntry).draggable) {
    // Every panel the drag would cross moves by the dragged panel's own span, away from the side it is dragged toward.
    const span = widthById.get(draggedEntry.id)! + gap;
    const walk = neighborsAt(draggedEntry);
    const forward = dragging.steps > 0;
    for (const crossed of (forward ? walk.right : walk.left).slice(0, Math.abs(dragging.steps))) shiftById.set(crossed.id, forward ? -span : span);
  }
  return (
    <ChromeStoreContext.Provider value={chrome}>
    <PanelViewContextValue.Provider value={viewContext}>
    {/* Always mounted: an exiting entry needs AnimatePresence to animate inside, and `initial={false}` must see
    what is present at app start to skip animating a restored session. `display: none` (not width 0) so an
    empty row consumes no flex `gap` from its siblings. */}
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        height: rowHeight,
        display: present.length > 0 ? 'block' : 'none',
        width: reservedWidth,
      }}
    >
      <AnimatePresence initial={false}>
        {rendered.map((p) => {
          const presentIndex = present.indexOf(p);
          const kept = presentIndex < 0;
          const rest = kept ? restRef.current.get(p.id)! : { leftOffset: leftOffsets[presentIndex]!, width: widths[presentIndex]! };
          const Component = resolveView(p.view);
          const { closable, draggable, placeable, resizable, formFactors, enterFrom, exitTo, closeExit, animated, layer, scrollOnDrag, headerButtons } = effective(p);
          const own = slotTuning(workspaceTuning, binding === undefined ? p.settings?.tuning : binding.panelTuning(p as PanelWindow));
          const handle = viewContext?.handleFor(p.id);
          const report = binding?.reportError ?? console.error;
          const note = binding?.reportNote ?? (() => {});
          // A panel whose last button was just removed while it held focus still gets the slot context for that one commit, so the hook that moves focus runs.
          const headerButtonSlots = headerButtonsOf(headerButtons, handle, report, note) ?? (handle !== undefined && focusInHeaderRow(handle.id) ? { slots: {}, handle, report, note } : undefined);
          const dragScroll: DragScroll | undefined = rowScroll
            ? { mode: scrollOnDrag, zonePx: own.edgeScroll.zonePx, maxPxPerSec: own.edgeScroll.maxPxPerSec, reducedStepMs: own.edgeScroll.reducedStepMs, instant: !animated, maxScroll, stops, settleStops: rowNumbers === undefined ? [] : rowNumbers.stops, settleSec: own.slide.durationSec, settleEase: own.slide.glideEase }
            : undefined;
          return (
            <PanelSlotContext.Provider
              key={p.id}
              value={{
                collapsible: p.collapsible,
                closable,
                draggable,
                placeable,
                resizable,
                formFactors,
                id: p.id,
                animated,
                setDragging: (on) => chrome.setDragging(p.id, on),
                neighborWidths: neighborWidthsAt(p),
                pinned: anchorTargetOf(p, rootId) === rootId && p.anchor?.position === 'left',
                tuning: own,
                dragScroll,
                headerButtonSlots,
                dragHops: (offset) => reorderStepsForOffset(offset, neighborWidthsAt(p), gap, own.hopFraction) !== 0,
                previewReorder: (offset) =>
                  setDragging((now) => {
                    if (offset === null) return now?.id === p.id ? null : now;
                    const steps = reorderStepsForOffset(offset, neighborWidthsAt(p), gap, own.hopFraction);
                    return now?.id === p.id && now.steps === steps ? now : { id: p.id, steps };
                  }),
              }}
            >
              <PanelRowSlot
                leftOffset={rest.leftOffset + (shiftById.get(p.id) ?? 0)}
                width={rest.width}
                phoneHeight={rowHeight}
                top={kept || p.slots === undefined ? undefined : alignedTop(heights[presentIndex]!)}
                height={kept || p.slots === undefined ? undefined : heights[presentIndex]!}
                enterDirection={enterDirectionOf(enterFrom, p.anchoredEnter ?? false, enterSideById.get(p.id), enteringViaAnchorIds.has(p.id), () => resolveEnterDirection(anchorIndexOf(p), presentIndex))}
                exitDirection={closingIds.has(p.id) ? closeExit : exitTo !== 'auto' ? exitTo : exitRightIds.has(p.id) ? 'right' : 'left'}
                zIndex={dragging?.id === p.id ? ROW_LAYER_Z.DRAGGED : layer === 'raised' ? ROW_LAYER_Z.RAISED : ROW_LAYER_Z.BASE}
                animated={animated}
                gap={gap}
                slide={own.slide}
                kept={kept}
                rowScroll={rowScroll}
                previewing={dragging !== null}
                onActivate={() => chrome.setActive(p.id)}
                dragged={dragging?.id === p.id}
              >
                {/* A resolved component -- built-in or third-party -- is written against PanelSummary only,
                    never the internal record. */}
                {/* The ONE place useViewState's ambient panel id is set, so a view's own useViewState(key,
                    initial) call needs no id argument. */}
                <useViewState.Provider value={p.id}>
                  <Component panel={renderedSummary(p, rest.width, kept ? undefined : heights[presentIndex], kept ? undefined : slotsOfWidth(rest.width), kept ? undefined : fitSlotsNow)} />
                </useViewState.Provider>
              </PanelRowSlot>
            </PanelSlotContext.Provider>
          );
        })}
      </AnimatePresence>
    </Box>
    </PanelViewContextValue.Provider>
    </ChromeStoreContext.Provider>
  );
}
