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
import type { FormFactor } from '../hostApi.js';
import { computeRowLayout } from '../panelRowLayout.js';
import { computeRowNumbers } from '../rowNumbers.js';
import { placePanel, reportNotes } from '../panelPlacement.js';
import type { AddPlacement } from '../panelSettings.js';
import { isPresent } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { effectiveMaxPanels } from '../panelCapacity.js';
import { effective, holdUnlistedNote } from '../panelSettings.js';
import type { SettingNote, WorkspaceTuning } from '../panelSettings.js';
import { DROP_TIE_BREAK, RETURN_TIE_BREAK, ROW_GAP } from '../rowConstants.js';
import {
  firstParkedAfter,
  lastParkedBefore,
  leftmostLiveIndex,
  farthestLiveCollapsibleId,
  movePanel,
  parkLevers,
  parksForRoom,
  promoteToLive,
  recordOverride,
  rightmostLiveIndex,
  setFormFactor,
  sideOfLiveRange,
  type PanelWindow,
} from '../panelWindow.js';

export interface UsePanelManagerResult {
  revealPanelProactively: (panelsNow: PanelWindow[], apply: (prev: PanelWindow[]) => PanelWindow[]) => void;
  handleActivatePanel: (id: string) => void;
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
   * The row gesture: 'right' brings the first parked panel after the rightmost live one and parks the LEFTMOST live
   * one ('left' mirrors), then parks more on that side until the row settles, never an acted-on panel. Does nothing,
   * with no `setPanels`, when nothing is parked on that side.
   */
  scrollRow: (direction: 'left' | 'right') => void;
  /** Moves `id` one row-slot toward `direction`; see `movePanel` for the no-op contract. `record` false (a call from code) leaves the person's arrangement, `overrides`, as it was. True when the move changes this render's list. */
  reorderPanel: (id: string, direction: 'left' | 'right', record?: boolean) => boolean;
  /** `setFormFactor` through setPanels; if the row no longer fits, the same update parks what the capacity drop would, keeping every acted-on panel live. False for a no-op. `record` false leaves `overrides` as it was. */
  resizePanel: (id: string, next: FormFactor, record?: boolean) => boolean;
  /** Puts `id` where `value` says, keeping its live flag; the placement is the developer's own ask, so `placeable` is the caller's to check. `record` false leaves `overrides` as it was. True when the placement changes this render's list. */
  placeAt: (id: string, value: AddPlacement | 'in-place', record?: boolean) => boolean;
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

/** What an in-flight operation does to the row, as far as the empty-row rule is concerned. */
export type GateKind = 'hide' | 'close' | 'other';

/**
 * The turn's record of which panels an operation is already acting on: one token per accepted call, deleted by the
 * commit that carries the call's `release`. A manager call that finds a token on its panel answers `busy`; a close is
 * exclusive among manager calls in both directions. A raw mutator takes a 'raw' token and never refuses, except that it
 * does nothing on a panel a manager call holds.
 */
export interface OperationGate {
  /** True when a manager call on `ids` of this `kind` would answer busy. Takes nothing. */
  busy: (ids: readonly string[], kind: GateKind) => boolean;
  /** Takes a manager token on `ids`; undefined, taking nothing, when `busy`. */
  take: (ids: readonly string[], kind: GateKind) => number | undefined;
  /** Takes a raw token on `ids`; undefined, taking nothing, when a manager token holds one of them. */
  takeRaw: (ids: readonly string[], kind: GateKind) => number | undefined;
  /** Marks the call that took `token` as finished, forcing a commit so its token is deleted even when the engine ignored the call. */
  release: (token: number) => void;
  /** The ids a hide or a close is acting on this turn. */
  leaving: () => ReadonlySet<string>;
}

interface Token {
  token: number;
  source: 'manager' | 'raw';
  kind: GateKind;
}

/** What keeps a parked panel parked: 'sticky' until it is shown, or until the free slots exceed `freeAfterPark`. */
export type Hold = 'sticky' | { readonly freeAfterPark: number };

/** Inputs usePanelManager takes beyond the row's own numbers; one object, so a later setting adds a field and not a parameter. */
export interface PanelManagerOptions {
  /** Receives each note the engine raises; whatever it throws is swallowed. */
  onNote?: (note: SettingNote) => void;
  /** Only `rowGap`, `returnTieBreak` and `dropTieBreak` are read here. */
  tuning?: WorkspaceTuning;
  /** The developer's panel order, read by every placement whose value is `'order'`. */
  order?: () => readonly string[];
}

/** How a park is classified: a hide that took a hold, or a park the engine made for room. */
type ParkCause = { kind: 'capacity' } | { kind: 'hide'; stickiness: 'sticky' | 'until-room'; liveAfter: readonly PanelWindow[] };

/** Live and parkable for room: the panels whose count and widths the capacity governs. */
const isParkLive = (p: PanelWindow): boolean => p.live && parksForRoom(p);

export function usePanelManager(
  panels: PanelWindow[],
  setPanels: Dispatch<SetStateAction<PanelWindow[]>>,
  phoneWidth: number,
  containerWidth: number,
  /** How many always-rendered, non-webview columns the row currently has (`count(!collapsible)` over the provider's own list, unless its host overrides it). */
  fixedColumnCount: number,
  rootId: string,
  options?: PanelManagerOptions,
): UsePanelManagerResult {
  const returnTieBreak: NonNullable<WorkspaceTuning['returnTieBreak']> = options?.tuning?.returnTieBreak ?? RETURN_TIE_BREAK;
  const dropTieBreak: NonNullable<WorkspaceTuning['dropTieBreak']> = options?.tuning?.dropTieBreak ?? DROP_TIE_BREAK;
  const gap = options?.tuning?.rowGap ?? ROW_GAP;
  /**
   * What prices `row`: the width each panel is drawn at, how many parkable panels with these widths may be live
   * beside the row's reserved ones, and whether a live set settles. A scroll panel never parks, so its width comes off
   * the budget instead of counting against the cap.
   */
  const pricing = (row: readonly PanelWindow[]) => {
    const numbers = computeRowNumbers({ entries: row, phoneWidth, containerWidth, gap, fixedItemCount: fixedColumnCount });
    // Only a row with a scroll panel prices its reserved widths one by one; any other keeps the fixed column count the host passed.
    const reservedWidths = row.some((p) => isPresent(p) && !parksForRoom(p) && p.collapsible) ? numbers.reservedWidths : undefined;
    const capacityFor = (liveWidths: readonly number[]): number => {
      // `containerWidth === 0` means unmeasured (the first commit, and every jsdom test that never calls
      // measure()): null means no cap and no reconcile, never "zero panels fit".
      const fitCount =
        containerWidth === 0
          ? null
          : fixedColumnCount + computeRowLayout({ containerWidth, phoneWidth, gap, fixedItemCount: fixedColumnCount, liveWidths, reservedWidths }).maxLiveThatFit;
      const effectiveMax = effectiveMaxPanels(fitCount, fixedColumnCount);
      // Floor of 1 keeps the panel just opened on screen even at the narrowest legal width (effectiveMaxPanels
      // already floors at fixedColumnCount + 1, so this bites only when the fixed columns alone reach effectiveMax).
      return effectiveMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, effectiveMax - fixedColumnCount);
    };
    const widthOf = (p: PanelWindow): number => panelWidthOf(p, phoneWidth, numbers.maxLiveWidth);
    /** Whether `set` (live parkable panels, row order) can stay live as it is: the one test both reconcile branches settle against. */
    const settles = (set: readonly PanelWindow[]): boolean => set.length <= capacityFor(set.map(widthOf));
    return { widthOf, capacityFor, settles };
  };
  const { widthOf, capacityFor, settles } = pricing(panels);
  const capacity = capacityFor(panels.filter(isParkLive).map(widthOf));

