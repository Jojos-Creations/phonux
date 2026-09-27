/**
 * The row's one panel wrapper -- History and every live web panel, together, one AnimatePresence
 * over ONE array. App-side (not a view): lays out each PRESENT entry (an always-shown column
 * regardless of `live`, or a web panel only while `live`) in its own animated slot, in the array's
 * own order. Renders ONE root, this Box, the row's last child (test T11a).
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { resolveView, useHost, useViewState } from 'phonux';
import { ANCHOR_PANEL_ID, resolveEnterDirection } from './anchorPanel.js';
import { GAP, LivePanelSlot } from './LivePanelSlot.js';
import { panelWidthOf, summarisePanel, type NeighborWidths, type PanelWindow } from './panelWindow.js';

/** A 'raised' slot sits above a 'base' one: a LEFT-exiting park crosses a raised panel's footprint (History, today) on the way out, so this ordering is load-bearing for that path (a close's exit is DOWN and never reaches it). */
const RAISED_LAYER_Z_INDEX = 2;
const BASE_LAYER_Z_INDEX = 1;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, 'left' | 'right'> = new Map();
const NO_NEIGHBORS: NeighborWidths = { left: [], right: [] };

/** The view's summary with `size.width` at the width the row renders it, so a view passing `panel.size` to Panel stays inside its slot. */
function renderedSummary(p: PanelWindow, width: number) {
  const summary = summarisePanel(p);
  return summary.size && summary.size.width !== width && (p.formFactor ?? 'phone') !== 'phone' ? { ...summary, size: { ...summary.size, width } } : summary;
}

/**
 * Mirrors this entry's own `collapsible` for the two things LivePanel.tsx must decide without ever reading
 * the field itself (a resolved view only ever receives `PanelSummary`, which has no `collapsible` field, on
 * purpose -- phoneViewApi.tsx): whether its grab bar is a reorder source, and whether the framework may offer
 * ANY drag-to-close handle at all. `undefined` (no provider above, e.g. a view mounted directly in a test)
 * is deliberately distinct from an explicit `false`: each hook below resolves that case to whichever default
 * matches today's pre-`permanent`-columns behavior for its OWN concern, not one shared default.
 */
const PanelSlotContext = React.createContext<{ collapsible: boolean; neighborWidths: NeighborWidths } | undefined>(undefined);
/** True only for a `collapsible` entry (e.g. a plain web panel) -- an always-shown column (History, or a
 * `permanent:true` custom column) is never a reorder source. Unprovided resolves to false: a view mounted
 * with no `LivePanels` above it never reorders. */
export const usePanelReorderEligible = (): boolean => React.useContext(PanelSlotContext)?.collapsible ?? false;
/** False only for an always-shown column (`collapsible:false`): the built-in 'web' view must never wrap such
 * an entry in a framework close handle (CreatePanelOptions.permanent's 'own control only' guarantee).
 * Unprovided resolves to true, matching every pre-existing test that mounts LivePanel directly for an
 * ordinary (implicitly collapsible) panel. */
export const usePanelCloseEligible = (): boolean => React.useContext(PanelSlotContext)?.collapsible ?? true;
/** The widths this entry's drag can cross (reorderStepsForOffset's input). Unprovided: none, so no hop. */
export const usePanelNeighborWidths = (): NeighborWidths => React.useContext(PanelSlotContext)?.neighborWidths ?? NO_NEIGHBORS;

