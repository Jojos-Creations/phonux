/**
 * front-page-link-windows-and-adventure-collapse /
 * front-page-link-windows-primary-panel-unification: the `PanelWindow` model
 * -- one browsing panel in the unified row (primary session page or an
 * "extra" guest-opened window) -- and every pure state-transition function
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
 * session's own starting page (see setPrimaryUrl), `kind: 'extra'` for
 * everything opened from a new-window request after it (human-clicked or
 * AI-clicked alike -- see electron/main.ts's setWindowOpenHandler, one code
 * path for both) -- so the SAME overflow/collapse/dead-end mechanism
 * (autoCollapseOldest, computeDeadEndBatch/stageDeadEnd, promoteToLive)
 * applies to every panel a session has open, the primary included. The
 * owner live-tested a 5-panel session and confirmed by eye that the primary
 * panel looked just as stale/collapsible as anything already in the
 * adventure card, but never got swept in before this.
 *
 * front-page-link-windows-primary-panel-unification's OWNER-ADDED live
 * decision (2026-09-14, folded in mid-implementation): the adventure card
 * no longer shows only PARKED panels -- AdventurePanel.tsx now renders
 * every entry in this array, live or not, so `live`/`checked`/`autoSwept`
 * live directly on this type rather than a panel getting converted into a
 * separate `DeadEndEntry` shape once staged. A panel is EITHER shown live
 * in the row (`live: true`) or parked in the adventure card only
 * (`live: false`) -- never both -- and is never removed from this array
 * just for being parked; only `confirmDeadEndClose` ("Close N pages") ever
 * actually drops an entry.
 */
export interface PanelWindow {
  id: string;
  /**
   * 'primary' names the CURRENT session's own starting page -- see
   * setPrimaryUrl. Exactly zero or one 'primary' entry exists at a time
   * (reset to none on newSession/selectSession, same scoping the old
   * `directUrl` had). 'extra' is everything opened via a guest
   * `<webview>`'s own new-window request.
   */
  kind: 'primary' | 'extra';
  url: string;
  title?: string;
  webContentsId: number | null;
  /** The guest `<webview>` this panel's own new-window request came FROM -- electron/main.ts's `pageId`. `-1` for the primary panel, which was never opened FROM anything else. */
  sourceWebContentsId: number;
  /** Mounted live in the row right now. `false` means parked in the adventure card only -- still fully present in this array, just not rendered as a `<webview>`. */
  live: boolean;
  /** Marked for closing via the adventure card's own checkbox (confirmDeadEndClose's own "toClose" set) -- independent of `live` (a panel can be checked while still live, mid-decision, or while already parked). */
  checked: boolean;
  /** True for a panel pulled into a close-batch automatically because it sat between a DIRECTLY dragged panel and the row's own leading edge (see computeDeadEndBatch) -- AdventurePanel's own red-tone styling. Always false for anything that arrived by auto-collapse or a plain activate-click rather than a drag. */
  autoSwept: boolean;
}

/** Appends a brand-new, live 'extra' panel for a just-intercepted new-window request, immutably. Always appended to the END (oldest-first array order) regardless of which panel it came from (`sourceWebContentsId`) -- "appended to the right of any currently-open ones" per this entry's own intent, not inserted next to its source. */
export function appendPanel(panels: PanelWindow[], info: { sourceWebContentsId: number; url: string }, id: string): PanelWindow[] {
  return [
    ...panels,
    { id, kind: 'extra', url: info.url, webContentsId: null, sourceWebContentsId: info.sourceWebContentsId, live: true, checked: false, autoSwept: false },
  ];
}

/**
 * Unifies the primary session panel's own url (previously a separate
 * `directUrl` state field) into the panel array. `url` falsy removes the
 * primary entry entirely (mirrors the old `setDirectUrl(null)` -- nothing
 * real to show, the render below falls back to the mock/placeholder
 * branches). An existing primary entry's `url` is updated IN PLACE (never
 * re-created or reordered, so a follow-up submit that repoints an
 * already-live primary panel never disturbs its position, webContentsId,
 * live, checked, or autoSwept). A brand-new primary entry is PREPENDED
 * (index 0) -- in practice extra panels can only ever exist once the
 * primary is already live (every extra panel originates from a guest
 * `<webview>`'s own new-window request, which needs a webview already
 * open), so this only ever runs against an empty array; prepending is
 * simply the more defensively-correct choice regardless of that.
 */
export function setPrimaryUrl(panels: PanelWindow[], url: string | null): PanelWindow[] {
  if (!url) return panels.filter((p) => p.kind !== 'primary');
  const existing = panels.find((p) => p.kind === 'primary');
  if (existing) return panels.map((p) => (p.kind === 'primary' ? { ...p, url } : p));
  const primary: PanelWindow = {
    id: 'primary',
    kind: 'primary',
    url,
    webContentsId: null,
    sourceWebContentsId: -1,
    live: true,
    checked: false,
    autoSwept: false,
  };
  return [primary, ...panels];
}

/** `id`'s own WebContents id, once its 'dom-ready' fires -- works for the primary panel (`id === 'primary'`) or any extra panel alike. Unknown `id` (already closed/reset by the time 'dom-ready' fires) leaves `panels` unchanged. */
export function setPanelContentsId(panels: PanelWindow[], id: string, webContentsId: number): PanelWindow[] {
  if (!panels.some((p) => p.id === id)) return panels;
  return panels.map((p) => (p.id === id ? { ...p, webContentsId } : p));
}

