/**
 * The panel collapse/reveal machinery: proactive pre-mount collapse (revealPanelProactively),
 * revive-with-demotion (handleActivatePanel), and the reactive ResizeObserver-overflow safety net.
 *
 * The raw ResizeObserver measurement effect that PRODUCES `rowOverflowing`/`containerWidth` lives in
 * row/useRowShell.ts (containerWidth also feeds that file's own row-centering math, so duplicating the
 * observer would be a confirmed anti-pattern) -- this hook only owns the REACTIVE response to
 * `rowOverflowing` once it's already computed, passed in as a plain value.
 *
 * CALL-SITE ORDERING HAZARD: this hook is a real function CALL -- its arguments are evaluated immediately,
 * at the call site. It must be called AFTER `rowRef`, `overflowContainerRef`, `rowOverflowing`, and
 * `autoCollapseAdventure` are already declared (the host calls useRowShell() before useAppApis, which calls
 * this), or those argument expressions throw a "used before initialization" error.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { countModeShouldCollapse, countModeTargetLiveWebviews, type MaxViewsSettings } from '../settings/adventureSettings.js';
import { computeBaseWidth, isRowOverflowing, predictWouldOverflow, shouldFireCollapse } from '../../../../src/panel-layout.js';
import { GAP } from './LivePanelSlot.js';
import { autoCollapseOldest, promoteToLive, type PanelWindow } from './panelWindow.js';

/** How long rowOverflowing must stay true before auto-collapse actually parks a panel -- gives the window-growth IPC round trip (bridge().reportPanelCount) time to resize the OS window and this renderer's own layout to catch up first, so a panel that just opened isn't collapsed before the window ever gets a chance to grow and fit it. */
const AUTO_COLLAPSE_SETTLE_MS = 500;

export interface UsePanelManagerResult {
  revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
  handleActivatePanel: (id: string) => void;
  /**
   * Removes `id` from the collapse-order stack if it is there -- called whenever a panel leaves the
   * collapsed state through a path that is NOT `revealMostRecentlyCollapsed` itself (this hook's own
   * `handleActivatePanel` calls it inline; usePanelClosing.ts's `close()` calls it for whatever id it just
   * closed, live or parked, so a panel closed while parked -- or later restored by `undoClose` -- never
   * leaves a stale entry that could resurrect it outside this feature's scope). A no-op for an id not on
   * the stack.
   */
  forgetCollapsed: (id: string) => void;
  /**
   * Given the panels array immediately AFTER a close (usePanelClosing's own `remaining`, not this hook's
   * `panels` argument -- that is still the pre-close snapshot), reveals the MOST recently auto-collapsed
   * panel still on the stack, provided doing so would not immediately overflow again (mirrors
   * `handleActivatePanel`'s own overflow check, just asked against `panelsAfterClose` instead of this hook's
   * `panels` closure). Does nothing if the stack is empty, or if revealing the top entry would overflow --
   * it never falls through to an older entry: this feature is about the single MOST recently collapsed
   * panel, not "whichever collapsed panel currently fits". Silently discards (permanently) any stack
   * entries that no longer point at a currently-collapsed panel in `panelsAfterClose` -- a panel closed
   * outright while parked (a History trash click) or wiped by `clearAll()` never goes through
   * `forgetCollapsed`'s own explicit call sites, so this is the backstop that keeps the stack from pointing
   * at nothing.
   */
  revealMostRecentlyCollapsed: (panelsAfterClose: PanelWindow[]) => void;
  /**
   * Ids currently (re)entering `live` via `revealMostRecentlyCollapsed` (below, marks its own candidate) or
   * usePanelClosing.ts's `undoClose` restoring a LIVE panel (useProvidePanels.ts wires
   * `markEnteringViaAnchor` into that hook's optional `onRestoreLive` callback) -- the ENTER-side mirror of
   * usePanelClosing's own `closingIds`. LivePanels.tsx reads it to decide each entering LivePanelSlot's
   * `enterDirection` (anchorPanel.ts's `resolveEnterDirection` for a member, 'right' unconditionally
   * otherwise) -- see that file's own doc comment for the full membership contract, including why a
   * brand-new panel or a manual activation are deliberately never marked.
   */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Marks `id` as entering via the anchor formula -- see `enteringViaAnchorIds`'s own doc comment for who calls this and why. */
  markEnteringViaAnchor: (id: string) => void;
}

