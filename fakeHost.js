/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host:
 * `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`, interact, then assert on
 * `host.calls`. Every method records `{ api, method, args }` in call order and does nothing else (async ones
 * resolve). The fakes hold no state: a test wanting a different live value re-renders with new overrides. An
 * override replaces a whole member (a nested object such as `closedPagesViewer` too), and an overridden
 * method no longer records. `createFakePanel` is the one exception: it holds the single panel state it was given.
 * Why it lives here: DESIGN.md, "Testing without a host".
 */
import { PHONE_MODELS } from './phoneModels.js';
import { DEFAULT_PHONE_SIZE, } from './hostApi.js';
import { resolvePanelSettings } from './panelSettings.js';
import { filterStates } from './panelHandles.js';
import { ROOT_MARKER_ID } from './workspaceCore.js';
/**
 * Builds a recording `FakeHost` with inert defaults: `overrides` replaces whole members per API, and every
 * non-overridden method appends to `calls`.
 * @param overrides - Members to replace, per API; an overridden method no longer records. `absent` names optional members to leave out.
 * @public
 */
export function createFakeHost(overrides = {}) {
    const calls = [];
    const log = (api, method, args) => {
        calls.push({ api, method, args });
    };
    const settings = {
        settingsColumn: {
            visible: false,
            show: () => log('settings', 'settingsColumn.show', []),
            hide: () => log('settings', 'settingsColumn.hide', []),
        },
    };
    const history = {
        loadClosedPages: async () => {
            log('history', 'loadClosedPages', []);
            return [];
        },
        closedPagesViewer: {
            isOpen: false,
            loading: false,
            entries: [],
            open: () => log('history', 'closedPagesViewer.open', []),
            close: () => log('history', 'closedPagesViewer.close', []),
        },
        locked: true,
        closed: false,
        close: () => log('history', 'close', []),
    };
    const panels = {
        panelList: [],
        maxFitPanels: null,
        // Explicitly optional (not inferred from PanelsAPI's own overloaded `create`): an inferred-required
        // parameter would no longer satisfy the interface's zero-arg overload.
        create: (options) => log('panels', 'create', options !== undefined ? [options] : []),
        activate: (id) => log('panels', 'activate', [id]),
        move: (id, direction) => log('panels', 'move', [id, direction]),
        setSlots: (id, slots) => log('panels', 'setSlots', [id, slots]),
        reanchor: (id, anchor) => log('panels', 'reanchor', [id, anchor]),
        close: (id) => log('panels', 'close', [id]),
        recentlyClosed: null,
        undoClose: () => log('panels', 'undoClose', []),
        clearAll: () => log('panels', 'clearAll', []),
    };
    // Never logs, unlike every other member: React calls get()/subscribe() on every render, so logging would add
    // `calls` entries to every test that merely renders a capturable Panel. get() always answers null.
    const snapshots = {
        get: () => null,
        subscribe: () => () => { },
    };
    const device = {
        size: DEFAULT_PHONE_SIZE,
        defaultSize: DEFAULT_PHONE_SIZE,
        models: PHONE_MODELS,
        chooseModel: async (modelId) => log('device', 'chooseModel', [modelId]),
    };
    const absent = new Set(overrides.absent);
    return {
        settings: { ...settings, ...overrides.settings },
        ...(absent.has('history') ? {} : { history: { ...history, ...overrides.history } }),
        panels: { ...panels, ...overrides.panels },
        device: { ...device, ...overrides.device },
        ...(absent.has('snapshots') ? {} : { snapshots: { ...snapshots, ...overrides.snapshots } }),
        calls,
    };
}
/**
 * A `WorkspaceStorage` that keeps the saved state in memory: `load` resolves a copy of what `save` last stored, or of
 * `initial`, and `save` stores a copy, so a test never shares an object with the workspace.
 * @param initial - The state `load` resolves until the first `save`; `null` for none.
 * @public
 */
export function memoryWorkspaceStorage(initial = null) {
    let held = initial === null ? null : JSON.stringify(initial);
    let lastSaved = null;
    return {
        load: async () => (held === null ? null : JSON.parse(held)),
        save: (state) => {
            held = JSON.stringify(state);
            lastSaved = held;
        },
        get saved() {
            return lastSaved === null ? null : JSON.parse(lastSaved);
        },
    };
}
/**
 * Members of `WorkspaceOptions` that make a workspace restore `seeds`, in the order given, through the same path a saved
 * file takes: `createWorkspace({ ...seedWorkspace(seeds), templates })`. For tests only; app code adds panels with
 * `definePanel`, `createWorkspace` and `addPanel`. Seed a workspace that declares no panels, and let it restore before
 * adding any: the first ids drawn and the first `hostData` handed out belong to the seeds.
 * @param seeds - The panels to restore, left to right after the root.
 * @param rootId - The id of the workspace's root entry; default is the id of a workspace without a root template.
 * @param laterIds - Engine ids (a panel's `id` in the snapshot) that `newId` hands out after the seeds and before the counter, one per panel added to the live workspace. An instance key is not set here: `addPanel(view, { id })` already names it.
 * @throws Error when two seeds share an id, or a later id repeats another.
 * @public
 */
