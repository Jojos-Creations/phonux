/**
 * The panel capacity machinery: how many live collapsible panels the row shows at once (`capacity`),
 * parking/revealing to stay at it, revive-with-demotion (`handleActivatePanel`), and the row gesture
 * (`scrollRow`) that brings a hidden panel back from either side. Every hide is a park (`live: false`,
 * never a removal) pushed onto `collapseOrderRef`, so `revealMostRecentlyCollapsed` keeps working
 * regardless of which path did the parking, except a park that is held: that one stays parked until a person
 * shows it (`holdPanel`, `heldIds`).
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { fewestParksThatSettle, isParkLive, rowPricing, settleKeeping, type RowEnv } from './rowSettle.js';
import { placePanel, reportNotes } from '../panelPlacement.js';
import { applyPinChange, landPanel, pinHalf, withoutDeferral, type PinApplied, type PinChange, type PinEnv } from '../panelPin.js';
import { resetEntries, type ResetEnv } from '../panelReset.js';
import type { AddPlacement, PanelSettingsResolution } from '../panelSettings.js';
import { isPresent } from '../panelRowEntry.js';
import { FIXED, effective, holdUnlistedNote } from '../panelSettings.js';
import type { SettingNote, WorkspaceTuning } from '../panelSettings.js';
import { DROP_TIE_BREAK, RETURN_TIE_BREAK, ROW_GAP } from '../rowConstants.js';
import {
  firstParkedAfter,
  lastParkedBefore,
  leastRecentlyTouchedId,
  leftmostLiveIndex,
  movePanelBy,
  parkLevers,
  parksForRoom,
  promoteToLive,
  recordOverride,
  rightmostLiveIndex,
  setSlots,
  sideOfLiveRange,
  type PanelWindow,
} from '../panelWindow.js';

export interface UsePanelManagerResult {
  /** Marks `id` as touched now: the panel the next park for room spares longest. A no-op for an id the row does not hold. */
  touchPanel: (id: string) => void;
  revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
  /**
   * Shows panel `id` the way a click on it does, landing it by `pin` when given. `from` is the row the landing is planned
   * against, this render's list when omitted. `placeAs` lands it there instead of by its `placeOnShow`.
   */
  handleActivatePanel: (id: string, pin?: PinChange, from?: PanelWindow[], placeAs?: AddPlacement | 'in-place') => void;
  /** Removes `id` from the collapse-order stack, so a closed panel (or one `undoClose` restores) leaves no stale entry for a later reveal. */
  forgetCollapsed: (id: string) => void;
  /**
   * Given the panels immediately AFTER a close, reveals the next parked panel that fits beside the live ones, in
   * `returnPriority` and tie-break order; one that does not fit stays on the stack. Also drops stack entries that no
   * longer point at a parked panel, which backstops `clearAll()` (it wipes without `forgetCollapsed`).
   */
  revealMostRecentlyCollapsed: (panelsAfterClose: PanelWindow[]) => void;
  /** Ids (re)entering `live` by a reveal or an `undoClose` of a live panel; PanelRow reads it only when `id` has no `enterSideById` entry. */
  enteringViaAnchorIds: ReadonlySet<string>;
  /** Marks `id` as entering via the anchor formula. */
  markEnteringViaAnchor: (id: string) => void;
  /** Marks `id` to enter from `side`, which wins over the anchor formula: a placed panel's side is a fact of the row it landed in, not of its anchor. */
  markEnterSide: (id: string, side: 'left' | 'right') => void;
  /** Drops a stale `enterSideById`/`exitRightIds` entry from an earlier park of `id`; call it FIRST on every anchor-formula revive, or the stale side wins. */
  clearEnterSide: (id: string) => void;
  /**
   * `row` with `id` landed as a path that makes it live lands it: the pin change it waits with, or `pin` when given,
   * applied through `applyPinChange` with `placeAs` as the path's own placement, else `placeAs` alone. A change that no
   * longer applies is dropped with a note. `pinned` is true when a change was applied.
   */
  landPanel: (row: readonly PanelWindow[], id: string, placeAs: AddPlacement | 'in-place', pin?: PinChange) => { row: PanelWindow[]; notes: SettingNote[]; pinned: boolean };
  /** What applying `change` to panel `id` would answer, from this render's list, changing nothing. */
  previewPin: (id: string, change: PinChange) => PinApplied;
  /** Saves what a person's pin of `id` by `change` records, in the update it is called in: the anchor when the half names a place, `parkable` when it names that. */
  recordPin: (id: string, change: PinChange) => void;
  /**
   * Applies `change` to the live or parked panel `id` in one update. The refusal, or the outcome of this render's list,
   * is answered at once; `record` true (a person's gesture) saves the anchor and the `parkable` the half names.
   */
  pinPanel: (id: string, change: PinChange, record: boolean) => PinApplied;
  /** Stores `change` on the entry `id` to apply the next time it is live; `null` removes what is stored. */
  deferPin: (id: string, change: PinChange | null) => void;
  /**
   * Resets the panels `ids` (in this order) to their cascade defaults in one update: overrides cleared, deferred pins
   * dropped, tier and `parkable` re-resolved, each placed by its `placeOnAdd`; what no longer fits is parked, and the
   * answer lists what the room it frees brings back. `changed` is false when nothing moved, resized or was cleared.
   */
  resetPanels: (ids: readonly string[]) => { changed: boolean; parked: string[]; returned: string[] };
  /**
   * The row gesture: 'right' brings the first parked panel after the rightmost live one and parks the LEFTMOST live
   * one ('left' mirrors), then parks more on that side until the row settles, never an acted-on panel. Does nothing,
   * with no `setPanels`, when nothing is parked on that side or when that panel's `revealOnScroll` is 'never'.
   */
  scrollRow: (direction: 'left' | 'right') => void;
  /** Moves `id` `by` row-slots (negative: left; 'left' and 'right' are one slot); see `movePanel` for the no-op contract, and `movePanelBy` for a count that runs out at an edge. `record` false (a call from code) leaves the person's arrangement, `overrides`, as it was. True when the move changes this render's list. */
  reorderPanel: (id: string, by: number | 'left' | 'right', record?: boolean) => boolean;
  /** `setSlots` through setPanels; if the row no longer fits, the same update parks what the capacity drop would, keeping every acted-on panel live. False for a no-op. `record` false leaves `overrides` as it was. */
  resizePanel: (id: string, slots: number, record?: boolean) => boolean;
  /** Puts `id` where `value` says, keeping its live flag; the placement is the developer's own ask, so a person's `movable` is the caller's to check. `record` false leaves `overrides` as it was. True when the placement changes this render's list. */
  placeAt: (id: string, value: AddPlacement | 'in-place', record?: boolean) => boolean;
  /** Puts the parked or hidden panel `id` where `value` says and makes it live, in one update; 'in-place' lands it at its array slot. `record` false leaves `overrides` as it was. False, changing nothing, for an unknown or live panel. */
  landAt: (id: string, value: AddPlacement | 'in-place', record?: boolean) => boolean;
  /** The in-flight gate shared by the manager's operations and the raw mutators. */
  gate: OperationGate;
  /** Explicit enter sides from `scrollRow` and the capacity rise; they win over `enteringViaAnchorIds`, which cannot say which side. */
  enterSideById: ReadonlyMap<string, 'left' | 'right'>;
  /** Ids parking with an exit to the RIGHT (every other park exits left). Set through `flushSync` BEFORE the parking `setPanels`: AnimatePresence reads `exit` from the last render before the child leaves. */
  exitRightIds: ReadonlySet<string>;
  /**
   * Parks `id` and records the hold of `kind`: a 'sticky' hold returns only when shown, an 'until-room' one when
   * the free slots exceed what the park itself left. An id already parked by capacity takes the hold and leaves
   * the collapse stack. False, changing nothing, for an unknown id, a fixed column, an id already parked and held,
   * one already held this turn, and a panel whose `hideWhenLast` is 'refuse' that would leave no panel present.
   */
  holdPanel: (id: string, kind: 'sticky' | 'until-room') => boolean;
  /** Drops the hold mark of `id` and nothing else: `live` and the collapse stack are untouched. True when a mark was dropped. */
  releaseHold: (id: string) => boolean;
  /** Each held id and its hold, this session only: workspace saves never carry it. A not-yet-measured 'until-room' hold reads `freeAfterPark: Infinity`. */
  heldIds: ReadonlyMap<string, Hold>;
  /** True iff no panel other than `ids` and the ones held earlier this turn stays present; a fixed column is always present. */
  wouldEmptyRow: (ids: readonly string[]) => boolean;
  /** Records the hold of an id that is already parked, as a creation path does for a panel created parked. False for a live, fixed or unknown id. */
  markHeld: (id: string, kind: 'sticky' | 'until-room') => boolean;
}

