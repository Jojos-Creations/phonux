/**
 * The panel capacity machinery: how many live collapsible panels the row may show at once (`capacity`,
 * derived from the measured fit and the stored setting), parking/revealing to stay at that capacity when a
 * panel opens or the capacity itself changes, revive-with-demotion (`handleActivatePanel`), and the row
 * gesture (`scrollRow`) that brings a hidden panel back into view from either side.
 *
 * Every hide is a park (`live: false`); nothing here ever removes a panel from the array (that is
 * `closePanel`'s own job, `usePanelClosing.ts`). Every park is pushed onto `collapseOrderRef`, so
 * `revealMostRecentlyCollapsed` (closing a live panel) keeps working regardless of which of this hook's own
 * paths did the parking.
 *
 * CALL-SITE ORDERING HAZARD: `containerWidth` is evaluated at the call site, so the host must call
 * useRowShell() before useAppApis (which reaches this through useProvidePanels), or reading it throws a
 * "used before initialization" error.
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { GAP } from './LivePanelSlot.js';
import { computeRowLayout } from '../../../../src/panel-layout.js';
import { effectiveMaxPanels } from '../settings/adventureSettings.js';
import {
  firstParkedAfter,
  lastParkedBefore,
  leftmostLiveIndex,
  farthestLiveCollapsibleId,
  promoteToLive,
  rightmostLiveIndex,
  sideOfLiveRange,
  type PanelWindow,
} from './panelWindow.js';

export interface UsePanelManagerResult {
  revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
  handleActivatePanel: (id: string) => void;
  /**
   * Removes `id` from the collapse-order stack if it is there. useProvidePanels.ts's `onAfterClose` calls it
   * for whatever id usePanelClosing just closed, live or parked, so a closed panel -- or one later restored
   * by `undoClose` -- never leaves a stale entry a later reveal could resurrect. A no-op for an id not on the
   * stack.
   */
  forgetCollapsed: (id: string) => void;
  /**
   * Given the panels array immediately AFTER a close (usePanelClosing's own `remaining`), reveals the MOST
   * recently parked panel still on the stack, provided the row has room for it. Does nothing if the stack
   * is empty, or if the row is already at capacity -- it never falls through to an older entry: this is
   * about the single MOST recently parked panel, not "whichever parked panel currently fits". Silently
   * discards (permanently) any stack entries that no longer point at a currently-parked panel in
   * `panelsAfterClose` -- a panel wiped by `clearAll()` never goes through `forgetCollapsed`, so this is the
   * backstop that keeps the stack from pointing at nothing.
   */
  revealMostRecentlyCollapsed: (panelsAfterClose: PanelWindow[]) => void;
  /**
   * Ids currently (re)entering `live` via `revealMostRecentlyCollapsed` (marks its own candidate) or
   * usePanelClosing.ts's `undoClose` restoring a LIVE panel (useProvidePanels.ts wires `markEnteringViaAnchor`
   * into that hook's optional `onRestoreLive` callback) -- consulted by LivePanels.tsx only when `id` has no
   * explicit `enterSideById` entry (see that field's own doc comment: an explicit gesture/capacity-rise side
   * always wins over this).
   */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Marks `id` as entering via the anchor formula -- see `enteringViaAnchorIds`'s own doc comment for who calls this and why. */
  markEnteringViaAnchor: (id: string) => void;
  /**
   * Drops any stale `enterSideById`/`exitRightIds` entry `id` picked up from an EARLIER park (ids cycle
   * live/parked repeatedly over a session) -- every path that revives a panel via the anchor formula must
   * call this FIRST, or a stale explicit side would win over the anchor formula (LivePanels.tsx's own
   * precedence) and the revived panel would slide in from the wrong side.
   */
  clearEnterSide: (id: string) => void;
  /**
   * The row gesture (wheel or arrow key, wired in `useRowScrollGesture.ts`): 'right' parks the LEFTMOST
   * live panel and promotes the first parked one after the current rightmost live panel; 'left' is the
   * mirror. One step per call. With nothing parked on that side, does nothing (no `setPanels` at all).
   */
  scrollRow: (direction: 'left' | 'right') => void;
  /**
   * Explicit enter sides set by `scrollRow` and the capacity-rise reconcile -- LivePanels.tsx's own
   * `enterSideById` prop. Wins over `enteringViaAnchorIds`/`anchoredEnter`: those two describe "enters via
   * the anchor formula" as a boolean, which cannot express "enters from the LEFT because a rightward
   * gesture revealed it", the case this exists for.
   */
  enterSideById: ReadonlyMap<string, 'left' | 'right'>;
  /**
   * Ids currently parking with an exit to the RIGHT (LivePanels.tsx's own `exitRightIds` prop) -- every
   * other park defaults to 'left' (LivePanels.tsx's `exitDirection` expression), so only the right-exiting
   * minority needs a mark at all. Marked via `flushSync` BEFORE the `setPanels` call that actually parks the
   * panel, the same `usePanelClosing.ts`-`closingIds` pattern: AnimatePresence takes an exiting child's
   * `exit` prop from its LAST render before it left `present`, and a plain `setState` here would batch with
   * that same commit and never let the panel render "still present, but marked" first.
   */
  exitRightIds: ReadonlySet<string>;
}

