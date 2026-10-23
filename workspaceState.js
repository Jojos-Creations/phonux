import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import { PANEL_UID_FORM } from './panelUid.js';
import { appendPanel, slotsOf } from './panelWindow.js';
import { ALL_SLOTS } from './rowConstants.js';
/** What a file saved before slots holds as a panel's tier, read as the slot count it stood for: desktop was every visible slot. */
const TIER_SLOTS = { phone: 1, tablet: 2, desktop: ALL_SLOTS };
const isTier = (value) => typeof value === 'string' && Object.hasOwn(TIER_SLOTS, value);
/** The most tombstones a file keeps; the oldest go first. */
export const DISMISSED_LIMIT = 256;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSlotCount = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= ALL_SLOTS;
const isOptional = (value, type) => value === undefined || typeof value === type;
function isSavedPanel(value) {
    if (!isRecord(value))
        return false;
    const { anchor } = value;
    return (isOptional(value.id, 'string') &&
        typeof value.view === 'string' &&
        isOptional(value.url, 'string') &&
        typeof value.live === 'boolean' &&
        isOptional(value.title, 'string') &&
        isOptional(value.listed, 'boolean') &&
        isOptional(value.permanent, 'boolean') &&
        (value.formFactor === undefined || isTier(value.formFactor)) &&
        (value.slots === undefined || isSlotCount(value.slots)) &&
        (value.layer === undefined || value.layer === 'base' || value.layer === 'raised') &&
        isRecord(anchor) &&
        typeof anchor.panel === 'string' &&
        (anchor.position === 'left' || anchor.position === 'right') &&
        typeof anchor.priority === 'number' &&
        Number.isFinite(anchor.priority));
}
/**
 * Whether `value` is a workspace file this version understands: version 1, a `panels` array of well-typed entries
 * with unique ids where they hold one. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 * @public
 */
export function isWorkspaceState(value) {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels))
        return false;
    const panels = value.panels;
    if (!panels.every(isSavedPanel))
        return false;
    const ids = panels.flatMap((p) => (p.id === undefined ? [] : [p.id]));
    return new Set(ids).size === ids.length;
}
/**
 * The saved rest of a file: its `scroll` when well formed, otherwise undefined with a drop note for anything but an absent one.
 */
export function cleanSavedScroll(value, dropped) {
    if (value === undefined)
        return undefined;
    if (isRecord(value) && typeof value.panel === 'string' && value.panel !== '' && typeof value.offset === 'number' && Number.isFinite(value.offset)) {
        return { panel: value.panel, offset: value.offset };
    }
    dropped.push({ key: 'scroll', message: 'scroll: expected { panel, offset }; dropped' });
    return undefined;
}
function cleanAnchor(value) {
    if (!isRecord(value) || typeof value.panel !== 'string' || (value.position !== 'left' && value.position !== 'right'))
        return undefined;
    if (typeof value.priority !== 'number' || !Number.isFinite(value.priority))
        return undefined;
    return { panel: value.panel, position: value.position, priority: value.priority };
}
/** `overrides` reduced to the members that are well formed; `undefined` for anything that is not an object. */
function cleanOverrides(value, dropped) {
    if (!isRecord(value)) {
        dropped.push({ key: 'overrides', message: 'overrides: expected an object; dropped' });
        return undefined;
    }
    const out = {};
    if (value.anchor !== undefined) {
        const anchor = cleanAnchor(value.anchor);
        if (anchor === undefined)
            dropped.push({ key: 'overrides.anchor', message: 'overrides.anchor: expected { panel, position, priority }; dropped' });
        else
            out.anchor = anchor;
    }
    if (value.formFactor !== undefined) {
        if (isTier(value.formFactor))
            out.slots = TIER_SLOTS[value.formFactor];
        else
            dropped.push({ key: 'overrides.formFactor', message: 'overrides.formFactor: expected phone, tablet or desktop; dropped' });
    }
    // A slot count outvotes the tier a file saved before slots holds.
    if (value.slots !== undefined) {
        if (isSlotCount(value.slots))
            out.slots = value.slots;
        else
            dropped.push({ key: 'overrides.slots', message: 'overrides.slots: expected an integer of at least 1; dropped' });
    }
    if (value.parkable !== undefined) {
        if (typeof value.parkable === 'boolean')
            out.parkable = value.parkable;
        else
            dropped.push({ key: 'overrides.parkable', message: 'overrides.parkable: expected a boolean; dropped' });
    }
    return out;
}
/**
 * The additive keys of one saved entry, each kept only when well formed; what is not is reported in `dropped` and
 * the entry restores without it. `seen` holds the keys earlier entries claimed: a repeat is dropped.
 */
