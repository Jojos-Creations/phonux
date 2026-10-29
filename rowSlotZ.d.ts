/**
 * The stacking of a row's slots: one rule for every speed and direction. A slot's z-index rises by two per step
 * from either end of the row toward its middle, so a slot nearer the middle is always drawn over one nearer an edge,
 * and a slot entering or leaving sits one level under its own rank, between it and the next rank out. An entry or
 * an exit at an edge thus always tucks under its inner neighbor, however many are in flight on that edge and
 * whichever way the last step went, and two slots in flight on one edge keep their row order among themselves.
 * @internal
 */
import * as React from 'react';
/** How many steps `index` is from the nearer end of a row of `count` slots: 0 at either end, highest at the middle. */
export declare function centerRank(index: number, count: number): number;
/**
 * The z-index of a slot in the `tier` layer (`ROW_LAYER_Z.BASE` or `RAISED`) at `rank`; `moving` is a slot entering or
 * leaving the row, drawn one level under its rank. Never below 0, so an entry at the edge of the base tier sits at 0,
 * under the whole row, and never into the next tier: the tiers are 99 apart and a rank is at most 31.
 */
export declare function slotZ(tier: number, rank: number, moving: boolean): number;
/** The z-index of a new open growing from its center: under the whole row, so it never paints over the panel sliding out of its slot. */
export declare const OPEN_Z: number;
/**
 * The order the row draws its slots in for ranking: `present` in row order, with each id of `before` that is no longer
 * present but still `mounted` (its exit still running) kept at the place it had, after the nearest id before it that is
 * still drawn. An exiting slot thus keeps counting from its edge, so two leaving by one edge stay in their row order.
 */
export declare function drawnOrder(before: readonly string[], present: readonly string[], mounted: ReadonlySet<string>): string[];
/** The rank of every id in `drawn`. */
export declare function ranksOf(drawn: readonly string[]): ReadonlyMap<string, number>;
/**
 * What a slot reads its rank from, and tells the row its mount by. A context, not a prop: AnimatePresence renders a leaving
 * slot with the props it left with, and the rank must follow the row while it leaves.
 */
export interface SlotRanks {
    readonly ranks: ReadonlyMap<string, number>;
    /** Marks `id`'s slot mounted; returns what unmarks it, which re-ranks the row. */
    readonly mounted: (id: string) => () => void;
}
export declare const SlotRanksContext: React.Context<SlotRanks>;
/** The row's rank store: ranks over the drawn order of this render, from the present ids and the slots still mounted. */
export declare function useSlotRanks(presentIds: readonly string[]): SlotRanks;
