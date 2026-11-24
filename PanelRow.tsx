/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */

import * as React from 'react';
import { AnimatePresence, useReducedMotion, useReducedMotionConfig } from 'motion/react';
import Box from '@mui/material/Box';
import { AutoMountContext } from './autoMountContext.js';
import { useHost } from './hostApi.js';
import { resolveLabels } from './labels.js';
import { LandingContext, usePhoneSize } from './phoneFit.js';
import { isPresent, summarisePanel, type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import { anchorTargetOf, resolveEnterDirection, type EnterDirection } from './panelRowOrder.js';
import { HandoffContext, PanelSlotContext, type DragScroll } from './panelSlotContext.js';
import type { PanelTemplate } from './panelTemplate.js';
import { PanelViewContextValue } from './panelViewContext.js';
import { HEADER_ROW_ATTRIBUTE, headerButtonsOf } from './panelHeaderButtons.js';
import { FIXED, LIBRARY_TUNING_DEFAULTS, effective, panelKey, resolvePanelSettings } from './panelSettings.js';
import type { EnterFrom, ExitTo, ResolvedPanelSettings, ResolvedWorkspaceTuning } from './panelSettings.js';
import { PanelRowSlot, SizeBox, type SlotEntrance, type SlotExit } from './PanelRowSlot.js';
import { steerEntry, steerSentinel, steerTab, useTabPress } from './panelRowTabOrder.js';
import { ChromeStoreContext, createChromeStore } from './panelChrome.js';
import { slotTuning, type SlotTuning } from './panelTuning.js';
import { reorderStepsForOffset } from './panelWindow.js';
import { RowDropContext, dropParts, partShifts, useRowDrop, type Neighbor, type Walk } from './panelRowDrop.js';
import { maxScrollOf, type RowNumbers } from './rowNumbers.js';
import { panelWidthOf } from './panelTiers.js';
import { fitSlots, slotWidth } from './rowConstants.js';
import { GLIDE_EASE, ROW_LAYER_Z } from './rowConstants.js';
import { SlotRanksContext, useSlotRanks } from './rowSlotZ.js';
import { useRowDraw } from './rowDraw.js';
import { AwayContext } from './panelAway.js';
import { restTranslate } from './slotMover.js';
import { sharedStartTime, taskToken } from './rowClock.js';
import { recentreRow, rowClip, type RowPlace } from './rowRecentre.js';
import type { SlideTuning } from './panelSettings.js';
import { resolveViewIn } from './templateView.js';
import { bindingOf, viewContextOf, type WorkspaceHandle } from './workspaceCore.js';
import { useViewState } from './viewState.js';
import { EMBLA_SLOT_ATTRIBUTE, EMBLA_UNLOADED_ATTRIBUTE, EMBLA_WINDOW_ATTRIBUTE, RowNearContext, emblaAheadOf, emblaDrawnOf, emblaRests, nearestStop, revealScroll, emblaMoveOf, emblaPlaceOf, emblaOf, emblaScrollOf, emblaTargetOf, emblaWindowOf, keptScroll, kickEmblaAway, loadedNear, moveEmbla, sameLayout, publishEmblaStrip, setEmblaFastScroll, setEmblaReduced, slotMarkerLefts, subscribeEmblaRows, useEmblaRow, type StripLayout } from './emblaRow.js';

const EMPTY_SET: ReadonlySet<string> = new Set();
// A host may apply a person's move a task or two after the drop or key that asked for it; a note older than this was refused.
const REORDER_NOTE_MS = 1000;
const EMPTY_MAP: ReadonlyMap<string, 'left' | 'right'> = new Map();
const NO_NEIGHBORS: NeighborWidths = { left: [], right: [] };

/** Whether keyboard focus sits in the header row that panel `panelId`'s declared header buttons mark: where a removed last button leaves it. */
function focusInHeaderRow(panelId: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.activeElement?.closest(`[${HEADER_ROW_ATTRIBUTE}]`)?.getAttribute(HEADER_ROW_ATTRIBUTE) === panelId;
}

/**
 * How an entry enters. The panel's own `enterFrom` (or the `anchoredEnter` flag, read as 'anchor') wins over the
 * workspace's `tuning.defaultEnterFrom` unless it is 'auto'. A side or 'fade' is a constant that beats every mark; 'expand'
 * grows out of the edge on the side a reveal comes in from (its mark, else the anchor formula) and from its center otherwise.
 * Otherwise an explicit mark from the engine wins, then the anchor formula for an entry that always uses it ('anchor')
 * or is entering via an anchor, then the right.
 */
export function enterDirectionOf(from: EnterFrom, anchoredEnter: boolean, mark: EnterDirection | undefined, viaAnchor: boolean, formula: () => EnterDirection, workspace: EnterFrom = 'auto'): SlotEntrance {
  const own = from === 'auto' && anchoredEnter ? 'anchor' : from;
  const chosen = own === 'auto' ? workspace : own;
  if (chosen === 'expand') {
    const side = mark ?? (viaAnchor ? formula() : undefined);
    return side === undefined ? 'expand' : side === 'left' ? 'expand-left' : 'expand-right';
  }
  if (chosen !== 'auto' && chosen !== 'anchor') return chosen;
  return mark ?? (chosen === 'anchor' || viaAnchor ? formula() : 'right');
}

/**
 * How an entry leaves. The panel's own `exitTo` wins over the workspace's `tuning.defaultExitTo` unless it is 'auto'; when
 * both are 'auto' a close drops down on the close timing and a park leaves by the side the row marked, else the left. A
 * 'shrink' park shrinks toward that same side; a 'shrink' close shrinks into its center.
 */
export function exitStyleOf(own: ExitTo, workspace: ExitTo, closing: boolean, parkRight: boolean): SlotExit {
  const chosen = own === 'auto' ? workspace : own;
  if (chosen === 'shrink' && !closing) return parkRight ? 'shrink-right' : 'shrink-left';
  if (chosen !== 'auto') return chosen;
  return closing ? FIXED.closeExit : parkRight ? 'right' : 'left';
}

/** The view's summary with `size` at the width and height the row draws the slot, so a view passing `panel.size` to Panel stays inside its slot. */
function renderedSummary(p: PanelRowEntry, width: number, height: number, drawnSlots: number | undefined, fitSlots: number | undefined) {
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
export const usePanelCapabilities = (): Pick<ResolvedPanelSettings, 'closable' | 'movable' | 'resizable' | 'maxSlots'> => {
  const inRow = React.useContext(PanelSlotContext);
  const slot = inRow ?? OUTSIDE_ROW;
  return { closable: slot.closable && (inRow?.collapsible ?? true), movable: slot.movable, resizable: slot.resizable, maxSlots: slot.maxSlots };
};
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export const usePanelNeighborWidths = (): NeighborWidths => React.useContext(PanelSlotContext)?.neighborWidths ?? NO_NEIGHBORS;
const OUTSIDE_ROW_TUNING: SlotTuning = slotTuning(LIBRARY_TUNING_DEFAULTS);
type PanelRowTuning = Pick<ResolvedWorkspaceTuning, 'rowGap' | 'dragToClose' | 'slide' | 'hopFraction' | 'edgeScroll'>;
const OUTSIDE_ROW_VIEW_TUNING: PanelRowTuning = OUTSIDE_ROW_TUNING.view;
/**
 * The workspace's row-wide `rowGap`, `dragToClose`, `slide`, `hopFraction` and `edgeScroll`: every panel reads the same
 * values, since a panel carries no tuning of its own. Outside a row: the library defaults.
 * @public
 */
export const usePanelTuning = (): Pick<ResolvedWorkspaceTuning, 'rowGap' | 'dragToClose' | 'slide' | 'hopFraction' | 'edgeScroll'> => {
  const tuning = React.useContext(PanelSlotContext)?.tuning;
  return tuning === undefined ? OUTSIDE_ROW_VIEW_TUNING : tuning.view;
};
/**
 * The hops a horizontal drag of this panel asks for: `steps(offsetX)` is reorderStepsForOffset over this slot's
 * neighbors, the row's gap and this panel's hop fraction. Outside a row there are no neighbors, so it is 0.
 * @public
 */
export const usePanelReorderSteps = (): ((offsetX: number) => number) => {
  const slot = React.useContext(PanelSlotContext);
  return (offsetX) => reorderStepsForOffset(offsetX, slot?.neighborWidths ?? NO_NEIGHBORS, (slot?.tuning ?? OUTSIDE_ROW_TUNING).rowGap, (slot?.tuning ?? OUTSIDE_ROW_TUNING).hopFraction);
};

/**
 * After a jump of an Embla row from `from` to `to` (scroll px) across a change of its strip from `before` to `after`, keeps what the
 * change did not move where it was on screen: a slot leaving in this commit runs its exit from where it was drawn, in view or out of it.
 * On a width change the view could not keep still (`glides`), a slot the change moved on screen glides there from where it was,
 * starting or ending one slot outside the window at most, on the slide's curve and the commit's shared start, the clock a size box
 * eases on, so a page and its neighbors stay one gap apart in every frame.
 */
function arriveAndLeave(box: HTMLElement, before: StripLayout, after: StripLayout, from: number, to: number, windowWidth: number, gap: number, glides: boolean, slide: SlideTuning, reduced: boolean): void {
  const nodeOf = (id: string): HTMLElement | null => box.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
  // Under Reduce Motion every slot lands where it goes at once; a leaving one still runs its exit from where it was drawn.
  const durationMs = reduced ? 0 : slide.durationSec * 1000;
  const glide = (node: HTMLElement | null, frames: Keyframe[]): void => {
    if (node === null || typeof node.animate !== 'function' || durationMs <= 0) return;
    const anim = node.animate(frames, { duration: durationMs, easing: `cubic-bezier(${slide.ease.join(',')})`, composite: 'add', fill: 'backwards' });
    anim.startTime = sharedStartTime();
  };
  const jump = to - from;
  before.ids.forEach((id, k) => {
    const j = after.ids.indexOf(id);
    const w = before.widths[k]!;
    const was = before.lefts[k]! - from;
    if (j < 0) {
      const node = nodeOf(id);
      if (Math.abs(jump) > 0.5 && node !== null && typeof node.animate === 'function') node.animate([{ translate: `${jump}px 0px` }, { translate: `${jump}px 0px` }], { duration: 10000, fill: 'forwards', composite: 'add' });
      return;
    }
    if (!glides) return;
    const now = after.lefts[j]! - to;
    if (Math.abs(now - was) <= 0.5) return;
    const shownBefore = was + w > 0.5 && was < windowWidth - 0.5;
    const shownAfter = now + after.widths[j]! > 0.5 && now < windowWidth - 0.5;
    if (!shownBefore && !shownAfter) return;
    const outside = (x: number, width: number): number => (x + width <= 0.5 ? -(width + gap) : x >= windowWidth - 0.5 ? windowWidth + gap : x);
    glide(nodeOf(id), [{ translate: `${outside(was, w) - now}px 0px` }, { translate: `${outside(now, after.widths[j]!) - now}px 0px` }]);
  });
}

/** The longest the row stays hidden waiting for the restore to settle, ms. @internal */
export const RESTORE_HIDE_MS = 1000;

/**
 * The row: every present entry in its own animated slot, in the array's order, each rendered by its template's view.
 * @public
 */
export function PanelRow({
  entries,
  rootId,
  closingIds,
  enteringViaAnchorIds,
  exitRightIds = EMPTY_SET,
  swapExitIds = EMPTY_SET,
  enterSideById = EMPTY_MAP,
  maxLiveWidth = Number.POSITIVE_INFINITY,
  rowNumbers,
  workspace,
}: {
  /** The raw one-list array (PanelRowEntry, not PanelSummary): `view` alone picks the component (an unknown key renders a
   * placeholder, never nothing), independent of `layer` (stacking) and `anchoredEnter` (enter direction). */
  entries: readonly PanelRowEntry[];
  /** The row's root entry: an entry with no anchor orients against it. */
  rootId: string;
  /** Ids being closed: each exits DOWN while its `exitTo` resolves to 'auto'. Kept off PanelsAPI on purpose. */
  closingIds: ReadonlySet<string>;
  /** Ids (re)joining `live` by a reveal or an undo: each enters from its anchor's side. Any other entry
   * enters from the right unless its own `anchoredEnter` says otherwise. */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Ids parking with an exit to the RIGHT; every other park exits LEFT. Read only while the panel's `exitTo` resolves to 'auto'. */
  exitRightIds?: ReadonlySet<string>;
  /** Ids a swap parks: each leaves as a close does, toward no side. */
  swapExitIds?: ReadonlySet<string>;
  /** An explicit enter side per id, winning over the anchor formula: a scroll gesture knows which side a reveal
   * must enter from, which the boolean anchor formula cannot express. */
  enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
  /** The widest one live panel can be in this row (ProvidedPanels.maxLiveWidth). Omitted: no cap. */
  maxLiveWidth?: number;
  /** The row's numbers (ProvidedPanels.rowNumbers): every width and rest is read from them, and a park exits relative to its rest when `rowScroll` is true. Omitted: the row computes its own from `maxLiveWidth`. */
  rowNumbers?: RowNumbers;
  /** The workspace this row renders: each template view receives its own handle and the reader of every panel, and the row's tuning is the workspace's. */
  workspace: WorkspaceHandle;
}): React.ReactElement {
  const { panels, labels: givenLabels } = useHost();
  const labels = resolveLabels(givenLabels);
  const phoneSize = usePhoneSize();
  const binding = bindingOf(workspace);
  // The restored panels arrive with the settle, after the row mounted. The row is not ready until the commit after it, and
  // a slot that mounts before then starts at its rest, so restored panels skip their enter and later ones animate.
  const restoreSettled = React.useSyncExternalStore(workspace.panels.subscribe, () => workspace.panels.getSnapshot().status === 'ready', () => false);
  // A static render has no restore to wait for, so it draws the row shown.
  const restoring = React.useSyncExternalStore(workspace.panels.subscribe, () => workspace.panels.getSnapshot().status === 'loading', () => false);
  // A restore that never settles must not leave the row blank: past this wait the row shows what it has, in place.
  const [restoreWaitedOut, setRestoreWaitedOut] = React.useState(false);
  React.useEffect(() => {
    if (!restoring || restoreWaitedOut) return undefined;
    const timer = setTimeout(() => setRestoreWaitedOut(true), RESTORE_HIDE_MS);
    return () => clearTimeout(timer);
  }, [restoring, restoreWaitedOut]);
  const autoMountOf = React.useContext(AutoMountContext);
  const handMounted = binding.autoMounted && autoMountOf !== workspace;
  React.useEffect(() => {
    if (handMounted) binding.warnHandMounted();
  }, [handMounted, binding]);
  const templateOf = (id: string): PanelTemplate | undefined => binding.template(id);
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
  // The strip's widths and rests are the present entries that are not sticky. A sticky one is drawn in its edge's group beside the strip,
  // so a panel that turns sticky or stops being sticky draws again in the other place and its view state is read back by its key.
  const presentAll = entries.filter(isPresent);
  const heldById = new Map((rowNumbers?.held ?? []).map((h) => [h.id, h] as const));
  const present = presentAll.filter((p) => !heldById.has(p.id));
  const startGroupIds = (rowNumbers?.held ?? []).filter((h) => h.side === 'left').map((h) => h.id);
  const endGroupIds = (rowNumbers?.held ?? []).filter((h) => h.side === 'right').map((h) => h.id);
  // The panels that changed between the strip and a group in this commit: the one that leaves and the one that arrives swap at once.
  const placeOf = new Map<string, 'strip' | 'left' | 'right'>(presentAll.map((p) => [p.id, heldById.get(p.id)?.side ?? 'strip']));
  const placedBefore = React.useRef<ReadonlyMap<string, 'strip' | 'left' | 'right'>>(placeOf);
  const swapped = presentAll.filter((p) => placedBefore.current.has(p.id) && placedBefore.current.get(p.id) !== placeOf.get(p.id)).map((p) => p.id);
  const handoff: ReadonlySet<string> = swapped.length === 0 ? EMPTY_SET : new Set(swapped);
  React.useLayoutEffect(() => {
    placedBefore.current = placeOf;
  });
  chrome.setKeys(new Map(entries.map((p) => [p.id, panelKey(p)])));
  // A panel this row showed and no longer shows (closed or parked) stops being the active or dragged one.
  const presentBefore = React.useRef<ReadonlySet<string>>(new Set());
  // A panel's DOM position is the order it first appeared in, never its reading order: React moves the nodes a reorder
  // leaves behind, and a moved node restarts what it hosts (a web view reloads). Position on screen comes from leftOffset.
  const birth = React.useRef({ seq: 0, byId: new Map<string, number>() });
  for (const p of presentAll) if (!birth.current.byId.has(p.id)) birth.current.byId.set(p.id, birth.current.seq++);
  const domOrder = [...presentAll].sort((a, b) => birth.current.byId.get(a.id)! - birth.current.byId.get(b.id)!);
  const slotRanks = useSlotRanks(presentAll.map((p) => p.id));
  React.useEffect(() => {
    const now = new Set(presentAll.map((p) => p.id));
    for (const id of presentBefore.current) {
      if (now.has(id)) continue;
      if (chrome.active() === id) chrome.setActive(null);
      chrome.setDragging(id, false);
      // The row never keeps holding for a drag whose panel is gone.
      if (chrome.resizing() === id) chrome.setResizing(id, false);
    }
    presentBefore.current = now;
  });
  // Every present entry's OWN width, in row order. An always-shown column needs no special case: setSlots
  // no-ops on a collapsible:false id, so panelWidthOf gives it `phoneWidth`.
  const numberAt = (p: PanelRowEntry): number => (rowNumbers === undefined ? -1 : rowNumbers.ids.indexOf(p.id));
  // While a host resizes a panel by hand every other panel keeps the width it was last drawn at, so nothing moves under the grabber.
  const resizingId = React.useSyncExternalStore(chrome.subscribeResizing, chrome.resizing, () => null);
  const heldWidthsRef = React.useRef<ReadonlyMap<string, number> | null>(null);
  const drawnBeforeRef = React.useRef<ReadonlyMap<string, number>>(new Map());
  if (resizingId === null) heldWidthsRef.current = null;
  else if (heldWidthsRef.current === null) heldWidthsRef.current = drawnBeforeRef.current;
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
  const growth = drawnPx === undefined ? 0 : drawnPx - baseWidths[drawnIndex]!;
  const tracking = wanted;
  // A slot's moves snap while the row lands its first measured size, as they do while a width is held.
  const landing = React.useContext(LandingContext);
  // Until the row is measured and the restore has settled, a slot's moves take no time, so a reload draws panels where they belong.
  const [ready, setReady] = React.useState(false);
  const measuredNow = rowNumbers === undefined || Number.isFinite(rowNumbers.windowWidth);
  React.useLayoutEffect(() => {
    if (measuredNow && restoreSettled) setReady(true);
  }, [measuredNow, restoreSettled]);
  const slotTracking = tracking || landing || !ready;
  const widths = baseWidths.map((width, index) => (index === drawnIndex && drawnPx !== undefined ? drawnPx : width));
  React.useLayoutEffect(() => {
    drawnBeforeRef.current = new Map(present.map((p, index) => [p.id, baseWidths[index]!]));
  });
  // Each slot's rest x: every PRECEDING item's own width plus one gap, so a wider item pushes the rest right. Pinned at the end, the
  // whole strip sits `growth` further left, so the panel's right edge and everything after it stay where they were.
  const pinShift = tracking && drawnNow!.pin === 'end' ? growth : 0;
  const leftOffsets: number[] = [];
  let runningOffset = 0;
  for (const [index, width] of widths.entries()) {
    leftOffsets.push((held === null ? rowNumbers?.leftOffsets[numberAt(present[index]!)] : undefined) ?? runningOffset - pinShift);
    runningOffset += width + gap;
  }
  // A panel is as many slots wide as its width spans, a half slot rounding up.
  // A stored width is a whole number of slots, so only the override is ever between two.
  const slotsOfWidth = (width: number): number => Math.max(1, Math.round((width + gap) / (phoneWidth + gap)));
  const fitSlotsNow = fitSlots(maxLiveWidth, phoneWidth, gap);
  const rowHeight = phoneHeight;
  const rowScroll = rowNumbers?.rowScroll ?? false;
  // While a width is held the row box is never shorter than it was: the browser would clamp the scroll to a shorter strip and move the row under the pointer.
  const reservedWidth = Math.max(0, widths.reduce((sum, width) => sum + width + gap, 0) - gap - pinShift, tracking ? baseWidths.reduce((sum, width) => sum + width + gap, 0) - gap : 0, rowNumbers?.stripWidth ?? 0);
  const maxScroll = rowNumbers === undefined ? 0 : maxScrollOf(rowNumbers);
  const stops = rowNumbers === undefined ? [] : rowNumbers.stops.length > 0 ? rowNumbers.stops : rowNumbers.leftOffsets.map((offset) => rowNumbers.stripStart + offset);
  const widthById = new Map(present.map((p, index) => [p.id, widths[index]!]));
  // Nearest first on each side, an always-shown column included: movePanel swaps past one like any neighbor. The
  // walk is over every array slot and stops at the first entry that is not crossable, a parked one included,
  // because that is where movePanel refuses the hop.
  const neighborsAt = (entry: PanelRowEntry): Walk => {
    // A sticky panel is never crossed or dragged, so it has no neighbors to hop over.
    if (heldById.has(entry.id)) return { left: [], right: [] };
    const at = entries.indexOf(entry);
    const side = (step: 1 | -1) => {
      const out: Neighbor[] = [];
      for (let i = at + step; i >= 0 && i < entries.length; i += step) {
        const next = entries[i]!;
        // A sticky panel is never crossed: it is not in the strip, so a drag that passed it would move it out of its edge.
        if (!effective(next).crossable || heldById.has(next.id)) break;
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
  const viewContext = viewContextOf(workspace);
  const rowTuning = slotTuning(workspaceTuning);
  // The one hop rule: the header drag and a drag that starts outside the row both count their hops through it.
  const stepsFor = (entry: PanelRowEntry, offset: number): number => reorderStepsForOffset(offset, neighborWidthsAt(entry), gap, rowTuning.hopFraction);
  const boxRef = React.useRef<HTMLDivElement>(null);
  // A root no drag may cross that starts the strip is where a drag stops and its left band ends; a sticky root is already outside the strip.
  const rootEntry = present[0]?.id === rootId ? present[0] : undefined;
  const barrierEl = (): HTMLElement | null | undefined => boxRef.current?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(rootId)}"]`);
  // The root's nudge is added back, so the band stays where the root rests.
  const nudged = React.useRef(0);
  const nudgeAnim = React.useRef<Animation | null>(null);
  const barrier =
    rootEntry === undefined || effective(rootEntry).crossable
      ? undefined
      : {
          barrierRight: (): number | undefined => {
            const root = barrierEl();
            return root == null ? undefined : root.getBoundingClientRect().right + nudged.current + gap;
          },
          nudgeBarrier: (px: number): void => {
            const root = barrierEl();
            if (root == null || px === nudged.current) return;
            nudged.current = px;
            // No Web Animations (a test DOM): the nudge lands at once. A throw here would stop Motion's frame loop for good.
            if (typeof root.animate !== 'function') {
              root.style.translate = restTranslate((Number(root.dataset.rowSlot) || 0) - px);
              return;
            }
            // An offset added to the rest on `translate`, so a rest the pass moves during a nudge carries it. 'add' leaves the compositor, which a nudge can afford: it runs only against the barrier, never in a glide. By the
            // Web Animations API, because the theme turns CSS transitions off. A push eases in fast, a release home slower, each from where the last one is now.
            const from = (Number.parseFloat(getComputedStyle(root).translate) || 0) - (Number.parseFloat(root.style.translate) || 0);
            nudgeAnim.current?.cancel();
            const anim = root.animate([{ translate: `${from}px 0px` }, { translate: `${-px}px 0px` }], { duration: px === 0 ? rowTuning.slide.durationSec * 500 : 120, easing: 'ease-out', fill: 'forwards', composite: 'add' });
            nudgeAnim.current = anim;
            if (px === 0) anim.onfinish = () => anim.cancel();
          },
        };
  // A row that fits its window still drags to its edges: there the band swaps hidden panels in rather than scrolling.
  const dragScroll: DragScroll = { mode: FIXED.scrollOnDrag, zonePx: rowTuning.edgeScroll.zonePx, maxPxPerSec: rowTuning.edgeScroll.maxPxPerSec, reducedStepMs: rowTuning.edgeScroll.reducedStepMs, maxScroll: rowScroll ? maxScroll : 0, stops: rowScroll ? stops : [], settleStops: rowScroll && rowNumbers !== undefined ? rowNumbers.stops : [], settleSec: rowTuning.slide.durationSec, settleEase: GLIDE_EASE, insetLeft: rowNumbers?.leftInset ?? 0, insetRight: rowNumbers?.rightInset ?? 0, ...barrier, cycle: binding.cycle };
  // A horizontal drag's live hop count. Only the slots' drawn positions follow it; the order changes at the drop.
  const [dragging, setDragging] = React.useState<{ id: string; steps: number } | null>(null);
  // A dragged panel that left the row (closed by other means) takes its preview with it.
  const draggedGone = dragging !== null && !present.some((x) => x.id === dragging.id);
  React.useEffect(() => {
    if (draggedGone) setDragging(null);
  }, [draggedGone]);
  const leftById = new Map(present.map((p, index) => [p.id, leftOffsets[index]!]));
  const widthFor = (entry: PanelRowEntry): number => widthById.get(entry.id) ?? panelWidthOf(entry, phoneWidth, maxLiveWidth, gap);
  const dropRowOf = (entry: PanelRowEntry) => ({ entries, rowGap: gap, widthById, leftById, width: widthFor(entry), walk: neighborsAt(entry) });
  // A drag from outside the row edge-scrolls the Embla row by the same numbers as a header drag; they are set below, once known.
  const rowDropScroll = React.useRef<DragScroll | undefined>(undefined);
  const { preview: drop, controller: rowDrop } = useRowDrop({
    workspace,
    rootId,
    entries,
    chrome,
    boxRef,
    walkOf: neighborsAt,
    stepsFor,
    dragScroll: () => rowDropScroll.current,
    centreOf: (entry, hidden) => (hidden ? (dropParts({ id: entry.id, steps: 0, hidden: true }, dropRowOf(entry)).gap?.left ?? 0) + widthFor(entry) / 2 : (leftById.get(entry.id) ?? 0) + widthFor(entry) / 2),
  });
  const shiftById = new Map<string, number>();
  const draggedEntry = dragging === null ? undefined : present.find((x) => x.id === dragging.id);
  if (dragging !== null && draggedEntry !== undefined && dragging.steps !== 0 && effective(draggedEntry).movable) {
    for (const [id, by] of partShifts(neighborsAt(draggedEntry), dragging.steps, widthById.get(draggedEntry.id)! + gap)) shiftById.set(id, by);
  }
  const dropEntry = drop === null ? undefined : entries.find((x) => x.id === drop.id);
  const dropPartsNow = drop === null || dropEntry === undefined ? undefined : dropParts(drop, dropRowOf(dropEntry));
  if (dropPartsNow !== undefined) for (const [id, by] of dropPartsNow.shifts) shiftById.set(id, by);
  const gapSpan = dropPartsNow?.gap == null ? 0 : dropPartsNow.gap.width + gap;
  // A change left of the view (a panel opened, closed, moved or resized there, or clamped by a narrower window) keeps the
  // view still: the scroll moves with the panel at the window's left edge, and every slot snaps to its new rest in the same frame.
  // Under Reduce Motion the size box snaps, so the slots a width change moves snap with it.
  const configReduced = useReducedMotionConfig() === true;
  const systemReduced = useReducedMotion() === true;
  const reducedMotion = configReduced || systemReduced;
  const windowRef = React.useRef<HTMLDivElement>(null);
  const stripPx = reservedWidth + gapSpan;
  // A sticky panel takes its group out of the window: the strip is seen through the rest, and the groups sit beside it.
  const insetLeft = rowNumbers?.leftInset ?? 0;
  const insetRight = rowNumbers?.rightInset ?? 0;
  const emblaWindow = emblaWindowOf((rowNumbers?.windowWidth ?? Number.POSITIVE_INFINITY) - insetLeft - insetRight, phoneWidth, gap, stripPx);
  const layoutNow: StripLayout = { ids: present.map((p) => p.id), lefts: leftOffsets, widths };
  const lastLayout = React.useRef<StripLayout | null>(null);
  const lastWindow = React.useRef<number | null>(null);
  // What the first commit of this task started from: what was painted, when a later commit in the same task glides.
  const shownRef = React.useRef<{ layout: StripLayout; drawn: number; task: object } | null>(null);
  const emblaNow = windowRef.current !== null ? emblaOf(windowRef.current) : undefined;
  const scrollNow = emblaNow === undefined ? 0 : emblaScrollOf(emblaNow);
  // Where the strip is drawn this frame, which a glide's location runs ahead of: slots that move on screen glide from here.
  const drawnScrollNow = emblaNow === undefined ? 0 : emblaDrawnOf(emblaNow);
  // Only a render that changed the strip or the window keeps the view: any other one (a pulled-past-the-end drag included, which
  // the clamp would snap back) leaves the row where it is.
  // A summon moves the root from out of the view to just outside it (`noteEmblaMove`): the commit that draws it snaps the slots it
  // moves, so the root stands at its new place before the glide brings it in.
  const moveNote = emblaNow === undefined ? undefined : emblaMoveOf(windowRef.current!);
  const lastMove = React.useRef(0);
  // A person's move of a panel (a drop, an arrow key on its grab strip) noted by the slot in the task that moves it: the view stays
  // where it is drawn instead of keeping the left-edge panel still, and the moved panel comes into view if the move took it out.
  const reorderNote = React.useRef<{ id: string; atMs: number } | null>(null);
  const changed = lastLayout.current !== null && (lastWindow.current !== emblaWindow.width || !sameLayout(lastLayout.current, layoutNow));
  const moving = moveNote !== undefined && moveNote.seq !== lastMove.current && changed;
  const stripMax = Math.max(0, stripPx - emblaWindow.width);
  const reorderNow = reorderNote.current !== null && performance.now() - reorderNote.current.atMs < REORDER_NOTE_MS && changed && lastLayout.current !== null && lastLayout.current.ids.length === layoutNow.ids.length && lastLayout.current.ids.every((id) => layoutNow.ids.includes(id)) ? reorderNote.current.id : null;
  // A place by code noted in the task that draws it: the keep-still rule does not anchor the view on the placed panel.
  const placeNote = emblaNow === undefined ? undefined : emblaPlaceOf(windowRef.current!);
  const lastPlace = React.useRef(0);
  const placedNow = placeNote !== undefined && placeNote.seq !== lastPlace.current && changed ? placeNote.id : undefined;
  const keptNow = emblaNow === undefined || !changed || reorderNow !== null ? scrollNow : keptScroll(lastLayout.current!, layoutNow, scrollNow, stripMax, placedNow);
  const keepTo = keptNow;
  const keeping = Math.abs(keepTo - scrollNow) > 0.5;
  // A change of the strip in the same window that moves the view (a page in view narrowed at the strip's end) jumps the scroll and
  // snaps the slots as any keep does; the slots it moved on screen then glide there with the size box, so nothing in view jumps.
  // Only a width change: the same panels in the same order (an open, close or move keeps its snap, as a window resize does).
  const sameOrder = lastLayout.current !== null && lastLayout.current.ids.join(' ') === layoutNow.ids.join(' ');
  const widthGlide = keeping && sameOrder && lastWindow.current === emblaWindow.width && ready && !landing && !reducedMotion;
  // What Embla builds its stops from: the markers and the window box. A change rebuilds them in the commit that draws it.
  const markers = slotMarkerLefts(stripPx, phoneWidth, gap);
  const stopsKey = `${markers.length}|${emblaWindow.width}|${phoneWidth}|${gap}`;
  // A reorder drag's edge scroll on Embla: the window's own edges, the strip's end and its rests (a Reduce Motion hold jumps rest to rest);
  // a strip has no hidden panels to swap in, and the release settles on Embla's nearest stop.
  const emblaDragScroll: DragScroll = { ...dragScroll, maxScroll: stripMax, stops: emblaRests(markers, stripPx, emblaWindow.width), settleStops: [], insetLeft: 0, insetRight: 0, cycle: undefined };
  rowDropScroll.current = emblaDragScroll;
  const lastStops = React.useRef<string | null>(null);
  // On Embla every panel has its slot on the strip; one far from the view draws a placeholder of its width instead of its content, and
  // loads again when it comes near. Under a cap (`maxLivePanels`) every collapsible panel but the dragged one counts and may unload,
  // whatever built it; with no cap only a hand-built 0.1.0 entry (collapsible, carrying no settings) does, as before `overflow` was
  // removed, and a template-built one stays loaded. A fixed column (the root, a pinned panel) is always loaded and takes nothing from the cap.
  const nearSlots = React.useContext(RowNearContext);
  const loadedRef = React.useRef<ReadonlySet<string> | null>(null);
  // What a glide brings into view in the next frames counts as shown, so it is loaded before it enters the view, whatever the cap.
  // Before the window is measured it is drawn the whole strip wide: load only the cap's nearest then, not every page for one commit.
  const windowKnown = Number.isFinite(rowNumbers?.windowWidth ?? Number.POSITIVE_INFINITY);
  const loadedAt = (scroll: number, ahead: number, toward: number | null): Set<string> =>
    loadedNear({ layout: layoutNow, scroll, windowWidth: windowKnown ? emblaWindow.width : 0, pitch: phoneWidth + gap, gap, near: windowKnown ? nearSlots : Number.POSITIVE_INFINITY, limit: workspaceTuning.maxLivePanels, unloadable: (id) => id !== dragging?.id && present.some((p) => p.id === id && p.collapsible && (workspaceTuning.maxLivePanels !== null || p.settings === undefined)), was: loadedRef.current, ahead, toward });
  // Read where the strip is drawn, not Embla's location: mid-glide the location runs up to a frame's travel ahead of the drawing.
  const loadedNow = emblaNow === undefined ? loadedAt(keepTo, 0, null) : loadedAt(drawnScrollNow + keepTo - scrollNow, emblaAheadOf(emblaNow), emblaTargetOf(emblaNow) + keepTo - scrollNow);
  loadedRef.current = loadedNow;
  const loadedAtRef = React.useRef(loadedAt);
  loadedAtRef.current = loadedAt;
  const [, reload] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    return subscribeEmblaRows(() => {
      const embla = windowRef.current === null ? undefined : emblaOf(windowRef.current);
      const was = loadedRef.current;
      if (embla === undefined || was === null) return;
      const next = loadedAtRef.current(emblaDrawnOf(embla), emblaAheadOf(embla), emblaTargetOf(embla));
      if (next.size !== was.size || [...next].some((id) => !was.has(id))) reload();
    });
  }, []);
  // One slot for a strip entry or a sticky one. A sticky entry is not draggable and is drawn in its group: it never moves.
  const slotFor = (p: PanelRowEntry, rest: { leftOffset: number; width: number }, held: boolean): React.ReactElement => {
    const Component = resolveViewIn(templateOf, p.view);
    const { closable, movable, resizable, maxSlots, enterFrom, exitTo, layer, headerButtons } = effective(p);
    const own = rowTuning;
    const handle = viewContext.handleFor(panelKey(p));
    const report = binding.reportError;
    const note = binding.reportNote;
    // A panel whose last button was just removed while it held focus still gets the slot context for that one commit, so the hook that moves focus runs.
    const headerButtonSlots = headerButtonsOf(headerButtons, handle, report, note) ?? (handle !== undefined && focusInHeaderRow(handle.id) ? { slots: {}, handle, report, note } : undefined);
    const index = presentAll.indexOf(p);
    const sticky = held;
    const summary = renderedSummary(p, rest.width, phoneHeight, slotsOfWidth(rest.width), fitSlotsNow);
    return (
      <PanelSlotContext.Provider
        key={p.id}
        value={{
          summary,
          collapsible: p.collapsible,
          closable,
          movable: movable && !held,
          resizable,
          maxSlots,
          id: p.id,
          tracking: slotTracking,
          setDragging: (on) => chrome.setDragging(p.id, on),
          neighborWidths: neighborWidthsAt(p),
          drawn: { width: rest.width, height: phoneHeight },
          handle,
          closing: closingIds.has(p.id),
          tuning: own,
          dragScroll: emblaDragScroll,
          headerButtonSlots,
          noteReorder: () => {
            reorderNote.current = { id: p.id, atMs: performance.now() };
          },
          dragHops: (offset) => stepsFor(p, offset) !== 0,
          previewReorder: (offset) =>
            setDragging((now) => {
              if (offset === null) return now?.id === p.id ? null : now;
              const steps = stepsFor(p, offset);
              return now?.id === p.id && now.steps === steps ? now : { id: p.id, steps };
            }),
        }}
      >
        <PanelRowSlot
          panelId={p.id}
          label={labels.panelPosition(p.title || labels.untitledPanel, index + 1, presentAll.length)}
          leftOffset={rest.leftOffset + (shiftById.get(p.id) ?? 0)}
          width={rest.width}
          phoneHeight={rowHeight}
          height={p.slots === undefined ? undefined : phoneHeight}
          enterDirection={held ? 'fade' : enterDirectionOf(enterFrom, p.anchoredEnter ?? false, enterSideById.get(p.id), enteringViaAnchorIds.has(p.id), () => resolveEnterDirection(anchorIndexOf(p), index), workspaceTuning.defaultEnterFrom)}
          exitDirection={held ? 'fade' : exitStyleOf(exitTo, workspaceTuning.defaultExitTo, closingIds.has(p.id) || swapExitIds.has(p.id), exitRightIds.has(p.id))}
          zIndex={sticky || dragging?.id === p.id || drop?.id === p.id ? ROW_LAYER_Z.DRAGGED : layer === 'raised' ? ROW_LAYER_Z.RAISED : ROW_LAYER_Z.BASE}
          tracking={slotTracking || keeping || moving || rowNumbers?.anchor !== undefined || handoff.has(p.id)}
          gap={gap}
          slide={own.slide}
          rowScroll={rowScroll}
          previewing={dragging !== null || drop !== null}
          firstPressFocusOnly={templateOf(p.view)?.firstPressFocusOnly ?? workspaceTuning.firstPressFocusOnly}
          onActivate={(control) => {
            chrome.setActive(p.id);
            binding.touch(p.id, control);
            // A panel the window's edge cuts comes whole into view as it takes the focus.
            const embla = windowRef.current !== null ? emblaOf(windowRef.current) : undefined;
            const at = lastLayout.current;
            const k = at === null ? -1 : at.ids.indexOf(p.id);
            const to = embla === undefined || at === null || k < 0 || dragging !== null || sticky ? null : revealScroll(at.lefts[k]!, at.widths[k]!, emblaTargetOf(embla), emblaWindow.width);
            if (embla !== undefined && to !== null) embla.scrollTo(nearestStop(embla, Math.min(Math.max(0, to), stripMax)), reducedMotion);
          }}
          dragged={dragging?.id === p.id}
          frame={sticky ? undefined : 0}
        >
          {/* A resolved component -- built-in or third-party -- is written against PanelSummary only,
              never the internal record. */}
          {/* The ONE place useViewState's ambient panel id is set, so a view's own useViewState(key,
              initial) call needs no id argument. */}
          {/* Every panel resizes through this one box, so a view that draws a bare Panel glides like any other. */}
          {!loadedNow.has(p.id) && !sticky ? (
            <div {...{ [EMBLA_UNLOADED_ATTRIBUTE]: '' }} style={{ width: '100%', height: '100%' }} />
          ) : (
            <SizeBox>
              <useViewState.Provider value={panelKey(p)}>
                <Component panel={summary} />
              </useViewState.Provider>
            </SizeBox>
          )}
        </PanelRowSlot>
      </PanelSlotContext.Provider>
    );
  };
  const rootRef = React.useRef<HTMLDivElement>(null);
  const lastRowPlace = React.useRef<RowPlace | null>(null);
  useRowDraw(rootRef);
  // On Embla the box is Embla's container, as wide as the window it moves in; the slots and markers overflow it and the window cuts them.
  // Embla runs only on a row with a slot: built with no slides it has no stop, and its position reads that missing stop as NaN.
  useEmblaRow(windowRef, boxRef, markers.length > 0, workspaceTuning.gestureQuietMs, React.useContext(AwayContext), workspaceTuning.rowGesture);
  React.useLayoutEffect(() => {
    const embla = windowRef.current !== null ? emblaOf(windowRef.current) : undefined;
    const restop = lastStops.current !== null && lastStops.current !== stopsKey;
    // The markers or the window changed in this commit: Embla rebuilds its stops from them, and the row keeps the view (a shift)
    // from where it is drawn, a glide in flight included.
    if (embla !== undefined) setEmblaReduced(embla, reducedMotion);
    if (embla !== undefined) setEmblaFastScroll(embla, workspaceTuning.fastScroll, rowTuning.slide.durationSec);
    if (embla !== undefined && (keeping || restop)) moveEmbla(embla, keeping ? keepTo - scrollNow : 0, restop);
    if (embla !== undefined) lastStops.current = stopsKey;
    if (moveNote !== undefined && changed) lastMove.current = moveNote.seq;
    if (placeNote !== undefined && changed) lastPlace.current = placeNote.seq;
    if (embla !== undefined && reorderNow !== null) {
      reorderNote.current = null;
      const k = layoutNow.ids.indexOf(reorderNow);
      const moved = present.find((p) => p.id === reorderNow);
      const to = k < 0 || moved === undefined || effective(moved).scrollOnMove !== 'follow' ? null : revealScroll(layoutNow.lefts[k]!, layoutNow.widths[k]!, emblaTargetOf(embla), emblaWindow.width);
      if (to !== null) embla.scrollTo(nearestStop(embla, Math.min(Math.max(0, to), stripMax)), reducedMotion);
    }
    const before = lastLayout.current;
    if (embla !== undefined && before !== null && lastWindow.current === emblaWindow.width) {
      // A panel that grew past the window's edge comes whole into view, as a reordered one does. Only one the window showed: a panel
      // that grew wholly outside it keeps the view still, as any change out of view does.
      const k = layoutNow.ids.findIndex((id, i) => {
        const j = before.ids.indexOf(id);
        const entry = present.find((p) => p.id === id);
        const shown = j >= 0 && before.lefts[j]! + before.widths[j]! > drawnScrollNow + 0.5 && before.lefts[j]! < drawnScrollNow + emblaWindow.width - 0.5;
        return shown && layoutNow.widths[i]! > before.widths[j]! + 0.5 && entry !== undefined && effective(entry).scrollOnMove === 'follow';
      });
      const to = k < 0 ? null : revealScroll(layoutNow.lefts[k]!, layoutNow.widths[k]!, emblaTargetOf(embla), emblaWindow.width);
      if (to !== null) embla.scrollTo(nearestStop(embla, Math.min(Math.max(0, to), stripMax)), reducedMotion);
    }
    if (embla !== undefined && lastLayout.current !== null && keeping && boxRef.current !== null) {
      // Two commits in one task (a width change, then the root it lets back beside the page) paint once: glide from what was painted.
      const shown = shownRef.current !== null && shownRef.current.task === taskToken() ? shownRef.current : { layout: lastLayout.current, drawn: drawnScrollNow };
      // Drawn after this commit: where the strip was drawn, moved by the keep's shift.
      const drawnTo = drawnScrollNow + keepTo - scrollNow;
      arriveAndLeave(boxRef.current, shown.layout, layoutNow, shown.drawn, drawnTo, emblaWindow.width, gap, widthGlide, rowTuning.slide, reducedMotion);
    }
    if (lastLayout.current !== null && (shownRef.current === null || shownRef.current.task !== taskToken())) shownRef.current = { layout: lastLayout.current, drawn: drawnScrollNow, task: taskToken() };
    lastLayout.current = layoutNow;
    lastWindow.current = emblaWindow.width;
    if (windowRef.current !== null) publishEmblaStrip(windowRef.current, { layout: layoutNow, windowWidth: emblaWindow.width, stripWidth: stripPx, pitch: phoneWidth + gap, gap, chromeFollowSlots: workspaceTuning.chrome.fitVisibleMaxSlots, sticky: [...startGroupIds.map((id) => ({ id, side: 'start' as const })), ...endGroupIds.map((id) => ({ id, side: 'end' as const }))] });
    // The container centers a strip that fits, so a panel coming, going or resizing moves the row itself: that rides the slide too.
    if (rootRef.current !== null && presentAll.length > 0) lastRowPlace.current = recentreRow(rootRef.current, windowRef.current, lastRowPlace.current, { windowWidth: emblaWindow.width, room: rowNumbers?.windowWidth ?? 0 }, gap, rowTuning.slide, landing || reducedMotion || !ready);
    // A commit can start slots moving on their own (an entrance, a glide, a reorder shift): the inert marks follow them frame by frame.
    if (windowRef.current !== null) kickEmblaAway(windowRef.current);
  });
  // The slots of each sticky group, in row order, at their place in the group.
  const groupOf = (side: 'left' | 'right'): { p: PanelRowEntry; width: number; leftOffset: number }[] =>
    (rowNumbers?.held ?? []).filter((h) => h.side === side).flatMap((h) => {
      const p = presentAll.find((x) => x.id === h.id);
      return p === undefined ? [] : [{ p, width: h.width, leftOffset: h.offset - (side === 'right' ? gap : 0) }];
    });
  const startGroup = groupOf('left');
  const endGroup = groupOf('right');
  const groupWidth = (g: readonly { width: number }[]): number => (g.length === 0 ? 0 : g.reduce((sum, x) => sum + x.width, 0) + (g.length - 1) * gap);
  const stripShown = present.length > 0;
  const group = (side: 'start' | 'end', slots: readonly { p: PanelRowEntry; width: number; leftOffset: number }[]): React.ReactElement | null =>
    slots.length === 0 ? null : (
    <Box
      data-row-sticky={side}
      sx={{
        position: 'relative',
        flexShrink: 0,
        height: rowHeight,
        width: groupWidth(slots),
        // One gap between a group and what follows it.
        ...(side === 'start' ? { marginRight: stripShown || endGroup.length > 0 ? `${gap}px` : 0 } : { marginLeft: stripShown ? `${gap}px` : 0 }),
      }}
    >
      <AnimatePresence initial={false}>{slots.map((x) => slotFor(x.p, { leftOffset: x.leftOffset, width: x.width }, true))}</AnimatePresence>
    </Box>
  );
  const box = (
    <>
    {/* Always mounted: an exiting entry needs AnimatePresence to animate inside, and `initial={false}` must see
    what is present at app start to skip animating a restored session. `display: none` (not width 0) so an
    empty row consumes no flex `gap` from its siblings. */}
    <Box
      ref={boxRef}
      sx={{
        position: 'relative',
        flexShrink: 0,
        height: rowHeight,
        display: 'block',
        width: emblaWindow.width,
      }}
    >
      {markers.map((left) => <div key={left} aria-hidden {...{ [EMBLA_SLOT_ATTRIBUTE]: left }} style={{ position: 'absolute', top: 0, left, width: phoneWidth, height: 0, pointerEvents: 'none' }} />)}
      {dropPartsNow?.gap == null ? null : <Box aria-hidden data-panel-row-drop-gap="" sx={{ position: 'absolute', top: 0, left: dropPartsNow.gap.left, width: dropPartsNow.gap.width, height: rowHeight, pointerEvents: 'none' }} />}
      <AnimatePresence initial={false}>
        {domOrder.filter((p) => !heldById.has(p.id)).map((p) => slotFor(p, { leftOffset: leftOffsets[present.indexOf(p)]!, width: widths[present.indexOf(p)]! }, false))}
      </AnimatePresence>
    </Box>
    </>
  );
  // Cut one gap past each window edge, as the old row's grid cut: a focus glow fades there and no neighbour starts inside it.
  const emblaCut = rowClip(emblaWindow.width, gap);
  // Tab reads the sticky panels at the start, the strip, then the sticky panels at the end.
  const readingIds = [...startGroup.map((x) => x.p.id), ...present.map((p) => p.id), ...endGroup.map((x) => x.p.id)];
  return (
    <ChromeStoreContext.Provider value={chrome}>
    <PanelViewContextValue.Provider value={viewContext}>
    <RowDropContext.Provider value={rowDrop}>
    <HandoffContext.Provider value={handoff}>
    <SlotRanksContext.Provider value={slotRanks}>
    <Box
      ref={rootRef}
      data-row-root=""
      onKeyDown={(event) => steerTab(event, event.currentTarget, readingIds)}
      onFocus={(event) => {
        steerSentinel(event, event.currentTarget, readingIds);
        steerEntry(event, event.currentTarget, readingIds, tabPress.current);
      }}
      // Hidden until the restore settles: the root alone, drawn centered first, would otherwise jump aside when the restored panels land.
      sx={{ display: presentAll.length > 0 ? 'flex' : 'none', flexShrink: 0, position: 'relative', ...(restoring && !restoreWaitedOut ? { visibility: 'hidden' } : {}) }}
    >
      {group('start', startGroup)}
      <div ref={windowRef} {...{ [EMBLA_WINDOW_ATTRIBUTE]: '' }} style={{ position: 'relative', flexShrink: 0, width: emblaWindow.width, clipPath: emblaCut, display: stripShown ? 'block' : 'none' }}>
        {box}
      </div>
      {group('end', endGroup)}
    </Box>
    </SlotRanksContext.Provider>
    </HandoffContext.Provider>
    </RowDropContext.Provider>
    </PanelViewContextValue.Provider>
    </ChromeStoreContext.Provider>
  );
}
