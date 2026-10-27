import { placePanel } from './panelPlacement.js';
import { computeRowOrder } from './panelRowOrder.js';
import { FIXED, applyTemplate, resolvePanelSettings, sameSettingsValue } from './panelSettings.js';
import { newPanelUid } from './panelUid.js';
import { appendPanel, clearOverrides } from './panelWindow.js';
import { cleanDismissed, cleanSavedExtras, cleanSavedUid, entryFromSaved, isWorkspaceState, savedNames } from './workspaceState.js';
/** The keys of `overrides` the resolver did not drop. */
function keptOverrides(held, resolution) {
    const gone = new Set(resolution.notes.filter((n) => n.code === 'override-dropped').map((n) => n.key));
    const { anchor, slots, parkable } = held;
    return {
        ...(anchor !== undefined ? { anchor } : {}),
        ...(slots !== undefined && !gone.has('slots') ? { slots } : {}),
        ...(parkable !== undefined && !gone.has('parkable') ? { parkable } : {}),
    };
}
/** `instance` without the keys the resolver reported as invalid, so the next save does not carry them. */
function keptInstance(instance, resolution) {
    const copy = { ...instance };
    for (const note of resolution.notes) {
        if (note.code !== 'invalid-saved-setting' || note.key === undefined || !note.message.startsWith('instance'))
            continue;
        delete copy[note.key];
    }
    return copy;
}
/**
 * Rebuilds the row's new entries. Draws every fresh id first; rebuilds a saved entry of a registered template by the
 * cascade (or of a plain view when the row has settings) and hydrates any other as 0.1.0 did; creates each
 * declared panel the file has no entry for unless its key is dismissed; lets `restoreVisibility` decide each `live`;
 * orders the row once. A saved entry owns what its `overrides` hold, and an entry without `overrides` (a 0.1.0 entry)
 * owns its anchor and slot count. An untouched entry keeps its saved place only while its resolved `placeOnAdd` equals
 * the one that placed it. Permission settings gate gestures, never a restore.
 */
