import { PanelManagerError } from './panelManagerError.js';
import { PANEL_SETTINGS_CATALOG, applyTemplate, checkTuningLeaf, resolvePanelSettings, sameSettingsValue, viewMayAsk } from './panelSettings.js';
import { mergePatch, mergeTuningPatch } from './settingsPatch.js';
const DESCRIPTORS = new Map(PANEL_SETTINGS_CATALOG.map((d) => [d.name, d]));
const FLAT_KEYS = new Set(PANEL_SETTINGS_CATALOG.filter((d) => !d.name.startsWith('tuning.')).map((d) => d.name));
const TUNING_LEAVES = new Set(PANEL_SETTINGS_CATALOG.filter((d) => d.name.startsWith('tuning.')).map((d) => d.name.slice('tuning.'.length)));
/** The layer name an error for `call` carries. */
const layerOf = (call) => (call === 'tuning' ? 'tuning' : call === 'template' ? 'template' : 'instance');
const isPlain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** What the settings in `d`'s door say about `call`: the refusal it earns, or undefined when `call` accepts it. */
function refusalFor(call, name, value) {
    const d = DESCRIPTORS.get(name);
    if (call === 'view') {
        const key = name;
        const ok = d.viewSettable && (value === null || viewMayAsk(key, value));
        return ok ? undefined : { code: 'not-view-settable', setting: name, message: `'${name}' is not a setting a view may change on its own panel` };
    }
    const door = call === 'panel' ? 'instance' : call;
    if (d.configure.doors.includes(door))
        return undefined;
    const where = d.configure.doors.map((x) => (x === 'instance' ? 'configure(id, ...)' : x === 'template' ? 'configureTemplate(...)' : 'configureTuning(...)')).join(' or ');
    return { code: 'wrong-scope', setting: name, message: `'${name}' cannot be set through this call; use ${where}` };
}
/**
 * Whether `leaf` is the removed tuning key. Its value is checked and a removed one is reported by `checkTuningLeaf`; nothing is
 * asked of the catalog because the setting no longer has a row there.
 */
function isRemovedTuningLeaf(leaf, value, layer) {
    if (leaf !== 'shrinkOutOfView')
        return false;
    const problem = checkTuningLeaf(leaf, value).problems[0];
    if (problem !== undefined)
        throw new PanelManagerError('invalid-settings', `${layer}.${problem.key}: ${problem.problem}`, { layer, key: problem.key });
    return true;
}
/**
 * The catalog names a patch touches, or the first refusal it earns. A key the catalog does not know throws
 * `invalid-settings` whatever else the patch holds: that is a programmer error, not a state.
 */
