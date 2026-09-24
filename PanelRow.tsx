/**
 * The row's one panel wrapper -- History and every live web panel, together
 * (panel-metadata-driven-model: merges what used to be FixedColumns.tsx and
 * this file, one AnimatePresence over ONE array instead of two near-identical
 * containers over two arrays). App-side (not a view): reads the phone size
 * from usePhoneAPIs() and lays out each PRESENT entry -- an always-shown
 * column (`collapsible: false`, e.g. History) regardless of `live`, or a web
 * panel only while `live` -- in its own animated slot, in the one list's own
 * array order. It renders ONE root, this Box, the row's last child (test
 * T11a).
 *
 * `entries` is the raw one-list array (PanelWindow, not the public
 * PanelSummary): `view` (which component to render) and `collapsible`
 * (stacking order below) live only on that shape, never on PanelsAPI.
 * `view` is the ONLY thing that picks the component -- every other decision
 * here (present, zIndex, enter direction) reads `collapsible`/`live`, the
 * same behavior flags production code reads everywhere else.
 *
 * `closingIds` is a PROP, not read off usePhoneAPIs(): it is
 * usePanelClosing.ts's own set (appApis.ts/GoalFrontPage.tsx thread it down),
 * kept off PanelsAPI on purpose (useProvidePanels.ts's ProvidedPanels). Each
 * present entry's `exitDirection` is decided HERE, at render time, while it
 * is still present -- an entry leaves either because it was closed
 * (closingIds has it: exits DOWN) or auto-collapsed to parked
 * (usePanelManager.ts: exits LEFT) -- see LivePanelSlot.tsx for why this must
 * be a prop rather than something read after the fact.
 *
 * ux-reveal-direction-and-fixed-column-animation: `enteringViaAnchorIds` is
 * the ENTER-side mirror of `closingIds` -- ids currently (re)joining `live`
 * through usePanelManager.ts's `revealMostRecentlyCollapsed` or
 * usePanelClosing.ts's `undoClose`. A brand-new panel or a manual
 * History-row activation never appear in this set, so they keep entering
 * from the right unconditionally. History's own reappearance always resolves
 * through the SAME anchor formula (anchorPanel.ts) unconditionally: compared
 * against itself its index is never less-than, so it always computes to
 * 'right' anyway -- no separate gate needed for it.
 *
 * Both `anchorIndex` and each entry's own row-slot `index` now come from the
 * SAME one-list array (no more `fixedColumnIds.length + panelIndex` offset
 * math: that existed only because History and the live panels used to be two
 * separate arrays with two separate index spaces).
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { usePhoneAPIs } from '../../shared/phone/PhoneView.js';
import { HistoryColumn } from '../history/HistoryColumn.js';
import { ANCHOR_PANEL_ID, resolveEnterDirection } from './anchorPanel.js';
import { LivePanel } from './LivePanel.js';
import { GAP, LivePanelSlot } from './LivePanelSlot.js';
import type { PanelWindow } from './panelWindow.js';

/** History's slot sits above a web panel's: auto-collapse's exit is LEFT and crosses History's footprint on the way out, so this ordering is load-bearing for that path (a close's exit is DOWN and never reaches it). */
const HISTORY_SLOT_Z_INDEX = 2;
const WEB_SLOT_Z_INDEX = 1;

export function LivePanels({
  entries,
  closingIds,
  enteringViaAnchorIds,
}: {
  entries: readonly PanelWindow[];
  closingIds: ReadonlySet<string>;
  enteringViaAnchorIds: ReadonlySet<string>;
}): React.ReactElement {
  const { device } = usePhoneAPIs();
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
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
        {present.map((p, index) => (
          <LivePanelSlot
            key={p.id}
            index={index}
            phoneWidth={phoneWidth}
            phoneHeight={phoneHeight}
            enterDirection={!p.collapsible || enteringViaAnchorIds.has(p.id) ? resolveEnterDirection(anchorIndex, index) : 'right'}
            exitDirection={closingIds.has(p.id) ? 'down' : 'left'}
            zIndex={p.collapsible ? WEB_SLOT_Z_INDEX : HISTORY_SLOT_Z_INDEX}
          >
            {p.view === 'history' ? <HistoryColumn /> : <LivePanel panel={p} />}
          </LivePanelSlot>
        ))}
      </AnimatePresence>
    </Box>
  );
}