/** `id`'s own page title, first-write-wins -- mirrors updateSessionPageTitle's own reasoning (never renamed by later in-page navigation). Works for the primary panel or any extra panel alike. */
export function setPanelTitle(panels: PanelWindow[], id: string, title: string): PanelWindow[] {
  if (!panels.some((p) => p.id === id && !p.title)) return panels;
  return panels.map((p) => (p.id === id && !p.title ? { ...p, title } : p));
}

/**
 * front-page-link-windows-and-adventure-collapse's dead-end feature
 * (Intent addendum, point 4): the dragged panel plus every LIVE panel
 * positioned before it. Only ever reachable by dragging an EXTRA panel's
 * own header (the primary panel has no drag handle of its own -- see this
 * entry's own evidence report), so this only ever considers `kind ===
 * 'extra'` panels that are currently live, in their own relative (array)
 * order -- exactly the set the row actually shows as draggable headers.
 * `null` for a `draggedId` no longer present/no longer live (a stale drag)
 * -- nothing to stage, not an error.
 */
export function computeDeadEndBatch(
  panels: PanelWindow[],
  draggedId: string,
): { staged: PanelWindow[]; autoSweptIds: Set<string> } | null {
  const liveExtras = panels.filter((p) => p.kind === 'extra' && p.live);
  const draggedIndex = liveExtras.findIndex((p) => p.id === draggedId);
  if (draggedIndex < 0) return null;
  const staged = liveExtras.slice(0, draggedIndex + 1);
  const autoSweptIds = new Set(staged.slice(0, -1).map((p) => p.id));
  return { staged, autoSweptIds };
}

/**
 * Applies a drop, immutably: every panel in the staged batch
 * (computeDeadEndBatch) is marked `live: false, checked: true` (plus
 * `autoSwept` per the batch), IN PLACE -- never removed from `panels` (see
 * PanelWindow's own doc comment for why parking is no longer a
 * remove-and-append across two separate arrays). `null` for a stale
 * `draggedId` (see computeDeadEndBatch) -- `panels` is left untouched.
 */
export function stageDeadEnd(panels: PanelWindow[], draggedId: string): PanelWindow[] | null {
  const batch = computeDeadEndBatch(panels, draggedId);
  if (!batch) return null;
  const { staged, autoSweptIds } = batch;
  const stagedIds = new Set(staged.map((p) => p.id));
  return panels.map((p) => (stagedIds.has(p.id) ? { ...p, live: false, checked: true, autoSwept: autoSweptIds.has(p.id) } : p));
}

/**
 * "Auto collapse into adventure card" (owner setting, default on): park the
 * SINGLE OLDEST live panel -- primary or extra alike, by array order (see
 * this entry's own evidence report for why the primary now participates,
 * where it never did before this entry) -- unchecked (this is space
 * management, not a dead end) and never `autoSwept` (reserved for an
 * ACTUAL drag). `null` when nothing is live to park. `promoteToLive` below
 * reuses this exact same "oldest live, by array order" policy for its own
 * demotion, so there is one demotion rule in this file, not two that could
 * silently drift apart.
 */
export function autoCollapseOldest(panels: PanelWindow[]): PanelWindow[] | null {
  const oldest = panels.find((p) => p.live);
  if (!oldest) return null;
  return panels.map((p) => (p.id === oldest.id ? { ...p, live: false, checked: false, autoSwept: false } : p));
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
  let next = panels.map((p) => (p.id === id ? { ...p, live: true, checked: false, autoSwept: false } : p));
  if (wouldOverflow(liveCountAfter)) {
    const demote = next.find((p) => p.live && p.id !== id);
    if (demote) {
      next = next.map((p) => (p.id === demote.id ? { ...p, live: false, checked: false, autoSwept: false } : p));
    }
  }
  return next;
}

/** Toggles one panel's checked state, immutably -- lets the owner uncheck an auto-swept-in entry before confirming (owner's own spec: "checkmarks... maybe with a red tone" implies these are reversible, not a fait accompli). Unknown `id` leaves `panels` unchanged. */
export function toggleDeadEndChecked(panels: PanelWindow[], id: string): PanelWindow[] {
  if (!panels.some((p) => p.id === id)) return panels;
  return panels.map((p) => (p.id === id ? { ...p, checked: !p.checked } : p));
}

/**
 * "Close {x} pages": splits the checked panels out (`toClose`) from the
 * ones left behind unchecked (`remaining`, which stay in `panels` exactly
 * as they were -- unchecking a panel before confirming means "don't close
 * this one," not "remove it from the list entirely"). Operates across
 * EVERY panel, live or parked -- closing a checked panel that happens to
 * still be live unmounts it too, same as closing a parked one discards it;
 * `remaining` is the caller's own next `panels` state either way.
 */
export function confirmDeadEndClose(panels: PanelWindow[]): { toClose: PanelWindow[]; remaining: PanelWindow[] } {
  return { toClose: panels.filter((p) => p.checked), remaining: panels.filter((p) => !p.checked) };
}

/**
 * Reverses confirmDeadEndClose: the just-closed batch goes back into
 * `panels`, appended at the end (position is not preserved through a
 * close/undo round trip -- an accepted trade-off for this rarely-used
 * path, see this entry's own evidence report). Always restored PARKED
 * (`live: false`, `webContentsId: null`) regardless of whether the closed
 * panel happened to be live at the moment it was closed -- its real
 * `<webview>` was actually unmounted the instant it left `panels`, so
 * `webContentsId` is stale either way; the owner clicking it again
 * (promoteToLive) is what remounts it fresh, exactly like any other
 * revive.
 */
export function undoDeadEndClose(panels: PanelWindow[], closedBatch: PanelWindow[]): PanelWindow[] {
  return [...panels, ...closedBatch.map((p) => ({ ...p, live: false, webContentsId: null }))];
}
