/**
 * The look tuning as one value per render: the workspace's leaves resolved over the library defaults, and the slice of it
 * each slot reads.
 */
import * as React from 'react';
import { LIBRARY_TUNING_DEFAULTS, checkTuningLeaf } from './panelSettings.js';
/** The height in px the Workspace's scroll container leaves for the row (its padding taken out); 0 until measured, and always in an environment that does no layout. */
export const RowHeightContext = React.createContext(0);
const OBJECT_LEAVES = new Set(['dragToClose', 'slide', 'edgeScroll', 'chrome']);
/** What this module resolved: handing one on to another resolve keeps its identity, so a context value does not change for nothing. */
const RESOLVED = new WeakSet([LIBRARY_TUNING_DEFAULTS]);
function frozenCopy(value) {
    if (Array.isArray(value))
        return Object.freeze(value.map(frozenCopy));
    if (typeof value === 'object' && value !== null)
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, member]) => [key, frozenCopy(member)])));
    return value;
}
/**
 * `tuning` over the library defaults, member by member. A member the settings resolver would refuse (out of range,
 * the wrong type, unknown) keeps its default and nothing throws: this input has no caller to refuse it to.
 */
export function resolveWorkspaceTuning(tuning) {
    if (typeof tuning !== 'object' || tuning === null)
        return LIBRARY_TUNING_DEFAULTS;
    if (RESOLVED.has(tuning))
        return tuning;
    const out = {};
    for (const leaf of Object.keys(LIBRARY_TUNING_DEFAULTS)) {
        const fallback = LIBRARY_TUNING_DEFAULTS[leaf];
        const given = tuning[leaf];
        const accepted = given === undefined ? undefined : checkTuningLeaf(leaf, given).accepted;
        out[leaf] = accepted === undefined ? fallback : OBJECT_LEAVES.has(leaf) ? { ...fallback, ...accepted } : accepted;
    }
    if (tuning.shrinkOutOfView !== undefined)
        checkTuningLeaf('shrinkOutOfView', tuning.shrinkOutOfView);
    const resolved = frozenCopy(out);
    RESOLVED.add(resolved);
    return resolved;
}
const SLOTS = new WeakMap();
/** The slice of the workspace's tuning every slot reads; one object per resolved tuning, so a context value does not change for nothing. */
export function slotTuning(workspace) {
    let slot = SLOTS.get(workspace);
    if (slot === undefined) {
        const view = { rowGap: workspace.rowGap, dragToClose: workspace.dragToClose, slide: workspace.slide, hopFraction: workspace.hopFraction, edgeScroll: workspace.edgeScroll };
        slot = { ...view, chrome: workspace.chrome, view };
        SLOTS.set(workspace, slot);
    }
    return slot;
}