export function usePanelManager(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  storedMaxPanels: number | null,
  phoneWidth: number,
  containerWidth: number,
  /** How many always-rendered, non-webview columns the row currently has (`count(!collapsible)` over the one panel list, via useAppApis). */
  fixedColumnCount: number,
): UsePanelManagerResult {
  // `containerWidth === 0` means unmeasured (the first commit, and every jsdom test that never calls
  // measure()): null means no cap and no reconcile, never "zero panels fit".
  const fitCount =
    containerWidth === 0
      ? null
      : fixedColumnCount + computeRowLayout({ containerWidth, phoneWidth, gap: GAP, fixedItemCount: fixedColumnCount, liveCountNow: 0 }).maxLiveThatFit;
  const effectiveMax = effectiveMaxPanels(storedMaxPanels, fitCount);
  // The owner's floor of 1 keeps the panel just opened on screen even at the narrowest legal width (the
  // fit-below-2 rule already floors `effectiveMax` itself at 2, so this only ever bites when fixedColumnCount
  // alone reaches or exceeds effectiveMax).
  const capacity = effectiveMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, effectiveMax - fixedColumnCount);

  /**
   * The ids of currently-parked panels, in the order they were parked (oldest push first, most recent push
   * last -- the top/end is what "most recently parked" means). A ref, not `useState`: nothing renders off
   * this directly (it is read only inside imperative handlers and the capacity-reconcile effect below), so
   * there is no reason to pay for a re-render on every push/pop the way a `PanelWindow[]`-sized state array
   * would.
   */
  const collapseOrderRef = useRef<string[]>([]);

  const enteringViaAnchorRef = useRef<ReadonlySet<string>>(new Set());
  const markEnteringViaAnchor = (id: string): void => {
    enteringViaAnchorRef.current = new Set(enteringViaAnchorRef.current).add(id);
  };
  const forgetEnteringViaAnchor = (id: string): void => {
    if (!enteringViaAnchorRef.current.has(id)) return;
    const next = new Set(enteringViaAnchorRef.current);
    next.delete(id);
    enteringViaAnchorRef.current = next;
  };

  const enterSideRef = useRef<ReadonlyMap<string, 'left' | 'right'>>(new Map());
  const [exitRightIds, setExitRightIds] = useState<ReadonlySet<string>>(new Set());

  /** Every path that makes an id live must forget any stale exit-right mark from a PREVIOUS park of the same id -- ids cycle live/parked repeatedly over a session. Put here, once, so no reveal path can skip it. */
  const purgeExitRight = (id: string): void => {
    setExitRightIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  /** No flushSync needed: the mark only has to be in the commit that mounts the slot, like enteringViaAnchorRef's. */
  const setEnterSide = (id: string, side: 'left' | 'right'): void => {
    enterSideRef.current = new Map(enterSideRef.current).set(id, side);
    purgeExitRight(id);
  };
  /** Forces the NEXT mount of `id` back to the default (anchor formula / right), overriding a stale gesture mark from an earlier reveal of the same id. */
  const clearEnterSide = (id: string): void => {
    if (enterSideRef.current.has(id)) {
      const next = new Map(enterSideRef.current);
      next.delete(id);
      enterSideRef.current = next;
    }
    purgeExitRight(id);
  };
  /** flushSync BEFORE the parking setPanels -- see `UsePanelManagerResult.exitRightIds`'s own doc comment for why. */
  const markExitRight = (id: string): void => {
    flushSync(() => setExitRightIds((prev) => new Set(prev).add(id)));
  };

  const pushCollapsed = (ids: readonly string[]): void => {
    const parkedSet = new Set(ids);
    collapseOrderRef.current = [...collapseOrderRef.current.filter((x) => !parkedSet.has(x)), ...ids];
  };
  const forgetCollapsed = (id: string): void => {
    collapseOrderRef.current = collapseOrderRef.current.filter((x) => x !== id);
  };

  /**
   * Before a panel is shown -- a new one from PanelsAPI.create(), or usePanelClosing's undo restoring a LIVE
   * one -- parks whatever is necessary to stay at capacity, in the SAME update that reveals it. `apply` is
   * called once, purely (no side effect), against `panelsNow` to learn the id and array position of whatever
   * it adds/restores; the real commit re-runs it against the LATEST state instead of trusting this snapshot.
   */
  const revealPanelProactively = (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]): void => {
    const afterInsert = apply(panelsNow);
    const targetId = afterInsert.find((p) => !panelsNow.some((q) => q.id === p.id))?.id;
    if (targetId === undefined || capacity === Number.POSITIVE_INFINITY) {
      setPanels((prev) => apply(prev));
      return;
    }
    const targetIndex = afterInsert.findIndex((p) => p.id === targetId);
    const liveCollapsibleCountAfter = afterInsert.filter((p) => p.collapsible && p.live).length;
    const overCapacity = Math.max(0, liveCollapsibleCountAfter - capacity);
    if (overCapacity === 0) {
      setPanels((prev) => apply(prev));
      return;
    }
    const toPark: string[] = [];
    let scratch = afterInsert;
    for (let i = 0; i < overCapacity; i++) {
      const id = farthestLiveCollapsibleId(scratch, targetIndex, targetId);
      if (!id) break;
      toPark.push(id);
      scratch = scratch.map((p) => (p.id === id ? { ...p, live: false } : p));
    }
    if (toPark.length === 0) {
      setPanels((prev) => apply(prev));
      return;
    }
    const rightParks = toPark.filter((id) => sideOfLiveRange(afterInsert, id) === 'right');
    if (rightParks.length > 0) {
      flushSync(() =>
        setExitRightIds((prev) => {
          const next = new Set(prev);
          for (const id of rightParks) next.add(id);
          return next;
        }),
      );
    }
    pushCollapsed(toPark);
    const parkedSet = new Set(toPark);
    setPanels((current) => apply(current).map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)));
  };

  /**
   * Clicking ANY adventure-card row -- live or parked alike -- activates it (promoteToLive's own doc
   * comment has the full "make/keep it live, preserve array order" spec).
   */
  const handleActivatePanel = (id: string): void => {
    const target = panels.find((p) => p.id === id);
    if (!target || target.live) return;
    // A manual History-row activation enters from the right (or by its own `anchoredEnter`) -- forget any
    // stale anchor-entry OR gesture-enter-side mark this id picked up from an earlier reveal (ids cycle
    // live/parked repeatedly over a session), so a manual click never inherits the direction of its last one.
    forgetEnteringViaAnchor(id);
    clearEnterSide(id);
    const before = panels;
    const result = promoteToLive(panels, id, capacity);
    if (!result) return;
    forgetCollapsed(id);
    const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
    if (!demoted) {
      setPanels(result);
      return;
    }
    if (sideOfLiveRange(before, demoted.id) === 'right') markExitRight(demoted.id);
    pushCollapsed([demoted.id]);
    // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
    // Infinity guarantees that for this call only), then the panel it displaces is parked.
    setPanels((prev) => promoteToLive(prev, id, Number.POSITIVE_INFINITY) ?? prev);
    setPanels((current) => current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)));
  };

  /**
   * The row gesture: 'right' brings in whatever is parked past the current rightmost live panel, parking
   * the current leftmost live panel to make room; 'left' is the exact mirror. See `UsePanelManagerResult.
   * scrollRow`'s own doc comment for the full contract.
   */
  const scrollRow = (direction: 'left' | 'right'): void => {
    if (direction === 'right') {
      const rightmost = rightmostLiveIndex(panels);
      const reveal = firstParkedAfter(panels, rightmost);
      if (!reveal) return;
      const parkIndex = leftmostLiveIndex(panels);
      const parkId = parkIndex >= 0 ? panels[parkIndex]!.id : null;
      setEnterSide(reveal.id, 'right');
      // The leftmost live panel exits LEFT, the default: no exit-right mark needed.
      if (parkId) pushCollapsed([parkId]);
      forgetCollapsed(reveal.id);
      setPanels((prev) => prev.map((p) => (p.id === parkId ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p)));
    } else {
      const leftmost = leftmostLiveIndex(panels);
      const reveal = lastParkedBefore(panels, leftmost);
      if (!reveal) return;
      const parkIndex = rightmostLiveIndex(panels);
      const parkId = parkIndex >= 0 ? panels[parkIndex]!.id : null;
      setEnterSide(reveal.id, 'left');
      // The rightmost live panel exits RIGHT: mark it BEFORE the setPanels below, in its own commit.
      if (parkId) {
        markExitRight(parkId);
        pushCollapsed([parkId]);
      }
      forgetCollapsed(reveal.id);
      setPanels((prev) => prev.map((p) => (p.id === parkId ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p)));
    }
  };

  /**
   * Reconciles the live count against `capacity` whenever either changes (a resize, a phone-size change, or
   * the setting itself) -- an effect, not something a render can decide, since it must act on a measurement
   * that just changed rather than one this render was given. A DROP parks the excess strictly from the LEFT
   * (`leftmostLiveIndex`, repeatedly): a right-exit mark cannot be committed first from inside an effect
   * (flushSync cannot flush inside a passive effect), so every park here reads the default 'left'. A RISE
   * reveals from the top of `collapseOrderRef`, most-recently-parked first, entering from whichever side
   * `sideOfLiveRange` says it sits on.
   */
  useEffect(() => {
    if (capacity === Number.POSITIVE_INFINITY) return;
    const liveCollapsibleCount = panels.filter((p) => p.collapsible && p.live).length;
    if (liveCollapsibleCount > capacity) {
      const toPark: string[] = [];
      let scratch = panels;
      for (let i = liveCollapsibleCount - capacity; i > 0; i--) {
        const idx = leftmostLiveIndex(scratch);
        if (idx < 0) break;
        const id = scratch[idx]!.id;
        toPark.push(id);
        scratch = scratch.map((p, j) => (j === idx ? { ...p, live: false } : p));
      }
      if (toPark.length === 0) return;
      pushCollapsed(toPark);
      const parkedSet = new Set(toPark);
      setPanels((current) => current.map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)));
    } else if (liveCollapsibleCount < capacity && collapseOrderRef.current.length > 0) {
      const room = capacity - liveCollapsibleCount;
      const toReveal: string[] = [];
      let stack = collapseOrderRef.current;
      while (toReveal.length < room && stack.length > 0) {
        const id = stack[stack.length - 1]!;
        stack = stack.slice(0, -1);
        if (panels.some((p) => p.id === id && !p.live)) toReveal.push(id);
      }
      if (toReveal.length === 0) return;
      collapseOrderRef.current = stack;
      for (const id of toReveal) setEnterSide(id, sideOfLiveRange(panels, id));
      const revealSet = new Set(toReveal);
      setPanels((current) => current.map((p) => (revealSet.has(p.id) ? { ...p, live: true } : p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, panels]);

  /**
   * See `UsePanelManagerResult.revealMostRecentlyCollapsed`'s own doc comment for the full contract. Walks
   * the stack from its own top (most recent), discarding entries that no longer name a currently-parked
   * panel in `panelsAfterClose`, until it finds one that does or the stack is empty.
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
    const liveCollapsibleCount = panelsAfterClose.filter((p) => p.collapsible && p.live).length;
    if (capacity !== Number.POSITIVE_INFINITY && liveCollapsibleCount + 1 > capacity) return;
    const candidateId = stack[stack.length - 1]!;
    collapseOrderRef.current = stack.slice(0, -1);
    // A candidate can carry a stale gesture-enter-side or exit-right mark from an EARLIER park of the same
    // id (ids cycle live/parked repeatedly); clear both before marking it entering-via-anchor, or a stale
    // `enterSideById` entry would win over the anchor formula (LivePanels.tsx's own precedence) and this
    // reveal would slide in from the wrong side. Mirrors handleActivatePanel's own clear-then-mark order.
    clearEnterSide(candidateId);
    // One of the two "reappearance" paths that enter from the anchor's side -- mark it BEFORE the setPanels
    // call below; no flushSync, since the mark only has to be in the commit that mounts the slot.
    markEnteringViaAnchor(candidateId);
    setPanels((current) => promoteToLive(current, candidateId, Number.POSITIVE_INFINITY) ?? current);
  };

  return {
    revealPanelProactively,
    handleActivatePanel,
    forgetCollapsed,
    revealMostRecentlyCollapsed,
    enteringViaAnchorIds: enteringViaAnchorRef.current,
    markEnteringViaAnchor,
    clearEnterSide,
    scrollRow,
    enterSideById: enterSideRef.current,
    exitRightIds,
  };
}
