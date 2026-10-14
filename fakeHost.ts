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
import type { ConfigureResult, PanelResult, PinResult } from './panelManager.js';
import { resolvePanelSettings, type PanelId } from './panelSettings.js';
import type { JsonValue, PanelSummary } from './hostApi.js';
import type { ListFilter, PanelReader, PanelSnapshot, PanelState, PanelViewProps, ViewHandle } from './panelTemplate.js';
import { filterStates } from './panelHandles.js';
import type { WorkspaceState, WorkspaceStorage } from './workspaceState.js';

// The ./testing entry point has to name every type FakeHost's own declaration reaches, not just Host.
export type { Host, PhoneSize, ClosedPageEntry, JsonValue, PanelSize, PanelSummary, CreatePanelOptions, SettingsAPI, HistoryAPI, PanelsAPI, PhoneDeviceAPI } from './hostApi.js';
export type { PhonuxLabels } from './labels.js';
export type { SnapshotsAPI, ViewId, ViewSnapshot } from './snapshots.js';
export type { PhoneModel } from './phoneModels.js';
export type { WorkspacePanelState, WorkspaceState, WorkspaceStorage } from './workspaceState.js';
export type { AddPlacement, AnchorRequest, PanelId, PanelSettingsResolution, ResolvedPanelSettings, ScrollAlign, SettingValues, ResolvedPanelTuning, HeaderButton, SourceLayer, SettingNote, SettingConflict, CatalogName } from './panelSettings.js';
export type { ConfigureResult, PanelResult, PinResult } from './panelManager.js';
export type { PanelRefusal } from './panelManagerError.js';
export type { PanelHandle } from './panelHandles.js';
export type { ListFilter, PanelReader, PanelReadHandle, PanelSnapshot, PanelState, PanelStatus, PanelViewProps, ViewHandle, DeferredPin, WorkspaceStatus } from './panelTemplate.js';
export type { ViewPatch } from './settingsPatch.js';
export type { BezierEase, FadeEase } from './panelSettings.js';
export type { ChromeTuning, CloseExitEase, GlideEase, HeaderButtonBase, HeaderButtonContext, PanelTuning, PinHalf, PinWhenNotLive } from './panelSettings.js';
export type { SettingsPatch } from './settingsPatch.js';
export type { DragToCloseTuning, EdgeScrollTuning, HeaderButtonIconForm, HeaderButtonTextForm, Overflow, PanelSettings, Pinning, PinningWhenNotLive, ScrollOnDrag, ScrollOnMove, ScrollOnOpen, SlideTuning, WorkspaceTuning } from './panelSettings.js';
export type { InstancePatch } from './settingsPatch.js';

/** One recorded call to a fake method, as listed in `FakeHost.calls`. @public */
export interface FakeCall {
  /** Which `Host` member the method belongs to, e.g. 'panels'; 'handle' for a call on a `createFakePanel` handle. */
  api: keyof Host | 'handle';
  /** The method's name; a method of a nested object is dotted, e.g. 'settingsColumn.show'. */
  method: string;
  /** The arguments the method received, in order. */
  args: unknown[];
}

/** Replacement members, per API. @public */
export type FakeOverrides = { [K in keyof Host]?: Partial<Host[K]> };

/** A `Host` whose methods record their calls instead of acting. @public */
export interface FakeHost extends Host {
  /** Every method call any of the fakes received, in order. */
  readonly calls: FakeCall[];
}

/**
 * Builds a recording `FakeHost` with inert defaults: `overrides` replaces whole members per API, and every
 * non-overridden method appends to `calls`.
 * @param overrides - Members to replace, per API; an overridden method no longer records.
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

  return {
    settings: { ...settings, ...overrides.settings },
    history: { ...history, ...overrides.history },
    panels: { ...panels, ...overrides.panels },
    device: { ...device, ...overrides.device },
    snapshots: { ...snapshots, ...overrides.snapshots },
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

/** What `createFakePanel` builds: the props to render a view with, and the calls its handle received. @public */
export interface FakePanel<P extends JsonValue = JsonValue> {
  /** The props a template's `view` or `footer` receives: render the component with `{...fake.props}`. */
  readonly props: PanelViewProps<P>;
  /** The panel's handle: the same object as `props.handle`. */
  readonly handle: ViewHandle<P>;
  /** The reader over the one panel: the same object as `props.manager`. */
  readonly manager: PanelReader;
  /** Every operation the handle received, in order, as `{ api: 'handle', method, args }`. */
  readonly calls: FakeCall[];
}

const ACCEPTED: PanelResult = { ok: true, changed: false };
const ACCEPTED_PIN: PinResult = { ok: true, changed: false };
const ACCEPTED_CONFIGURE: ConfigureResult = { ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] };

/**
 * Builds a handle and a reader over one in-memory panel, so a view takes `props` from a test with no cast. The panel holds
 * the one state it was given and never changes it; every operation records a call and answers an accepted result that
 * changed nothing.
 * @param state - The panel's state; a field left out takes a default (id 'panel', template 'fake', status 'live').
 * @public
 */
export function createFakePanel<P extends JsonValue = JsonValue>(state: Partial<Omit<PanelState, 'params'>> & { params?: P } = {}): FakePanel<P> {
  const calls: FakeCall[] = [];
  const resolution = resolvePanelSettings();
  const own: PanelState & { readonly params: P | undefined } = {
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
  const snapshot: PanelSnapshot = { version: 1, status: 'ready', panels: [own] };
  const record = (method: string, args: unknown[]): void => {
    calls.push({ api: 'handle', method, args });
  };
  const answer = <R>(method: string, args: unknown[], result: R): R => {
    record(method, args);
    return result;
  };
  const read = { id: own.id, templateId: own.templateId, getState: () => own, getSettings: () => ({ ...resolution, value: own.settings }), subscribe: () => () => {} };
  const handle: ViewHandle<P> = {
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
  const manager: PanelReader = {
    get: (id: PanelId) => (id === own.id ? read : undefined),
    list: (f?: ListFilter) => filterStates(snapshot.panels, f),
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  };
  const panel: PanelSummary<P> = {
    id: own.id,
    ...(own.title === undefined ? {} : { title: own.title }),
    live: own.status === 'live',
    locked: false,
    ...(own.params === undefined ? {} : { params: own.params }),
    slots: own.settings.slots,
  };
  return { props: { panel, handle, manager }, handle, manager, calls };
}
