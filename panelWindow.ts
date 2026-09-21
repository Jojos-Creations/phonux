/**
 * front-page-link-windows-and-adventure-collapse /
 * front-page-link-windows-primary-panel-unification: the `PanelWindow` model
 * -- one browsing panel in the unified row (an "extra" guest-opened
 * window) -- and every pure state-transition function
 * that operates on a `PanelWindow[]` array. Extracted out of GoalFrontPage.tsx
 * (2026-09-15 thinning pass) verbatim, comments included: this was already a
 * self-contained model within that file (AdventurePanel.tsx already imports
 * `PanelWindow` as a type from it), so giving it its own module changes
 * nothing about behavior, only where the code lives.
 */

/**
 * front-page-link-windows-and-adventure-collapse: one browsing panel in the
 * unified row. Originally two separate things: the primary session's own
 * `directUrl`/`liveWebviewRef`/`liveWebContentsId`, and a list of
 * `ExtraWindow`s opened by a guest `<webview>`'s own new-window request.
 *
 * front-page-link-windows-primary-panel-unification (owner decision,
 * 2026-09-14: full unification, not a thin compatibility shim) folds BOTH
 * into ONE array of `PanelWindow` -- `kind: 'primary'` for the current
 * session's own starting page (since cut), `kind: 'extra'` for
 * everything opened from a new-window request after it (human-clicked or
 * AI-clicked alike -- see electron/main.ts's setWindowOpenHandler, one code
 * path for both) -- so the SAME overflow/collapse/dead-end mechanism
 * (autoCollapseOldest, promoteToLive)
 * applies to every panel a session has open, the primary included. The
 * owner live-tested a 5-panel session and confirmed by eye that the primary
 * panel looked just as stale/collapsible as anything already in the
 * adventure card, but never got swept in before this.
 *
 * front-page-link-windows-primary-panel-unification's OWNER-ADDED live
 * decision (2026-09-14, folded in mid-implementation): the adventure card
 * no longer shows only PARKED panels -- AdventurePanel.tsx now renders
 * every entry in this array, live or not. A panel is EITHER shown live
 * in the row (`live: true`) or parked in the adventure card only
 * (`live: false`) -- never both -- and is never removed from this array
 * just for being parked; only `closePanel` (owner, 2026-09-20: a view
 * dragged down or trashed from History closes COMPLETELY) ever drops an
 * entry. There is no staging any more: no `checked`, no `autoSwept`.
 */
export interface PanelWindow {
  id: string;
  /**
   * Always 'extra' now: everything opened via a new-window request or
   * History's "+". A 'primary' kind (the session's own starting page) used
   * to exist and was cut with the screenshot-open chain; the field stays
   * until the API layer drops it.
   */
  kind: 'extra';
  url: string;
  title?: string;
  webContentsId: number | null;
  /** The guest `<webview>` this panel's own new-window request came FROM -- electron/main.ts's `pageId`. `-1` for a panel that was not opened FROM another page (History's "+" makes these). */
  sourceWebContentsId: number;
  /** Mounted live in the row right now. `false` means parked in the adventure card only -- still fully present in this array, just not rendered as a `<webview>`. */
  live: boolean;
}

/** Appends a brand-new, live 'extra' panel for a just-intercepted new-window request, immutably. Always appended to the END (oldest-first array order) regardless of which panel it came from (`sourceWebContentsId`) -- "appended to the right of any currently-open ones" per this entry's own intent, not inserted next to its source. */
export function appendPanel(panels: PanelWindow[], info: { sourceWebContentsId: number; url: string }, id: string): PanelWindow[] {
  return [
    ...panels,
    { id, kind: 'extra', url: info.url, webContentsId: null, sourceWebContentsId: info.sourceWebContentsId, live: true },
  ];
}

/** `id`'s own WebContents id, once its 'dom-ready' fires. Unknown `id` (already closed/reset by the time 'dom-ready' fires) leaves `panels` unchanged. */
export function setPanelContentsId(panels: PanelWindow[], id: string, webContentsId: number): PanelWindow[] {
  if (!panels.some((p) => p.id === id)) return panels;
  return panels.map((p) => (p.id === id ? { ...p, webContentsId } : p));
}

/** `id`'s own page title, first-write-wins -- mirrors updateSessionPageTitle's own reasoning (never renamed by later in-page navigation). */
export function setPanelTitle(panels: PanelWindow[], id: string, title: string): PanelWindow[] {
  if (!panels.some((p) => p.id === id && !p.title)) return panels;
  return panels.map((p) => (p.id === id && !p.title ? { ...p, title } : p));
}

