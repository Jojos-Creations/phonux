import { placePanel } from './panelPlacement.js';
import { LIBRARY_PANEL_DEFAULTS, applyTemplate, effective, panelKey } from './panelSettings.js';
import { slotsOf } from './panelWindow.js';
/** The row's root: the marker when there is one, else the first entry that has no anchor. */
function rootOf(row) {
    return row.find((p) => p.marker === true) ?? row.find((p) => p.anchor === undefined);
}
/** Whether `entry` sits immediately on the left side of the root: by its anchor, else by its place in the array. */
function leftOfRoot(entry, row, rootId) {
    if (entry.id === rootId)
        return false;
    if (entry.anchor !== undefined)
        return entry.anchor.panel === rootId && entry.anchor.position === 'left';
    return row.findIndex((p) => p.id === entry.id) < row.findIndex((p) => p.id === rootId);
}
/**
 * Whether `entry` reads as pinned under `definition`. A definition naming `parkable` in both halves is read by the
 * entry's resolved `parkable`, whatever its placement; one with `row-start` and `row-end` or `after-fixed` is read
 * by sitting left of the root; both are read when both hold; an empty one reads false. `rootId` names the root; omitted,
 * it is the row's marker or its entry with no anchor.
 * @internal
 */
export function isPinned(entry, row, definition, rootId) {
    const { pinned, unpinned } = definition;
    const byParkable = pinned.parkable !== undefined && unpinned.parkable !== undefined && pinned.parkable !== unpinned.parkable;
    const byPlace = pinned.placement === 'row-start' && (unpinned.placement === 'row-end' || unpinned.placement === 'after-fixed');
    if (!byParkable && !byPlace)
        return false;
    const root = rootId ?? rootOf(row)?.id;
    if (byParkable && effective(entry).parkable !== pinned.parkable)
        return false;
    if (byPlace && (root === undefined || !leftOfRoot(entry, row, root)))
        return false;
    return true;
}
/**
 * The ids of the entries of `row` that read as pinned, each under its own `pinning` (the library default for an entry
 * with no settings). Parked entries are read like live ones.
 * @internal
 */
export function pinnedIds(row, rootId) {
    const ids = new Set();
    for (const entry of row)
        if (isPinned(entry, row, definitionOf(entry), rootId))
            ids.add(entry.id);
    return ids;
}
/** The half of `definition` that `change` applies; a bare `parkable` value is a half of its own. */
const halfOf = (definition, change) => ('by' in change ? (change.by === 'pin' ? definition.pinned : definition.unpinned) : { parkable: change.parkable });
/** The definition `entry` is pinned under: its resolved one, else the library default. */
const definitionOf = (entry) => entry.settings?.pinning ?? LIBRARY_PANEL_DEFAULTS.pinning;
/** The half of `entry`'s `pinning` that `change` applies. @internal */
export const pinHalf = (entry, change) => halfOf(definitionOf(entry), change);
/**
 * What `entry` does with `change` in `status` under `pinningWhenNotLive`: a live panel applies it; a pending one and a
 * closed one nothing can name refuse; an engine-parked or hidden one follows the setting's answer for that status
 * (a half that names `parkable` is refused whole where the answer is place-only); a closed one with a record can
 * only store the change. There is no room check: a fixed pin never needs room.
 * @internal
 */
export function decidePinChange(entry, status, setting, change) {
    if (status === 'live')
        return { kind: 'apply' };
    if (status === 'pending')
        return { kind: 'refuse', code: 'is-pending' };
    if (status === 'closed-anonymous')
        return { kind: 'refuse', code: 'is-closed' };
    if (status === 'closed-declared' || status === 'undo') {
        const answer = typeof setting === 'string' ? setting : (setting.closed ?? 'refuse');
        return answer === 'apply-on-next-show' ? { kind: 'defer' } : { kind: 'refuse', code: 'is-closed' };
    }
    const answer = typeof setting === 'string' ? setting : ((status === 'parked' ? setting.parked : setting.hidden) ?? 'place-only');
    if (answer === 'show')
        return { kind: 'show' };
    if (answer === 'apply-on-next-show')
        return { kind: 'defer' };
    if (answer === 'refuse')
        return { kind: 'refuse', code: 'would-reshape-row' };
    return halfOf(definitionOf(entry), change).parkable === undefined ? { kind: 'apply' } : { kind: 'refuse', code: 'would-reshape-row' };
}
const refusal = (code, message, setting) => ({ ok: false, code, message, ...(setting === undefined ? {} : { setting }) });
/** `p` without its deferred pin. @internal */
export const withoutDeferral = (p) => {
    const { deferredPin: _dropped, ...rest } = p;
    return rest;
};
/** `entry` carrying `resolution`: the mirror fields follow, and a panel that became a fixed column is live, because a fixed column is never parked. @internal */
export const reparked = (entry, resolution) => {
    const next = applyTemplate(entry, resolution.value, 'reconfigure');
    return resolution.value.parkable ? next : { ...next, live: true };
};
const sameSlot = (a, b) => a.id === b.id && a.collapsible === b.collapsible && a.live === b.live && a.listed === b.listed && a.anchor?.panel === b.anchor?.panel && a.anchor?.position === b.anchor?.position;
/**
 * `change` applied to panel `id` of `row`, all or nothing. `pin` places, then fixes: a fixed column needs one slot and
 * no explicit setting the fix would override. `unpin` frees first, then places. A half with no placement uses
 * `o.fallback`. Placement is the developer's own ask, so `movable` gates none of it. A deferred pin the panel held is
 * cleared whatever the outcome.
 * @internal
 */
