/**
 * The arithmetic of side-by-side spaces, React-free: how the slots of a window divide among the spaces a column shows, and what a
 * divider may do. DESIGN.md, "Side by side".
 */
import { stickyKept, type StickyCandidate } from './rowNumbers.js';

/** One space the saved split asks the window to show. @internal */
export interface SideSpace {
  /** The workspace's id. */
  id: string;
  /** The row slots the saved split gives it, sticky panels not counted. */
  rows: number;
  /** Its sticky panels. */
  sticky: readonly StickyCandidate[];
  /** Every panel it draws, sticky or not. */
  panels: number;
}

/** What `planSides` is asked. @internal */
export interface SidePlanInput {
  /** The spaces in the saved order, left to right. */
  spaces: readonly SideSpace[];
  /** The index of the current space in `spaces`. */
  current: number;
  /** The whole slots the window holds; 0 while it is unmeasured. */
  windowSlots: number;
  /** `tuning.minScrollSlots`. */
  minScrollSlots: number;
}

/** One space the window shows. @internal */
export interface SideCell {
  /** The workspace's id. */
  id: string;
  /** The slots the cell takes: its row and its sticky panels. */
  slots: number;
  /** The slots of the scrolling row, a sticky panel that went back into it included. */
  rowSlots: number;
  /** The slots the sticky panels in effect take. */
  sticky: number;
}

/** The least row slots a side keeps when spaces share the window: one, or `minScrollSlots` when that is more. @internal */
export const minRowSlots = (minScrollSlots: number): number => Math.max(1, minScrollSlots);

/** Where `pos` stands from the current space: the nearer first, and of equal distance the one on the left. */
const distance = (pos: number, current: number): number => Math.abs(pos - current);

/**
 * The cells the window shows, left to right, in whole slots.
 *
 * One space alone gets every slot and the row's own rule (`stickyKept`). Several spaces need `minRowSlots` each, so the one farthest
 * from the current space leaves until they fit (it stays in the saved list). Then, while the saved split and the sticky panels ask
 * for more than the window holds: sticky panels go back into their rows first (the lowest rank first, of equal rank the later one in
 * the column read as one row, as `stickyKept` does), then the sides the person is not in give up slots, the widest first, down to
 * `minRowSlots`, and only then the current side. A window with room to spare gives the rest to the current space and then the
 * nearest ones, one slot at a time.
 * Every cell is exactly `rowSlots` plus the slots of its sticky panels, which is what the cell's own row works out from its width
 * when it is told `rowSlots` as its least scrolling room.
 * @internal
 */
export function planSides(i: SidePlanInput): SideCell[] {
  const { spaces, current } = i;
  const cur = spaces[current];
  if (cur === undefined) return [];
  if (!(i.windowSlots > 0)) return [{ id: cur.id, slots: 0, rowSlots: 0, sticky: 0 }];
  const room = i.windowSlots;
  const least = minRowSlots(i.minScrollSlots);
  let kept = spaces.map((_, pos) => pos);
  while (kept.length > 1 && kept.length * least > room) {
    let farthest = kept[0]!;
    for (const pos of kept) {
      const d = distance(pos, current);
      const f = distance(farthest, current);
      if (d > f || (d === f && pos > farthest)) farthest = pos;
    }
    kept = kept.filter((pos) => pos !== farthest);
  }
  if (kept.length === 1) {
    const only = spaces[kept[0]!]!;
    const sticky = stickyKept(only.sticky, only.panels, room, i.minScrollSlots).reduce((sum, c) => sum + c.slots, 0);
    return [{ id: only.id, slots: room, rowSlots: room - sticky, sticky }];
  }
  const rows = new Map(kept.map((pos) => [pos, Math.max(least, Math.trunc(spaces[pos]!.rows))]));
  const stays = new Map(kept.map((pos) => [pos, [...spaces[pos]!.sticky]]));
  const size = (pos: number): number => rows.get(pos)! + stays.get(pos)!.reduce((sum, c) => sum + c.slots, 0);
  const demand = (): number => kept.reduce((sum, pos) => sum + size(pos), 0);
  // The room a space may be given first: the current one, then those nearer to it.
  const nearest = [...kept].sort((a, b) => distance(a, current) - distance(b, current) || a - b);
  const share = (): void => {
    for (let k = 0; demand() < room; k = (k + 1) % nearest.length) rows.set(nearest[k]!, rows.get(nearest[k]!)! + 1);
  };
  if (demand() < room) share();
  if (demand() > room) {
    const back = kept
      .flatMap((pos) => stays.get(pos)!.map((c) => ({ pos, c })))
      .sort((a, b) => a.c.rank - b.c.rank || b.pos - a.pos || b.c.k - a.c.k);
    for (const { pos, c } of back) {
      if (demand() <= room) break;
      stays.set(pos, stays.get(pos)!.filter((x) => x !== c));
    }
    if (demand() < room) share();
  }
  while (demand() > room) {
    // The sides the person is not in give up slots first; the current side gives up only when every other is down to its least.
    let widest: number | undefined;
    for (const pos of kept) {
      if (pos === current || rows.get(pos)! <= least) continue;
      if (widest === undefined) widest = pos;
      else {
        const [a, b] = [size(pos), size(widest)];
        if (a > b || (a === b && (distance(pos, current) > distance(widest, current) || (distance(pos, current) === distance(widest, current) && pos > widest)))) widest = pos;
      }
    }
    if (widest === undefined && rows.get(current)! > least) widest = current;
    if (widest === undefined) break;
    rows.set(widest, rows.get(widest)! - 1);
  }
  return kept.map((pos) => {
    const sticky = stays.get(pos)!.reduce((sum, c) => sum + c.slots, 0);
    return { id: spaces[pos]!.id, slots: rows.get(pos)! + sticky, rowSlots: rows.get(pos)!, sticky };
  });
}

