/**
 * The stacking of a row's slots: one rule for every speed and direction. A slot's z-index rises by two per step
 * from either end of the row toward its middle, so a slot nearer the middle is always drawn over one nearer an edge,
 * and a slot entering or leaving sits one level under its own rank, between it and the next rank out. An entry or
 * an exit at an edge thus always tucks under its inner neighbor, however many are in flight on that edge and
 * whichever way the last step went, and two slots in flight on one edge keep their row order among themselves.
 * @internal
 */
import * as React from 'react';
import { ROW_LAYER_Z } from './rowConstants.js';
/** How many steps `index` is from the nearer end of a row of `count` slots: 0 at either end, highest at the middle. */
export function centerRank(index, count) {
    if (index < 0 || index >= count)
        return 0;
    return Math.min(index, count - 1 - index);
}
/**
 * The z-index of a slot in the `tier` layer (`ROW_LAYER_Z.BASE` or `RAISED`) at `rank`; `moving` is a slot entering or
 * leaving the row, drawn one level under its rank. Never below 0, so an entry at the edge of the base tier sits at 0,
 * under the whole row, and never into the next tier: the tiers are 99 apart and a rank is at most 31.
 */
export function slotZ(tier, rank, moving) {
    return Math.max(0, tier + 2 * rank - (moving ? 1 : 0));
}
/** The z-index of a new open growing from its center: under the whole row, so it never paints over the panel sliding out of its slot. */
export const OPEN_Z = ROW_LAYER_Z.BASE - 1;
/**
 * The order the row draws its slots in for ranking: `present` in row order, with each id of `before` that is no longer
 * present but still `mounted` (its exit still running) kept at the place it had, after the nearest id before it that is
 * still drawn. An exiting slot thus keeps counting from its edge, so two leaving by one edge stay in their row order.
 */
export function drawnOrder(before, present, mounted) {
    const presentSet = new Set(present);
    const drawn = [...present];
    for (let i = 0; i < before.length; i++) {
        const id = before[i];
        if (presentSet.has(id) || !mounted.has(id) || drawn.includes(id))
            continue;
        let at = 0;
        for (let j = i - 1; j >= 0; j--) {
            const index = drawn.indexOf(before[j]);
            if (index !== -1) {
                at = index + 1;
                break;
            }
        }
        drawn.splice(at, 0, id);
    }
    return drawn;
}
/** The rank of every id in `drawn`. */
export function ranksOf(drawn) {
    return new Map(drawn.map((id, i) => [id, centerRank(i, drawn.length)]));
}
const NO_RANKS = { ranks: new Map(), mounted: () => () => { } };
export const SlotRanksContext = React.createContext(NO_RANKS);
/** The row's rank store: ranks over the drawn order of this render, from the present ids and the slots still mounted. */
export function useSlotRanks(presentIds) {
    const [, bump] = React.useReducer((n) => n + 1, 0);
    const state = React.useRef({ before: [], mountedIds: new Set() });
    const drawn = drawnOrder(state.current.before, presentIds, state.current.mountedIds);
    state.current.before = drawn;
    const mounted = React.useCallback((id) => {
        state.current.mountedIds.add(id);
        return () => {
            state.current.mountedIds.delete(id);
            bump();
        };
    }, []);
    return React.useMemo(() => ({ ranks: ranksOf(drawn), mounted }), [drawn.join('\u0000'), mounted]);
}
