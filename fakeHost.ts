/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host and no desktop
 * bridge: `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`,
 * interact, then assert on `host.calls`. Every method records `{ api, method, args }`, in call order,
 * and does nothing else (async methods resolve) -- the fakes hold no state, so a test wanting a different
 * live value re-renders with new overrides; `overrides` replaces whole members (an override of
 * `closedPagesViewer` or `settingsColumn` replaces the whole nested object), and an overridden method no
 * longer records. Lives beside the contracts, not the app's test folder, so a third-party view can import
 * it: no test-runner dependency, and imports only the contracts and the data-only phone model list.
 */

import { PHONE_MODELS } from './phoneModels.js';
import {
  DEFAULT_PHONE_SIZE,
  type CreatePanelOptions,
  type HistoryAPI,
  type Host,
  type PanelsAPI,
  type PhoneDeviceAPI,
  type SettingsAPI,
} from './hostApi.js';
import type { SnapshotsAPI } from './snapshots.js';

// The ./testing entry point has to name every type FakeHost's own declaration reaches, not just Host.
export type { Host, PhoneSize, DetectedPhone, ClosedPageEntry, JsonValue, FormFactor, PanelSize, PanelSummary, CreatePanelOptions, SettingsAPI, HistoryAPI, PanelsAPI, PhoneDeviceAPI } from './hostApi.js';
export type { SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
export type { PhoneModel } from './phoneModels.js';

/** @public */
export interface FakeCall {
  api: keyof Host;
  method: string;
  args: unknown[];
}

/** Replacement members, per API. @public */
export type FakeOverrides = { [K in keyof Host]?: Partial<Host[K]> };

/** @public */
export interface FakeHost extends Host {
  /** Every method call any of the fakes received, in order. */
  readonly calls: FakeCall[];
}

/** @public @deprecated use FakeHost */
export type FakePhoneAPIs = FakeHost;

/** @public */
export function createFakeHost(overrides: FakeOverrides = {}): FakeHost {
  const calls: FakeCall[] = [];
  const log = (api: keyof Host, method: string, args: unknown[]): void => {
    calls.push({ api, method, args });
  };

  const settings: SettingsAPI = {
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

  const history: HistoryAPI = {
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

  const panels: PanelsAPI = {
    panelList: [],
    // Explicitly optional (not inferred from PanelsAPI's own overloaded `create`): an inferred-required
    // parameter would no longer satisfy the interface's zero-arg overload.
    create: (options?: CreatePanelOptions) => log('panels', 'create', options !== undefined ? [options] : []),
    activate: (id) => log('panels', 'activate', [id]),
    move: (id, direction) => log('panels', 'move', [id, direction]),
    setFormFactor: (id, next) => log('panels', 'setFormFactor', [id, next]),
    reanchor: (id, anchor) => log('panels', 'reanchor', [id, anchor]),
    close: (id) => log('panels', 'close', [id]),
    recentlyClosed: null,
    undoClose: () => log('panels', 'undoClose', []),
    clearAll: () => log('panels', 'clearAll', []),
  };

  // Deliberately does NOT log, unlike every other member here: useSyncExternalStore calls get()/subscribe()
  // as part of ordinary React rendering (every render, every mount), not as a discrete user action -- logging
  // them would put a `snapshots.get`/`snapshots.subscribe` entry in `calls` for every test that merely renders
  // a view with a capturable Panel, breaking every exact `deepEqual(calls, [...])` assertion elsewhere that
  // has nothing to do with snapshots. Holds no state either way: get() always answers null.
  const snapshots: SnapshotsAPI = {
    get: () => null,
    subscribe: () => () => {},
  };

  const device: PhoneDeviceAPI = {
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
