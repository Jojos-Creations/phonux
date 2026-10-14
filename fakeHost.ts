/**
 * Recording fakes of every API in hostApi.tsx, for testing a view with no host:
 * `createFakeHost({ panels: { panelList: [...] } })`, render under `<HostProvider>`, interact, then assert on
 * `host.calls`. Every method records `{ api, method, args }` in call order and does nothing else (async ones
 * resolve). The fakes hold no state: a test wanting a different live value re-renders with new overrides. An
 * override replaces a whole member (a nested object such as `closedPagesViewer` too), and an overridden
 * method no longer records. Why it lives here: DESIGN.md, "Testing without a host".
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
import type { WorkspaceState, WorkspaceStorage } from './workspaceState.js';

// The ./testing entry point has to name every type FakeHost's own declaration reaches, not just Host.
export type { Host, PhoneSize, ClosedPageEntry, JsonValue, PanelSize, PanelSummary, CreatePanelOptions, SettingsAPI, HistoryAPI, PanelsAPI, PhoneDeviceAPI } from './hostApi.js';
export type { PhonuxLabels } from './labels.js';
export type { SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
export type { PhoneModel } from './phoneModels.js';
export type { WorkspacePanelState, WorkspaceState, WorkspaceStorage } from './workspaceState.js';
export type { AddPlacement, AnchorRequest, PanelId } from './panelSettings.js';

/** One recorded call to a fake method, as listed in `FakeHost.calls`. @public */
export interface FakeCall {
  /** Which `Host` member the method belongs to, e.g. 'panels'. */
  api: keyof Host;
  /** The method's name; a method of a nested object is dotted, e.g. 'settingsColumn.show'. */
  method: string;
  /** The arguments the method received, in order. */
  args: unknown[];
}

/** The `Host` members a host may leave out, which `FakeOverrides.absent` can leave out of a fake. @public */
export type AbsentHostMember = 'history' | 'snapshots';

/**
 * Replacement members, per API. `absent` leaves the named optional members out of the fake altogether, so a view test renders
 * the frame in which a host has not supplied them yet; `createFakeHost` never supplies `labels`, so it is always absent.
 * @public
 */
export type FakeOverrides = { [K in keyof Host]?: Partial<Host[K]> } & { absent?: readonly AbsentHostMember[] };

/** A `Host` whose methods record their calls instead of acting. @public */
export interface FakeHost extends Host {
  /** Every method call any of the fakes received, in order. */
  readonly calls: FakeCall[];
}

/**
 * Builds a recording `FakeHost` with inert defaults: `overrides` replaces whole members per API, and every
 * non-overridden method appends to `calls`.
 * @param overrides - Members to replace, per API; an overridden method no longer records. `absent` names optional members to leave out.
 * @public
 */
export function createFakeHost(overrides: FakeOverrides = {}): FakeHost {
  const calls: FakeCall[] = [];
  const log = (api: keyof Host, method: string, args: unknown[]): void => {
    calls.push({ api, method, args });
  };

  const settings: SettingsAPI = {
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
    maxFitPanels: null,
    // Explicitly optional (not inferred from PanelsAPI's own overloaded `create`): an inferred-required
    // parameter would no longer satisfy the interface's zero-arg overload.
    create: (options?: CreatePanelOptions) => log('panels', 'create', options !== undefined ? [options] : []),
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
  const snapshots: SnapshotsAPI = {
    get: () => null,
    subscribe: () => () => {},
  };

  const device: PhoneDeviceAPI = {
    size: DEFAULT_PHONE_SIZE,
    defaultSize: DEFAULT_PHONE_SIZE,
    models: PHONE_MODELS,
    chooseModel: async (modelId) => log('device', 'chooseModel', [modelId]),
  };

  const absent = new Set<AbsentHostMember>(overrides.absent);
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
export function memoryWorkspaceStorage(initial: WorkspaceState | null = null): WorkspaceStorage {
  let held: string | null = initial === null ? null : JSON.stringify(initial);
  return {
    load: async () => (held === null ? null : (JSON.parse(held) as WorkspaceState)),
    save: (state) => {
      held = JSON.stringify(state);
    },
  };
}
