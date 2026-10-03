/**
 * One AnimatePresence over ONE array: each PRESENT entry (an always-shown column regardless of `live`, a
 * collapsible one only while `live`) in its own animated slot, in the array's order. Not a view. Renders ONE
 * root, this Box.
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { useHost } from './hostApi.js';
import { summarisePanel, type NeighborWidths, type PanelRowEntry } from './panelRowEntry.js';
import { anchorTargetOf, resolveEnterDirection } from './panelRowOrder.js';
import { GAP, PanelRowSlot } from './PanelRowSlot.js';
import { panelWidthOf } from './panelTiers.js';
import { resolveView } from './viewRegistry.js';
import { useViewState } from './viewState.js';

/** A 'raised' slot sits above a 'base' one: a LEFT-exiting park crosses a raised panel's footprint on the way out (a close exits DOWN and never does). */
const RAISED_LAYER_Z_INDEX = 2;
const BASE_LAYER_Z_INDEX = 1;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, 'left' | 'right'> = new Map();
const NO_NEIGHBORS: NeighborWidths = { left: [], right: [] };

/** The view's summary with `size.width` at the width the row renders it, so a view passing `panel.size` to Panel stays inside its slot. */
function renderedSummary(p: PanelRowEntry, width: number) {
  const summary = summarisePanel(p);
  return summary.size && summary.size.width !== width && (p.formFactor ?? 'phone') !== 'phone' ? { ...summary, size: { ...summary.size, width } } : summary;
}

/**
 * Per-slot facts a view cannot read itself: it only receives `PanelSummary`, which has no `collapsible` or
 * `anchor`, on purpose (hostApi.tsx). No provider above (a view mounted directly, as in tests) is `undefined`,
 * deliberately not `false`: each hook below resolves that case to its OWN default.
 */
const PanelSlotContext = React.createContext<{ collapsible: boolean; neighborWidths: NeighborWidths; pinned: boolean } | undefined>(undefined);
/** True only for a `collapsible` entry (e.g. a plain web panel): an always-shown column (the root, or a
 * `permanent:true` custom column) is never a reorder source. Unprovided resolves to false: a view mounted
 * with no `PanelRow` above it never reorders.
 * @public */
export const usePanelReorderEligible = (): boolean => React.useContext(PanelSlotContext)?.collapsible ?? false;
/** False only for an always-shown column (`collapsible:false`): the built-in 'web' view must never wrap such
 * an entry in a framework close handle (CreatePanelOptions.permanent's 'own control only' guarantee).
 * Unprovided resolves to true: a view mounted directly (as tests do) is an ordinary collapsible panel.
 * @public */
export const usePanelCloseEligible = (): boolean => React.useContext(PanelSlotContext)?.collapsible ?? true;
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop.
 * @public */
export const usePanelNeighborWidths = (): NeighborWidths => React.useContext(PanelSlotContext)?.neighborWidths ?? NO_NEIGHBORS;
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
  /** The widest one live panel can be in this row (see computeMaxLiveWidth). Omitted: no cap. */
  maxLiveWidth?: number;
}): React.ReactElement {
  const { device, panels } = useHost();
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
  // Ids never repeat, so a panel in neither list can never be shown again and its view state is released.
  useViewState.useRetainOnly([...entries, ...(panels.recentlyClosed ?? [])].map((p) => p.id));
  const present = entries.filter((p) => !p.collapsible || p.live);
  // Every present entry's OWN width, in row order. An always-shown column needs no special case: setFormFactor
  // no-ops on a collapsible:false id, so panelWidthOf gives it `phoneWidth`.
  const widths = present.map((p) => panelWidthOf(p, phoneWidth, maxLiveWidth));
  // Each slot's rest x: every PRECEDING item's own width plus one gap, so a wider item pushes the rest right.
  const leftOffsets: number[] = [];
  let runningOffset = 0;
  for (const width of widths) {
    leftOffsets.push(runningOffset);
    runningOffset += width + GAP;
  }
  const reservedWidth = Math.max(0, widths.reduce((sum, width) => sum + width + GAP, 0) - GAP);
  // Nearest first on each side, an always-shown column included: movePanel swaps past one like any neighbour.
  const neighborWidthsAt = (index: number): NeighborWidths => {
    const side = (step: 1 | -1): number[] => {
      const out: number[] = [];
      for (let i = index + step; i >= 0 && i < present.length; i += step) out.push(widths[i]!);
      return out;
    };
    return { left: side(-1), right: side(1) };
  };
  // Per panel, and searched in `present`: each slot's own `index` below counts in that same array.
  const anchorIndexOf = (p: PanelRowEntry): number => present.findIndex((x) => x.id === anchorTargetOf(p, rootId));
  return (
    // Always mounted: an exiting entry needs AnimatePresence to animate inside, and `initial={false}` must see
    // what is present at app start to skip animating a restored session. `display: none` (not width 0) so an
    // empty row consumes no flex `gap` from its siblings.
    <Box
      sx={{
        position: 'relative',
        flexShrink: 0,
        height: phoneHeight,
        display: present.length > 0 ? 'block' : 'none',
        width: reservedWidth,
      }}
    >
      <AnimatePresence initial={false}>
        {present.map((p, index) => {
          const Component = resolveView(p.view);
          return (
            <PanelSlotContext.Provider
              key={p.id}
              value={{ collapsible: p.collapsible, neighborWidths: neighborWidthsAt(index), pinned: anchorTargetOf(p, rootId) === rootId && p.anchor?.position === 'left' }}
            >
              <PanelRowSlot
                leftOffset={leftOffsets[index]!}
                width={widths[index]!}
                phoneHeight={phoneHeight}
                enterDirection={enterSideById.get(p.id) ?? ((p.anchoredEnter ?? false) || enteringViaAnchorIds.has(p.id) ? resolveEnterDirection(anchorIndexOf(p), index) : 'right')}
                exitDirection={closingIds.has(p.id) ? 'down' : exitRightIds.has(p.id) ? 'right' : 'left'}
                zIndex={(p.layer ?? 'base') === 'raised' ? RAISED_LAYER_Z_INDEX : BASE_LAYER_Z_INDEX}
              >
                {/* A resolved component -- built-in or third-party -- is written against PanelSummary only,
                    never the internal record. */}
                {/* The ONE place useViewState's ambient panel id is set, so a view's own useViewState(key,
                    initial) call needs no id argument. */}
                <useViewState.Provider value={p.id}>
                  <Component panel={renderedSummary(p, widths[index]!)} />
                </useViewState.Provider>
              </PanelRowSlot>
            </PanelSlotContext.Provider>
          );
        })}
      </AnimatePresence>
    </Box>
  );
}
