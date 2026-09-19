/**
 * front-page-scope-use-panel-manager-hook: the panel collapse/reveal
 * machinery extracted out of GoalFrontPage.tsx's render body -- proactive
 * pre-mount collapse (revealPanelProactively), revive-with-demotion
 * (handleActivatePanel), and the reactive ResizeObserver-overflow safety net,
 * unchanged in behavior from their inline form (see this entry's own
 * plans/records/front-page-scope-use-panel-manager-hook.md for the research
 * that produced this exact signature and the ordering hazard below).
 *
 * The raw ResizeObserver measurement effect that PRODUCES `rowOverflowing`/
 * `containerWidth` stays in GoalFrontPage (containerWidth also feeds that
 * file's own row-centering math, so duplicating the observer would be a
 * confirmed anti-pattern) -- this hook only owns the REACTIVE response to
 * `rowOverflowing` once it's already computed, passed in as a plain value.
 *
 * CALL-SITE ORDERING HAZARD: unlike the original inline effects (which only
 * *referenced* `rowRef`/`overflowContainerRef` inside effect callbacks that
 * run post-render, long after the whole render function has executed), this
 * hook is a real function CALL -- its arguments are evaluated immediately,
 * at the call site. It must be called AFTER `rowRef`, `overflowContainerRef`,
 * `rowOverflowing`, and `autoCollapseAdventure` are already declared in
 * GoalFrontPage, or those argument expressions throw a
 * "used before initialization" error instead of silently working the way
 * the pre-extraction code did.
 */
import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { countModeShouldCollapse, countModeTargetLiveWebviews, type MaxViewsSettings } from '../settings/adventureSettings.js';
import { computeBaseWidth, isRowOverflowing, predictWouldOverflow, shouldFireCollapse } from '../../../../src/panel-layout.js';
import { GAP } from './LivePanelSlot.js';
import { autoCollapseOldest, promoteToLive, type PanelWindow } from './panelWindow.js';

/** How long rowOverflowing must stay true before auto-collapse actually parks a panel -- gives the window-growth IPC round trip (bridge().reportPanelCount) time to resize the OS window and this renderer's own layout to catch up first, so a panel that just opened isn't collapsed before the window ever gets a chance to grow and fit it. See the effect's own doc comment for the live-caught bug this fixes. */
const AUTO_COLLAPSE_SETTLE_MS = 500;

export interface UsePanelManagerResult {
  revealPanelProactively: (
    panelsNow: PanelWindow[],
    incomingKind: 'primary' | 'extra',
    apply: (prev: PanelWindow[]) => PanelWindow[],
  ) => void;
  handleActivatePanel: (id: string) => void;
}