/**
 * The entry's `uid` when it is well formed and no earlier entry holds it; otherwise undefined, with a drop note for
 * anything but an absent one. `seen` collects the uids kept so far.
 */
export function cleanSavedUid(entry, seen, dropped) {
    const raw = entry.uid;
    if (raw === undefined)
        return undefined;
    if (typeof raw !== 'string' || !PANEL_UID_FORM.test(raw)) {
        dropped.push({ key: 'uid', message: 'uid: expected the form u_ and 32 hex characters; dropped' });
        return undefined;
    }
    if (seen.has(raw)) {
        dropped.push({ key: 'uid', message: `uid: '${raw}' repeats an earlier entry's uid; dropped` });
        return undefined;
    }
    seen.add(raw);
    return raw;
}
export function cleanSavedExtras(entry, seen, dropped) {
    const raw = entry;
    const out = {};
    if (raw.key !== undefined) {
        if (typeof raw.key !== 'string' || raw.key === '')
            dropped.push({ key: 'key', message: 'key: expected a non-empty string; dropped' });
        else if (seen.has(raw.key))
            dropped.push({ key: 'key', message: `key: '${raw.key}' repeats an earlier entry's key; dropped` });
        else {
            seen.add(raw.key);
            out.key = raw.key;
        }
    }
    if (raw.instance !== undefined) {
        if (isRecord(raw.instance))
            out.instance = raw.instance;
        else
            dropped.push({ key: 'instance', message: 'instance: expected an object; dropped' });
    }
    if (raw.overrides !== undefined) {
        out.owned = cleanOverrides(raw.overrides, dropped);
    }
    if (raw.applied !== undefined) {
        if (isRecord(raw.applied) && raw.applied.placeOnAdd !== undefined)
            out.applied = { placeOnAdd: raw.applied.placeOnAdd };
        else
            dropped.push({ key: 'applied', message: 'applied: expected { placeOnAdd }; dropped' });
    }
    if (raw.closable === false)
        out.closable = false;
    else if (raw.closable !== undefined)
        dropped.push({ key: 'closable', message: 'closable: only false is saved; dropped' });
    return out;
}
/** The tombstone list of `value`: strings only, each once, the newest 256. Anything that is not an array reads as empty. */
export function cleanDismissed(value, dropped) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value)) {
        dropped.push({ key: 'dismissed', message: 'dismissed: expected an array of keys; dropped' });
        return [];
    }
    const keys = value.filter((k) => typeof k === 'string' && k !== '');
    const unique = keys.filter((k, i) => keys.lastIndexOf(k) === i);
    return unique.slice(-DISMISSED_LIMIT);
}
/** Drops what JSON cannot hold (a function, `undefined`) from `value`, so a settings layer is safe to save. */
function jsonSafe(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value))
        return value.map((item) => jsonSafe(item) ?? null);
    if (isRecord(value)) {
        const out = {};
        for (const k of Object.keys(value)) {
            const kept = jsonSafe(value[k]);
            if (kept !== undefined)
                out[k] = kept;
        }
        return out;
    }
    return undefined;
}
/**
 * The saved form of `panels`: every entry but the root, with only the documented keys. `permanent` is derived
 * (`!collapsible`) because PanelWindow has no such field, and an absent optional stays absent so no key holds
 * `undefined`. An entry that carries settings also writes `key`, `instance` (unless code declares it again),
 * `overrides`, `applied` and `closable`. `dismissed` is the tombstone list the caller holds.
 */