export function usePanelManager(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  maxViews: MaxViewsSettings,
  phoneWidth: number,
  rowOverflowing: boolean,
  autoCollapseAdventure: boolean,
  rowRef: RefObject<HTMLDivElement | null>,
  overflowContainerRef: RefObject<HTMLDivElement | null>,
  /** How many always-rendered, non-webview columns the row currently has (`count(!collapsible)` over the one panel list, via useAppApis) -- fed into `computeBaseWidth` so 'screen-width' mode's overflow math reflects the columns actually on screen instead of a stale guess. */
  fixedColumnCount: number,
): UsePanelManagerResult {
  const baseWidth = computeBaseWidth({ fixedColumnCount, phoneWidth, gap: GAP });

  /**
   * The ids of currently-collapsed panels, in the order they were auto-collapsed (oldest push first, most
   * recent push last -- the top/end is what "most recently collapsed" means). A ref, not `useState`:
   * nothing renders off this directly (it is read only inside imperative handlers --
   * `handleActivatePanel`, and `revealMostRecentlyCollapsed` called from usePanelClosing's `close()`), so
   * there is no reason to pay for a re-render on every push/pop the way a `PanelWindow[]`-sized state array
   * would. Kept alongside `panels` rather than as a new field on every `PanelWindow`: this is a transient
   * ordering concern for THIS hook's own reveal logic, never read by `collapsible`/`listed`/`locked`'s own
   * behavior sites, so it has no business on the record itself.
   *
   * Scope: pushed ONLY from the two existing auto-collapse paths below (`collapseOldestIds` inside
   * `revealPanelProactively`, and `autoCollapseOldest` in the reactive safety-net effect) -- never from
   * `promoteToLive`'s own demotion side effect inside `handleActivatePanel` (bumping one panel out to make
   * room for another a user just manually activated). That demotion is a real park too, but it is
   * triggered by a manual activate, not a bare overflow reaction, so it is deliberately excluded here.
   */
  const collapseOrderRef = useRef<string[]>([]);

  /**
   * The ids currently marked "entering via anchor" -- see `UsePanelManagerResult.enteringViaAnchorIds`'s
   * own doc comment for the full contract. A ref, not `useState`, for the same reason `collapseOrderRef`
   * above is one: nothing renders off this directly, only imperative handlers read/write it, and the
   * mutating handler (`revealMostRecentlyCollapsed` below, or `undoClose` via `markEnteringViaAnchor`)
   * always calls `setPanels` synchronously in the SAME handler, so the state change that actually triggers
   * the re-render both this hook and LivePanels.tsx need already exists -- this ref only needs to be
   * correct BY the time that re-render reads it, which a synchronous mutation before/alongside the
   * `setPanels` call already guarantees (no flushSync needed here, unlike `closingIds`'s own EXIT-side
   * concern: that one needs the marking and the removal to land as separate commits; entering only needs
   * them to land in the SAME one, which they already do). Reassigned (never mutated by reference) on every
   * add/delete so a caller that captured an earlier `.current` never sees a later mutation "underneath" it.
   */
  const enteringViaAnchorRef = useRef<ReadonlySet<string>>(new Set());

  const markEnteringViaAnchor = (id: string): void => {
    enteringViaAnchorRef.current = new Set(enteringViaAnchorRef.current).add(id);
  };

  /** The inverse of `markEnteringViaAnchor`: forces the NEXT mount of `id` back to the row's default 'right', overriding any stale mark left by an earlier reveal/undo of the same id (ids cycle live/parked/live repeatedly over a session -- see `handleActivatePanel`'s own call site below). */
  const forgetEnteringViaAnchor = (id: string): void => {
    if (!enteringViaAnchorRef.current.has(id)) return;
    const next = new Set(enteringViaAnchorRef.current);
    next.delete(id);
    enteringViaAnchorRef.current = next;
  };

  /**
   * Same overflow question `handleActivatePanel`'s own inline `wouldOverflow` asks (would one more live
   * panel, on top of whatever's in `panelsNow`, overflow?), just parameterized on an explicit array rather
   * than this hook's own `panels` closure -- `revealMostRecentlyCollapsed` below needs to ask this against
   * the array immediately AFTER a close (usePanelClosing's own `remaining`), which `panels` does not yet
   * reflect (still this render's pre-close snapshot). Left as its own small function, rather than
   * refactoring `handleActivatePanel` to share it, so the already-tested code path there stays untouched.
   */
  const wouldOneMoreLiveOverflow = (panelsNow: PanelWindow[]): boolean => {
    const liveCountAfter = panelsNow.filter((p) => p.collapsible && p.live).length + 1;
    if (maxViews.mode === 'count') return countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount);
    return predictWouldOverflow({
      baseWidth,
      extraCount: liveCountAfter,
      perPanel: phoneWidth + GAP,
      displayWidth: displayWidth(),
    });
  };

  /**
   * The renderer-side equivalent of electron/main.ts's own
   * `display.workAreaSize.width` -- `window.screen.availWidth` is a
   * standard, SYNCHRONOUS web API (no IPC round trip needed, which matters
   * here: this feeds a PROACTIVE, pre-mount prediction that must resolve
   * before the new panel is ever shown, not after an async round trip).
   * Close enough to the real work area for a prediction; the real resize
   * (electron/main.ts's 'window:report-panel-count' handler) still always
   * uses the real Electron value.
   */
  const displayWidth = (): number => (typeof window !== 'undefined' ? window.screen.availWidth : Number.POSITIVE_INFINITY);

  /**
   * How many EXISTING live panels must collapse to make room for one MORE
   * about to be shown -- 'screen-width' mode only ever needs at most one
   * (every panel is the same width, and predictWouldOverflow already
   * accounts for the window growing to absorb a few panels first); 'count'
   * mode can need more than one at once (a "collapse down to M" policy,
   * which can be a bigger drop than the +1 that triggered it).
   *
   * Both modes count every live panel the same: the incoming one adds one.
   *
   * `panelsNow` is passed explicitly (never read from the `panels` state
   * closure) so this stays correct when called from the onOpenNewWindow
   * bridge subscription below, which reads the LATEST panels via a ref to
   * avoid the classic stale-closure bug a `[]`-deps subscription effect
   * would otherwise have.
   */
  const collapseCountForNewPanel = (panelsNow: PanelWindow[]): number => {
    const liveCountAfter = panelsNow.filter((p) => p.collapsible && p.live).length + 1;
    if (maxViews.mode === 'count') {
      if (!countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount)) return 0;
      return Math.max(0, liveCountAfter - countModeTargetLiveWebviews(maxViews, fixedColumnCount));
    }
    const extraCountAfter = panelsNow.filter((p) => p.collapsible && p.live).length + 1;
    const overflow = predictWouldOverflow({
      baseWidth,
      extraCount: extraCountAfter,
      perPanel: phoneWidth + GAP,
      displayWidth: displayWidth(),
    });
    return overflow ? 1 : 0;
  };

  /**
   * The ids of the `count` oldest LIVE panels in `start`, by array order --
   * collapsing one never changes the relative order of the rest, so this is
   * simply the first `count` live entries, no need to actually simulate the
   * collapse loop step by step.
   */
  const collapseOldestIds = (start: PanelWindow[], count: number): string[] =>
    start
      .filter((p) => p.collapsible && p.live)
      .slice(0, count)
      .map((p) => p.id);

  /**
   * Before a NEW panel is actually shown -- a brand-new extra window (a just-intercepted new-window
   * request) -- predicts whether showing it would overflow, and if so collapses whatever's necessary
   * FIRST, in the same update that reveals the new panel. A purely reactive approach (append first, let a
   * ResizeObserver notice the overflow, collapse afterward) leaves a visible moment where the row
   * overflows/scrolls before settling down. If nothing needs to collapse, `apply` runs immediately: no
   * artificial delay for the common case.
   *
   * `panelsNow` -- see collapseCountForNewPanel's own doc comment for why it
   * is threaded through explicitly rather than read from the `panels`/closure
   * state.
   */
  const revealPanelProactively = (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => {
    const needed = collapseCountForNewPanel(panelsNow);
    if (needed === 0) {
      setPanels((prev) => apply(prev));
      return;
    }
    const idsToCollapse = collapseOldestIds(panelsNow, needed);
    const collapsedSet = new Set(idsToCollapse);
    // Pushed in `idsToCollapse`'s own oldest-first order, so when `needed` collapses more than one at once,
    // the LAST of this batch (the youngest of the ones just parked) ends up on top -- the most recent to
    // leave the live row, even within a single atomic collapse event.
    collapseOrderRef.current = [...collapseOrderRef.current, ...idsToCollapse];
    // ONE atomic update -- collapse the outgoing panels and reveal the new one in the same commit (a
    // two-commit, timer-separated version of this produced a visible stall between them; see the record).
    // AnimatePresence (see the panel list below) is what keeps the outgoing panel on screen long enough to
    // animate out, not a timer holding back the incoming one.
    //
    // A functional update, merged by id, rather than replacing `panels`
    // outright with a snapshot derived from `panelsNow` -- touching only the
    // specific ids this call decided to collapse keeps this safe regardless
    // of what else changed `panels` in the meantime.
    setPanels((current) =>
      apply(current.map((p) => (collapsedSet.has(p.id) ? { ...p, live: false } : p))),
    );
  };

  /**
   * Clicking ANY adventure-card row -- live or parked alike -- activates it
   * (promoteToLive's own doc comment has the full "make/keep it live,
   * preserve array order" spec). The overflow prediction fed to
   * promoteToLive is the SAME mode-aware one collapseCountForNewPanel uses,
   * just asked as a plain yes/no for one additional live panel rather than
   * "how many should collapse" -- a revive only ever needs at most one
   * demotion (see promoteToLive's own doc comment for why).
   */
  const handleActivatePanel = (id: string) => {
    const target = panels.find((p) => p.id === id);
    if (!target || target.live) return;
    // A manual History-row activation keeps entering from the right unconditionally -- forget any stale
    // anchor-entry mark this id picked up from an earlier reveal/undo (ids cycle live/parked repeatedly
    // over a session), so a manual click can never inherit the wrong direction from what happened to it
    // last time.
    forgetEnteringViaAnchor(id);
    const wouldOverflow = (liveCountAfter: number): boolean => {
      if (maxViews.mode === 'count') return countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount);
      const extraLiveCountAfter =
        panels.filter((p) => p.collapsible && p.live).length + 1;
      return predictWouldOverflow({
        baseWidth,
        extraCount: extraLiveCountAfter,
        perPanel: phoneWidth + GAP,
        displayWidth: displayWidth(),
      });
    };
    const result = promoteToLive(panels, id, wouldOverflow);
    if (!result) return;
    // `id` just left the collapsed state (manually, via a History row click) -- forget it so a later
    // reveal-on-close can never target a panel that is already live.
    collapseOrderRef.current = collapseOrderRef.current.filter((x) => x !== id);
    const demoted = result.find((p) => !p.live && panels.find((prev) => prev.id === p.id)?.live);
    if (!demoted) {
      setPanels(result);
      return;
    }
    // Applied in two functional updates, in this order: `id` goes live first
    // (no demotion yet -- `() => false` guarantees that for this call only),
    // then the panel it displaces is parked.
    setPanels((prev) => promoteToLive(prev, id, () => false) ?? prev);
    setPanels((current) =>
      current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)),
    );
  };

  // REACTIVE safety net -- the proactive, pre-mount check above is what normally prevents overflow from
  // ever being visible at all, but this stays as a fallback for overflow that has nothing to do with
  // opening a new panel (e.g. shrinking the OS window itself). Deliberately gated to 'screen-width' mode
  // only: 'count' mode ignores window/screen width entirely by design -- its own collapsing happens only
  // at open/activate time (collapseCountForNewPanel/handleActivatePanel above), never off a raw DOM
  // overflow measurement; once collapsed down to its own target count, 'count' mode wants the row to
  // scroll horizontally if it still doesn't fit, never to keep collapsing further.
  //
  // Parks the single oldest live panel at a time; removing one shrinks the
  // row, which re-fires the ResizeObserver above and, if still overflowing,
  // runs this again. Converges once it fits or there's nothing left to
  // park.
  //
  // Debounced by AUTO_COLLAPSE_SETTLE_MS rather than acting the instant rowOverflowing flips true: the
  // window-growth request below (bridge().reportPanelCount) is an async IPC round trip to the main
  // process, an actual OS window resize, and then this renderer's own layout catching up -- none of that
  // is synchronous with the SAME render that just appended a new panel. Acting immediately races that
  // round trip and can collapse the panel that just opened before the window ever gets a chance to grow
  // and fit it (see the record for the live-caught symptom this fixes). If the window actually grows in
  // time, a later effect run (rowOverflowing back to false) cancels this pending timeout via cleanup -- no
  // collapse happens at all, which is correct: the row fit, there was nothing to alternate.
  //
  // `latchedAtMs` is stamped the moment THIS effect run schedules its
  // timeout, and `shouldFireCollapse` (src/panel-layout.ts) re-checks it
  // against `Date.now()` inside the timeout's own callback -- the real,
  // reachable go/no-go check for whether the settle window has actually
  // elapsed, rather than trusting setTimeout's delay alone.
  useEffect(() => {
    if (maxViews.mode !== 'screen-width') return;
    if (!rowOverflowing || !autoCollapseAdventure || !panels.some((p) => p.collapsible && p.live)) return;
    const latchedAtMs = Date.now();
    const t = setTimeout(() => {
      if (!shouldFireCollapse(latchedAtMs, Date.now(), AUTO_COLLAPSE_SETTLE_MS)) return;
      // Re-measure the DOM directly rather than trusting `rowOverflowing` here: this effect depends on
      // `panels`, so the FIRST collapse's own setPanels re-triggers it immediately, with `rowOverflowing`
      // still the stale pre-collapse `true` before its own ResizeObserver gets a chance to re-measure the
      // now-narrower row (see the record for the double-collapse this caused). A fresh isRowOverflowing()
      // call is the real go/no-go here; `rowOverflowing`/`shouldFireCollapse` above only gate SCHEDULING
      // the timeout cheaply, not the collapse decision itself.
      const row = rowRef.current;
      const container = overflowContainerRef.current;
      if (row && container && !isRowOverflowing(row.scrollWidth, container.clientWidth)) return;
      // Captured BEFORE autoCollapseOldest runs, but it selects the exact same "first live by array order"
      // entry that function's own doc comment names -- see this file's own collapseOrderRef doc comment for
      // why this is a push site.
      const collapsingId = panels.find((p) => p.collapsible && p.live)?.id;
      const result = autoCollapseOldest(panels);
      if (!result) return;
      setPanels(result);
      if (collapsingId) collapseOrderRef.current = [...collapseOrderRef.current, collapsingId];
    }, AUTO_COLLAPSE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [rowOverflowing, autoCollapseAdventure, panels, maxViews.mode]);

  /** See this hook's own `UsePanelManagerResult.forgetCollapsed` doc comment for the contract; implementation is a plain idempotent filter. */
  const forgetCollapsed = (id: string): void => {
    collapseOrderRef.current = collapseOrderRef.current.filter((x) => x !== id);
  };

  /**
   * See this hook's own `UsePanelManagerResult.revealMostRecentlyCollapsed` doc comment for the full
   * contract. Walks the stack from its own top (most recent), discarding entries that no longer name a
   * currently-collapsed panel in `panelsAfterClose`, until it finds one that does or the stack is empty;
   * that first valid entry is the only one ever considered for THIS call (an older entry underneath it is
   * left exactly where it is, for a later close to consider).
   */
  const revealMostRecentlyCollapsed = (panelsAfterClose: PanelWindow[]): void => {
    let stack = collapseOrderRef.current;
    while (stack.length > 0) {
      const candidateId = stack[stack.length - 1]!;
      const candidate = panelsAfterClose.find((p) => p.id === candidateId);
      if (candidate && !candidate.live) break;
      stack = stack.slice(0, -1);
    }
    collapseOrderRef.current = stack;
    if (stack.length === 0) return;
    if (wouldOneMoreLiveOverflow(panelsAfterClose)) return;
    const candidateId = stack[stack.length - 1]!;
    collapseOrderRef.current = stack.slice(0, -1);
    // This IS one of the two "reappearance" paths that enter from the anchor's side (History) -- mark it
    // BEFORE the setPanels call below, so it is already true by the render that promotes this id back to
    // live (see enteringViaAnchorRef's own doc comment for why no flushSync is needed here).
    markEnteringViaAnchor(candidateId);
    // A functional update against whatever `current` is at flush time (never `panelsAfterClose` directly --
    // this hook's own header names usePanelManager as the array's one owner that "merges by id across
    // async writers"), the SAME idiom `handleActivatePanel`'s own no-demotion step uses: `promoteToLive`
    // returning `null` (the candidate is somehow already live, or gone) is a safe, silent no-op.
    setPanels((current) => promoteToLive(current, candidateId, () => false) ?? current);
  };

  return {
    revealPanelProactively,
    handleActivatePanel,
    forgetCollapsed,
    revealMostRecentlyCollapsed,
    enteringViaAnchorIds: enteringViaAnchorRef.current,
    markEnteringViaAnchor,
  };
}