export function reconcileWorkspace(i) {
    const notes = [];
    const topDrops = [];
    let file;
    if (i.saved !== null && i.saved !== undefined) {
        if (!isWorkspaceState(i.saved)) {
            notes.push({ code: 'workspace-ignored', message: 'Ignored the saved workspace: it is not a version 1 workspace file.' });
        }
        else {
            const seen = new Set();
            const seenUids = new Set();
            const drops = [];
            const panels = i.saved.panels.map((s) => {
                const entryDrops = [];
                const plain = { ...s };
                delete plain.uid;
                for (const key of ['key', 'instance', 'overrides', 'applied', 'closable'])
                    delete plain[key];
                drops.push(entryDrops);
                const uid = cleanSavedUid(s, seenUids, entryDrops);
                return { ...plain, ...(uid !== undefined ? { uid } : {}), ...cleanSavedExtras(s, seen, entryDrops) };
            });
            file = { panels, raw: i.saved.panels, drops, dismissed: cleanDismissed(i.saved.dismissed, topDrops) };
        }
    }
    for (const d of topDrops)
        notes.push({ code: 'invalid-saved-setting', key: d.key, message: d.message });
    const saved = file?.panels ?? [];
    const declared = i.declared ?? [];
    const workspace = i.workspaceDefaults ?? {};
    const settingsOn = i.workspaceDefaults !== undefined || i.templates.length > 0 || declared.length > 0;
    const templateOf = (id) => i.templates.find((t) => t.id === id);
    const have = new Set(i.current.map((p) => p.key ?? p.id));
    // Every id is drawn before anything else, so a saved id that happens to equal a fresh one is never reused.
    const fresh = saved.map(() => i.freshId());
    const freshOf = savedNames(file?.raw ?? [], fresh);
    let missing;
    const targetOf = (savedId) => {
        if (savedId === i.rootId)
            return i.rootId;
        const mapped = freshOf.get(savedId);
        if (mapped !== undefined)
            return mapped;
        missing ??= i.freshId();
        return missing;
    };
    const anchorOf = (a) => ({ panel: targetOf(a.panel), position: a.position, priority: a.priority });
    // A declaration claims the saved entry carrying its id, else the first unkeyed (0.1.0) entry of its template, so a 0.1.0 singleton is not made twice.
    const claims = new Map();
    for (const d of declared) {
        let at = saved.findIndex((s, k) => s.key === d.id && !claims.has(k));
        if (at < 0)
            at = saved.findIndex((s, k) => s.key === undefined && s.view === d.templateId && !claims.has(k));
        if (at >= 0)
            claims.set(at, d);
    }
    const newUid = i.newUid ?? newPanelUid;
    const adopted = [];
    /** The id of the panel already in the row that stands for a saved entry, by the entry's index. */
    const standIns = new Map();
    let minted = false;
    const built = [];
    const replace = [];
    saved.forEach((s, k) => {
        const id = fresh[k];
        const claim = claims.get(k);
        const template = templateOf(claim?.templateId ?? s.view);
        const key = claim?.id ?? (template !== undefined ? s.key : undefined);
        if (key !== undefined && have.has(key)) {
            // The panel already in the row stands for this entry: it takes the file's uid, or the file gets its own.
            const present = i.current.find((p) => (p.key ?? p.id) === key);
            if (present !== undefined)
                standIns.set(k, present.id);
            if (s.uid === undefined)
                minted = true;
            else if (present !== undefined && present.uid !== s.uid)
                adopted.push({ id: present.id, uid: s.uid });
            return;
        }
        for (const d of file.drops[k])
            notes.push({ code: 'invalid-saved-setting', panelId: id, key: d.key, message: d.message });
        if (s.uid === undefined)
            minted = true;
        const base = entryFromSaved(s, id, anchorOf(s.anchor), i.rootId, s.uid ?? newUid());
        if (!settingsOn) {
            built.push(base);
            return;
        }
        const legacy = s.owned === undefined;
        const ask = claim !== undefined ? { ...claim.settings } : { ...s.instance };
        // A saved `closable: false` binds a view no template rebuilds; a registered template says what its panel may do.
        const plainAsk = template === undefined && s.closable === false ? { ...ask, closable: false } : ask;
        const layers = legacy
            ? {
                workspace,
                ...(template !== undefined ? { template: template.settings } : {}),
                host: { listed: base.listed, layer: base.layer ?? 'base', ...(base.slots !== undefined ? { slots: base.slots } : {}) },
                instance: { ...plainAsk, parkable: base.collapsible },
            }
            : { workspace, ...(template !== undefined ? { template: template.settings } : {}), instance: plainAsk };
        const first = resolvePanelSettings(layers, { lenient: true });
        // The saved anchor names another saved entry; the live one names its fresh id.
        const heldOverrides = s.owned === undefined ? undefined : { ...s.owned, ...(s.owned.anchor !== undefined ? { anchor: anchorOf(s.owned.anchor) } : {}) };
        const owns = !legacy && FIXED.rememberLayout && Object.keys(heldOverrides).length > 0;
        const resolution = owns ? resolvePanelSettings({ ...layers, user: heldOverrides }, { lenient: true }) : first;
        const settings = resolution.value;
        for (const n of resolution.notes)
            notes.push({ ...n, panelId: id });
        const reconfigured = applyTemplate(base, settings, 'reconfigure');
        const live = settings.restoreVisibility === 'saved' ? base.live : settings.restoreVisibility === 'live';
        let anchor = base.anchor;
        let applied;
        if (!legacy) {
            if (owns && heldOverrides.anchor !== undefined) {
                anchor = heldOverrides.anchor;
                applied = s.applied ?? { placeOnAdd: settings.placeOnAdd };
            }
            else {
                applied = { placeOnAdd: settings.placeOnAdd };
                // A panel that remembers nothing has no saved place worth keeping: the default places it again.
                if (!FIXED.rememberLayout || !sameSettingsValue(s.applied?.placeOnAdd, settings.placeOnAdd))
                    replace.push({ id, value: settings.placeOnAdd, fallback: FIXED.placeFallback });
            }
        }
        built.push({
            ...reconfigured,
            live,
            slots: settings.slots,
            ...(anchor !== undefined ? { anchor } : {}),
            ...(key !== undefined ? { key } : {}),
            ...(claim !== undefined ? { declared: true } : { instance: keptInstance(plainAsk, resolution) }),
            ...(legacy ? {} : { overrides: owns ? keptOverrides(heldOverrides, resolution) : heldOverrides }),
            ...(applied !== undefined ? { applied } : {}),
        });
    });
    const dismissed = file?.dismissed ?? [];
    const restoredKeys = new Set(built.map((p) => p.key));
    const released = new Set();
    for (const d of declared) {
        if (restoredKeys.has(d.id) || have.has(d.id))
            continue;
        const template = templateOf(d.templateId);
        if (template === undefined) {
            if (!dismissed.includes(d.id))
                notes.push({ code: 'unknown-template', key: d.templateId, message: `declared panel '${d.id}' names template '${d.templateId}', which is not registered; it was not created` });
            continue;
        }
        const resolution = resolvePanelSettings({ workspace, template: template.settings, instance: d.settings }, { lenient: true });
        const settings = resolution.value;
        // A tombstone keeps a panel closed only while the panel can be closed and stays closed after it: a stale one never hides an unclosable or returning panel.
        if (dismissed.includes(d.id)) {
            if (settings.closable && settings.afterClose === 'stay-closed')
                continue;
            released.add(d.id);
        }
        const id = i.freshId();
        for (const n of resolution.notes)
            notes.push({ ...n, panelId: id });
        const skeleton = appendPanel([], { url: d.url ?? '', view: template.id, title: settings.title ?? i.panelTitle?.(id) ?? '', params: d.params ?? template.params, listed: settings.listed, layer: settings.layer, slots: settings.slots, permanent: !settings.parkable }, id, i.rootId, newUid())[0];
        built.push({ ...applyTemplate({ ...skeleton, key: d.id }, settings, 'create'), declared: true, overrides: {}, applied: { placeOnAdd: settings.placeOnAdd } });
        replace.push({ id, value: settings.placeOnAdd, fallback: FIXED.placeFallback });
    }
    let row = computeRowOrder([...i.current, ...built], i.rootId);
    for (const r of replace) {
        const placed = placePanel(row, r.id, r.value, { fallback: r.fallback, rootId: i.rootId, ...(i.order !== undefined ? { order: i.order } : {}) });
        row = placed.row;
        notes.push(...placed.notes);
    }
    // Mapped once every entry has its id: an opener may stand later in the file than the panel it opened.
    const openerOf = savedNames(file?.raw ?? [], fresh.map((id, k) => standIns.get(k) ?? id));
    const openers = new Map();
    saved.forEach((s, k) => {
        const name = s.openedBy;
        if (name === undefined)
            return;
        if (typeof name !== 'string' || name === '') {
            notes.push({ code: 'invalid-saved-setting', panelId: fresh[k], key: 'openedBy', message: 'openedBy: expected the name of another saved panel; dropped' });
            return;
        }
        const opener = name === i.rootId ? i.rootId : openerOf.get(name);
        if (opener !== undefined && opener !== fresh[k])
            openers.set(fresh[k], opener);
    });
    const added = new Set(built.map((p) => p.id));
    return { entries: row.filter((p) => added.has(p.id)).map((p) => (openers.has(p.id) ? { ...p, openedBy: openers.get(p.id) } : p)), notes, dismissed: dismissed.filter((k) => !restoredKeys.has(k) && !released.has(k)), adopted, minted };
}
/**
 * `row`, which holds a just-built entry `id`, with that entry resolved by `settings`: carrying its `instance` layer,
 * empty `overrides` and the `placeOnAdd` that places it, and placed there unless the caller gave an anchor itself.
 * `name` is a template panel's key; absent, the entry's key is its id.
 */
export function finishCreated(i) {
    const made = i.row.find((p) => p.id === i.id);
    const built = {
        ...applyTemplate(i.name === undefined ? made : { ...made, key: i.name }, i.settings, 'create'),
        instance: i.instance,
        applied: { placeOnAdd: i.settings.placeOnAdd },
    };
    const row = clearOverrides(i.row.map((p) => (p.id === i.id ? built : p)), [i.id]);
    // A one-off `place` is not recorded as `applied`, so a relaunch keeps where it landed.
    const place = i.place ?? i.settings.placeOnAdd;
    if (i.callerPlaced || place === 'row-end')
        return row;
    return placePanel(row, i.id, place, { fallback: FIXED.placeFallback, rootId: i.rootId, ...(i.order !== undefined ? { order: i.order } : {}) }).row;
}
/** The notes a host-bag create's conflicts raise, one per setting the cascade overrode or refused. */
export function conflictNotes(panelId, conflicts) {
    return conflicts.map((c) => ({ code: c.kind, panelId, key: c.key, message: c.message }));
}