/**
 * "Auto collapse into adventure card" (owner setting, default on): park the
 * SINGLE OLDEST live panel, by array order (this is space management, not a
 * close: the panel stays in the array). `null` when nothing is live to park. `promoteToLive` below
 * reuses this exact same "oldest live, by array order" policy for its own
 * demotion, so there is one demotion rule in this file, not two that could
 * silently drift apart.
 */
export function autoCollapseOldest(panels: PanelWindow[]): PanelWindow[] | null {
  const oldest = panels.find((p) => p.live);
  if (!oldest) return null;
  return panels.map((p) => (p.id === oldest.id ? { ...p, live: false } : p));
}

/**
 * Clicking ANY adventure-card row (live or parked alike) activates it --
 * front-page-link-windows-primary-panel-unification's OWNER-ADDED
 * requirement (2026-09-14, folded in mid-implementation): the live row's
 * own rendering order must always follow the unified array's natural
 * order, so this NEVER moves the target panel's position (contrast the
 * pre-unification `reviveDeadEndEntry`, which re-appended a revived entry
 * at the row's newest/rightmost slot) -- it only ever flips `live` in
 * place, on the SAME array entry.
 *
 * `null` for an unknown `id` -- nothing to do. Also `null` when the target
 * is ALREADY live: clicking an already-live row in the (now
 * everything-shows) adventure list is a legitimate no-op ("keep it live"),
 * not an error, but there is nothing for the caller to apply.
 *
 * `wouldOverflow(liveCountAfter)` is the caller's own overflow prediction
 * (src/panel-layout.ts's predictWouldOverflow for 'screen-width' mode, or
 * adventureSettings.ts's countModeShouldCollapse for 'count' mode) --
 * `liveCountAfter` is how many panels would be live counting the one just
 * activated. When it returns true, this demotes exactly one OTHER live
 * panel back to parked: the OLDEST other live one, by array order -- the
 * SAME policy autoCollapseOldest already uses (this file's own documented
 * choice for the "which panel gets bumped" ambiguity the owner flagged when
 * specifying this requirement), keeping "exactly one window swaps for
 * another" true past the collapse threshold (this entry's own evidence
 * bullet). When it returns false, no demotion happens: there was room,
 * nothing needs to leave.
 */
export function promoteToLive(
  panels: PanelWindow[],
  id: string,
  wouldOverflow: (liveCountAfter: number) => boolean,
): PanelWindow[] | null {
  const target = panels.find((p) => p.id === id);
  if (!target || target.live) return null;
  const liveCountAfter = panels.filter((p) => p.live).length + 1;
  let next = panels.map((p) => (p.id === id ? { ...p, live: true } : p));
  if (wouldOverflow(liveCountAfter)) {
    const demote = next.find((p) => p.live && p.id !== id);
    if (demote) {
      next = next.map((p) => (p.id === demote.id ? { ...p, live: false } : p));
    }
  }
  return next;
}

/**
 * Closes one panel COMPLETELY (owner, 2026-09-20): it leaves the array, live or
 * parked, so it leaves the row and History together. Returns what a caller
 * needs to log it and to undo it -- the array without it, the panel itself and
 * the index it had -- or `null` for an unknown `id` (already closed, cleared):
 * nothing to do, not an error.
 */
export function closePanel(panels: PanelWindow[], id: string): { remaining: PanelWindow[]; closed: PanelWindow; index: number } | null {
  const index = panels.findIndex((p) => p.id === id);
  if (index < 0) return null;
  return { remaining: panels.filter((p) => p.id !== id), closed: panels[index]!, index };
}

/**
 * Reverses closePanel for one panel: puts `panel` back at `index` (clamped to
 * the current length, so a shorter array still takes it), `webContentsId` reset
 * because whatever it pointed at was unmounted when it closed. An id that is
 * already present leaves `panels` unchanged (a double undo never duplicates).
 * Whether it comes back live or parked is the caller's choice: it is whatever
 * `panel.live` says.
 */
export function restorePanel(panels: PanelWindow[], panel: PanelWindow, index: number): PanelWindow[] {
  if (panels.some((p) => p.id === panel.id)) return panels;
  const at = Math.max(0, Math.min(index, panels.length));
  return [...panels.slice(0, at), { ...panel, webContentsId: null }, ...panels.slice(at)];
}