  /**
   * Parked ids in park order, most recent last. A ref, not state: only handlers and the reconcile effect below
   * read it, so a push or pop need not re-render.
   */
  const collapseOrderRef = useRef<string[]>([]);

  /**
   * The panels the next capacity-reconcile DROP must keep live, in the order they were acted on: each one just
   * resized, opened or activated, so acting on a panel never parks it, and each of several actions in one
   * update keeps its own. The value is the array the action read: a reconcile still on it ran before the action.
   */
  const keepLiveRef = useRef<ReadonlyMap<string, PanelWindow[]>>(new Map());
  const markKeepLive = (id: string): void => {
    keepLiveRef.current = new Map(keepLiveRef.current).set(id, panels);
  };
  const keptIds = (): ReadonlySet<string> => new Set(keepLiveRef.current.keys());
  /** Tiers resizePanel queued on `seen` that have not reached `panels` yet, so a later action in the same handler can price them. */
  const pendingTiersRef = useRef<{ seen: PanelWindow[] | null; tiers: ReadonlyMap<string, FormFactor> }>({ seen: null, tiers: new Map() });
  /** `row` (read in this render) with those tiers applied. */
  const withPendingTiers = (row: PanelWindow[]): PanelWindow[] => {
    const { seen, tiers } = pendingTiersRef.current;
    return seen === panels ? [...tiers].reduce((acc, [id, tier]) => setFormFactor(acc, id, tier), row) : row;
  };
  /** `next`, plus in the same update whatever the reconcile's DROP would park, so no committed row overflows. */
  const settledKeeping = (next: PanelWindow[], keep: readonly string[]): PanelWindow[] => {
    const live = next.filter(isParkLive);
    const priced = pricing(next);
    if (priced.settles(live)) return next;
    const parked = new Set(fewestParksThatSettle(live, priced.widthOf, priced.settles, keep, dropTieBreak));
    return parked.size === 0 ? next : next.map((p) => (parked.has(p.id) ? { ...p, live: false } : p));
  };
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

