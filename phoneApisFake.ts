/**
 * Recording fakes of every API in phoneViewApi.tsx, for testing a view with no
 * host and no desktop bridge:
 *
 *   const apis = createFakePhoneAPIs({ panels: { panelList: [...] } });
 *   render(<PhoneAPIsProvider apis={apis}><MyView /></PhoneAPIsProvider>);
 *   // interact, then assert on apis.calls
 *
 * Every method records `{ api, method, args }` in `apis.calls`, in call order,
 * and does nothing else: the fakes hold no state, so a test that wants a
 * different live value re-renders with new overrides. Async methods resolve.
 * `overrides` replaces whole members of one API (an override of
 * `closedPagesViewer` or `settingsColumn` replaces the whole nested object); an
 * overridden method no longer records.
 *
 * Lives beside the API contracts, not in the app's test folder, so a view
 * written by a third party can import it. It has no test-runner dependency and
 * imports only the contracts and the data-only phone model list.
 */

import { PHONE_MODELS } from './phoneModels.js';
import {
  DEFAULT_PHONE_SIZE,
  type DeviceAPI,
  type HistoryAPI,
  type PanelsAPI,
  type PhoneAPIs,
  type SettingsAPI,
} from './phoneViewApi.js';

export interface FakeCall {
  api: keyof PhoneAPIs;
  method: string;
  args: unknown[];
}

/** Replacement members, per API. */
export type FakeOverrides = { [K in keyof PhoneAPIs]?: Partial<PhoneAPIs[K]> };

export interface FakePhoneAPIs extends PhoneAPIs {
  /** Every method call any of the fakes received, in order. */
  readonly calls: FakeCall[];
}

export function createFakePhoneAPIs(overrides: FakeOverrides = {}): FakePhoneAPIs {
  const calls: FakeCall[] = [];
  const log = (api: keyof PhoneAPIs, method: string, args: unknown[]): void => {
    calls.push({ api, method, args });
  };

  const settings: SettingsAPI = {
    maxViews: { mode: 'screen-width', collapseAtViews: 6, downToViews: 4 },
    maxViewsBounds: { min: 3, max: 20 },
    setMaxViews: (next) => log('settings', 'setMaxViews', [next]),
    autoCollapse: true,
    setAutoCollapse: async (on) => log('settings', 'setAutoCollapse', [on]),
    hideSettingsAfterViews: null,
    setHideSettingsAfterViews: (views) => log('settings', 'setHideSettingsAfterViews', [views]),
    shownViews: 1,
    settingsColumn: {
      visible: true,
      show: () => log('settings', 'settingsColumn.show', []),
      hide: () => log('settings', 'settingsColumn.hide', []),
    },
    locked: false,
    closed: false,
    close: () => log('settings', 'close', []),
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
    create: () => log('panels', 'create', []),
    activate: (id) => log('panels', 'activate', [id]),
    close: (id) => log('panels', 'close', [id]),
    recentlyClosed: null,
    undoClose: () => log('panels', 'undoClose', []),
    clearAll: () => log('panels', 'clearAll', []),
  };

  const device: DeviceAPI = {
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
    calls,
  };
}