export function applyPinChange(row, id, change, env, o = {}) {
    const entry = row.find((p) => p.id === id);
    if (entry === undefined)
        return refusal('unknown-panel', `no panel '${id}' is in the row`);
    const name = panelKey(entry);
    if (id === env.rootId)
        return refusal('root-fixed', `panel '${name}' is the root and cannot be anchored to itself`);
    const half = halfOf(definitionOf(entry), change);
    const fixing = half.parkable === false && entry.collapsible;
    const freeing = half.parkable === true && !entry.collapsible;
    const fixedTo = fixing ? env.resolveWith(entry, false) : undefined;
    const freedTo = freeing ? env.resolveWith(entry, true) : undefined;
    const freed = freedTo === undefined ? entry : reparked(entry, freedTo);
    if (fixedTo !== undefined) {
        if (slotsOf(entry) !== 1)
            return refusal('slots-above-max', `panel '${name}' is wider than one slot, which a fixed column needs`);
        const clash = fixedTo.conflicts.find((c) => c.kind === 'forced' && c.forcedBy === 'parkable');
        if (clash !== undefined)
            return refusal('settings-conflict', clash.message, clash.key);
    }
    const placement = half.placement ?? o.fallback ?? 'in-place';
    let next = row.map((p) => (p.id === id ? freed : p));
    let notes = [];
    if (placement !== 'in-place') {
        const placed = placePanel(next, id, placement, { ...env.placing(entry), rootId: env.rootId });
        next = placed.row;
        notes = placed.notes;
    }
    if (fixedTo !== undefined)
        next = next.map((p) => (p.id === id ? reparked(p, fixedTo) : p));
    next = next.map((p) => (p.id === id ? withoutDeferral(p) : p));
    const changed = next.length !== row.length || next.some((p, k) => !sameSlot(p, row[k]) || p.id !== row[k].id);
    const cleared = entry.deferredPin !== undefined;
    return { ok: true, row: changed || cleared ? next : row, notes, changed };
}
/** The note raised when a pin change that waited for a panel no longer applies when it comes to apply. */
const droppedNote = (name, why) => ({ code: 'deferred-pin-dropped', panelId: name, message: `pin: the change waiting on '${name}' no longer applies (${why}); it was dropped` });
/**
 * Lands panel `id` of `row` the way a path that makes it live does: its pending pin change, `pin` or else the one it
 * waits with, applied through `applyPinChange` with `fallback` as the path's own placement, or, with none waiting,
 * `fallback` alone. A change that no longer applies is dropped with a note and the panel lands by `fallback`.
 * @internal
 */
export function landPanel(row, id, pin, fallback, env) {
    const entry = row.find((p) => p.id === id);
    if (entry === undefined)
        return { row: [...row], notes: [], pinned: false };
    const waiting = pin ?? entry.deferredPin;
    const plain = (from, extra) => {
        const placed = placePanel(from, id, fallback, { ...env.placing(entry), rootId: env.rootId });
        return { row: placed.row, notes: [...extra, ...placed.notes], pinned: false };
    };
    if (waiting === undefined)
        return plain(row, []);
    const out = applyPinChange(row, id, waiting, env, { fallback });
    if (out.ok)
        return { row: out.row === row ? [...row] : out.row, notes: out.notes, pinned: true };
    return plain(row.map((p) => (p.id === id ? withoutDeferral(p) : p)), [droppedNote(panelKey(entry), out.message)]);
}