  /** Tokens live in refs: every closure of every render reads the same turn, however many commits a flushSync makes inside it. */
  const seqRef = useRef(0);
  const tokensRef = useRef<Map<string, Token>>(new Map());
  const closeTokenRef = useRef(0);
  const [published, release] = useReducer((a: number, b: number) => Math.max(a, b), 0);
  // No dependency list: every commit deletes the tokens whose call finished before it was rendered.
  useLayoutEffect(() => {
    for (const [id, t] of tokensRef.current) if (t.token <= published) tokensRef.current.delete(id);
    if (closeTokenRef.current <= published) closeTokenRef.current = 0;
  });
  const gate: OperationGate = {
    busy: (ids, kind) => {
      if (ids.some((id) => tokensRef.current.has(id))) return true;
      if (kind === 'close') return [...tokensRef.current.values()].some((t) => t.source === 'manager');
      return closeTokenRef.current !== 0;
    },
    take: (ids, kind) => {
      if (gate.busy(ids, kind)) return undefined;
      const token = ++seqRef.current;
      for (const id of ids) tokensRef.current.set(id, { token, source: 'manager', kind });
      if (kind === 'close') closeTokenRef.current = token;
      return token;
    },
    takeRaw: (ids, kind) => {
      if (ids.some((id) => tokensRef.current.get(id)?.source === 'manager')) return undefined;
      const token = ++seqRef.current;
      for (const id of ids) tokensRef.current.set(id, { token, source: 'raw', kind });
      return token;
    },
    release,
    leaving: () => new Set([...tokensRef.current].filter(([, t]) => t.kind !== 'other').map(([id]) => id)),
  };

