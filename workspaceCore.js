import { checkPatch, configured, flipRefusal, flipsParkable, ownLayer, planInstance, planTemplate, planTuning, reconfigured, refusedFlip, refusedPlan, unchanged } from './panelConfigure.js';
import { makeHandle, makeOwnHandle, makeReader, makeViewHandle } from './panelHandles.js';
import { accepted, makePanelManager, refused } from './panelManager.js';
import { PanelManagerError } from './panelManagerError.js';
import { applyTemplate, effective, holdUnlistedNote, panelKey, resolvePanelSettings, sameSettingsValue } from './panelSettings.js';
import { definePanel } from './panelTemplate.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { createRootPanel, slotsOf } from './panelWindow.js';
import { cleanWorkspaceName, DEFAULT_WORKSPACE_NAME } from './workspaceName.js';
import { entryNamed } from './panelIds.js';
import { familyIds } from './panelOpener.js';
import { resolveOpen } from './openPlacement.js';
import { createLiveStore, refusedLiveKeys } from './workspaceLive.js';
/** The id of the marker entry a workspace without a root keeps. */
export const ROOT_MARKER_ID = '__root__';
let nextEngineIdValue = 1;
/** The next id for an engine entry. A module counter, bumped only from handlers and the restore callback, never from a state initializer. */
export const nextEngineId = () => String(nextEngineIdValue++);
/** Moves the counter past the number after the first `~` of every restored key, which `nextEngineId` restarted below at launch and would otherwise hand out again. The counter only rises, so calling this twice, or from two workspaces, is harmless. */
export function seedEngineIdsPast(keys) {
    for (const key of keys) {
        const cut = key?.indexOf('~') ?? -1;
        if (key === undefined || cut < 0)
            continue;
        const suffix = key.slice(cut + 1);
        // Plain decimal only: a uuid, `007` or `1e3` is a name a custom `newId` made, not a count this counter handed out.
        if (!/^[1-9][0-9]*$/.test(suffix))
            continue;
        const n = Number(suffix);
        if (Number.isSafeInteger(n + 1))
            nextEngineIdValue = Math.max(nextEngineIdValue, n + 1);
    }
}
/** How many closed anonymous panels keep answering through a handle someone still holds. */
const RETIRED_LIMIT = 256;
const CORES = new WeakMap();
const sameState = (a, b) => a.id === b.id &&
    a.templateId === b.templateId &&
    a.status === b.status &&
    a.held === b.held &&
    a.engineId === b.engineId &&
    a.index === b.index &&
    a.title === b.title &&
    a.url === b.url &&
    a.listed === b.listed &&
    a.openedBy === b.openedBy &&
    a.slots === b.slots &&
    JSON.stringify(a.params) === JSON.stringify(b.params) &&
    sameSettingsValue(a.settings, b.settings);
/** `outcome` with the hold-unlisted note appended to its answer when the update leaves a listed, held panel unlisted. */
function withHoldNote(target, status, outcome) {
    if (!('next' in outcome) || status !== 'hidden')
        return outcome;
    if (!effective(target).listed || effective(outcome.next).listed)
        return outcome;
    return { ...outcome, done: { ...outcome.done, notes: [...outcome.done.notes, holdUnlistedNote(target.id)] } };
}
/**
 * A workspace over `o`. It renders itself (see `WorkspaceOptions.mount`) unless `mount: false` hands that to `useProvidePanels({ workspace })`
 * in a tree the caller writes. Panels added before the row attaches are recorded and created when the restore settles.
 * @public
 */