export function projectWorkspaceState(panels, rootId, dismissed = [], scroll) {
    const positional = new Map(deriveAnchorsFromOrder(panels, rootId).map((p) => [p.id, p.anchor]));
    const root = panels.find((p) => p.id === rootId);
    // A counter id restarts every launch, so the file names a panel by what outlives one: its uid, else its key.
    const names = new Map(panels.map((p) => [p.id, p.uid ?? p.key ?? p.id]));
    const nameOf = (id) => (id === rootId ? rootId : (names.get(id) ?? id));
    return {
        version: 1,
        panels: panels
            .filter((p) => p.id !== rootId)
            .map((p) => {
            const anchor = p.anchor ?? positional.get(p.id);
            const extras = {};
            if (p.settings !== undefined) {
                extras.key = p.key ?? p.id;
                if (p.declared !== true)
                    extras.instance = (jsonSafe(p.instance ?? {}) ?? {});
                if (p.overrides !== undefined) {
                    const { anchor: held, ...rest } = p.overrides;
                    extras.overrides = { ...(held === undefined ? {} : { anchor: { ...held, panel: nameOf(held.panel) } }), ...rest };
                }
                if (p.applied !== undefined)
                    extras.applied = { placeOnAdd: p.applied.placeOnAdd };
                if (!p.settings.closable)
                    extras.closable = false;
            }
            return {
                ...(p.uid !== undefined ? { uid: p.uid } : {}),
                view: p.view,
                url: p.url,
                ...(p.title !== undefined ? { title: p.title } : {}),
                ...(p.params !== undefined ? { params: p.params } : {}),
                ...(p.listed !== undefined ? { listed: p.listed } : {}),
                live: p.live,
                anchor: { panel: nameOf(anchor.panel), position: anchor.position, priority: anchor.priority },
                ...(p.slots !== undefined && p.slots !== 1 ? { slots: p.slots } : {}),
                ...(!p.collapsible ? { permanent: true } : {}),
                ...(p.layer !== undefined ? { layer: p.layer } : {}),
                ...extras,
            };
        }),
        ...(dismissed.length > 0 ? { dismissed: [...dismissed] } : {}),
        ...(root?.settings !== undefined && root.key !== undefined ? { root: root.key } : {}),
        ...(root !== undefined && slotsOf(root) > 1 ? { rootSlots: slotsOf(root) } : {}),
        ...(scroll !== undefined ? { scroll: { panel: nameOf(scroll.panel), offset: scroll.offset } } : {}),
    };
}
/** The slot count the tier of an entry saved before slots stood for, or undefined for an entry with no tier. */
function savedTierSlots(s) {
    const tier = s.formFactor;
    return isTier(tier) ? TIER_SLOTS[tier] : undefined;
}
/**
 * The settings-free skeleton of one saved entry under `id`: appendPanel owns the creation rules (permanent forces listed
 * false and one slot, size comes from the slots), and a permanent column is never parked, so one saved as parked is live.
 * `anchor` is the entry's saved anchor with its target already mapped.
 */
export function entryFromSaved(s, id, anchor, rootId, uid) {
    const entry = appendPanel([], { ...(s.url !== undefined ? { url: s.url } : {}), view: s.view, title: s.title, params: s.params, listed: s.listed, layer: s.layer, slots: s.slots ?? savedTierSlots(s), permanent: s.permanent }, id, rootId, ...(uid !== undefined ? [uid] : []))[0];
    return { ...entry, live: s.permanent === true ? true : s.live, ...(anchor === undefined ? {} : { anchor }) };
}
/**
 * What each name an entry answers to maps to in `values` (parallel to the entries): its `uid`, its `key`, and the `id`
 * a file saved before panels were named by uid holds. A name claimed twice goes to the first, and a uid outranks
 * an id outranks a key, so a name an older file gave a counter id is read as that id.
 */
export function savedNames(entries, values) {
    const out = new Map();
    for (const field of ['uid', 'id', 'key']) {
        entries.forEach((e, k) => {
            const name = e[field];
            if (typeof name === 'string' && name !== '' && !out.has(name))
                out.set(name, values[k]);
        });
    }
    return out;
}
/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export function hydrateWorkspaceState(state, freshId, rootId) {
    // Every entry's id is drawn before anything else, so a saved name that happens to equal a fresh id is never reused.
    const fresh = state.panels.map(() => freshId());
    const freshOf = savedNames(state.panels, fresh);
    // One id nothing else holds stands in for every anchor target the file does not contain: a name kept as it
    // is could equal a fresh id (both count up from 1 each launch) and attach the panel to a stranger.
    let missing;
    const targetOf = (saved) => {
        if (saved === rootId)
            return rootId;
        const mapped = freshOf.get(saved);
        if (mapped !== undefined)
            return mapped;
        missing ??= freshId();
        return missing;
    };
    const seenUids = new Set();
    const built = state.panels.map((s, i) => {
        return entryFromSaved(s, fresh[i], { panel: targetOf(s.anchor.panel), position: s.anchor.position, priority: s.anchor.priority }, rootId, cleanSavedUid(s, seenUids, []));
    });
    // One pass over the whole set: placing entries one at a time would rewrite an anchor that names a later entry.
    return computeRowOrder(built, rootId);
}