export function usePanelManager(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  maxViews: MaxViewsSettings,
  phoneWidth: number,
  capturePanels: (ids: string[]) => Promise<Map<string, string>>,
  rowOverflowing: boolean,
  autoCollapseAdventure: boolean,
  rowRef: RefObject<HTMLDivElement | null>,
  overflowContainerRef: RefObject<HTMLDivElement | null>,
  /** How many always-rendered, non-webview columns the row currently has (GoalFrontPage.tsx's own `fixedItemCount`) -- fed into `computeBaseWidth` so 'screen-width' mode's overflow math reflects the columns actually on screen instead of a stale guess. See `computeBaseWidth`'s own doc comment for the bug this replaced. */
  fixedColumnCount: number,
): UsePanelManagerResult {
  const baseWidth = computeBaseWidth({ fixedColumnCount, phoneWidth, gap: GAP });

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
   * mode can need more than one at once (the owner's own "collapse down to
   * M" spec, which can be a bigger drop than the +1 that triggered it).
   *
   * `incomingKind` matters ONLY for 'screen-width' mode's own extraCount:
   * baseWidth already budgets for the primary panel's own slot
   * unconditionally (see that constant's own doc comment), so revealing the
   * PRIMARY panel never adds to extraCount the way opening a new EXTRA
   * panel does -- getting this wrong would proactively (and needlessly)
   * collapse something else just because the primary panel came back live.
   * 'count' mode has no such asymmetry: every live webview, primary or
   * extra, counts the same toward its own total.
   *
   * `panelsNow` is passed explicitly (never read from the `panels` state
   * closure) so this stays correct when called from the onOpenNewWindow
   * bridge subscription below, which reads the LATEST panels via a ref to
   * avoid the classic stale-closure bug a `[]`-deps subscription effect
   * would otherwise have.
   */
  const collapseCountForNewPanel = (panelsNow: PanelWindow[], incomingKind: 'primary' | 'extra'): number => {
    const liveCountAfter = panelsNow.filter((p) => p.live).length + 1;
    if (maxViews.mode === 'count') {
      if (!countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount)) return 0;
      return Math.max(0, liveCountAfter - countModeTargetLiveWebviews(maxViews, fixedColumnCount));
    }
    const extraCountAfter = panelsNow.filter((p) => p.kind === 'extra' && p.live).length + (incomingKind === 'extra' ? 1 : 0);
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
      .filter((p) => p.live)
      .slice(0, count)
      .map((p) => p.id);

  /**
   * front-page-link-windows-primary-panel-unification, part 3 (owner-added,
   * 2026-09-14): before a NEW panel is actually shown -- a brand-new extra
   * window (a just-intercepted new-window request) or the primary panel's
   * own fresh reveal -- predicts whether showing it would overflow, and if
   * so collapses whatever's necessary FIRST (capturing a screenshot
   * placeholder for each, same precedent as every other collapse path in
   * this file), waits PROACTIVE_COLLAPSE_REVEAL_DELAY_MS, THEN reveals the
   * new panel -- rather than today's reactive design (append first, let a
   * ResizeObserver notice the overflow, collapse afterward), which left a
   * visible moment where the row overflowed/scrolled before settling down.
   * If nothing needs to collapse, `apply` runs immediately with no delay at
   * all -- the owner's own spec: no artificial delay for the common case.
   *
   * `panelsNow`/`incomingKind` -- see collapseCountForNewPanel's own doc
   * comment for why both are threaded through explicitly rather than read
   * from the `panels`/closure state.
   */
  const revealPanelProactively = (
    panelsNow: PanelWindow[],
    incomingKind: 'primary' | 'extra',
    apply: (prev: PanelWindow[]) => PanelWindow[],
  ) => {
    const needed = collapseCountForNewPanel(panelsNow, incomingKind);
    if (needed === 0) {
      setPanels((prev) => apply(prev));
      return;
    }
    const collapsedIds = collapseOldestIds(panelsNow, needed);
    void capturePanels(collapsedIds).then((screenshots) => {
      // ONE atomic update -- collapse the outgoing panels and reveal the new
      // one in the same commit (owner-caught, 2026-09-15).
      //
      // This used to be two updates separated by a
      // PROACTIVE_COLLAPSE_REVEAL_DELAY_MS timer, which is what produced the
      // reported "the second view autoshrinks and THEN shows the new phone
      // view": the collapse landed, 220ms of nothing, then the arrival. The
      // delay existed to hide a visible overflow/scroll flash between the two
      // commits -- but with both in a single commit there is no intermediate
      // state to hide, and AnimatePresence (see the panel list below) is what
      // keeps the outgoing panel on screen long enough to animate out, rather
      // than a timer holding back the incoming one.
      //
      // A functional update, merged by id, rather than replacing `panels`
      // outright with a snapshot derived from `panelsNow` -- the capture()
      // round trip above is async, so something else may well have changed
      // `panels` in the meantime (another new-window event, a user action);
      // touching only the specific ids this call decided to collapse keeps
      // this safe regardless of what else landed in between.
      const collapsedSet = new Set(collapsedIds);
      setPanels((current) =>
        apply(
          current.map((p) =>
            collapsedSet.has(p.id)
              ? { ...p, live: false, checked: false, autoSwept: false, screenshot: screenshots.get(p.id) ?? p.screenshot }
              : p,
          ),
        ),
      );
    });
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
    const wouldOverflow = (liveCountAfter: number): boolean => {
      if (maxViews.mode === 'count') return countModeShouldCollapse(liveCountAfter, maxViews, fixedColumnCount);
      const extraLiveCountAfter =
        panels.filter((p) => p.kind === 'extra' && p.live).length + (target.kind === 'extra' ? 1 : 0);
      return predictWouldOverflow({
        baseWidth,
        extraCount: extraLiveCountAfter,
        perPanel: phoneWidth + GAP,
        displayWidth: displayWidth(),
      });
    };
    const result = promoteToLive(panels, id, wouldOverflow);
    if (!result) return;
    const demoted = result.find((p) => !p.live && panels.find((prev) => prev.id === p.id)?.live);
    if (!demoted) {
      setPanels(result);
      return;
    }
    // A demotion is about to unmount `demoted`'s own live webview -- same
    // capture-before-unmount precedent as every other collapse path in this
    // file (handleDeadEndDrop, the reactive safety net, revealPanelProactively).
    // Applied in two steps so the CLICK still feels instant: `id` goes live
    // right away (no demotion yet -- `() => false` guarantees that for this
    // call only), and the actual demotion (with whatever screenshot the
    // capture produced) lands once that capture resolves or times out.
    setPanels((prev) => promoteToLive(prev, id, () => false) ?? prev);
    void capturePanels([demoted.id]).then((screenshots) => {
      const shot = screenshots.get(demoted.id);
      setPanels((current) =>
        current.map((p) =>
          p.id === demoted.id ? { ...p, live: false, checked: false, autoSwept: false, screenshot: shot ?? p.screenshot } : p,
        ),
      );
    });
  };

  // REACTIVE safety net -- part 3's own new proactive, pre-mount check
  // above is what normally prevents overflow from ever being visible at
  // all now, but this stays as a fallback for overflow that has nothing to
  // do with opening a new panel (e.g. the owner manually shrinking the OS
  // window itself). Deliberately gated to 'screen-width' mode only: 'count'
  // mode ignores window/screen width entirely by design (owner spec) --
  // its own collapsing happens only at open/activate time
  // (collapseCountForNewPanel/handleActivatePanel above), never off a raw
  // DOM overflow measurement; once collapsed down to its own target count,
  // 'count' mode wants the row to scroll horizontally if it still doesn't
  // fit, never to keep collapsing further.
  //
  // Parks the single oldest live panel at a time; removing one shrinks the
  // row, which re-fires the ResizeObserver above and, if still overflowing,
  // runs this again. Converges once it fits or there's nothing left to
  // park.
  //
  // Debounced by AUTO_COLLAPSE_SETTLE_MS rather than acting the instant
  // rowOverflowing flips true: the window-growth request below
  // (bridge().reportPanelCount) is an async IPC round trip to the main
  // process, an actual OS window resize, and then this renderer's own
  // layout catching up -- none of that is synchronous with the SAME
  // render that just appended a new panel. Acting immediately raced that
  // round trip and collapsed the panel that had JUST opened before the
  // window ever got a chance to grow and fit it, defeating the new-window
  // feature outright (caught live, 2026-09-14: the panel's own webview
  // never survived long enough to be observed). If the window actually
  // grows in time, a later effect run (rowOverflowing back to false)
  // cancels this pending timeout via cleanup -- no collapse happens at
  // all, which is correct: the row fit, there was nothing to alternate.
  //
  // `latchedAtMs` is stamped the moment THIS effect run schedules its
  // timeout, and `shouldFireCollapse` (src/panel-layout.ts) re-checks it
  // against `Date.now()` inside the timeout's own callback -- the real,
  // reachable go/no-go check for whether the settle window has actually
  // elapsed, rather than trusting setTimeout's delay alone.
  useEffect(() => {
    if (maxViews.mode !== 'screen-width') return;
    if (!rowOverflowing || !autoCollapseAdventure || !panels.some((p) => p.live)) return;
    const latchedAtMs = Date.now();
    const t = setTimeout(() => {
      if (!shouldFireCollapse(latchedAtMs, Date.now(), AUTO_COLLAPSE_SETTLE_MS)) return;
      // Re-measure the DOM directly rather than trusting `rowOverflowing`
      // itself here (live-caught, 2026-09-15: two panels collapsed for one
      // overflow). This effect depends on `panels`, so the FIRST collapse's
      // own setPanels re-triggers it immediately, with `rowOverflowing`
      // still the stale pre-collapse `true` -- its own ResizeObserver
      // hasn't had a chance to re-measure the now-narrower row yet, that's
      // async. That second run schedules a second collapse against a row
      // that, by the time THIS timeout actually fires, has already fit for
      // a while. A fresh isRowOverflowing() call is the real go/no-go here;
      // `rowOverflowing`/`shouldFireCollapse` above only gate SCHEDULING
      // the timeout cheaply, not the collapse decision itself.
      const row = rowRef.current;
      const container = overflowContainerRef.current;
      if (row && container && !isRowOverflowing(row.scrollWidth, container.clientWidth)) return;
      const oldestLive = panels.find((p) => p.live);
      if (!oldestLive) return;
      // Same screenshot-before-unmount capture as handleDeadEndDrop above
      // -- owner spec, 2026-09-14.
      void capturePanels([oldestLive.id]).then((screenshots) => {
        const result = autoCollapseOldest(panels);
        if (!result) return;
        setPanels(result.map((p) => (screenshots.has(p.id) ? { ...p, screenshot: screenshots.get(p.id) } : p)));
      });
    }, AUTO_COLLAPSE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [rowOverflowing, autoCollapseAdventure, panels, maxViews.mode]);

  return { revealPanelProactively, handleActivatePanel };
}