export function checkPatch(call, patch) {
    const layer = layerOf(call);
    if (!isPlain(patch))
        throw new PanelManagerError('invalid-settings', `configure: the patch must be an object`, { layer });
    const asks = [];
    for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (value === undefined)
            continue;
        if (call === 'tuning') {
            if (isRemovedTuningLeaf(key, value, layer))
                continue;
            if (TUNING_LEAVES.has(key))
                asks.push({ name: `tuning.${key}`, value });
            else if (FLAT_KEYS.has(key))
                asks.push({ name: key, value });
            else if (key === 'tuning')
                asks.push({ name: 'tuning', value });
            else
                throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown tuning key`, { layer, key });
            continue;
        }
        if (key === 'tuning') {
            if (!isPlain(value)) {
                asks.push({ name: 'tuning', value });
                continue;
            }
            for (const leaf of Object.keys(value)) {
                if (value[leaf] === undefined)
                    continue;
                if (isRemovedTuningLeaf(leaf, value[leaf], layer))
                    continue;
                if (!TUNING_LEAVES.has(leaf))
                    throw new PanelManagerError('invalid-settings', `${layer}.tuning.${leaf}: unknown tuning key`, { layer, key: `tuning.${leaf}` });
                asks.push({ name: `tuning.${leaf}`, value: value[leaf] });
            }
            continue;
        }
        if (key === 'draggable' || key === 'placeable')
            throw new PanelManagerError('invalid-settings', `${layer}.${key}: a setting this version no longer has; set 'movable' instead`, { layer, key });
        if (!FLAT_KEYS.has(key))
            throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown setting`, { layer, key });
        asks.push({ name: key, value });
    }
    for (const ask of asks) {
        if (ask.name === 'tuning')
            return { refusal: { code: 'wrong-scope', setting: 'tuning', message: call === 'tuning' ? `'tuning' cannot be set through configureTuning; give it the tuning keys themselves` : `'tuning' belongs to the workspace; use configureTuning(...)` } };
        const refusal = refusalFor(call, ask.name, ask.value);
        if (refusal !== undefined)
            return { refusal };
    }
    return { names: asks.map((a) => a.name) };
}
/** The settings whose configure class acts at this commit; `parkable` and `maxSlots` are STATE keys that change what the panel is or may be at once. */
const NOW_STATE = new Set(['parkable', 'maxSlots']);
/** What a parked or held panel shows or answers at once: its permissions, its listing and its title. The rest waits for it to be drawn. */
const WHILE_PARKED = new Set(['closable', 'movable', 'crossable', 'resizable', 'listed', 'title', 'parkable', 'maxSlots']);
/** Whether `name` acts at this commit on a panel in `status`. */
export function actsNow(name, status) {
    if (status === 'closed')
        return false;
    const cls = DESCRIPTORS.get(name).configure.cls;
    const now = cls === 'NOW' || NOW_STATE.has(name);
    return status === 'live' ? now : now && WHILE_PARKED.has(name);
}
const EMPTY = Object.freeze({});
/** `merged` as the resolver's instance layer: without the keys only the view's ask holds, which the host layer carries. */
export function ownLayer(merged, split) {
    if (merged === undefined || split === undefined)
        return merged;
    const hostOnly = Object.keys(merged).filter((k) => k in split.host && !split.touched.has(k));
    if (hostOnly.length === 0)
        return merged;
    const own = { ...merged };
    for (const k of hostOnly)
        delete own[k];
    return own;
}
const sameConflict = (a, b) => a.key === b.key && a.kind === b.kind && a.rule === b.rule && a.forcedBy === b.forcedBy && a.layer === b.layer;
const sameNote = (a, b) => a.code === b.code && a.key === b.key && a.message === b.message;
/** Whether the layer holds a different value for `name` than `before` does. */
function differs(before, after, name) {
    return !sameSettingsValue(before[name], after[name]);
}
/**
 * The plan for patching panel layers: the new instance layer, the whole stack resolved again (a bad value throws
 * `invalid-settings`), the refusals a state or a new conflict earns, and the names split into what acts now and what
 * waits. A patch that changes nothing is `changed: false`.
 */
