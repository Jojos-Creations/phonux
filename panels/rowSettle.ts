/**
 * The row's pricing and its capacity settle: pure functions of a row and the workspace's numbers. The list hook settles
 * the row with them before anything reads it, and the panel manager prices the same row with them, so the two agree.
 */

import { computeRowNumbers } from '../rowNumbers.js';
import { isPresent } from '../panelRowEntry.js';
import { panelWidthOf } from '../panelTiers.js';
import { effectiveMaxPanels, rowFitCount } from '../panelCapacity.js';
import type { WorkspaceTuning } from '../panelSettings.js';
import { parkLevers, parksForRoom, type PanelWindow } from '../panelWindow.js';
import type { RowRest } from '../rowRest.js';

/** The workspace numbers a row is priced against. `maxLive` is null without a cap. */
export interface RowEnv {
  readonly phoneWidth: number;
  readonly containerWidth: number;
  readonly gap: number;
  readonly fixedColumnCount: number;
  readonly maxLive: number | null;
  readonly dropTieBreak: NonNullable<WorkspaceTuning['dropTieBreak']>;
  /** The blanks the row rests with: each one is a slot no parked panel may fill. */
  readonly rest?: RowRest | null;
}

/** Live and parkable for room: the panels whose count and widths the capacity governs. */
export const isParkLive = (p: PanelWindow): boolean => p.live && parksForRoom(p);

/**
 * What prices `row`: panel widths, how many parkable panels may be live, whether a live set settles. A scroll panel never parks, so its width comes off the budget instead of counting.
 */
export function rowPricing(env: RowEnv, row: readonly PanelWindow[]) {
  const { phoneWidth, containerWidth, gap, fixedColumnCount, maxLive } = env;
  const blanks = env.rest == null ? 0 : env.rest.lead + env.rest.tail + (env.rest.head ?? 0);
  const numbers = computeRowNumbers({ entries: row, phoneWidth, containerWidth, gap, fixedItemCount: fixedColumnCount });
  // Only a row with a scroll panel, or a fixed column wider than a phone, prices its reserved widths one by one; any other keeps the fixed column count the host passed.
  const widerThanPhone = row.some((p) => isPresent(p) && !p.collapsible && panelWidthOf(p, phoneWidth, numbers.maxLiveWidth, gap) !== phoneWidth);
  const reservedWidths = widerThanPhone || row.some((p) => isPresent(p) && !parksForRoom(p) && p.collapsible) ? numbers.reservedWidths : undefined;
  const widthOf = (p: PanelWindow): number => panelWidthOf(p, phoneWidth, numbers.maxLiveWidth, gap);
  const fitCapacityFor = (liveWidths: readonly number[]): number => {
    // `containerWidth === 0` means unmeasured (the first commit, and every jsdom test that never calls
    // measure()): null means no cap and no reconcile, never "zero panels fit".
    const fitCount = rowFitCount({ containerWidth: containerWidth === 0 ? 0 : Math.max(1, containerWidth - blanks * (phoneWidth + gap)), phoneWidth, gap, fixedColumnCount, liveWidths, reservedWidths });
    const effectiveMax = effectiveMaxPanels(fitCount, fixedColumnCount);
    // Floor of 1 keeps the panel just opened on screen even at the narrowest legal width (effectiveMaxPanels
    // already floors at fixedColumnCount + 1, so this bites only when the fixed columns alone reach effectiveMax).
    return effectiveMax === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(1, effectiveMax - fixedColumnCount);
  };
  /**
   * How many panels `set` (live parkable, row order) may number: the window's fit (priced from `fitWidths`, else `set`'s
   * own), held under a cap to at most N. A scrolling row under a cap ignores the fit.
   */
  const capacityFor = (set: readonly PanelWindow[], fitWidths: readonly number[] = set.map(widthOf)): number => {
    if (maxLive === null) return fitCapacityFor(fitWidths);
    const fit = numbers.rowScroll ? Number.POSITIVE_INFINITY : fitCapacityFor(fitWidths);
    return Math.max(1, Math.min(fit, maxLive - blanks));
  };
  /** Whether `set` (live parkable panels, row order) can stay live as it is: the one test both reconcile branches settle against. */
  const settles = (set: readonly PanelWindow[]): boolean => set.length <= capacityFor(set);
  return { widthOf, capacityFor, settles };
}

/** `next`, plus in the same update whatever the reconcile's DROP would park, so no committed row overflows. */
export function settleKeeping(env: RowEnv, next: PanelWindow[], keep: readonly string[]): PanelWindow[] {
const { dropTieBreak } = env;
  const live = next.filter(isParkLive);
  const priced = rowPricing(env, next);
  if (priced.settles(live)) return next;
  const parked = new Set(fewestParksThatSettle(live, priced.widthOf, priced.settles, keep, dropTieBreak));
  return parked.size === 0 ? next : next.map((p) => (parked.has(p.id) ? { ...p, live: false } : p));
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