export function seedWorkspace(seeds, rootId = ROOT_MARKER_ID, laterIds = []) {
    const ids = seeds.map((seed) => seed.id);
    if (new Set(ids).size !== ids.length)
        throw new Error('seedWorkspace: two seeds share an id');
    const taken = new Set([...ids, ...laterIds]);
    if (taken.size !== ids.length + laterIds.length)
        throw new Error('seedWorkspace: an id is given twice');
    // Priority 0 sits nearest the root, so the leftmost of the left seeds holds the highest.
    const leftCount = seeds.filter((seed) => seed.side === 'left').length;
    let leftSeen = 0;
    const state = {
        version: 1,
        panels: seeds.map((seed, index) => ({
            id: seed.id,
            view: seed.view,
            live: seed.live,
            ...(seed.url !== undefined ? { url: seed.url } : {}),
            ...(seed.title !== undefined ? { title: seed.title } : {}),
            ...(seed.slots !== undefined ? { slots: seed.slots } : {}),
            ...(seed.permanent !== undefined ? { permanent: seed.permanent } : {}),
            anchor: seed.side === 'left' ? { panel: rootId, position: 'left', priority: leftCount - 1 - leftSeen++ } : { panel: rootId, position: 'right', priority: index },
        })),
    };
    const idsLeft = [...ids, ...laterIds];
    const hostDataLeft = seeds.map((seed) => seed.hostData);
    let counter = 0;
    const newId = () => {
        const chosen = idsLeft.shift();
        if (chosen !== undefined)
            return chosen;
        do
            counter += 1;
        while (taken.has(String(counter)));
        return String(counter);
    };
    return { storage: memoryWorkspaceStorage(state), newId, panels: { defaultHostData: () => hostDataLeft.shift() ?? null } };
}
const ACCEPTED = { ok: true, changed: false };
const ACCEPTED_PIN = { ok: true, changed: false };
const ACCEPTED_CONFIGURE = { ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] };
/**
 * Builds a handle and a reader over one in-memory panel, so a view takes `props` from a test with no cast. The panel holds
 * the one state it was given and never changes it; every operation records a call and answers an accepted result that
 * changed nothing.
 * @param state - The panel's state; a field left out takes a default (id 'panel', template 'fake', status 'live').
 * @public
 */
export function createFakePanel(state = {}) {
    const calls = [];
    const resolution = resolvePanelSettings();
    const own = {
        id: 'panel',
        templateId: 'fake',
        status: 'live',
        held: false,
        engineId: null,
        index: 0,
        title: undefined,
        listed: true,
        settings: resolution.value,
        pinned: false,
        deferredPin: null,
        ...state,
        params: state.params,
    };
    const snapshot = { version: 1, status: 'ready', panels: [own] };
    const record = (method, args) => {
        calls.push({ api: 'handle', method, args });
    };
    const answer = (method, args, result) => {
        record(method, args);
        return result;
    };
    const read = { id: own.id, templateId: own.templateId, getState: () => own, getSettings: () => ({ ...resolution, value: own.settings }), subscribe: () => () => { } };
    const handle = {
        ...read,
        show: (...args) => answer('show', args, ACCEPTED),
        hide: (...args) => answer('hide', args, ACCEPTED),
        toggleVisibility: (...args) => answer('toggleVisibility', args, ACCEPTED),
        close: (...args) => answer('close', args, ACCEPTED),
        open: (...args) => answer('open', args, ACCEPTED),
        move: (...args) => answer('move', args, ACCEPTED),
        place: (...args) => answer('place', args, ACCEPTED),
        setSlots: (...args) => answer('setSlots', args, ACCEPTED),
        scrollTo: (...args) => answer('scrollTo', args, ACCEPTED),
        pin: (...args) => answer('pin', args, ACCEPTED_PIN),
        unpin: (...args) => answer('unpin', args, ACCEPTED_PIN),
        configure: (...args) => answer('configure', args, ACCEPTED_CONFIGURE),
    };
    const manager = {
        get: (id) => (id === own.id ? read : undefined),
        list: (f) => filterStates(snapshot.panels, f),
        getSnapshot: () => snapshot,
        subscribe: () => () => { },
    };
    const panel = {
        id: own.id,
        ...(own.title === undefined ? {} : { title: own.title }),
        live: own.status === 'live',
        ...(own.params === undefined ? {} : { params: own.params }),
        slots: own.settings.slots,
    };
    return { props: { panel, handle, manager }, handle, manager, calls };
}