export function createWorkspace(o = {}) {
    const conflicts = o.conflicts ?? 'warn';
    const defaults = o.defaults;
    let tuningInput = o.tuning;
    let tuning = resolveWorkspaceTuning(tuningInput);
    const tuningListeners = new Set();
    const root = o.root === undefined ? undefined : definePanel(o.root);
    const rootId = root?.id ?? ROOT_MARKER_ID;
    const newId = o.newId ?? nextEngineId;
    const templates = new Map();
    const removers = [];
    const records = new Map();
    /** What a view asked at a Host-bag create, by engine id. The file keeps those asks merged into the instance layer; this keeps them apart for the session so a `null` in a configure shows them again. */
    const splits = new Map();
    const inflight = new Set();
    const warned = new Set();
    const listeners = new Set();
    const panelListeners = new Map();
    const handles = new Map();
    const readHandles = new Map();
    const retired = new Map();
    const viewHandles = new Map();
    /** What `configureTemplate` changed, per template id, for this session; the three template-scope keys only. */
    const templateOverrides = new Map();
    const effectiveTemplates = new WeakMap();
    /** The last commit's entries by engine id, so the next commit can tell which panels left. */
    let lastEntries = new Map();
    const resolutions = new WeakMap();
    let status = 'detached';
    let owner;
    let committed;
    let commit;
    let observed;
    // useSyncExternalStore needs getState to return the same object until the state changes, also for a panel drawn before its first commit.
    const drawnStates = new Map();
    let version = 0;
    let snapshot = { version: 0, status, panels: [] };
    let states = new Map();
    const registeredTemplate = (id) => templates.get(id) ?? (root?.id === id ? root : undefined);
    /** `t` with this session's `configureTemplate` changes laid over its settings; `t` itself when there are none. */
    const withOverrides = (t) => {
        const over = templateOverrides.get(t.id);
        if (over === undefined)
            return t;
        const cached = effectiveTemplates.get(t);
        if (cached !== undefined && cached.over === over)
            return cached.template;
        const template = { ...t, settings: { ...t.settings, ...over } };
        effectiveTemplates.set(t, { over, template });
        return template;
    };
    const templateOf = (id) => {
        const found = registeredTemplate(id);
        return found === undefined ? undefined : withOverrides(found);
    };
    /** The instance layer `e` resolves under: for a closed entry and for one code declares, the record's, which a configure edits; otherwise the entry's own. */
    const instanceLayer = (e) => {
        const rec = records.get(panelKey(e));
        if (e.declared === true)
            return rec?.settings;
        return rec !== undefined && e.id !== rootId && !lastEntries.has(e.id) ? rec.settings : e.instance;
    };
    const reportError = (e) => {
        if (o.onError === undefined)
            console.error(e);
        else {
            try {
                o.onError(e);
            }
            catch {
                // A reporter that throws must not break the work that raised the error.
            }
        }
    };
    const autoMounted = o.mount !== false && typeof document !== 'undefined';
    const live = createLiveStore({ ...(o.device !== undefined ? { device: o.device } : {}), ...(o.snapshots !== undefined ? { snapshots: o.snapshots } : {}), ...(o.labels !== undefined ? { labels: o.labels } : {}), ...(o.icons !== undefined ? { icons: o.icons } : {}), ...(o.topInset !== undefined ? { topInset: o.topInset } : {}), ...(o.panels !== undefined ? { panels: o.panels } : {}) });
    let warnedHandMount = false;
    let noteSink;
    let touchSink;
    let blurSink;
    let cycleSink;
    let summonSink;
    const notesBeforeSink = [];
    const reportConflicts = (id, res) => {
        if (conflicts === 'off')
            return;
        for (const c of res.conflicts) {
            if (conflicts === 'throw')
                throw new PanelManagerError('invalid-settings', `panel '${id}': ${c.message}`, { layer: c.layer, key: c.key });
            const key = `${id}\u0000${c.key}`;
            if (warned.has(key))
                continue;
            warned.add(key);
            console.warn(`panel '${id}': ${c.message}`);
        }
    };
    const resolutionFor = (key, id, templateId, settings, user, isRoot, split) => {
        const template = templateOf(templateId);
        const cached = resolutions.get(key);
        if (cached !== undefined && cached.template === template && cached.settings === settings && cached.split === split)
            return cached.res;
        const instance = ownLayer(settings, split);
        const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), ...(template?.settings !== undefined ? { template: template.settings } : {}), ...(split !== undefined ? { host: split.host } : {}), ...(instance !== undefined ? { instance } : {}), ...(user !== undefined ? { user } : {}) }, { lenient: true, root: isRoot });
        resolutions.set(key, { template, settings, split, res });
        return res;
    };
    /** The layers an entry resolves under, with `user` as the person's layer. */
    const resolveEntry = (e, user) => {
        const template = templateOf(e.view);
        const split = splits.get(e.id);
        const settings = ownLayer(instanceLayer(e), split);
        return resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), ...(template?.settings !== undefined ? { template: template.settings } : {}), ...(split !== undefined ? { host: split.host } : {}), ...(settings !== undefined ? { instance: settings } : {}), ...(user !== undefined ? { user } : {}) }, { lenient: true, root: e.id === rootId });
    };
    const entryResolution = (e) => {
        const id = panelKey(e);
        const rec = records.get(id);
        const settings = instanceLayer(e);
        const res = resolutionFor(e, id, e.view, settings, e.overrides, e.id === rootId, splits.get(e.id));
        if (e.settings === undefined)
            return { ...res, value: effective(e) };
        return res;
    };
    /** The public id of `e`'s opener while the opener is in the row, else null. */
    const openerKey = (e, entries) => {
        if (e.openedBy === undefined)
            return null;
        const opener = entries.find((p) => p.id === e.openedBy);
        return opener === undefined || opener.marker === true ? null : panelKey(opener);
    };
    const stateOfEntry = (e, entries, held, index) => {
        const res = entryResolution(e);
        return {
            id: panelKey(e),
            templateId: e.view,
            status: e.live ? 'live' : 'parked',
            held: !e.live && held.has(e.id),
            engineId: e.id,
            index,
            title: e.title,
            url: e.url,
            params: e.params,
            listed: e.listed,
            settings: res.value,
            openedBy: openerKey(e, entries),
            slots: e.savedSlots ?? slotsOf(e),
        };
    };
    const stateOfRecord = (r) => {
        const template = templateOf(r.templateId);
        const res = resolutionFor(r, r.id, r.templateId, r.settings, undefined, false, r.lastEngineId === undefined ? undefined : splits.get(r.lastEngineId));
        const pending = !r.closed && (inflight.has(r.id) || (r.intent && status !== 'ready'));
        return {
            id: r.id,
            templateId: r.templateId,
            status: pending ? 'pending' : 'closed',
            held: false,
            engineId: null,
            index: null,
            title: res.value.title,
            url: r.url ?? '',
            params: r.params ?? template?.params,
            listed: res.value.listed,
            settings: res.value,
            openedBy: null,
        };
    };
    /** Rebuilds the snapshot from the last commit and the records; a no-op, and no new version, when nothing changed. */
    const refresh = () => {
        const entries = committed?.entries ?? [];
        const held = committed?.held ?? new Set();
        const next = [];
        const seen = new Set();
        let index = 0;
        for (const e of entries) {
            if (e.marker === true)
                continue;
            const state = stateOfEntry(e, entries, held, index);
            index += 1;
            seen.add(state.id);
            next.push(state);
        }
        for (const r of records.values())
            if (!seen.has(r.id))
                next.push(stateOfRecord(r));
        const reused = next.map((s) => {
            const before = states.get(s.id);
            return before !== undefined && sameState(before, s) ? before : s;
        });
        const unchanged = status === snapshot.status && reused.length === snapshot.panels.length && reused.every((s, i) => s === snapshot.panels[i]);
        if (unchanged)
            return;
        const previous = states;
        states = new Map(reused.map((s) => [s.id, s]));
        drawnStates.clear();
        version += 1;
        snapshot = { version, status, panels: reused };
        for (const s of reused)
            if (previous.get(s.id) !== s)
                for (const l of [...(panelListeners.get(s.id) ?? [])])
                    l();
        for (const id of previous.keys())
            if (!states.has(id))
                for (const l of [...(panelListeners.get(id) ?? [])])
                    l();
        for (const l of [...listeners])
            l();
    };
    /** The entry named `id` in the list this render draws, with its place in it. */
    const drawn = (id) => {
        if (observed === undefined)
            return undefined;
        const entry = observed.entries.find((p) => panelKey(p) === id);
        return entry === undefined ? undefined : { entry, index: observed.entries.filter((p) => p.marker !== true).indexOf(entry) };
    };
    const stateById = (id) => {
        const known = states.get(id);
        if (known !== undefined)
            return known;
        const entry = drawn(id);
        if (entry !== undefined) {
            const fresh = stateOfEntry(entry.entry, observed.entries, observed.held, entry.index);
            const before = drawnStates.get(id);
            if (before !== undefined && sameState(before, fresh))
                return before;
            drawnStates.set(id, fresh);
            return fresh;
        }
        const r = records.get(id);
        if (r !== undefined)
            return stateOfRecord(r);
        const gone = retired.get(id);
        if (gone !== undefined)
            return gone.state;
        throw new PanelManagerError('invalid-options', `no panel '${id}' in this workspace`);
    };
    /** The panel's state if the workspace has ever known it, else undefined. */
    const knownState = (id) => {
        try {
            return stateById(id);
        }
        catch {
            return undefined;
        }
    };
    /** Drops a panel nothing can ask for again from the snapshot; a handle someone holds keeps answering `closed`. */
    const retire = (key, e) => {
        const last = states.get(key);
        if (last !== undefined) {
            const res = entryResolution(e);
            retired.set(key, { state: { ...last, status: 'closed', held: false, engineId: null, index: null, openedBy: null }, res });
            for (const old of [...retired.keys()].slice(0, Math.max(0, retired.size - RETIRED_LIMIT))) {
                retired.delete(old);
                handles.delete(old);
                viewHandles.delete(old);
                readHandles.delete(old);
            }
        }
        records.delete(key);
        splits.delete(e.id);
    };
    /** What closing `e` leaves behind: a record a later `open()` can use when code can name the panel again, nothing otherwise. */
    const leave = (e) => {
        const key = panelKey(e);
        const rec = records.get(key);
        const nameable = e.key !== undefined && !key.includes('~');
        if (rec !== undefined ? !rec.anonymous : nameable) {
            if (rec === undefined) {
                records.set(key, { id: key, templateId: e.view, settings: e.instance, params: e.params, url: e.url === '' ? undefined : e.url, intent: false, closed: false, anonymous: false });
            }
            records.get(key).lastEngineId = e.id;
            return;
        }
        retire(key, e);
    };
    const source = {
        stateOf: stateById,
        settingsOf: (id) => {
            const e = committed?.entries.find((p) => panelKey(p) === id) ?? drawn(id)?.entry;
            if (e !== undefined)
                return entryResolution(e);
            const r = records.get(id);
            if (r === undefined) {
                const gone = retired.get(id);
                if (gone !== undefined)
                    return gone.res;
                throw new PanelManagerError('invalid-options', `no panel '${id}' in this workspace`);
            }
            return resolutionFor(r, r.id, r.templateId, r.settings, undefined, false, r.lastEngineId === undefined ? undefined : splits.get(r.lastEngineId));
        },
        subscribePanel: (id, l) => {
            let set = panelListeners.get(id);
            if (set === undefined) {
                set = new Set();
                panelListeners.set(id, set);
            }
            set.add(l);
            return () => void panelListeners.get(id)?.delete(l);
        },
        getSnapshot: () => snapshot,
        subscribe: (l) => {
            listeners.add(l);
            return () => void listeners.delete(l);
        },
        handleOf: (id) => {
            const known = knownState(id);
            if (known === undefined)
                return undefined;
            let handle = handles.get(id);
            if (handle === undefined) {
                handle = makeViewHandle(source, id, known.templateId);
                handles.set(id, handle);
            }
            return handle;
        },
        readHandleOf: (id) => {
            const known = knownState(id);
            if (known === undefined)
                return undefined;
            let handle = readHandles.get(id);
            if (handle === undefined) {
                handle = makeHandle(source, id, known.templateId);
                readHandles.set(id, handle);
            }
            return handle;
        },
        viewHandleOf: (id) => {
            const known = knownState(id);
            if (known === undefined)
                return undefined;
            let handle = viewHandles.get(id);
            if (handle === undefined) {
                handle = makeOwnHandle(source, id, known.templateId);
                viewHandles.set(id, handle);
            }
            return handle;
        },
        operate: (id, call, src) => operate(id, call, src),
        resetLayout: (target) => resetLayout(target),
        swap: (show, hide) => swapPanels(show, hide),
        rootView: () => summonSink?.view() ?? 'shown',
        summonRoot: () => summonSink?.summon() ?? false,
        dismissRoot: () => summonSink?.dismiss() ?? false,
        configure: (id, patch, caller) => configureOne(id, patch, caller),
        configureTemplate: (templateId, patch) => configureTemplateOne(templateId, patch),
        configureTuning: (patch) => configureTuningOne(patch),
        familyOf: (id) => familyOf(id),
    };
    const panels = makePanelManager(source);
    const reader = makeReader(source);
    /** The panel `id` and its descendants by public id, in row order, read from the committed row. */
    const familyOf = (id) => {
        const entries = committed?.entries ?? [];
        const top = entries.find((p) => p.marker !== true && panelKey(p) === id);
        if (top === undefined)
            return [];
        const byId = new Map(entries.map((p) => [p.id, p]));
        return familyIds(entries, top.id).map((engineId) => panelKey(byId.get(engineId)));
    };
    const registerOne = (t) => {
        definePanel(t);
        const existing = templates.get(t.id);
        if (existing !== undefined && existing !== t)
            throw new PanelManagerError('duplicate-template', `template '${t.id}' is already registered in this workspace`);
        if (existing === t)
            return () => { };
        templates.set(t.id, t);
        const remove = () => {
            if (templates.get(t.id) === t)
                templates.delete(t.id);
        };
        removers.push(remove);
        return remove;
    };
    const rootEntry = () => {
        if (root === undefined)
            return { id: ROOT_MARKER_ID, url: '', title: '', live: true, view: ROOT_MARKER_ID, collapsible: false, listed: false, marker: true };
        const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: root.settings }, { root: true });
        return applyTemplate({ ...createRootPanel(root.id), title: res.value.title ?? '', view: root.id, ...(root.params !== undefined ? { params: root.params } : {}), key: root.id }, res.value, 'create');
    };
    const instanceKeys = (templateId) => {
        const keys = new Set();
        for (const e of committed?.entries ?? [])
            if (e.view === templateId && e.marker !== true && e.id !== rootId)
                keys.add(panelKey(e));
        for (const r of records.values())
            if (r.templateId === templateId && !r.closed && (inflight.has(r.id) || (r.intent && status !== 'ready')))
                keys.add(r.id);
        return keys;
    };
    const instancesOf = (templateId) => instanceKeys(templateId).size;
    const validateExplicitId = (id, t) => {
        if (typeof id !== 'string')
            throw new PanelManagerError('invalid-options', 'id must be a string');
        let problem;
        try {
            definePanel({ id, view: t.view });
        }
        catch (e) {
            problem = e instanceof Error ? e.message : String(e);
        }
        if (problem === undefined && templateOf(id) !== undefined)
            problem = `'${id}' is the id of a registered template`;
        if (problem !== undefined)
            throw new PanelManagerError('invalid-options', `panel id ${JSON.stringify(id)}: ${problem}`);
    };
    /** What `place` asks of the row as `c` holds it, in engine terms; the panel it closes is closed here, before the open. */
    const placeOpen = (c, place) => {
        const inView = c.entries.filter((e) => e.live && e.collapsible && e.marker !== true);
        const asked = place({ inView: inView.map(panelKey) });
        const r = resolveOpen(inView.map(panelKey), asked);
        const engineOf = (key) => inView.find((e) => panelKey(e) === key)?.id;
        const closes = engineOf(r.closes);
        if (closes !== undefined)
            c.ops.close(closes, 'code');
        const leaves = engineOf(r.leaves);
        return { place: r.place, ...(leaves !== undefined ? { leaves } : {}), ...(asked.enterFrom !== undefined ? { enterFrom: asked.enterFrom } : {}) };
    };
    /** `addPanel` for the view of the panel drawn under `opener`, which a panel it creates records as its opener; undefined for the host's. */
    const addPanelBy = (opener) => (given, options) => {
        if (status === 'disposed')
            throw new PanelManagerError('disposed', 'the workspace was disposed');
        let t;
        if (typeof given === 'string') {
            const found = registeredTemplate(given);
            if (found === undefined)
                throw new PanelManagerError('unknown-template', `no template '${given}' is registered`);
            t = found;
        }
        else {
            t = given;
            definePanel(t);
            const known = registeredTemplate(t.id);
            if (known === undefined)
                registerOne(t);
            else if (known !== t)
                throw new PanelManagerError('duplicate-template', `a different template '${t.id}' is already registered`);
        }
        if (options?.id !== undefined)
            validateExplicitId(options.id, t);
        // Validated here, not at settle, so a bad settings layer throws at the call that wrote it.
        const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: withOverrides(t).settings, ...(options?.settings !== undefined ? { instance: options.settings } : {}) });
        const multiple = res.value.multiple;
        const ready = status === 'ready' && commit !== undefined;
        if (options?.id === undefined && multiple && !ready)
            throw new PanelManagerError('instance-id-required', `template '${t.id}' is multiple: before the workspace is ready each panel needs an explicit id`);
        const suffix = options?.id === undefined && multiple ? newId() : undefined;
        const id = options?.id ?? (suffix !== undefined ? `${t.id}~${suffix}` : t.id);
        const existing = records.get(id);
        const present = committed?.entries.find((e) => panelKey(e) === id);
        const owned = existing?.templateId ?? present?.view;
        if (owned !== undefined && owned !== t.id)
            throw new PanelManagerError('invalid-options', `panel id '${id}' already belongs to template '${owned}'`);
        if (existing !== undefined)
            return source.handleOf(id);
        if (present !== undefined) {
            records.set(id, { id, templateId: t.id, settings: options?.settings, params: options?.params, url: options?.url, intent: false, closed: false, anonymous: id.includes('~') });
            return source.handleOf(id);
        }
        reportConflicts(id, res);
        const count = instancesOf(t.id);
        const over = (!multiple && count > 0) || (res.value.maxInstances !== 'unlimited' && count >= res.value.maxInstances);
        const rec = { id, templateId: t.id, settings: options?.settings, params: options?.params, url: options?.url, intent: !ready && !over, closed: over, anonymous: suffix !== undefined };
        records.set(id, rec);
        if (ready && !over) {
            inflight.add(id);
            const open = options?.place === undefined ? undefined : placeOpen(commit, options.place);
            const settings = open?.enterFrom === undefined ? options?.settings : { ...options?.settings, enterFrom: open.enterFrom };
            commit.create({ id, templateId: t.id, engineId: suffix ?? newId(), ...(opener !== undefined ? { openedBy: opener } : {}), ...(settings !== undefined ? { settings } : {}), ...(open?.place !== undefined ? { place: open.place } : {}), ...(open?.leaves !== undefined ? { leaves: open.leaves } : {}), ...(options?.params !== undefined ? { params: options.params } : {}), ...(options?.url !== undefined ? { url: options.url } : {}) });
        }
        if (!ready || over)
            refresh();
        return source.handleOf(id);
    };
    const addPanel = addPanelBy(undefined);
    /** The refusal for an operation a workspace in this state cannot take at all, or undefined when it is attached and ready. */
    const lifecycleRefusal = (id) => {
        if (status === 'disposed')
            return refused('disposed', `panel '${id}': the workspace was disposed`);
        if (owner === undefined)
            return refused('not-attached', `panel '${id}': the workspace is not attached to a row`);
        if (status !== 'ready' || commit === undefined)
            return refused('not-ready', `panel '${id}': the workspace has not finished loading`);
        return undefined;
    };
    /** Adds a closed panel back through the engine, after the limits its settings set. */
    const reopen = (id) => {
        const rec = records.get(id);
        const state = knownState(id);
        if (rec === undefined || state === undefined || (rec.anonymous && !rec.closed))
            return refused('is-closed', `panel '${id}' is closed and nothing can name it again`);
        const template = templateOf(rec.templateId);
        if (template === undefined)
            return refused('unknown-panel', `panel '${id}': template '${rec.templateId}' is not registered`);
        const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: template.settings, ...(rec.settings !== undefined ? { instance: rec.settings } : {}) }, { lenient: true });
        const count = instancesOf(template.id);
        const full = (!res.value.multiple && count > 0) || (res.value.maxInstances !== 'unlimited' && count >= res.value.maxInstances);
        if (full)
            return refused('instance-limit', `panel '${id}': template '${template.id}' is at its limit of ${res.value.multiple ? res.value.maxInstances : 1}`);
        const engineId = id.includes('~') ? id.slice(id.indexOf('~') + 1) : (rec.lastEngineId ?? newId());
        const result = commit.ops.reopen({
            id,
            templateId: template.id,
            engineId,
            declared: rec.intent,
            ...(rec.settings !== undefined ? { settings: rec.settings } : {}),
            ...(rec.params !== undefined ? { params: rec.params } : {}),
            ...(rec.url !== undefined ? { url: rec.url } : {}),
        });
        if (!result.ok)
            return result;
        rec.closed = false;
        inflight.add(id);
        refresh();
        return result;
    };
    /** What a verb does to a panel that is closed: the settings that name it, or a refusal. */
    const onClosed = (id, state, verb) => {
        const rec = records.get(id);
        const reopenable = rec !== undefined && (rec.closed || !rec.anonymous);
        const closed = refused('is-closed', `panel '${id}' is closed`);
        switch (verb) {
            case 'close':
                return accepted(false);
            case 'open':
                return reopenable ? reopen(id) : closed;
            case 'show':
                return reopenable && state.settings.showWhenClosed === 'reopen' ? reopen(id) : closed;
            case 'toggleVisibility':
                if (!reopenable)
                    return closed;
                return state.settings.toggleWhenClosed === 'reopen' ? reopen(id) : accepted(false);
            default:
                return closed;
        }
    };
    /** Runs one operation: the refusals every state shares first, then the verb's table by the panel's state. */
    const operate = (id, call, src) => {
        const unavailable = lifecycleRefusal(id);
        if (unavailable !== undefined)
            return unavailable;
        const state = knownState(id);
        if (state === undefined)
            return call.verb === 'close' ? accepted(false) : refused('is-closed', `panel '${id}' is closed`);
        if (state.status === 'pending')
            return refused('is-pending', `panel '${id}' is still being added`);
        if (state.status === 'closed')
            return onClosed(id, state, call.verb);
        const ops = commit.ops;
        const engineId = state.engineId;
        switch (call.verb) {
            case 'show':
                return ops.show(engineId);
            case 'hide':
                return ops.hide(engineId);
            case 'toggleVisibility':
                return state.status === 'live' ? ops.hide(engineId) : ops.show(engineId);
            case 'close':
                return ops.close(engineId, src);
            case 'open':
                return ops.open(engineId);
            case 'move':
                return state.status === 'live' ? ops.move(engineId, call.by, src) : refused('not-live', `panel '${id}' is parked`);
            case 'place':
                return ops.place(engineId, call.value, src);
            case 'land':
                return ops.land(engineId, call.value, src);
            case 'setSlots':
                return ops.setSlots(engineId, call.slots, src);
            case 'scrollTo':
                return state.status === 'live' ? ops.scrollTo(engineId, call.align) : refused('not-live', `panel '${id}' is parked`);
        }
    };
    /** The closed panels a reset can still reach: a record that can be named again. */
    const closedRecords = () => [...records.values()].filter((r) => knownState(r.id)?.status === 'closed' && (r.closed || !r.anonymous));
    /** Clears what a reset clears on a closed panel: its place in the undo window. True when it was in it. */
    const resetClosed = (r) => r.lastEngineId !== undefined && commit.ops.resetClosed(r.lastEngineId);
    /** `swap`: the engine ids of `show` and `hide`, each a panel the row holds, or the refusal for one it cannot take. */
    const swapPanels = (show, hide) => {
        const first = hide[0] ?? show[0];
        const unavailable = lifecycleRefusal(first === undefined || typeof first === 'string' ? (first ?? rootId) : first.id);
        if (unavailable !== undefined)
            return unavailable;
        const engineIdOf = (id) => {
            const state = knownState(id);
            if (state === undefined)
                return refused('unknown-panel', `no panel '${id}' in this workspace`);
            if (state.status === 'pending')
                return refused('is-pending', `panel '${id}' is still being added`);
            if (state.status === 'closed')
                return refused('is-closed', `panel '${id}' is closed`);
            return state.engineId;
        };
        const hideIds = [];
        for (const id of hide) {
            const engineId = engineIdOf(id);
            if (typeof engineId !== 'string')
                return engineId;
            hideIds.push(engineId);
        }
        const shows = [];
        for (const entry of show) {
            const { id, place } = typeof entry === 'string' ? { id: entry, place: undefined } : entry;
            const engineId = engineIdOf(id);
            if (typeof engineId !== 'string')
                return engineId;
            shows.push(place === undefined ? { engineId } : { engineId, place });
        }
        return commit.ops.swap(shows, hideIds);
    };
    /** `resetLayout`: one panel, or every panel but the root, back to the cascade's defaults in one update. */
    const resetLayout = (target) => {
        const unavailable = lifecycleRefusal(target);
        if (unavailable !== undefined)
            return unavailable;
        const ops = commit.ops;
        const drawn = (committed?.entries ?? []).filter((e) => e.marker !== true && e.id !== rootId);
        if (target === 'all') {
            const declared = [...records.values()].filter((r) => r.intent).map((r) => r.id);
            const rank = (e) => {
                const at = declared.indexOf(panelKey(e));
                return at < 0 ? declared.length : at;
            };
            const ordered = drawn.map((e, k) => ({ e, k })).sort((a, b) => rank(a.e) - rank(b.e) || a.k - b.k).map(({ e }) => e.id);
            const result = ops.reset(ordered, false);
            if (!result.ok)
                return result;
            const cleared = closedRecords().filter(resetClosed);
            if (cleared.length > 0)
                refresh();
            return { ...result, changed: result.changed || cleared.length > 0 };
        }
        const state = knownState(target);
        if (state === undefined)
            return refused('unknown-panel', `no panel '${target}' in this workspace`);
        if (target === rootId)
            return accepted(false);
        if (state.status === 'pending')
            return refused('is-pending', `panel '${target}' is still being added`);
        if (state.status === 'closed') {
            const rec = records.get(target);
            if (rec === undefined || (rec.anonymous && !rec.closed))
                return refused('is-closed', `panel '${target}' is closed and nothing can name it again`);
            const changed = resetClosed(rec);
            if (changed)
                refresh();
            return { ...accepted(changed), panels: [target] };
        }
        return ops.reset([state.engineId], true);
    };
    /** A refusal `lifecycleRefusal` or a state check produced, as the failing arm of a `ConfigureResult`. */
    const failed = (r) => (r.ok ? unchanged() : r);
    /** The instance layer, and the Host-bag split with it, that the panel `id` running as `engineId` resolves under from now on. */
    const storeLayer = (id, engineId, layer, split) => {
        const rec = records.get(id);
        if (rec !== undefined)
            rec.settings = layer;
        if (split !== undefined)
            splits.set(engineId, split);
    };
    /** `configure(id, patch)` from the panel's own caller or from its view: the gate, the checks, then one update through the engine. */
    const configureOne = (id, patch, caller) => {
        const checked = checkPatch(caller, patch);
        const unavailable = lifecycleRefusal(id);
        if (unavailable !== undefined)
            return failed(unavailable);
        const state = knownState(id);
        if (state === undefined)
            return failed(refused('unknown-panel', `no panel '${id}' in this workspace`));
        if ('refusal' in checked)
            return { ok: false, ...checked.refusal };
        if (state.status === 'pending')
            return failed(refused('is-pending', `panel '${id}' is still being added`));
        const asked = patch;
        const input = { call: caller, patch: asked, names: checked.names, workspace: defaults };
        if (state.status === 'closed') {
            const rec = records.get(id);
            if (rec === undefined || (rec.anonymous && !rec.closed))
                return failed(refused('is-closed', `panel '${id}' is closed and nothing can name it again`));
            const plan = planInstance({ ...input, base: rec.settings, template: templateOf(rec.templateId)?.settings, split: rec.lastEngineId === undefined ? undefined : splits.get(rec.lastEngineId), person: undefined, root: false, status: 'closed' });
            if (!plan.ok)
                return refusedPlan(id, plan);
            if (!plan.changed)
                return unchanged();
            if (flipsParkable(asked, plan, state.settings.parkable))
                return refusedFlip(id, flipRefusal('closed'));
            rec.settings = plan.layer;
            if (rec.lastEngineId !== undefined && plan.split !== undefined)
                splits.set(rec.lastEngineId, plan.split);
            refresh();
            return configured(plan);
        }
        let layer;
        let split;
        // The update plans again when an earlier update of the turn rebuilt the entry, and by then the record already holds the new layer: the base must stay the one the call saw.
        let base;
        const planUpdate = (target, status) => {
            base ??= { layer: instanceLayer(target), split: splits.get(target.id) };
            const seen = base;
            const plan = planInstance({ ...input, base: seen.layer, template: templateOf(target.view)?.settings, split: seen.split, person: target.overrides, root: target.id === rootId, slots: slotsOf(target), status });
            if (!plan.ok)
                return { done: refusedPlan(id, plan) };
            if (!plan.changed)
                return { done: unchanged() };
            const refusal = flipsParkable(asked, plan, effective(target).parkable) ? flipRefusal(status) : undefined;
            if (refusal !== undefined)
                return { done: refusedFlip(id, refusal) };
            layer = plan.layer;
            split = plan.split;
            return { done: configured(plan), next: reconfigured(target, plan, asked) };
        };
        const result = commit.ops.configure(state.engineId, (target, status) => withHoldNote(target, status, planUpdate(target, status)));
        if (result.ok && result.changed && layer !== undefined)
            storeLayer(id, state.engineId, layer, split);
        return result;
    };
    /** What `multiple: false` must fit: the row's instances and the closed ones that can come back. Only configure counts the closed ones; a reopen that did would count the record it reopens. */
    const returningInstances = (templateId) => {
        const keys = instanceKeys(templateId);
        for (const r of closedRecords())
            if (r.templateId === templateId && !r.closed)
                keys.add(r.id);
        for (const [key, gone] of retired)
            if (gone.state.templateId === templateId && commit?.ops.inUndoWindow(key.slice(key.indexOf('~') + 1)) === true)
                keys.add(key);
        return [...keys];
    };
    /** `configureTemplate`: the three template-scope keys of one template, for panels made from now on. */
    const configureTemplateOne = (templateId, patch) => {
        const checked = checkPatch('template', patch);
        const template = registeredTemplate(templateId);
        if (template === undefined)
            throw new PanelManagerError('unknown-template', `no template '${templateId}' is registered`);
        const unavailable = lifecycleRefusal(templateId);
        if (unavailable !== undefined)
            return failed(unavailable);
        if ('refusal' in checked)
            return { ok: false, ...checked.refusal };
        const before = templateOverrides.get(templateId);
        const plan = planTemplate(before, patch);
        if (!plan.changed)
            return unchanged();
        const after = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: { ...template.settings, ...plan.layer } }).value;
        const wasMultiple = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: { ...template.settings, ...before } }).value.multiple;
        if (checked.names.includes('multiple') && wasMultiple && !after.multiple) {
            const counted = returningInstances(templateId);
            if (counted.some((key) => key !== templateId)) {
                return { ok: false, code: 'instance-limit', setting: 'multiple', message: `template '${templateId}': ${counted.length} ${counted.length === 1 ? 'instance exists' : 'instances exist'}, and a template that is not multiple allows only the one named '${templateId}'` };
            }
        }
        const cap = after.multiple ? after.maxInstances : 1;
        const limited = checked.names.find((n) => n === 'multiple' || n === 'maxInstances');
        if (limited !== undefined && cap !== 'unlimited' && cap < instancesOf(templateId)) {
            return { ok: false, code: 'instance-limit', setting: limited, message: `template '${templateId}': ${instancesOf(templateId)} instances exist, more than ${cap} allows` };
        }
        if (Object.keys(plan.layer).length === 0)
            templateOverrides.delete(templateId);
        else
            templateOverrides.set(templateId, plan.layer);
        refresh();
        const later = checked.names.filter((n) => !sameSettingsValue(before?.[n], plan.layer[n]));
        const notes = checked.names.includes('maxInstances') && !after.multiple ? [{ code: 'max-instances-moot', key: 'maxInstances', message: `maxInstances: template '${templateId}' is not multiple, so this limit has no effect until multiple is true` }] : [];
        for (const note of notes)
            binding.reportNote(note);
        return { ok: true, changed: true, now: [], later, shadowed: [], notes };
    };
    /** `configureTuning`: the workspace's tuning keys, for this session. */
    const configureTuningOne = (patch) => {
        const checked = checkPatch('tuning', patch);
        if (status === 'disposed')
            return failed(refused('disposed', 'the workspace was disposed'));
        if ('refusal' in checked)
            return { ok: false, ...checked.refusal };
        const plan = planTuning(tuningInput, patch);
        if (!plan.changed)
            return unchanged();
        const apply = () => {
            tuningInput = plan.input;
            tuning = resolveWorkspaceTuning(plan.input);
            refresh();
            for (const l of [...tuningListeners])
                l();
        };
        // Before the first load there is no layout to reprice: the patch lands in the input the load reads.
        if (plan.reprices && commit !== undefined && status === 'ready') {
            const done = commit.ops.reprice(apply);
            if (!done.ok)
                return failed(done);
        }
        else {
            apply();
        }
        return { ok: true, changed: true, now: plan.now, later: plan.later, shadowed: [], notes: [] };
    };
    for (const t of o.templates ?? [])
        registerOne(t);
    const binding = {
        rootId,
        storage: o.storage,
        defaults,
        get tuningInput() {
            return tuningInput;
        },
        get tuning() {
            return tuning;
        },
        layerOf: instanceLayer,
        hostAsked: (engineId, host) => void splits.set(engineId, { host, touched: new Set() }),
        order: o.order,
        newId,
        reportError,
        autoMounted,
        live,
        wrap: o.wrap,
        undoToast: o.undoToast !== false,
        rowNearSlots: o.rowNearSlots,
        theme: o.theme,
        warnHandMounted: () => {
            if (!autoMounted || warnedHandMount || typeof process === 'undefined' || process.env.NODE_ENV === 'production')
                return;
            warnedHandMount = true;
            console.warn('phonux: a PanelRow was given a workspace that also renders itself, so its panels mount twice. Pass `mount: false` to createWorkspace when you render the workspace yourself.');
        },
        reportNote: (note) => {
            if (noteSink === undefined) {
                notesBeforeSink.push(note);
                return;
            }
            try {
                noteSink(note);
            }
            catch {
                // A reporter that throws must not break the slot that raised the note.
            }
        },
        touch: (engineId, control = false) => touchSink?.(engineId, control),
        blur: () => blurSink?.(),
        bindBlur: (sink) => {
            blurSink = sink;
        },
        bindTouch: (sink) => {
            touchSink = sink;
        },
        cycle: (direction, keepId) => cycleSink?.(direction, keepId) ?? false,
        bindCycle: (sink) => {
            cycleSink = sink;
        },
        bindSummon: (sink) => {
            summonSink = sink;
        },
        bindNotes: (sink) => {
            noteSink = sink;
            // A slot that fails in the first commit reports before the hook's layout effect has bound the sink.
            for (const note of sink === undefined ? [] : notesBeforeSink.splice(0))
                binding.reportNote(note);
        },
        templates: () => [...(root !== undefined && !templates.has(root.id) ? [root] : []), ...templates.values()].map(withOverrides),
        template: registeredTemplate,
        resolved: (e) => entryResolution(e).value,
        resolveDefaults: (e) => resolveEntry(e, undefined),
        declared: () => [...records.values()].filter((r) => r.intent && !r.closed).map((r) => ({ id: r.id, templateId: r.templateId, ...(r.settings !== undefined ? { settings: r.settings } : {}), ...(r.params !== undefined ? { params: r.params } : {}), ...(r.url !== undefined ? { url: r.url } : {}) })),
        initialEntries: () => [rootEntry()],
        attach: (who) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the workspace was disposed');
            if (owner !== undefined && owner !== who)
                throw new PanelManagerError('already-attached', 'this workspace is already attached to another useProvidePanels; one workspace feeds one row');
            owner = who;
            committed = undefined;
            commit = undefined;
            observed = undefined;
            lastEntries = new Map();
            inflight.clear();
            status = 'loading';
        },
        detach: (who) => {
            if (owner !== who)
                return;
            owner = undefined;
            commit = undefined;
            inflight.clear();
            if (status !== 'disposed')
                status = 'detached';
            refresh();
        },
        observe: (entries, held) => {
            if (status !== 'disposed')
                observed = { entries, held };
        },
        heldByOther: (who) => owner !== undefined && owner !== who,
        publish: (c) => {
            if (status === 'disposed' || owner === undefined)
                return;
            committed = { entries: c.entries, held: c.held };
            commit = c;
            const now = new Map(c.entries.filter((e) => e.marker !== true && e.id !== rootId).map((e) => [e.id, e]));
            for (const [engineId, e] of lastEntries) {
                if (now.has(engineId))
                    continue;
                leave(e);
                viewWorkspaces.delete(engineId);
            }
            lastEntries = now;
            inflight.clear();
            status = c.settled ? 'ready' : 'loading';
            refresh();
        },
        subscribe: (l) => {
            tuningListeners.add(l);
            return () => void tuningListeners.delete(l);
        },
    };
    let name = cleanWorkspaceName(o.name) ?? DEFAULT_WORKSPACE_NAME;
    const handle = {
        id: o.id ?? `workspace-${nextEngineId()}`,
        get name() {
            return name;
        },
        rename: (next) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the workspace was disposed');
            const clean = cleanWorkspaceName(next);
            if (clean === undefined || clean === name)
                return name;
            name = clean;
            try {
                o.onRename?.(name);
            }
            catch (e) {
                reportError(e);
            }
            return name;
        },
        rootId,
        panels,
        get tuning() {
            return tuning;
        },
        get status() {
            return status;
        },
        addPanel,
        update: (change) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the workspace was disposed');
            const refusedKeys = refusedLiveKeys(change);
            if (refusedKeys.length > 0)
                throw new PanelManagerError('invalid-options', `update cannot change ${refusedKeys.join(', ')}: only device, settings, history, snapshots, labels, icons, topInset and panels are live`);
            live.update(change);
        },
        registerTemplate: (t) => {
            if (status === 'disposed')
                throw new PanelManagerError('disposed', 'the workspace was disposed');
            const remove = registerOne(t);
            if (conflicts === 'throw') {
                const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: t.settings });
                const c = res.conflicts[0];
                if (c !== undefined) {
                    remove();
                    throw new PanelManagerError('invalid-settings', `template '${t.id}': ${c.message}`, { layer: c.layer, key: c.key });
                }
            }
            if (status === 'ready')
                commit?.lateRegister(withOverrides(t));
            return remove;
        },
        dispose: () => {
            if (status === 'disposed')
                return;
            status = 'disposed';
            owner = undefined;
            commit = undefined;
            for (const r of records.values())
                r.intent = false;
            refresh();
            listeners.clear();
            panelListeners.clear();
            tuningListeners.clear();
            live.clear();
            splits.clear();
            templateOverrides.clear();
            for (const remove of removers.splice(0))
                remove();
        },
    };
    const workspace = Object.freeze({ panels: Object.freeze({ ...handle.panels, addPanel }) });
    // One per drawn panel, so `useWorkspace()` keeps one identity per view and a panel it adds records that view's panel as its opener.
    const viewWorkspaces = new Map();
    const view = {
        workspace,
        workspaceFor: (engineId) => {
            let own = viewWorkspaces.get(engineId);
            if (own === undefined) {
                own = Object.freeze({ panels: Object.freeze({ ...handle.panels, addPanel: addPanelBy(engineId) }) });
                viewWorkspaces.set(engineId, own);
            }
            return own;
        },
        handleFor: (name) => {
            const e = entryNamed((observed ?? committed)?.entries ?? [], name);
            return e === undefined || e.marker === true ? undefined : source.viewHandleOf(panelKey(e));
        },
        manager: reader,
    };
    const transfer = {
        family: familyOf,
        release: (family) => {
            const engineIds = family.map((c) => c.engineId);
            const check = commit.ops.release(engineIds, false);
            if (!check.ok)
                return { refusal: check };
            return { go: () => void commit.ops.release(engineIds, true) };
        },
        leaving: (key) => {
            const unavailable = lifecycleRefusal(key);
            if (unavailable !== undefined)
                return { refusal: unavailable };
            const entry = committed.entries.find((p) => panelKey(p) === key);
            if (entry === undefined || entry.marker === true)
                return { refusal: refused('unknown-panel', `panel '${key}': this workspace holds no such panel`) };
            const no = (code, message) => ({ refusal: refused(code, `panel '${key}' ${message}`) });
            if (entry.id === rootId)
                return no('root-fixed', 'is the root of its workspace and never moves');
            if (!entry.collapsible)
                return no('not-movable', 'is an always-shown column and stays in its workspace');
            const settings = effective(entry);
            if (!settings.movable)
                return no('not-movable', 'is not movable');
            // Code declares such a panel again at every launch, so only a tombstone keeps it out of this workspace.
            if (entry.declared === true && !(settings.closable && settings.afterClose === 'stay-closed'))
                return no('not-movable', 'is declared by code for this workspace and would return at the next launch');
            const check = commit.ops.release([entry.id], false);
            if (!check.ok)
                return { refusal: check };
            const settingsLayer = instanceLayer(entry);
            const carried = {
                key,
                templateId: entry.view,
                engineId: entry.id,
                openedBy: entry.openedBy,
                settings: settingsLayer,
                params: entry.params,
                url: entry.url === '' ? undefined : entry.url,
                fields: { ...(entry.uid !== undefined ? { uid: entry.uid } : {}), ...(entry.title !== undefined ? { title: entry.title } : {}), slots: slotsOf(entry), sized: entry.overrides?.slots !== undefined },
            };
            return { carried };
        },
        arriving: (family) => {
            const no = (key, message, code = 'instance-limit') => ({ refusal: refused(code, `panel '${key}': ${message}`) });
            const unavailable = lifecycleRefusal(family[0]?.key ?? '');
            if (unavailable !== undefined)
                return { refusal: unavailable };
            // Counted together, so a family of two panels of one template fits only where both do.
            const planned = new Map();
            const plannedIds = new Set();
            const arrivals = [];
            for (const carried of family) {
                const key = carried.key;
                const template = templateOf(carried.templateId);
                if (template === undefined)
                    return no(key, `template '${carried.templateId}' is not registered in the target workspace`, 'unknown-panel');
                const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: template.settings, ...(carried.settings !== undefined ? { instance: carried.settings } : {}) }, { lenient: true });
                const count = instancesOf(template.id) + (planned.get(template.id) ?? 0);
                // A named panel draws its engine id as it lands; an anonymous one keeps the suffix of its key.
                const engineId = key.includes('~') ? key.slice(key.indexOf('~') + 1) : undefined;
                if (committed.entries.some((p) => panelKey(p) === key || (engineId !== undefined && p.id === engineId)) || inflight.has(key) || (engineId !== undefined && plannedIds.has(engineId)))
                    return no(key, 'the target workspace already has a panel under that id');
                if (records.get(key)?.intent === true)
                    return no(key, "the target workspace's code declares a panel under that id, so it cannot take another");
                if ((!res.value.multiple && count > 0) || (res.value.maxInstances !== 'unlimited' && count >= res.value.maxInstances))
                    return no(key, `template '${template.id}' is at its limit of ${res.value.multiple ? res.value.maxInstances : 1} in the target workspace`);
                planned.set(template.id, (planned.get(template.id) ?? 0) + 1);
                if (engineId !== undefined)
                    plannedIds.add(engineId);
                arrivals.push({ carried, template, engineId });
            }
            return {
                go: () => {
                    const landed = new Map(arrivals.map((a) => [a.carried.engineId, a.engineId ?? newId()]));
                    for (const { carried, template } of arrivals) {
                        const key = carried.key;
                        const openedBy = carried.openedBy === undefined ? undefined : landed.get(carried.openedBy);
                        records.set(key, { id: key, templateId: template.id, settings: carried.settings, params: carried.params, url: carried.url, intent: false, closed: false, anonymous: key.includes('~') });
                        inflight.add(key);
                        commit.create({ id: key, templateId: template.id, engineId: landed.get(carried.engineId), ...(openedBy !== undefined ? { openedBy } : {}), ...(carried.settings !== undefined ? { settings: carried.settings } : {}), ...(carried.params !== undefined ? { params: carried.params } : {}), ...(carried.url !== undefined ? { url: carried.url } : {}), carried: carried.fields });
                    }
                    refresh();
                },
            };
        },
    };
    CORES.set(handle, { binding, view, reader, handle, transfer, land: (key, value, src) => operate(key, { verb: 'land', value }, src) });
    if (autoMounted) {
        // Loaded on demand so a workspace that never mounts keeps `react-dom/client` off its import path; a mount that outlives a dispose is undone at once.
        void import('./autoMount.js')
            .then((m) => {
            if (status === 'disposed')
                return;
            removers.push(m.mountWorkspace(handle, o.mount === false ? undefined : o.mount, reportError));
        })
            .catch(reportError);
    }
    return handle;
}
const coreOf = (ws) => {
    const core = CORES.get(ws);
    if (core === undefined)
        throw new PanelManagerError('invalid-options', 'expected a workspace made by createWorkspace');
    return core;
};
/** What a provider hook reads from and writes to `ws`. Throws `invalid-options` for anything `createWorkspace` did not make. */
export const bindingOf = (ws) => coreOf(ws).binding;
/**
 * Puts the parked or hidden panel public under `key` where `value` says and makes it live, as one gated update; a live panel is placed. The row-drop hook ends a
 * drag of a panel that is not in view with it. Throws `invalid-options` for anything `createWorkspace` did not make.
 */
