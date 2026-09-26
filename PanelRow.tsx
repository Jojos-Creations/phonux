/**
 * The row's one panel wrapper -- History and every live web panel, together,
 * one AnimatePresence over ONE array. App-side (not a view): reads the phone
 * size from useHost() and lays out each PRESENT entry -- an
 * always-shown column (`collapsible: false`, e.g. History) regardless of
 * `live`, or a web panel only while `live` -- in its own animated slot, in
 * the one list's own array order. It renders ONE root, this Box, the row's
 * last child (test T11a).
 *
 * `entries` is the raw one-list array (PanelWindow, not the public
 * PanelSummary): `view`/`layer`/`anchoredEnter` (rendering, stacking, enter
 * direction) live only on that shape, never on PanelsAPI. `view` is the ONLY
 * thing that picks the component (through phonux's resolveView, which
 * never returns nothing) -- `present` reads `collapsible`/`live`, zIndex
 * reads `layer`, enter direction reads `anchoredEnter`: three independent
 * per-panel fields, not one flag doing triple duty.
 *
 * `closingIds` is a PROP, not read off useHost(): it is
 * usePanelClosing.ts's own set (appApis.ts/GoalFrontPage.tsx thread it down),
 * kept off PanelsAPI on purpose (useProvidePanels.ts's ProvidedPanels). Each
 * present entry's `exitDirection` is decided HERE, at render time, while it
 * is still present -- an entry leaves either because it was closed
 * (closingIds has it: exits DOWN), parks to the row's right edge
 * (exitRightIds has it: exits RIGHT), or parks anywhere else (the default,
 * LEFT) -- see LivePanelSlot.tsx for why this must be a prop rather than
 * something read after the fact.
 *
 * `enteringViaAnchorIds` is one ENTER-side source -- ids currently (re)joining
 * `live` through usePanelManager.ts's `revealMostRecentlyCollapsed` or
 * usePanelClosing.ts's `undoClose`. A brand-new panel or a manual
 * History-row activation never appear in this set, so they enter from the
 * right unless their own `anchoredEnter` says otherwise. History's own reappearance always resolves
 * through the SAME anchor formula (anchorPanel.ts) unconditionally: compared
 * against itself its index is never less-than, so it always computes to
 * 'right' anyway -- no separate gate needed for it.
 *
 * `enterSideById` is the other, and wins over the anchor formula when both
 * would otherwise apply: usePanelManager.ts's row gesture and its
 * capacity-rise reconcile know exactly which side a reveal must enter from
 * (the side it was hidden toward), which the boolean anchor formula alone
 * cannot express. Optional, defaulting to an empty map, so a caller that
 * never needs it (e.g. a test mounting this component directly) is unaffected.
 *
 * Both `anchorIndex` and each entry's own row-slot `index` come from the
 * SAME one-list array.
 *
 * Each present entry's slot is wrapped in `PanelReorderContext` (this file's own export,
 * `usePanelReorderEligible`) so LivePanel.tsx's grab bar knows whether IT is a reorder source without
 * needing a new prop through `resolveView`'s third-party `Component` contract.
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { resolveView, useHost, useViewState } from 'phonux';
import { ANCHOR_PANEL_ID, resolveEnterDirection } from './anchorPanel.js';
import { GAP, LivePanelSlot } from './LivePanelSlot.js';
import { summarisePanel, type PanelWindow } from './panelWindow.js';

/** A 'raised' slot sits above a 'base' one: a LEFT-exiting park crosses a raised panel's footprint (History, today) on the way out, so this ordering is load-bearing for that path (a close's exit is DOWN and never reaches it). */
const RAISED_LAYER_Z_INDEX = 2;
const BASE_LAYER_Z_INDEX = 1;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP: ReadonlyMap<string, 'left' | 'right'> = new Map();

/**
 * Whether the row's drag-to-reorder gesture applies to THIS entry's own grab bar -- true only for a
 * `collapsible` entry (an always-shown column, e.g. History, is never a reorder source). A resolved view
 * only ever receives `PanelSummary` (no `collapsible` field, on purpose -- phoneViewApi.tsx), so LivePanel.tsx
 * reads this instead of checking the field itself. Default false: a view with no provider above it (e.g. a
 * test mounting itself directly) never reorders.
 */
const PanelReorderContext = React.createContext<boolean>(false);
/** See `PanelReorderContext`'s own doc comment. */
export const usePanelReorderEligible = (): boolean => React.useContext(PanelReorderContext);

export function LivePanels({
  entries,
  closingIds,
  enteringViaAnchorIds,
  exitRightIds = EMPTY_SET,
  enterSideById = EMPTY_MAP,
}: {
  entries: readonly PanelWindow[];
  closingIds: ReadonlySet<string>;
  enteringViaAnchorIds: ReadonlySet<string>;
  /** See this file's own header for the full contract. Optional, defaulting to empty (nothing exits right). */
  exitRightIds?: ReadonlySet<string>;
  /** See this file's own header for the full contract. Optional, defaulting to empty (the anchor formula alone decides). */
  enterSideById?: ReadonlyMap<string, 'left' | 'right'>;
}): React.ReactElement {
  const { device, panels } = useHost();
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
  // Ids never repeat, so a panel in neither list can never be shown again and its view state is released.
  useViewState.useRetainOnly([...entries, ...(panels.recentlyClosed ?? [])].map((p) => p.id));
  const present = entries.filter((p) => !p.collapsible || p.live);
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
        width: Math.max(0, present.length * (phoneWidth + GAP) - GAP),
      }}
    >
      <AnimatePresence initial={false}>
        {present.map((p, index) => {
          const Component = resolveView(p.view);
          return (
            <PanelReorderContext.Provider key={p.id} value={p.collapsible}>
              <LivePanelSlot
                index={index}
                phoneWidth={phoneWidth}
                phoneHeight={phoneHeight}
                enterDirection={enterSideById.get(p.id) ?? ((p.anchoredEnter ?? false) || enteringViaAnchorIds.has(p.id) ? resolveEnterDirection(anchorIndex, index) : 'right')}
                exitDirection={closingIds.has(p.id) ? 'down' : exitRightIds.has(p.id) ? 'right' : 'left'}
                zIndex={(p.layer ?? 'base') === 'raised' ? RAISED_LAYER_Z_INDEX : BASE_LAYER_Z_INDEX}
              >
                {/* Narrowed through the SAME projection PanelsAPI itself uses: a resolved component -- built-in or
                    third-party -- is written against PanelSummary only, never the internal PanelWindow record. */}
                {/* The ONE place useViewState's ambient panel id is set: a view calls useViewState(key, initial)
                    with no id argument at all, so this wrap is what makes that id ambient rather than explicit. */}
                <useViewState.Provider value={p.id}>
                  <Component panel={summarisePanel(p)} />
                </useViewState.Provider>
              </LivePanelSlot>
            </PanelReorderContext.Provider>
          );
        })}
      </AnimatePresence>
    </Box>
  );
}
