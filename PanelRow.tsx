/**
 * The row's live-panel slot, moved out of GoalFrontPage. App-side (not a view):
 * it reads the panel list and the phone size from usePhoneAPIs() and lays each
 * live panel out in its animated slot. It renders ONE root, the slot Box, the
 * row's last child (test T11a); the off-screen JSX drag chip that used to follow
 * it went with the HTML5 drag flow (owner, 2026-09-20).
 *
 * `closingIds` is a PROP, not read off usePhoneAPIs(): it is
 * usePanelClosing.ts's own set (appApis.ts/GoalFrontPage.tsx thread it down),
 * kept off PanelsAPI on purpose (useProvidePanels.ts's ProvidedPanels). Each
 * live panel's `exitDirection` is decided HERE, at render time, while it is
 * still present -- a panel leaves `live` either because it was closed
 * (closingIds has it: exits DOWN) or auto-collapsed to parked (usePanelManager.ts:
 * exits LEFT, the original behavior) -- see LivePanelSlot.tsx for why this must
 * be a prop rather than something read after the fact.
 *
 * ux-reveal-direction-and-fixed-column-animation: `enteringViaAnchorIds` is the
 * ENTER-side mirror of `closingIds` -- ids currently (re)joining `live` through
 * usePanelManager.ts's `revealMostRecentlyCollapsed` or usePanelClosing.ts's
 * `undoClose` (both "a closed/collapsed panel reappears" paths the owner asked
 * to enter from the anchor's side), threaded the same way `closingIds` is. A
 * brand-new panel (`useProvidePanels.create`) or a manual History-row
 * activation (`handleActivatePanel`) never appear in this set, so they keep
 * entering from the right unconditionally -- the plan record's own scope
 * decision. For an id that IS in the set, the actual direction is COMPUTED
 * (anchorPanel.ts's `resolveEnterDirection`) against `fixedColumnIds` -- the
 * row's real fixed-column order (GoalFrontPage's own array, the SAME one
 * FixedColumns.tsx renders) -- rather than hardcoded, so a live panel's own
 * row slot index is `fixedColumnIds.length + itsOwnIndexAmongLivePanels`.
 */

import * as React from 'react';
import { AnimatePresence } from 'motion/react';
import Box from '@mui/material/Box';
import { usePhoneAPIs } from '../../shared/phone/PhoneView.js';
import { ANCHOR_PANEL_ID, resolveEnterDirection } from './anchorPanel.js';
import { LivePanel } from './LivePanel.js';
import { GAP, LivePanelSlot } from './LivePanelSlot.js';

export function LivePanels({
  closingIds,
  enteringViaAnchorIds,
  fixedColumnIds,
}: {
  closingIds: ReadonlySet<string>;
  enteringViaAnchorIds: ReadonlySet<string>;
  fixedColumnIds: readonly string[];
}): React.ReactElement {
  const { panels, device } = usePhoneAPIs();
  const phoneWidth = device.size.width;
  const phoneHeight = device.size.height;
  const live = panels.panelList.filter((p) => p.live);
  const anchorIndex = fixedColumnIds.indexOf(ANCHOR_PANEL_ID);
  return (
    /* front-page-link-windows-and-adventure-collapse: each LIVE panel gets its
       own phone-view slot, in the unified array's own order
       (front-page-link-windows-primary-panel-unification). Owner design,
       2026-09-15: each live panel sits at `x: index * (phoneWidth + GAP)` inside
       one relatively-positioned "slot" Box sized to fit them, so adding or
       removing one never nudges the fixed items to its left.

       `zIndex: 1` against History's `zIndex: 2` puts a leaving panel BEHIND
       History as it slides out past this container's left edge (see
       HistoryColumn.tsx). A close's exit is DOWNWARD (owner, 2026-09-22 --
       LivePanelSlot.tsx) and never reaches History's footprint, so it is not
       load-bearing THERE; auto-collapse's exit is LEFT again (owner,
       2026-09-22, same day, second decision -- must stay visually distinct
       from a close), which does cross it, so this ordering is load-bearing
       once more for that path.

       This container is ALWAYS mounted, and hidden with `display: none` when it
       holds nothing, rather than being conditionally rendered. Two reasons, both
       load-bearing:
         - AnimatePresence must not unmount, or an exiting panel has nothing to
           animate inside.
         - `initial={false}` suppresses the enter animation for children present
           when AnimatePresence ITSELF first mounts. Mounting it together with
           the first panel therefore ate that panel's slide-in (measured:
           transform stayed `none` for the whole animation). Mounted from app
           start, it means what it should: don't animate a restored session, do
           animate every panel opened afterwards.
       `display: none` (not width 0) because an empty flex child still consumes
       one `gap` from the row, which would throw off both the spacing and the
       centering arithmetic; a `display: none` child generates no box at all. */
    <Box
      sx={{
        position: 'relative',
        zIndex: 1,
        flexShrink: 0,
        height: phoneHeight, // explicit, not inherited -- see FixedColumns.tsx's matching box for why
        display: live.length > 0 ? 'block' : 'none',
        width: Math.max(0, live.length * (phoneWidth + GAP) - GAP),
      }}
    >
      <AnimatePresence initial={false}>
        {live.map((p, panelIndex) => (
          <LivePanelSlot
            key={p.id}
            index={panelIndex}
            phoneWidth={phoneWidth}
            phoneHeight={phoneHeight}
            enterDirection={enteringViaAnchorIds.has(p.id) ? resolveEnterDirection(anchorIndex, fixedColumnIds.length + panelIndex) : 'right'}
            exitDirection={closingIds.has(p.id) ? 'down' : 'left'}
          >
            <LivePanel panel={p} />
          </LivePanelSlot>
        ))}
      </AnimatePresence>
    </Box>
  );
}