export const landPanelIn = (ws, key, value, src) => coreOf(ws).land(key, value, src);
/** What a row tells its template views about `ws`. */
export const viewContextOf = (ws) => coreOf(ws).view;
/**
 * Moves the panel `key` of `from`, with its family less `leave` when asked, to the end of `to`'s row; both must belong to one column
 * and the caller has checked they differ. Every moving member is checked on both sides before anything acts. With `run` false it
 * only answers.
 */
export function transferPanel(from, key, to, options, run) {
    const source = coreOf(from).transfer;
    const family = options.withFamily === true ? source.family(key) : [];
    const left = new Set((options.leave ?? []).filter((k) => k !== key));
    const keys = family.length > 0 ? family.filter((k) => !left.has(k)) : [key];
    const members = [];
    for (const k of keys) {
        const one = source.leaving(k);
        if ('refusal' in one)
            return { ok: false, code: one.refusal.code, message: one.refusal.message };
        members.push(one.carried);
    }
    const engineOf = new Map(members.map((c) => [c.key, c.engineId]));
    const openerOf = (k) => from.panels.get(k)?.getState().openedBy ?? null;
    const carried = members.map((c) => {
        if (c.key === key)
            return { ...c, openedBy: undefined };
        let opener = openerOf(c.key);
        while (opener !== null && left.has(opener))
            opener = openerOf(opener);
        return { ...c, openedBy: opener === null ? undefined : engineOf.get(opener) };
    });
    const leaving = source.release(carried);
    if ('refusal' in leaving)
        return { ok: false, code: leaving.refusal.code, message: leaving.refusal.message };
    const arriving = coreOf(to).transfer.arriving(carried);
    if ('refusal' in arriving)
        return { ok: false, code: arriving.refusal.code, message: `target workspace '${to.name}': ${arriving.refusal.message}` };
    if (!run)
        return { ok: true, panelIds: keys };
    // Added before they are removed, so a failure in between would leave a panel twice, never lose it.
    arriving.go();
    leaving.go();
    return { ok: true, panelIds: keys };
}
