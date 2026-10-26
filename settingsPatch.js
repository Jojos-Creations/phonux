/**
 * The shapes a change to a settings layer takes, and the one pure step that applies it. `null` deletes a value
 * from the instance layer; `undefined` never changes anything. The patch is not validated here: the layer it
 * produces is validated when the whole stack is resolved again.
 */
import { sameSettingsValue } from './panelSettings.js';
const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Merges a patch into one container (the workspace tuning, one tuning leaf, or the header-button map) member by member. */
function mergeMembers(base, patch, deeper) {
    if (!isPlain(patch))
        return patch;
    const result = isPlain(base) ? { ...base } : {};
    for (const key of Object.keys(patch)) {
        const asked = patch[key];
        if (asked === undefined)
            continue;
        if (asked === null) {
            delete result[key];
        }
        else if (deeper && isPlain(asked)) {
            const inner = mergeMembers(result[key], asked, false);
            if (isPlain(inner) && Object.keys(inner).length === 0 && !isPlain(result[key]))
                continue;
            result[key] = inner;
        }
        else {
            result[key] = asked;
        }
    }
    return sameSettingsValue(result, base) ? base : result;
}
/**
 * Applies a patch to a settings layer and returns the new layer; the layer and the patch are never changed. `null`
 * deletes a value, and inside `headerButtons` it deletes one slot. An empty patch, or one that
 * changes nothing, returns the very same layer object.
 * @public
 */
export function mergePatch(layer, patch) {
    const next = { ...layer };
    const asked = patch;
    for (const key of Object.keys(asked)) {
        const value = asked[key];
        if (value === undefined)
            continue;
        if (value === null) {
            delete next[key];
        }
        else if (key === 'headerButtons') {
            const merged = mergeMembers(next[key], value, false);
            if (isPlain(merged) && Object.keys(merged).length === 0 && !isPlain(next[key]))
                continue;
            next[key] = merged;
        }
        else {
            next[key] = value;
        }
    }
    return sameSettingsValue(next, layer) ? layer : next;
}
/**
 * Applies a `configureTuning` patch to the workspace's tuning input, leaf by leaf and member by member; `null` deletes a leaf
 * or a member. Returns the very same object when nothing changes.
 * @internal
 */
export function mergeTuningPatch(current, patch) {
    const base = current ?? {};
    return mergeMembers(base, patch, true);
}