export function planInstance(i) {
    const base = i.base ?? EMPTY;
    const asked = i.patch;
    let layer = mergePatch(base, i.patch);
    if (layer === base)
        return { ok: true, changed: false };
    let split = i.split;
    if (split !== undefined) {
        // A `null` on a key the view asked for puts its ask back into the merged layer the file keeps; any other value makes the key the instance layer's own.
        const touched = new Set(split.touched);
        const restored = { ...layer };
        for (const key of Object.keys(split.host)) {
            if (asked[key] === undefined)
                continue;
            if (asked[key] === null) {
                touched.delete(key);
                restored[key] = split.host[key];
            }
            else {
                touched.add(key);
            }
        }
        if (sameSettingsValue(restored, base))
            return { ok: true, changed: false };
        layer = restored;
        split = { host: split.host, touched };
    }
    const layers = (instance, user, of) => ({
        ...(i.workspace !== undefined ? { workspace: i.workspace } : {}),
        ...(i.template !== undefined ? { template: i.template } : {}),
        ...(of !== undefined ? { host: of.host } : {}),
        instance: ownLayer(instance, of) ?? instance,
        ...(user !== undefined ? { user } : {}),
    });
    const resolve = (instance, user, of) => resolvePanelSettings(layers(instance, user, of), { root: i.root });
    const before = resolve(base, i.person, i.split);
    const after = resolve(layer, i.person, split);
    const fresh = after.conflicts.find((c) => !before.conflicts.some((b) => sameConflict(b, c)));
    if (fresh !== undefined)
        return { ok: false, code: 'settings-conflict', message: fresh.message, setting: fresh.key };
    if (i.slots !== undefined && i.slots <= before.value.maxSlots && i.slots > after.value.maxSlots) {
        return { ok: false, code: 'slots-above-max', message: `the panel is ${i.slots} slots wide, which these settings no longer allow` };
    }
    const changed = i.names.filter((n) => differs(base, layer, n));
    const now = changed.filter((n) => actsNow(n, i.status));
    const later = changed.filter((n) => !now.includes(n));
    const shadowed = changed.filter((n) => asked[n] !== null && after.source[n] !== 'instance');
    const notes = after.notes.filter((n) => !before.notes.some((b) => sameNote(b, n)));
    return { ok: true, changed: true, layer, resolution: after, now, later, shadowed, notes, split };
}
/** The success a plan answers with. */
export function configured(plan) {
    return { ok: true, changed: true, now: plan.now, later: plan.later, shadowed: plan.shadowed, notes: plan.notes };
}
/** The success of a call that changed nothing. */
export const unchanged = () => ({ ok: true, changed: false, now: [], later: [], shadowed: [], notes: [] });
/** The refusal a plan carries, as the result for panel `name`. */
export const refusedPlan = (name, plan) => ({
    ok: false,
    code: plan.code,
    message: `panel '${name}': ${plan.message}`,
    ...(plan.setting === undefined ? {} : { setting: plan.setting }),
});
/** The refusal a flip of `parkable` earns on a panel that is not live: only a live panel can change what it is. */
export function flipRefusal(status) {
    if (status === 'live')
        return undefined;
    if (status === 'pending')
        return 'is-pending';
    return status === 'closed' ? 'is-closed' : 'would-reshape-row';
}
/** The refusal of a flip of `parkable` on a panel that is not live. */
export const refusedFlip = (name, code) => ({ ok: false, code, message: `panel '${name}': parkable cannot change while it is not live` });
/** Whether `plan` flips `parkable` of a panel reading `reads` now: not when the patch leaves it out, or the panel already reads as asked or is outvoted by the person's override. */
export function flipsParkable(patch, plan, reads) {
    return patch.parkable !== undefined && plan.resolution.value.parkable !== reads;
}
/** `entry` carrying `resolution`: the mirror fields follow, and a panel that became a fixed column is live, because a fixed column is never parked. */
export const reparked = (entry, resolution) => {
    const next = applyTemplate(entry, resolution.value, 'reconfigure');
    return resolution.value.parkable ? next : { ...next, live: true };
};
/**
 * `entry` carrying what `plan` resolved: the fields that mirror the settings follow, the instance layer is kept for an
 * entry code does not re-declare, a title the patch removed goes, and a panel that became a fixed column is live. The
 * slots, size, anchor, `hostData`, `key`, `overrides` and `applied` are the ones `entry` already had.
 */
export function reconfigured(entry, plan, patch) {
    let next = reparked(entry, plan.resolution);
    if (entry.declared !== true)
        next = { ...next, instance: plan.layer };
    if (patch.title !== undefined && plan.resolution.value.title === undefined) {
        const { title: _gone, ...rest } = next;
        next = rest;
    }
    return next;
}
/** `prev` with `target` replaced by `next`, or `prev` itself when the row no longer holds `target`: something changed the entry between the call and the commit. */
export function applyConfigure(prev, target, next) {
    const at = prev.indexOf(target);
    return at < 0 ? prev : prev.map((p, k) => (k === at ? next : p));
}
/** The plan for patching the workspace tuning input; a leaf that is out of range throws `invalid-settings`. */
export function planTuning(current, patch) {
    const base = current ?? {};
    const input = mergeTuningPatch(base, patch);
    if (input === base)
        return { changed: false };
    const names = [];
    for (const leaf of Object.keys(patch)) {
        if (patch[leaf] === undefined)
            continue;
        const after = input[leaf];
        if (after !== undefined) {
            const checked = checkTuningLeaf(leaf, after);
            const problem = checked.problems[0];
            if (problem !== undefined)
                throw new PanelManagerError('invalid-settings', `tuning.${problem.key.replace(/^tuning\./, '')}: ${problem.problem}`, { layer: 'tuning', key: problem.key });
        }
        if (leaf !== 'shrinkOutOfView' && !sameSettingsValue(current?.[leaf], after))
            names.push(`tuning.${leaf}`);
    }
    if (names.length === 0)
        return { changed: false };
    return { changed: true, input, now: names.filter((n) => actsNow(n, 'live')), later: names.filter((n) => !actsNow(n, 'live')), reprices: names.includes('tuning.rowGap') };
}
/** The layer of the three template-scope keys after a patch, or the same layer when nothing changed. */
export function planTemplate(base, patch) {
    const from = base ?? EMPTY;
    const layer = mergePatch(from, patch);
    return { layer, changed: layer !== from };
}
