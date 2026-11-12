/**
 * The row's pricing and its capacity settle: pure functions of a row and the workspace's numbers. The list hook settles
 * the row with them before anything reads it, and the panel manager prices the same row with them, so the two agree.
 */
import { computeRowNumbers } from '../rowNumbers.js';
import { panelWidthOf } from '../panelTiers.js';
import { parksForRoom } from '../panelWindow.js';
/** Live and parkable for room: the panels whose count and widths the capacity governs. */
export const isParkLive = (p) => p.live && parksForRoom(p);
/**
 * What prices `row`: panel widths, how many parkable panels may be live, whether a live set settles. The row is one continuous
 * strip (Embla): every panel has its slot on it, so nothing parks for room or for the cap, and every live set settles.
 */
export function rowPricing(env, row) {
    const numbers = computeRowNumbers({ entries: row, phoneWidth: env.phoneWidth, containerWidth: env.containerWidth, gap: env.gap, fixedItemCount: env.fixedColumnCount });
    const widthOf = (p) => panelWidthOf(p, env.phoneWidth, numbers.maxLiveWidth, env.gap);
    const capacityFor = (_set, _fitWidths) => Number.POSITIVE_INFINITY;
    const settles = (_set) => true;
    return { widthOf, capacityFor, settles };
}
/** `next` as it is: on a strip no committed row overflows, so nothing parks. */
export function settleKeeping(_env, next, _keep) {
    return next;
}