  /** Free slots a row leaves for `live` (its live collapsible panels): capacity priced from their own widths, less their count. Infinity while unmeasured. */
  const freeSlots = (live: readonly PanelWindow[]): number => capacityFor(live.map(widthOf)) - live.length;
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
        continue;
      }
      const parked = panels.find((p) => p.id === id);
      if (parked !== undefined && parkLevers(parked).capacityReturn === 'manual') {
        writeHold(id, 'sticky');
        forgetCollapsed(id);
      } else {
        pushCollapsed([id]);
      }
    }
  };
  /** What a placement of `p` resolves against: the row's root and the panel's own `placeFallback`. */
  const placing = (p: PanelWindow) => ({ rootId, fallback: effective(p).placeFallback, ...(options?.order !== undefined ? { order: options.order } : {}) });
  const noteHold = (p: PanelWindow): void => {
    if (!effective(p).listed) noteOnce(holdUnlistedNote(p.id));
  };

  const wouldEmptyRow = (ids: readonly string[]): boolean => {
    const gone = new Set([...ids, ...inFlight(), ...gate.leaving()]);
    return !panels.some((p) => isPresent(p) && !(p.collapsible && gone.has(p.id)));
  };

  const holdPanel = (id: string, kind: 'sticky' | 'until-room'): boolean => {
    const target = panels.find((p) => p.id === id);
    if (!target?.collapsible) return false;
    if ((!target.live && heldRef.current.has(id)) || inFlight().has(id)) return false;
    if (effective(target).hideWhenLast === 'refuse' && wouldEmptyRow([id])) return false;
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
    const capacityAfter = targetId === undefined ? capacity : pricing(afterInsert).capacityFor(panels.filter(isParkLive).map(widthOf));
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
      const id = farthestLiveCollapsibleId(scratch, targetIndex, exempt, parkLevers(afterInsert[targetIndex]!).evictionOrder);
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

  /**
   * Clicking ANY row -- live or parked alike -- activates it (promoteToLive's own doc
   * comment has the full "make/keep it live, preserve array order" spec).
   */
  const handleActivatePanel = (id: string): void => {
    const target = panels.find((p) => p.id === id);
    if (!target || target.live) return;
    markKeepLive(id);
    const keep = [...keptIds()];
    // A manual History-row activation enters from the right (or by its own `anchoredEnter`), so it drops any
    // anchor-entry or gesture-side mark left from an earlier reveal of this id.
    forgetEnteringViaAnchor(id);
    clearEnterSide(id);
    // Re-placed before it goes live, in the same update; the updaters below place again over the latest list.
    const showAt = effective(target).placeOnShow;
    const placed = placePanel(panels, id, showAt, placing(target));
    const placeFirst = (row: PanelWindow[]): PanelWindow[] => placePanel(row, id, showAt, placing(target)).row;
    const before = showAt === 'in-place' ? panels : placed.row;
    const result = promoteToLive(before, id, capacity, keptIds());
    if (!result) return;
    reportNotes(options?.onNote, placed.notes);
    if (showAt !== 'in-place') setEnterSide(id, sideOfLiveRange(result, id));
    forgetCollapsed(id);
    releaseHold(id);
    const demoted = result.find((p) => !p.live && before.find((prev) => prev.id === p.id)?.live);
    if (!demoted) {
      // An updater, not `result`: `result` is built from this render's array and would drop an update queued
      // earlier in the same handler.
      setPanels((prev) => settledKeeping(promoteToLive(placeFirst(prev), id, Number.POSITIVE_INFINITY) ?? prev, keep));
      return;
    }
    if (sideOfLiveRange(before, demoted.id) === 'right') markExitRight(demoted.id);
    recordPark([demoted.id], { kind: 'capacity' });
    // Applied in two functional updates, in this order: `id` goes live first (no demotion yet -- capacity
    // Infinity guarantees that for this call only), then the panel it displaces is parked.
    setPanels((prev) => promoteToLive(placeFirst(prev), id, Number.POSITIVE_INFINITY) ?? prev);
    setPanels((current) => settledKeeping(current.map((p) => (p.id === demoted.id ? { ...p, live: false } : p)), keep));
  };

  /** See `UsePanelManagerResult.scrollRow`'s own doc comment. */
  const scrollRow = (direction: 'left' | 'right'): void => {
    const reveal = direction === 'right' ? firstParkedAfter(panels, rightmostLiveIndex(panels)) : lastParkedBefore(panels, leftmostLiveIndex(panels));
    if (!reveal) return;
    const kept = keptIds();
    markKeepLive(reveal.id);
    // A resize earlier in this handler is priced at its new tier, or the row committed below could overflow.
    const sized = withPendingTiers(panels);
    const live = sized.filter(isParkLive);
    const farFirst = (direction === 'right' ? live : [...live].reverse()).filter((p) => !kept.has(p.id));
    const toPark = new Set<string>();
    const rowAfter = (): PanelWindow[] => sized.filter((p) => (isParkLive(p) || (p.id === reveal.id && parksForRoom(p))) && !toPark.has(p.id));
    // At least the one panel the gesture swaps out, then more only while the row with `reveal` would not settle.
    for (const p of farFirst) {
      if (toPark.size > 0 && settles(rowAfter())) break;
      toPark.add(p.id);
    }
    setEnterSide(reveal.id, direction);
    // A leftward gesture parks off the RIGHT edge: mark those BEFORE the setPanels below, in their own commit.
    if (direction === 'left' && toPark.size > 0) flushOwn(() => setExitRightIds((prev) => new Set([...prev, ...toPark])));
    recordPark([...toPark], { kind: 'capacity' });
    forgetCollapsed(reveal.id);
    releaseHold(reveal.id);
    setPanels((prev) => prev.map((p) => (toPark.has(p.id) ? { ...p, live: false } : p.id === reveal.id ? { ...p, live: true } : p)));
  };

  /** See `UsePanelManagerResult.reorderPanel`'s own doc comment. */
  const reorderPanel = (id: string, direction: 'left' | 'right', record = true): boolean => {
    setPanels((prev) => {
      const moved = movePanel(prev, id, direction, rootId);
      // A drag settles every panel's place for the person, not only the dragged one's.
      return moved === prev || !record ? moved : recordOverride(moved, 'anchor', moved.map((p) => p.id), rootId);
    });
    return movePanel(panels, id, direction, rootId) !== panels;
  };

  /** See `UsePanelManagerResult.placeAt`'s own doc comment. */
  const placeAt = (id: string, value: AddPlacement | 'in-place', record = true): boolean => {
    const target = panels.find((p) => p.id === id);
    if (target === undefined || value === 'in-place') return false;
    const sameRow = (a: readonly PanelWindow[], b: readonly PanelWindow[]): boolean =>
      a.length === b.length && a.every((p, k) => p.id === b[k]!.id && p.anchor?.panel === b[k]!.anchor?.panel && p.anchor?.position === b[k]!.anchor?.position && p.anchor?.priority === b[k]!.anchor?.priority);
    const placed = placePanel(panels, id, value, placing(target));
    reportNotes(options?.onNote, placed.notes);
    setPanels((prev) => {
      const next = placePanel(prev, id, value, placing(target)).row;
      if (sameRow(prev, next)) return prev;
      return record ? recordOverride(next, 'anchor', next.map((p) => p.id), rootId) : next;
    });
    return !sameRow(panels, placed.row);
  };

  /** See `UsePanelManagerResult.resizePanel`'s own doc comment. */
  const resizePanel = (id: string, next: FormFactor, record = true): boolean => {
    if (setFormFactor(panels, id, next) === panels) return false;
    const wasLive = panels.find((p) => p.id === id)?.live === true;
    markKeepLive(id);
    const keep = [...keptIds()];
    const pending = pendingTiersRef.current.seen === panels ? pendingTiersRef.current.tiers : [];
    pendingTiersRef.current = { seen: panels, tiers: new Map(pending).set(id, next) };
    if (wasLive) {
      purgeExitRight(id);
      forgetCollapsed(id);
    }
    setPanels((prev) => {
      const resized = setFormFactor(prev, id, next);
      // An earlier call in this same handler may have queued a park of it (its exit mark and stack entry are
      // dropped above): a resize never parks its own panel, so that park is cancelled before anything commits.
      const own = wasLive && resized.some((p) => p.id === id && !p.live) ? resized.map((p) => (p.id === id ? { ...p, live: true } : p)) : resized;
      const settled = settledKeeping(own, keep);
      return record ? recordOverride(settled, 'formFactor', [id], rootId) : settled;
    });
    return true;
  };

  /**
   * Reconciles the live set against `capacity` whenever either changes -- an effect, since it must act on a
   * measurement that just changed, not one this render was given. Both branches judge a candidate set by `settles`,
   * never `capacity` as a count: `capacity` prices every not-yet-live slot at `phoneWidth`, so WHICH panels park or
   * return decides whether the rest fits, and a set that does not settle re-triggers a branch next render. A DROP
   * parks `fewestParksThatSettle` and exits 'left' (flushSync cannot mark a right exit first from a passive effect).
   * A RISE reveals from the top of `collapseOrderRef`; one that doesn't settle stays on the stack for an OLDER, narrower one.
   */
  const committedRef = useRef(panels);
  useEffect(() => {
    // `settledKeeping` parks inside a state update, where no call-time code sees which panels it chose: the
    // stack learns of any park not already on it from the commit itself.
    const before = committedRef.current;
    committedRef.current = panels;
    // A panel added parked is held per its own setting; a hold whose panel is gone (clearAll wipes without a close) is dropped.
    for (const p of panels) if (p.collapsible && !p.live && !before.some((q) => q.id === p.id)) markHeld(p.id, effective(p).hideStickiness);
    for (const id of heldRef.current.keys()) if (!panels.some((p) => p.id === id)) releaseHold(id);
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
    } else if (live.length < capacity && collapseOrderRef.current.length > 0) {
      const stack = collapseOrderRef.current;
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
      collapseOrderRef.current = stack.filter((id) => !revealed.has(id) && !stale.has(id));
      // Each returning panel is placed by its own `placeOnReturn`, in return order, in the update that makes it live.
      const placements = [...revealed].flatMap((id) => {
        const returning = panels.find((p) => p.id === id)!;
        const value = effective(returning).placeOnReturn;
        return value === 'in-place' ? [] : [{ id, value, at: placing(returning) }];
      });
      const placeAll = (row: PanelWindow[]): PanelWindow[] => placements.reduce((acc, { id, value, at }) => placePanel(acc, id, value, at).row, row);
      let landing = panels;
      for (const { id, value, at } of placements) {
        const result = placePanel(landing, id, value, at);
        reportNotes(options?.onNote, result.notes);
        landing = result.row;
      }
      const landed = landing.map((p) => (revealed.has(p.id) ? { ...p, live: true } : p));
      for (const id of revealed) {
        releaseHold(id);
        setEnterSide(id, sideOfLiveRange(placements.some((x) => x.id === id) ? landed : panels, id));
      }
      setPanels((current) => placeAll(current).map((p) => (revealed.has(p.id) ? { ...p, live: true } : p)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, panels]);

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
    const sized = withPendingTiers(panelsAfterClose);
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
    const returnAt = effective(returning).placeOnReturn;
    if (returnAt === 'in-place') {
      // One of the two "reappearance" paths that enter from the anchor's side -- mark it BEFORE the setPanels
      // call below; no flushSync, since the mark only has to be in the commit that mounts the slot.
      markEnteringViaAnchor(revealId);
      setPanels((current) => promoteToLive(current, revealId, Number.POSITIVE_INFINITY) ?? current);
      return;
    }
    const placed = placePanel(panelsAfterClose, revealId, returnAt, placing(returning));
    reportNotes(options?.onNote, placed.notes);
    setEnterSide(revealId, sideOfLiveRange(placed.row, revealId));
    setPanels((current) => promoteToLive(placePanel(current, revealId, returnAt, placing(returning)).row, revealId, Number.POSITIVE_INFINITY) ?? current);
  };

  return {
    revealPanelProactively,
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
    gate,
    enterSideById: enterSideRef.current,
    exitRightIds,
    holdPanel,
    releaseHold,
    heldIds: heldRef.current,
    wouldEmptyRow,
    markHeld,
  };
}

/**
 * The ids (row order) to park so the live panels left settle: as FEW as possible, and among equally few the lowest
 * `evictionRank` first, then the `tieBreak` end: the LEFTMOST by default, so a row of equal widths parks exactly its
 * leftmost excess, and a wide panel parks alone when that is what leaves the most panels live. Each of `keepIds`
 * (in the order they were acted on) is never parked, whatever that costs the others, unless the ones before it
 * already fill the row.
 * @internal
 */
export function fewestParksThatSettle(
  live: readonly PanelWindow[],
  widthOf: (p: PanelWindow) => number,
  settles: (set: readonly PanelWindow[]) => boolean,
  keepIds: readonly string[] = [],
  tieBreak: 'leftmost' | 'rightmost' = 'leftmost',
): string[] {
  const narrowestFirst = (set: readonly PanelWindow[]): PanelWindow[] => [...set].sort((a, b) => widthOf(a) - widthOf(b));
  const inRowOrder = (set: readonly PanelWindow[]): PanelWindow[] => live.filter((p) => set.includes(p));
  // The first kept panel alone always settles (capacity is >= 1).
  const mustKeep: PanelWindow[] = [];
  for (const id of keepIds) {
    const p = live.find((q) => q.id === id);
    if (p && !mustKeep.includes(p) && settles(inRowOrder([...mustKeep, p]))) mustKeep.push(p);
  }
  const candidates = live.filter((p) => !mustKeep.includes(p));
  // Parked first to last; the sort is stable, so equal ranks keep the tie-break's end first.
  const parkOrder = (tieBreak === 'rightmost' ? [...candidates].reverse() : [...candidates]).sort((a, b) => parkLevers(a).evictionRank - parkLevers(b).evictionRank);
  // Whether a set settles depends only on its size and its width sum, so the k narrowest candidates are the
  // cheapest k to keep: if they do not settle, no k do.
  let keep = candidates.length;
  while (keep > 0 && mustKeep.length + keep > 1 && !settles(inRowOrder([...mustKeep, ...narrowestFirst(candidates).slice(0, keep)]))) keep--;
  const kept: PanelWindow[] = [...mustKeep];
  const toPark: string[] = [];
  parkOrder.forEach((p, i) => {
    const stillToKeep = keep - (kept.length - mustKeep.length);
    const rest = parkOrder.slice(i + 1);
    // Park `p` only if what is left after it can still complete a set that settles.
    const canPark =
      toPark.length < candidates.length - keep && rest.length >= stillToKeep && settles(inRowOrder([...kept, ...narrowestFirst(rest).slice(0, stillToKeep)]));
    if (canPark) toPark.push(p.id);
    else kept.push(p);
  });
  return inRowOrder(toPark.map((id) => live.find((p) => p.id === id)!)).map((p) => p.id);
}
