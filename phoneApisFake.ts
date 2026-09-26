/**
 * Recording fakes of every API in phoneViewApi.tsx, for testing a view with no
 * host and no desktop bridge:
 *
 *   const host = createFakeHost({ panels: { panelList: [...] } });
 *   render(<HostProvider host={host}><MyView /></HostProvider>);
 *   // interact, then assert on host.calls
 *
 * Every method records `{ api, method, args }` in `host.calls`, in call order,
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
  type CreatePanelOptions,
  type HistoryAPI,
  type Host,
  type PanelsAPI,
  type PhoneDeviceAPI,
  type SettingsAPI,
} from './phoneViewApi.js';

export interface FakeCall {
  api: keyof Host;
  method: string;
  args: unknown[];
}

/** Replacement members, per API. */
export type FakeOverrides = { [K in keyof Host]?: Partial<Host[K]> };

export interface FakeHost extends Host {
  /** Every method call any of the fakes received, in order. */
  readonly calls: FakeCall[];
}

/** @deprecated use FakeHost */
export type FakePhoneAPIs = FakeHost;

export function createFakeHost(overrides: FakeOverrides = {}): FakeHost {
  const calls: FakeCall[] = [];
  const log = (api: keyof Host, method: string, args: unknown[]): void => {
    calls.push({ api, method, args });
  };

  const settings: SettingsAPI = {
    maxPanelsOnScreen: null,
    fitCount: 4,
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
    close: (id) => log('panels', 'close', [id]),
    recentlyClosed: null,
    undoClose: () => log('panels', 'undoClose', []),
    clearAll: () => log('panels', 'clearAll', []),
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
    calls,
  };
}

/** @deprecated use createFakeHost -- same function, so identity checks keep working. */
export const createFakePhoneAPIs = createFakeHost;