import { createOperationGate, type OperationGate } from './operationGate.js';

export type { GateKind, OperationGate } from './operationGate.js';

/** What keeps a parked panel parked: 'sticky' until it is shown, or until the free slots exceed `freeAfterPark`. */
export type Hold = 'sticky' | { readonly freeAfterPark: number };

/** Inputs usePanelManager takes beyond the row's own numbers; one object, so a later setting adds a field and not a parameter. */
export interface PanelManagerOptions {
  /** The list hook owns these: it settles the row before the manager reads it. Left out, the manager keeps its own. */
  keepLiveRef?: { current: ReadonlyMap<string, PanelWindow[]> };
  capParkedRef?: { current: string[] };
  /** Receives each note the engine raises; whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
  /** Only `rowGap`, `returnTieBreak`, `dropTieBreak` and `maxLivePanels` are read here. */
  tuning?: WorkspaceTuning;
  /** What the panel's settings resolve to over the layers the workspace holds with the person's `parkable` set; without it no pin change can be applied. */
  resolveWith?: PinEnv['resolveWith'];
  /** What the panel's settings resolve to over those layers with no person's layer at all; without it nothing can be reset. */
  resolveDefaults?: (entry: PanelWindow) => PanelSettingsResolution;
  /** The developer's panel order, read by every placement whose value is `'order'`. */
  order?: () => readonly string[];
}

/** How a park is classified: a hide that took a hold, or a park the engine made for room. */
type ParkCause = { kind: 'capacity' } | { kind: 'hide'; stickiness: 'sticky' | 'until-room'; liveAfter: readonly PanelWindow[] };