export function LivePanels({
  entries,
  closingIds,
  enteringViaAnchorIds,
  exitRightIds = EMPTY_SET,
  enterSideById = EMPTY_MAP,
  maxLiveWidth = Number.POSITIVE_INFINITY,
}: {
  /** The raw one-list array (PanelWindow, not PanelSummary): `view`/`layer`/`anchoredEnter`
   * (rendering, stacking, enter direction) are three independent fields here, not one flag doing
   * triple duty -- `view` alone picks the component (resolveView, which never returns nothing). */
  entries: readonly PanelWindow[];
  /** usePanelClosing.ts's own set, kept off PanelsAPI on purpose. An entry in it exits DOWN
   * (closed); see `exitDirection` below for the other two cases. */
  closingIds: ReadonlySet<string>;
  /** Ids currently (re)joining `live` via usePanelManager.ts's `revealMostRecentlyCollapsed` or
   * `undoClose`. A brand-new panel or manual activation is never in this set, so it enters from the
   * right unless its own `anchoredEnter` says otherwise. */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Ids parking with an exit to the RIGHT; every other park defaults to LEFT. Optional, defaulting
   * to empty (nothing exits right). */
  exitRightIds?: ReadonlySet<string>;
  /** Wins over the anchor formula when both would otherwise apply: the row gesture and the
   * capacity-rise reconcile know exactly which side a reveal must enter from, which the boolean
   * anchor formula alone cannot express. Optional, defaulting to empty. */
  enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
  /** The widest one live panel can be in this row (useAppApis's, from computeMaxLiveWidth). Optional: no cap. */
  maxLiveWidth?: number;
}): React.ReactElement {
  const { device, panels } = useHost();
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
  // Ids never repeat, so a panel in neither list can never be shown again and its view state is released.
  useViewState.useRetainOnly([...entries, ...(panels.recentlyClosed ?? [])].map((p) => p.id));
  const present = entries.filter((p) => !p.collapsible || p.live);
  // Every present entry's OWN width, in row order -- History and a permanent column included: neither can
  // actually carry a non-'phone' formFactor today (PanelsAPI.setFormFactor no-ops on a collapsible:false id),
  // so panelWidthOf gives them `phoneWidth` exactly, the same as reading it directly, with no special case.
  const widths = present.map((p) => panelWidthOf(p, phoneWidth, maxLiveWidth));
  // Each slot's own rest x: the running sum of every PRECEDING item's own width plus one gap -- a wider item
  // ahead of this one pushes it further right, so this can no longer be `index * one shared slot`.
  const leftOffsets: number[] = [];
  let runningOffset = 0;
  for (const width of widths) {
    leftOffsets.push(runningOffset);
    runningOffset += width + GAP;
  }
  const reservedWidth = Math.max(0, widths.reduce((sum, width) => sum + width + GAP, 0) - GAP);
  // Nearest first on each side, stopping at an always-shown column: movePanel never swaps past one.
  const neighborWidthsAt = (index: number): NeighborWidths => {
    const side = (step: 1 | -1): number[] => {
      const out: number[] = [];
      for (let i = index + step; i >= 0 && i < present.length && present[i]!.collapsible; i += step) out.push(widths[i]!);
      return out;
    };
    return { left: side(-1), right: side(1) };
  };
  // anchorIndex and each entry's own slot `index` below come from the SAME array.
  const anchorIndex = present.findIndex((p) => p.id === ANCHOR_PANEL_ID);
  return (
    // Always mounted (never conditionally rendered): AnimatePresence must not unmount, or an exiting entry
    // has nothing to animate inside, and `initial={false}` needs to see whatever is present at ITS OWN
    // first mount (app start) to skip animating a restored session. `display: none` (not width 0) so an
    // empty row consumes no flex `gap` from its own siblings.
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
            <PanelSlotContext.Provider key={p.id} value={{ collapsible: p.collapsible, neighborWidths: neighborWidthsAt(index) }}>
              <LivePanelSlot
                leftOffset={leftOffsets[index]!}
                width={widths[index]!}
                phoneHeight={phoneHeight}
                enterDirection={enterSideById.get(p.id) ?? ((p.anchoredEnter ?? false) || enteringViaAnchorIds.has(p.id) ? resolveEnterDirection(anchorIndex, index) : 'right')}
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
              </LivePanelSlot>
            </PanelSlotContext.Provider>
          );
        })}
      </AnimatePresence>
    </Box>
  );
}