/** Why a split is refused, or null when it may be set: one entry per cell, each a whole number of at least `least`, and no more than the window holds. @internal */
export function splitProblem(rows: readonly number[], cells: number, windowSlots: number, least: number): string | null {
  if (rows.length !== cells) return `the split names ${rows.length} spaces and the window shows ${cells}`;
  const bad = rows.findIndex((r) => !Number.isInteger(r) || r < least);
  if (bad >= 0) return `side ${bad + 1} gets ${String(rows[bad])} row panels, and every side keeps at least ${least} whole one${least === 1 ? '' : 's'}`;
  const total = rows.reduce((sum, r) => sum + r, 0);
  if (total > windowSlots) return `the split asks for ${total} row panels and the window holds ${windowSlots} slots`;
  return null;
}

/** The least and most row slots the side left of divider `at` may take while the side right of it keeps `least`. @internal */
export function dividerRange(rows: readonly number[], at: number, least: number): { min: number; max: number } {
  const total = (rows[at] ?? 0) + (rows[at + 1] ?? 0);
  return { min: least, max: Math.max(least, total - least) };
}

/** `rows` with divider `at` moved `by` slots toward the right, the two sides it parts trading slots and neither going under `least`. @internal */
export function shiftDivider(rows: readonly number[], at: number, by: number, least: number): number[] {
  if (at < 0 || at + 1 >= rows.length) return [...rows];
  const { min, max } = dividerRange(rows, at, least);
  const left = Math.min(max, Math.max(min, rows[at]! + Math.trunc(by)));
  const total = rows[at]! + rows[at + 1]!;
  return rows.map((r, k) => (k === at ? left : k === at + 1 ? total - left : r));
}

/**
 * The row slots of cells that share `windowSlots` as evenly as whole slots allow, the leftmost taking the odd slot, counting each
 * cell's sticky panels in its share; a cell whose share is no more than its sticky panels still keeps `least`.
 * @internal
 */
export function evenRows(sticky: readonly number[], windowSlots: number, least: number): number[] {
  const n = sticky.length;
  if (n === 0) return [];
  const rows = sticky.map((s, k) => Math.max(least, Math.floor(windowSlots / n) + (k < windowSlots % n ? 1 : 0) - s));
  const sizeOf = (k: number): number => rows[k]! + sticky[k]!;
  for (let guard = 0; guard < 4096; guard++) {
    const total = rows.reduce((sum, r, k) => sum + r + sticky[k]!, 0);
    if (total === windowSlots) break;
    if (total > windowSlots) {
      let widest = -1;
      for (let k = n - 1; k >= 0; k--) if (rows[k]! > least && (widest < 0 || sizeOf(k) > sizeOf(widest))) widest = k;
      if (widest < 0) break;
      rows[widest]!--;
    } else {
      let narrowest = 0;
      for (let k = 1; k < n; k++) if (sizeOf(k) < sizeOf(narrowest)) narrowest = k;
      rows[narrowest]!++;
    }
  }
  return rows;
}
