/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host and no desktop bridge:
 * `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`, interact, then assert on
 * `host.calls`. Every method records `{ api, method, args }` in call order and does nothing else (async ones
 * resolve). The fakes hold no state: a test wanting a different live value re-renders with new overrides. An
 * override replaces a whole member (a nested object such as `closedPagesViewer` too), and an overridden
 * method no longer records. Why it lives here: DESIGN.md, "Testing without a host".
 */
import { PHONE_MODELS } from './phoneModels.js';
import { DEFAULT_PHONE_SIZE, } from './hostApi.js';
/** @public */
export function createFakeHost(overrides = {}) {
    const calls = [];
    const log = (api, method, args) => {
        calls.push({ api, method, args });
    };
    const settings = {
        maxPanelsOnScreen: null,
        fitCount: 4,
        // Matches the app's own single-fixed-column (History-only) default; a test with more permanent columns
        // overrides this explicitly.
        minPanelsOnScreen: 2,
        setMaxPanelsOnScreen: async (n) => log('settings', 'setMaxPanelsOnScreen', [n]),
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
        // Explicitly optional (not inferred from PanelsAPI's own overloaded `create`): an inferred-required
        // parameter would no longer satisfy the interface's zero-arg overload.
        create: (options) => log('panels', 'create', options !== undefined ? [options] : []),
        activate: (id) => log('panels', 'activate', [id]),
        move: (id, direction) => log('panels', 'move', [id, direction]),
        setFormFactor: (id, next) => log('panels', 'setFormFactor', [id, next]),
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
        detectedPhone: null,
        dismissDetectedPhone: () => log('device', 'dismissDetectedPhone', []),
        resizeForDetectedPhone: (modelId) => log('device', 'resizeForDetectedPhone', [modelId]),
    };
    return {
        settings: { ...settings, ...overrides.settings },
        history: { ...history, ...overrides.history },
        panels: { ...panels, ...overrides.panels },
        device: { ...device, ...overrides.device },
        snapshots: { ...snapshots, ...overrides.snapshots },
        calls,
    };
}
/** @public @deprecated use createFakeHost -- same function, so identity checks keep working. */
export const createFakePhoneAPIs = createFakeHost;