export function usePanelManager(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  phoneWidth: number,
  containerWidth: number,
  /** How many always-rendered columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
  fixedColumnCount: number,
  rootId: string,
  options?: PanelManagerOptions,
): UsePanelManagerResult {
  const returnTieBreak: NonNullable<WorkspaceTuning['returnTieBreak']> = options?.tuning?.returnTieBreak ?? RETURN_TIE_BREAK;
  const dropTieBreak: NonNullable<WorkspaceTuning['dropTieBreak']> = options?.tuning?.dropTieBreak ?? DROP_TIE_BREAK;
  const gap = options?.tuning?.rowGap ?? ROW_GAP;
  const maxLive = options?.tuning?.maxLivePanels ?? null;
  const env: RowEnv = { phoneWidth, containerWidth, gap, fixedColumnCount, maxLive, rootId, dropTieBreak };
  const pricing = (row: readonly PanelWindow[]) => rowPricing(env, row);
  const settledKeeping = (next: PanelWindow[], keep: readonly string[]): PanelWindow[] => settleKeeping(env, next, keep);
  const { widthOf, capacityFor, settles, pinned } = pricing(panels);
  const capacity = capacityFor(panels.filter(isParkLive));

  /**
   * Parked ids in park order, most recent last. A ref, not state: only handlers and the reconcile effect below
   * read it, so a push or pop need not re-render.
   */
  const collapseOrderRef = useRef<string[]>([]);

  /**
   * When each panel was last touched: created, shown again, or focused. Session only, because a restored row has no
   * touch order to restore and starts every panel tied, which the row order then settles. A panel not stamped yet
   * counts as the newest, so one opened in the update being decided is never the one parked.
   */
  const touchedRef = useRef<Map<string, number>>(new Map());
  const touchPanel = (id: string): void => {
    if (touchedRef.current.has(id)) touchedRef.current.set(id, performance.now());
  };
  const touchedAt = (id: string): number => touchedRef.current.get(id) ?? Number.POSITIVE_INFINITY;

  /**
   * The panels the next capacity-reconcile DROP must keep live, in the order they were acted on: each one just
   * resized, opened or activated, so acting on a panel never parks it, and each of several actions in one
   * update keeps its own. The value is the array the action read: a reconcile still on it ran before the action.
   */
  const ownKeepLive = useRef<ReadonlyMap<string, PanelWindow[]>>(new Map());
  const keepLiveRef = options?.keepLiveRef ?? ownKeepLive;
  const markKeepLive = (id: string): void => {
    keepLiveRef.current = new Map(keepLiveRef.current).set(id, panels);
  };
  /** Every id a park must leave alone: those just acted on, and under a cap the pinned ones. */
  const keptIds = (): ReadonlySet<string> => new Set([...keepLiveRef.current.keys(), ...pinned]);
  /** Slot counts resizePanel queued on `seen` that have not reached `panels` yet, so a later action in the same handler can price them. */
  const pendingSlotsRef = useRef<{ seen: PanelWindow[] | null; slots: ReadonlyMap<string, number> }>({ seen: null, slots: new Map() });
  /** `row` (read in this render) with those slot counts applied. */
  const withPendingSlots = (row: PanelWindow[]): PanelWindow[] => {
    const { seen, slots } = pendingSlotsRef.current;
    return seen === panels ? [...slots].reduce((acc, [id, count]) => setSlots(acc, id, count), row) : row;
  };
  const ownCapParked = useRef<string[]>([]);
  const capParkedRef = options?.capParkedRef ?? ownCapParked;
  /** Nonzero inside this hook's own flushSync: a reconcile run there is mid-handler, before later actions land. */
  const flushingRef = useRef(0);
  const flushOwn = (update: () => void): void => {
    flushingRef.current++;
    try {
      flushSync(update);
    } finally {
      flushingRef.current--;
    }
  };

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
    flushOwn(() => setExitRightIds((prev) => new Set(prev).add(id)));
  };

  const pushCollapsed = (ids: readonly string[]): void => {
    const parkedSet = new Set(ids);
    collapseOrderRef.current = [...collapseOrderRef.current.filter((x) => !parkedSet.has(x)), ...ids];
  };
  const forgetCollapsed = (id: string): void => {
    collapseOrderRef.current = collapseOrderRef.current.filter((x) => x !== id);
  };
  /**
   * The 'manual' panels the CAPACITY parked, most recent last. They are held 'sticky' and off the collapse stack, so
   * this is the only record that tells them from a host hide; only a raise of `maxLivePanels` reads it. recordPark
   * appends in the order it is given (the cap's choice, `dropTieBreak` included), a hide removes the id, and the
   * reconcile effect drops any id that is live, closed or gone.
   */
  const capParkedOrderRef = useRef<string[]>([]);
  const forgetCapParked = (id: string): void => {
    capParkedOrderRef.current = capParkedOrderRef.current.filter((x) => x !== id);
  };

  /** Session only, and a new Map per change so `heldIds` is a snapshot; the counter re-renders for a change no `setPanels` carries. */
  const heldRef = useRef<ReadonlyMap<string, Hold>>(new Map());
  const [, bumpHeld] = useState(0);
  const writeHold = (id: string, hold: Hold | null): boolean => {
    const next = new Map(heldRef.current);
    if (hold === null) {
      if (!next.delete(id)) return false;
    } else {
      next.set(id, hold);
    }
    heldRef.current = next;
    bumpHeld((n) => n + 1);
    return true;
  };
  const releaseHold = (id: string): boolean => writeHold(id, null);

  /** The ids `holdPanel` took on this render's list: a second call in the same handler still reads the list the first did not change. */
  const inFlightRef = useRef<{ seen: PanelWindow[] | null; ids: Set<string> }>({ seen: null, ids: new Set() });
  const inFlight = (): ReadonlySet<string> => (inFlightRef.current.seen === panels ? inFlightRef.current.ids : new Set());
  const markInFlight = (id: string): void => {
    if (inFlightRef.current.seen !== panels) inFlightRef.current = { seen: panels, ids: new Set() };
    inFlightRef.current.ids.add(id);
  };

  const [published, release] = useReducer((a: number, b: number) => Math.max(a, b), 0);
  const [{ gate, settle }] = useState(() => createOperationGate(release));
  // No dependency list: every commit deletes the tokens whose call finished before it was rendered.
  useLayoutEffect(() => settle(published));

  /** Free slots a row leaves for `live` (its live collapsible panels): capacity priced from their own widths, less their count. Infinity while unmeasured. */
  const freeSlots = (live: readonly PanelWindow[]): number => capacityFor(live) - live.length;
  const liveParkable = (row: readonly PanelWindow[]): PanelWindow[] => row.filter(isParkLive);
  /** Whether an 'until-room' hold still keeps `id` parked beside `base`, the live set it would join. */
  const heldBack = (id: string, base: readonly PanelWindow[]): boolean => {
    const hold = heldRef.current.get(id);
    return typeof hold === 'object' && !(freeSlots(base) > hold.freeAfterPark);
  };

  const notedRef = useRef<ReadonlySet<string>>(new Set());
  const noteOnce = (note: SettingNote): void => {
    const at = `${note.panelId}:${note.code}`;
    if (notedRef.current.has(at)) return;
    notedRef.current = new Set(notedRef.current).add(at);
    try {
      options?.onNote?.(note);
    } catch {
      // A reporter that throws must not break the park that raised the note.
    }
  };

  /**
   * The one place a park is classified. A hold keeps the id off the collapse stack ('sticky') or on it behind a
   * threshold ('until-room'); a park for room goes on the stack unless the panel's `capacityReturn` is 'manual',
   * which holds it like a sticky hide.
   */
  const recordPark = (ids: readonly string[], cause: ParkCause): void => {
    for (const id of ids) {
      if (cause.kind === 'hide') {
        if (cause.stickiness === 'until-room') {
          writeHold(id, { freeAfterPark: freeSlots(cause.liveAfter) });
          pushCollapsed([id]);
        } else {
          writeHold(id, 'sticky');
          forgetCollapsed(id);
        }
        forgetCapParked(id);
        continue;
      }
      const parked = panels.find((p) => p.id === id);
      if (parked !== undefined && parkLevers(parked).capacityReturn === 'manual') {
        writeHold(id, 'sticky');
        forgetCollapsed(id);
        capParkedOrderRef.current = [...capParkedOrderRef.current.filter((x) => x !== id), id];
      } else {
        pushCollapsed([id]);
      }
    }
  };
  /** What a placement of `p` resolves against: the row's root and the panel's own `placeFallback`. */
  const placing = (p: PanelWindow) => ({ rootId, fallback: FIXED.placeFallback, ...(options?.order !== undefined ? { order: options.order } : {}) });
  const noteHold = (p: PanelWindow): void => {
    if (!effective(p).listed) noteOnce(holdUnlistedNote(p.id));
  };
  const pinEnv: PinEnv | undefined = options?.resolveWith === undefined ? undefined : { rootId, resolveWith: options.resolveWith, placing };
  /** `row` with `id` landed by `placeAs`, or by its pending pin change, which a path that makes a panel live applies in its own update. */
  const landOn = (row: readonly PanelWindow[], id: string, placeAs: AddPlacement | 'in-place', pin?: PinChange): { row: PanelWindow[]; notes: SettingNote[]; pinned: boolean } => {
    const target = row.find((p) => p.id === id);
    if (target === undefined) return { row: [...row], notes: [], pinned: false };
    if (pinEnv !== undefined) return landPanel(row, id, pin, placeAs, pinEnv);
    const placed = placePanel(row, id, placeAs, placing(target));
    return { ...placed, pinned: false };
  };
  /** `row` with `id` landed and live, or null when `id` is unknown or already live: the one lift every path that shows a panel runs inside its update. */
  const liftOn = (row: PanelWindow[], id: string, placeAs: AddPlacement | 'in-place', cap: number, keep?: ReadonlySet<string>, pin?: PinChange): PanelWindow[] | null => {
    if (!row.some((p) => p.id === id && !p.live)) return null;
    const landed = landOn(row, id, placeAs, pin);
    if (landed.row.some((p) => p.id === id && p.live)) return landed.row;
    return promoteToLive(landed.row, id, cap, touchedAt, keep);
  };

  const wouldEmptyRow = (ids: readonly string[]): boolean => {
    const gone = new Set([...ids, ...inFlight(), ...gate.leaving()]);
    return !panels.some((p) => isPresent(p) && !(p.collapsible && gone.has(p.id)));
  };

  const holdPanel = (id: string, kind: 'sticky' | 'until-room'): boolean => {
    const target = panels.find((p) => p.id === id);
    if (!target?.collapsible) return false;
    if ((!target.live && heldRef.current.has(id)) || inFlight().has(id)) return false;
    if (FIXED.hideWhenLast === 'refuse' && wouldEmptyRow([id])) return false;
    const liveAfter = liveParkable(panels).filter((p) => p.id !== id && !inFlight().has(p.id));
    noteHold(target);
    if (!target.live) {
      recordPark([id], { kind: 'hide', stickiness: kind, liveAfter });
      return true;
    }
    markInFlight(id);
    if (sideOfLiveRange(panels, id) === 'right') markExitRight(id);
    recordPark([id], { kind: 'hide', stickiness: kind, liveAfter });
    setPanels((prev) => prev.map((p) => (p.id === id ? { ...p, live: false } : p)));
    return true;
  };

  /** Reads the last committed list, not this render's: a creation path calls it in the commit that added the panel. */
  const markHeld = (id: string, kind: 'sticky' | 'until-room'): boolean => {
    const row = committedRef.current;
    const target = row.find((p) => p.id === id);
    if (!target?.collapsible || target.live) return false;
    recordPark([id], { kind: 'hide', stickiness: kind, liveAfter: liveParkable(row) });
    noteHold(target);
    return true;
  };

  /**
   * Before a panel is shown -- a new one from PanelsAPI.create(), or usePanelClosing's undo restoring a LIVE
   * one -- parks whatever is necessary to stay at capacity (by count, then by width), in the SAME update that
   * reveals it. `apply` is called once, purely (no side effect), against `panelsNow` to learn the id and array
   * position of whatever it adds/restores; the real commit re-runs it against the LATEST state instead of
   * trusting this snapshot.
   */
  const revealPanelProactively = (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]): void => {
    const afterInsert = apply(panelsNow);
    const targetId = afterInsert.find((p) => !panelsNow.some((q) => q.id === p.id))?.id;
    if (targetId !== undefined) markKeepLive(targetId);
    const keep = [...keptIds()];
    const settledApply = (prev: PanelWindow[]): PanelWindow[] => settledKeeping(apply(prev), keep);
    // The new panel may itself be a reserved one, which takes room from the parkable panels already live.
    const capacityAfter = targetId === undefined ? capacity : pricing(afterInsert).capacityFor(afterInsert.filter(isParkLive), panels.filter(isParkLive).map(widthOf));
    if (targetId === undefined || capacityAfter === Number.POSITIVE_INFINITY) {
      setPanels(settledApply);
      return;
    }
    const targetIndex = afterInsert.findIndex((p) => p.id === targetId);
    const liveParkableCountAfter = afterInsert.filter(isParkLive).length;
    const overCapacity = Math.max(0, liveParkableCountAfter - capacityAfter);
    if (overCapacity === 0) {
      setPanels(settledApply);
      return;
    }
    const toPark: string[] = [];
    const exempt = keptIds();
    let scratch = afterInsert;
    for (let i = 0; i < overCapacity; i++) {
      const id = leastRecentlyTouchedId(scratch, touchedAt, exempt);
      if (!id) break;
      toPark.push(id);
      scratch = scratch.map((p) => (p.id === id ? { ...p, live: false } : p));
    }
    if (toPark.length === 0) {
      setPanels(settledApply);
      return;
    }
    const rightParks = toPark.filter((id) => sideOfLiveRange(afterInsert, id) === 'right');
    if (rightParks.length > 0) {
      flushOwn(() =>
        setExitRightIds((prev) => {
          const next = new Set(prev);
          for (const id of rightParks) next.add(id);
          return next;
        }),
      );
    }
    recordPark(toPark, { kind: 'capacity' });
    const parkedSet = new Set(toPark);
    setPanels((current) => settledKeeping(apply(current).map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)), keep));
  };

  /** The capacity `promoteToLive` judges `target` going live against in `row`: this render's, or under a cap the one that counts `target` if the cap counts it. */
  const capacityShowing = (row: PanelWindow[], target: PanelWindow): number => {
    if (maxLive === null) return capacity;
    const priced = pricing(row);
    const live = row.filter(isParkLive);
    return priced.capacityFor(parksForRoom(target) ? [...live, target] : live, live.map(priced.widthOf));
  };

  /**
   * Clicking ANY row -- live or parked alike -- activates it (promoteToLive's own doc
   * comment has the full "make/keep it live, preserve array order" spec).
   */
  const handleActivatePanel = (id: string, pin?: PinChange, from: PanelWindow[] = panels, placeAs?: AddPlacement | 'in-place'): void => {
    const target = from.find((p) => p.id === id);
    if (!target || target.live) return;
    markKeepLive(id);
    const keep = [...keptIds()];
    // A manual History-row activation enters from the right (or by its own `anchoredEnter`), so it drops any
    // anchor-entry or gesture-side mark left from an earlier reveal of this id.
    forgetEnteringViaAnchor(id);
    clearEnterSide(id);
    // Re-placed before it goes live, in the same update; the updaters below place again over the latest list.
    const showAt = placeAs ?? effective(target).placeOnShow;
    const landed = landOn(from, id, showAt, pin);
    const before = showAt === 'in-place' && !landed.pinned ? from : landed.row;
    const result = before.some((p) => p.id === id && p.live) ? before : promoteToLive(before, id, capacityShowing(before, target), touchedAt, keptIds());
    if (!result) return;
    reportNotes(options?.onNote, landed.notes);
    if (showAt !== 'in-place' || landed.pinned) setEnterSide(id, sideOfLiveRange(result, id));
    forgetCollapsed(id);
    releaseHold(id);
    const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
    if (!demoted) {
      // An updater, not `result`: `result` is built from this render's array and would drop an update queued
      // earlier in the same handler.
      setPanels((prev) => settledKeeping(liftOn(prev, id, showAt, Number.POSITIVE_INFINITY, undefined, pin) ?? prev, keep));
      return;
    }
    if (sideOfLiveRange(before, demoted.id) === 'right') markExitRight(demoted.id);
    recordPark([demoted.id], { kind: 'capacity' });
    // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
    // Infinity guarantees that for this call only), then the panel it displaces is parked.
    setPanels((prev) => liftOn(prev, id, showAt, Number.POSITIVE_INFINITY, undefined, pin) ?? prev);
    setPanels((current) => settledKeeping(current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)), keep));
  };

  /** See `UsePanelManagerResult.scrollRow`'s own doc comment. */
  const scrollRow = (direction: 'left' | 'right'): void => {
    const reveal = direction === 'right' ? firstParkedAfter(panels, rightmostLiveIndex(panels)) : lastParkedBefore(panels, leftmostLiveIndex(panels));
    if (!reveal || effective(reveal).revealOnScroll === 'never') return;
    const kept = keptIds();
    markKeepLive(reveal.id);
    // A resize earlier in this handler is priced at its new tier, or the row committed below could overflow. A pin change the panel waits with lands first, so the gesture parks against the row it makes.
    const waiting = reveal.deferredPin !== undefined;
    const landed = waiting ? landOn(withPendingSlots(panels), reveal.id, 'in-place') : undefined;
    const sized = landed?.row ?? withPendingSlots(panels);
    const live = sized.filter(isParkLive);
    const farFirst = (direction === 'right' ? live : [...live].reverse()).filter((p) => !kept.has(p.id));
    const toPark = new Set<string>();
    const rowAfter = (): PanelWindow[] => sized.filter((p) => (isParkLive(p) || (p.id === reveal.id && parksForRoom(p))) && !toPark.has(p.id));
    // At least the one panel the gesture swaps out, then more only while the row with `reveal` would not settle.
    for (const p of farFirst) {
      if (toPark.size > 0 && settles(rowAfter())) break;
      toPark.add(p.id);
    }
    const flip = (row: PanelWindow[]): PanelWindow[] => row.map((p) => (toPark.has(p.id) ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p));
    // The side a panel enters from is its landing slot's when a pin change moved it, the gesture's direction when nothing did.
    setEnterSide(reveal.id, landed === undefined ? direction : sideOfLiveRange(flip(sized), reveal.id));
    reportNotes(options?.onNote, landed?.notes ?? []);
    // A leftward gesture parks off the RIGHT edge: mark those BEFORE the setPanels below, in their own commit.
    if (direction === 'left' && toPark.size > 0) flushOwn(() => setExitRightIds((prev) => new Set([...prev, ...toPark])));
    recordPark([...toPark], { kind: 'capacity' });
    forgetCollapsed(reveal.id);
    releaseHold(reveal.id);
    setPanels((prev) => (waiting ? landOn(flip(prev), reveal.id, 'in-place').row : flip(prev)));
  };

  /** Pinned follows position, so under a cap a move that changes the row can change whether `id` counts: the park it causes leaves `id` live, as a pin does. */
  const keepMoved = (id: string, changes: boolean): void => {
    if (changes && maxLive !== null) markKeepLive(id);
  };

  /** See `UsePanelManagerResult.reorderPanel`'s own doc comment. */
  const reorderPanel = (id: string, by: number | 'left' | 'right', record = true): boolean => {
    const count = by === 'left' ? -1 : by === 'right' ? 1 : by;
    const changes = movePanelBy(panels, id, count, rootId) !== panels;
    keepMoved(id, changes);
    setPanels((prev) => {
      const moved = movePanelBy(prev, id, count, rootId);
      // A drag settles every panel's place for the person, not only the dragged one's.
      return moved === prev || !record ? moved : recordOverride(moved, 'anchor', moved.map((p) => p.id), rootId);
    });
    return changes;
  };

  /** See `UsePanelManagerResult.placeAt`'s own doc comment. */
  const placeAt = (id: string, value: AddPlacement | 'in-place', record = true): boolean => {
    const target = panels.find((p) => p.id === id);
    if (target === undefined || value === 'in-place') return false;
    const sameRow = (a: readonly PanelWindow[], b: readonly PanelWindow[]): boolean =>
      a.length === b.length && a.every((p, k) => p.id === b[k]!.id && p.anchor?.panel === b[k]!.anchor?.panel && p.anchor?.position === b[k]!.anchor?.position && p.anchor?.priority === b[k]!.anchor?.priority);
    const placed = placePanel(panels, id, value, placing(target));
    reportNotes(options?.onNote, placed.notes);
    const changes = !sameRow(panels, placed.row);
    keepMoved(id, changes);
    setPanels((prev) => {
      const next = placePanel(prev, id, value, placing(target)).row;
      if (sameRow(prev, next)) return prev;
      return record ? recordOverride(next, 'anchor', next.map((p) => p.id), rootId) : next;
    });
    return changes;
  };

  /** See `UsePanelManagerResult.landAt`'s own doc comment. */
  const landAt = (id: string, value: AddPlacement | 'in-place', record = true): boolean => {
    const target = panels.find((p) => p.id === id);
    if (target === undefined || target.live) return false;
    handleActivatePanel(id, undefined, panels, value);
    // Queued after the lift, in the same batch, so the person's arrangement is read from the row the lift made.
    if (record) setPanels((prev) => recordOverride(prev, 'anchor', prev.map((p) => p.id), rootId));
    return true;
  };

  /** See `UsePanelManagerResult.resizePanel`'s own doc comment. */
  const resizePanel = (id: string, next: number, record = true): boolean => {
    if (setSlots(panels, id, next) === panels) return false;
    const wasLive = panels.find((p) => p.id === id)?.live === true;
    markKeepLive(id);
    const keep = [...keptIds()];
    const pending = pendingSlotsRef.current.seen === panels ? pendingSlotsRef.current.slots : [];
    pendingSlotsRef.current = { seen: panels, slots: new Map(pending).set(id, next) };
    if (wasLive) {
      purgeExitRight(id);
      forgetCollapsed(id);
    }
    setPanels((prev) => {
      const resized = setSlots(prev, id, next);
      // An earlier call in this same handler may have queued a park of it (its exit mark and stack entry are
      // dropped above): a resize never parks its own panel, so that park is cancelled before anything commits.
      const own = wasLive && resized.some((p) => p.id === id && !p.live) ? resized.map((p) => (p.id === id ? { ...p, live: true } : p)) : resized;
      // A width set now replaces the one a panel resting at one phone would go back to.
      const settled = settledKeeping(own, keep).map((p) => (p.id === id && p.restoreSlots !== undefined ? { ...p, restoreSlots: undefined } : p));
      return record ? recordOverride(settled, 'slots', [id], rootId) : settled;
    });
    return true;
  };

  /**
   * Reconciles the live set against `capacity` whenever either changes -- an effect, since it must act on a
   * measurement that just changed, not one this render was given. Both branches judge a candidate set by `settles`,
   * never `capacity` as a count: `capacity` prices every not-yet-live slot at `phoneWidth`, so WHICH panels park or
   * return decides whether the rest fits, and a set that does not settle re-triggers a branch next render. A DROP
   * parks `fewestParksThatSettle` and exits 'left' (flushSync cannot mark a right exit first from a passive effect), but
   * finds nothing to drop while a cap is set: the render above has settled the row. A RISE reveals from the top of
   * `collapseOrderRef`; one that doesn't settle stays on the stack for an OLDER, narrower one.
   */
  const committedRef = useRef(panels);
  // The value the previous committed render had: a raise is read against it, so a mount, a restore, a resize, an equal or lower value and StrictMode's second effect all read none.
  const prevMaxLiveRef = useRef(maxLive);
  useEffect(() => {
    const raised = prevMaxLiveRef.current !== null && (maxLive === null || maxLive > prevMaxLiveRef.current);
    prevMaxLiveRef.current = maxLive;
    capParkedOrderRef.current = capParkedOrderRef.current.filter((id) => panels.some((p) => p.id === id && p.collapsible && !p.live));
    // `settledKeeping` parks inside a state update, where no call-time code sees which panels it chose: the
    // stack learns of any park not already on it from the commit itself.
    const before = committedRef.current;
    committedRef.current = panels;
    // A panel that is new, or live where it was parked, is touched now; one that left the row is forgotten.
    const touched = touchedRef.current;
    const stamp = performance.now();
    for (const id of [...touched.keys()]) if (!panels.some((p) => p.id === id)) touched.delete(id);
    for (const p of panels) if (!touched.has(p.id) || (p.live && !before.some((q) => q.id === p.id && q.live))) touched.set(p.id, stamp);
    const byCap = capParkedRef.current;
    capParkedRef.current = [];
    // A panel added parked is held per its own setting, unless the cap parked it before its row was shown; a hold whose panel is gone (clearAll wipes without a close) is dropped.
    for (const p of panels) if (p.collapsible && !p.live && !before.some((q) => q.id === p.id) && !byCap.includes(p.id)) markHeld(p.id, effective(p).hideStickiness);
    for (const id of heldRef.current.keys()) if (!panels.some((p) => p.id === id)) releaseHold(id);
    const capParked = byCap.filter((id) => panels.some((p) => p.id === id && p.collapsible && !p.live));
    if (capParked.length > 0) recordPark(capParked, { kind: 'capacity' });
    const unrecorded = panels.filter(
      (p) => p.collapsible && !p.live && !collapseOrderRef.current.includes(p.id) && !heldRef.current.has(p.id) && before.some((q) => q.id === p.id && q.live),
    );
    if (unrecorded.length > 0) recordPark(unrecorded.map((p) => p.id), { kind: 'capacity' });
    const keepIds: string[] = [];
    const waiting = new Map<string, PanelWindow[]>();
    // A mark still on the array its action read waits for that action to land. Inside flushOwn every mark
    // outlives this reconcile: the rest of its handler has not landed yet.
    for (const [id, seen] of keepLiveRef.current) {
      if (seen !== panels) keepIds.push(id);
      if (seen === panels || flushingRef.current > 0) waiting.set(id, seen);
    }
    keepLiveRef.current = waiting;
    if (capacity === Number.POSITIVE_INFINITY) return;
    const live = panels.filter(isParkLive);
    // An 'until-room' hold taken before the first measurement took no threshold; it takes the row's as measured now.
    for (const [id, hold] of heldRef.current) if (typeof hold === 'object' && hold.freeAfterPark === Number.POSITIVE_INFINITY) writeHold(id, { freeAfterPark: capacity - live.length });
    if (live.length > capacity) {
      const toPark = fewestParksThatSettle(live, widthOf, settles, keepIds, dropTieBreak);
      if (toPark.length === 0) return;
      recordPark(toPark, { kind: 'capacity' });
      const parkedSet = new Set(toPark);
      setPanels((current) => current.map((p) => (parkedSet.has(p.id) ? { ...p, live: false } : p)));
    } else if (live.length < capacity && (collapseOrderRef.current.length > 0 || (raised && capParkedOrderRef.current.length > 0))) {
      // A raise also walks the manual panels the cap parked; the walk and its bound are the ones a capacity rise uses.
      const stack = raised ? [...collapseOrderRef.current, ...capParkedOrderRef.current] : collapseOrderRef.current;
      const revealed = new Set<string>();
      const stale = new Set<string>();
      for (const id of returnOrder(stack, panels)) {
        const candidate = panels.find((p) => p.id === id);
        if (!candidate || candidate.live) {
          stale.add(id); // closed, or already live some other way
          continue;
        }
        if (heldBack(id, panels.filter((p) => parksForRoom(p) && (p.live || revealed.has(p.id))))) continue;
        if (settles(panels.filter((p) => parksForRoom(p) && (p.live || revealed.has(p.id) || p.id === id)))) revealed.add(id);
      }
      if (revealed.size === 0) return;
      collapseOrderRef.current = collapseOrderRef.current.filter((id) => !revealed.has(id) && !stale.has(id));
      capParkedOrderRef.current = capParkedOrderRef.current.filter((id) => !revealed.has(id) && !stale.has(id));
      // Each returning panel lands by its own `placeOnReturn`, or by the pin change it waits with, in return order, in the update that makes it live.
      const returnAt = (id: string): AddPlacement | 'in-place' => FIXED.placeOnReturn;
      const landAll = (row: PanelWindow[]): PanelWindow[] => [...revealed].reduce((acc, id) => landOn(acc, id, returnAt(id)).row, row);
      let landing = panels;
      const moved = new Set<string>();
      for (const id of revealed) {
        const result = landOn(landing, id, returnAt(id));
        reportNotes(options?.onNote, result.notes);
        if (returnAt(id) !== 'in-place' || result.pinned) moved.add(id);
        landing = result.row;
      }
      const landed = landing.map((p) => (revealed.has(p.id) ? { ...p, live: true } : p));
      for (const id of revealed) {
        releaseHold(id);
        setEnterSide(id, sideOfLiveRange(moved.has(id) ? landed : panels, id));
      }
      setPanels((current) => landAll(current).map((p) => (revealed.has(p.id) ? { ...p, live: true } : p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, panels, maxLive]);

  /**
   * `stack` (park order, most recent last) in the order a return walk tries it: the tie-break first, then a stable
   * sort by `returnPriority`, highest first.
   */
  const returnOrder = (stack: readonly string[], row: readonly PanelWindow[]): string[] => {
    const rowIndex = (id: string): number => row.findIndex((p) => p.id === id);
    const priority = (id: string): number => {
      const p = row.find((q) => q.id === id);
      return p === undefined ? 0 : parkLevers(p).returnPriority;
    };
    const walk = returnTieBreak === 'latest-first' ? [...stack].reverse() : returnTieBreak === 'earliest-first' ? [...stack] : [...stack].sort((a, b) => rowIndex(a) - rowIndex(b));
    return walk.sort((a, b) => priority(b) - priority(a));
  };

  /** See `UsePanelManagerResult.revealMostRecentlyCollapsed`'s own doc comment for the full contract. */
  const revealMostRecentlyCollapsed = (panelsAfterClose: PanelWindow[]): void => {
    // Priced like scrollRow: a resize earlier in this handler is not in `panelsAfterClose` yet.
    const sized = withPendingSlots(panelsAfterClose);
    const stack = collapseOrderRef.current;
    const stale = new Set<string>();
    let candidateId: string | null = null;
    for (const id of returnOrder(stack, panelsAfterClose)) {
      const candidate = panelsAfterClose.find((p) => p.id === id);
      if (!candidate || candidate.live) {
        stale.add(id); // closed, or already live some other way
        continue;
      }
      if (candidateId === null && !heldBack(id, liveParkable(sized)) && settles(sized.filter((p) => parksForRoom(p) && (p.live || p.id === id)))) candidateId = id;
    }
    collapseOrderRef.current = stack.filter((id) => id !== candidateId && !stale.has(id));
    if (candidateId === null) return;
    const revealId = candidateId;
    releaseHold(revealId);
    // Clear before marking, as `clearEnterSide`'s contract requires: a stale explicit side would win over the anchor.
    clearEnterSide(revealId);
    const returning = panelsAfterClose.find((p) => p.id === revealId)!;
    const returnAt = FIXED.placeOnReturn;
    if (returnAt === 'in-place' && returning.deferredPin === undefined) {
      // One of the two "reappearance" paths that enter from the anchor's side -- mark it BEFORE the setPanels
      // call below; no flushSync, since the mark only has to be in the commit that mounts the slot.
      markEnteringViaAnchor(revealId);
      setPanels((current) => promoteToLive(current, revealId, Number.POSITIVE_INFINITY, touchedAt) ?? current);
      return;
    }
    const placed = landOn(panelsAfterClose, revealId, returnAt);
    reportNotes(options?.onNote, placed.notes);
    setEnterSide(revealId, sideOfLiveRange(placed.row, revealId));
    setPanels((current) => liftOn(current, revealId, returnAt, Number.POSITIVE_INFINITY) ?? current);
  };

  /** See `UsePanelManagerResult.previewPin`'s own doc comment. */
  const previewPin = (id: string, change: PinChange): PinApplied =>
    pinEnv === undefined || !panels.some((p) => p.id === id) ? { ok: false, code: 'unknown-panel', message: `no panel '${id}' is in the row` } : applyPinChange(panels, id, change, pinEnv);

  /** `row` with what a person's pin of `id` by `change` records: the anchor when the half names a place, `parkable` when it names that. */
  const recordPinned = (row: PanelWindow[], id: string, change: PinChange): PanelWindow[] => {
    const half = pinHalf(row.find((p) => p.id === id) ?? { settings: undefined }, change);
    const anchored = half.placement === undefined ? row : recordOverride(row, 'anchor', row.map((p) => p.id), rootId);
    return half.parkable === undefined ? anchored : recordOverride(anchored, 'parkable', [id], rootId);
  };

  /** See `UsePanelManagerResult.pinPanel`'s own doc comment. */
  const pinPanel = (id: string, change: PinChange, record: boolean): PinApplied => {
    const outcome = previewPin(id, change);
    if (!outcome.ok) return outcome;
    reportNotes(options?.onNote, outcome.notes);
    if (outcome.row === panels) return outcome;
    markKeepLive(id);
    const keep = [...keptIds()];
    setPanels((prev) => {
      const applied = applyPinChange(prev, id, change, pinEnv!);
      if (!applied.ok || applied.row === prev) return prev;
      const settled = settledKeeping(applied.row, keep);
      return record ? recordPinned(settled, id, change) : settled;
    });
    return outcome;
  };

  /** See `UsePanelManagerResult.recordPin`'s own doc comment. */
  const recordPin = (id: string, change: PinChange): void => setPanels((prev) => recordPinned(prev, id, change));

  /** See `UsePanelManagerResult.deferPin`'s own doc comment. */
  const deferPin = (id: string, change: PinChange | null): void => {
    setPanels((prev) => prev.map((p) => (p.id === id ? (change === null ? withoutDeferral(p) : { ...p, deferredPin: change }) : p)));
  };

  /** The ids of the parked panels on the collapse stack that `row` has room to bring back, in return order. */
  const plannedReturns = (row: readonly PanelWindow[]): string[] => {
    const priced = pricing(row);
    const back = new Set<string>();
    for (const id of returnOrder(collapseOrderRef.current, row)) {
      const candidate = row.find((p) => p.id === id);
      if (!candidate || candidate.live) continue;
      if (heldBack(id, row.filter((p) => parksForRoom(p) && (p.live || back.has(p.id))))) continue;
      if (priced.settles(row.filter((p) => parksForRoom(p) && (p.live || back.has(p.id) || p.id === id)))) back.add(id);
    }
    return [...back];
  };

  /** See `UsePanelManagerResult.resetPanels`'s own doc comment. */
  const resetPanels = (ids: readonly string[]): { changed: boolean; parked: string[]; returned: string[] } => {
    const none = { changed: false, parked: [], returned: [] };
    if (options?.resolveDefaults === undefined) return none;
    const env: ResetEnv = { rootId, resolveDefaults: options.resolveDefaults, placing };
    const outcome = resetEntries(panels, ids, env);
    if (outcome.row === panels) return none;
    reportNotes(options?.onNote, outcome.notes);
    for (const id of outcome.resized) markKeepLive(id);
    const keep = [...keptIds()];
    const settledRow = settledKeeping(outcome.row, keep);
    const parked = settledRow.filter((p) => !p.live && outcome.row.find((q) => q.id === p.id)?.live).map((p) => p.id);
    setPanels((prev) => {
      const again = resetEntries(prev, ids, env);
      return again.row === prev ? prev : settledKeeping(again.row, keep);
    });
    return { changed: outcome.changed, parked, returned: plannedReturns(settledRow).filter((id) => !parked.includes(id)) };
  };

  return {
    revealPanelProactively,
    landPanel: landOn,
    previewPin,
    pinPanel,
    recordPin,
    deferPin,
    resetPanels,
    handleActivatePanel,
    forgetCollapsed,
    revealMostRecentlyCollapsed,
    enteringViaAnchorIds: enteringViaAnchorRef.current,
    markEnteringViaAnchor,
    markEnterSide: setEnterSide,
    clearEnterSide,
    scrollRow,
    reorderPanel,
    resizePanel,
    placeAt,
    landAt,
    gate,
    enterSideById: enterSideRef.current,
    exitRightIds,
    holdPanel,
    releaseHold,
    heldIds: heldRef.current,
    wouldEmptyRow,
    markHeld,
    touchPanel,
  };
}

export { fewestParksThatSettle } from './rowSettle.js';
