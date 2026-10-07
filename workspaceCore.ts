/**
 * The workspace behind `createWorkspace`: React-free state that the provider hook attaches to. Declarative intents
 * (`addPanel` before the workspace is ready) are replayed at every settle; after ready `addPanel` asks the attached
 * engine to create the panel. The engine's controls reach this module through `publish` and are used only here,
 * through the handles and the reader built over `ReadSource`; DESIGN.md, "The workspace core", says why.
 */
import type { JsonValue } from './hostApi.js';
import { makeHandle, makeReader, type PanelHandle, type ReadSource } from './panelHandles.js';
import { makePanelManager, type PanelManager } from './panelManager.js';
import { PanelManagerError } from './panelManagerError.js';
import { isPinned } from './panelPin.js';
import { applyTemplate, effective, panelKey, resolvePanelSettings, sameSettingsValue } from './panelSettings.js';
import type { PanelId, PanelSettings, PanelSettingsResolution, ResolvedWorkspaceTuning, WorkspaceTuning } from './panelSettings.js';
import { definePanel } from './panelTemplate.js';
import type { PanelReader, PanelSnapshot, PanelState, PanelTemplate, WorkspaceStatus } from './panelTemplate.js';
import { resolveWorkspaceTuning } from './panelTuning.js';
import { createHistoryPanel, type PanelWindow } from './panelWindow.js';
import type { PanelViewContext } from './panelViewContext.js';
import { getTemplate, registerTemplate as registerGlobalTemplate } from './viewRegistry.js';
import type { DeclaredPanel } from './workspacePlan.js';
import type { WorkspaceStorage } from './workspaceState.js';

/** The id of the marker entry a workspace without a root keeps. */
export const ROOT_MARKER_ID = '__root__';

let nextEngineIdValue = 1;
/** The next id for an engine entry. A module counter, bumped only from handlers and the restore callback, never from a state initialiser. */
export const nextEngineId = (): string => String(nextEngineIdValue++);

/**
 * What `createWorkspace` takes; every member is optional.
 * @public
 */
export type WorkspaceOptions = {
  /** Where the workspace is kept between launches. Unset: nothing is loaded or saved. */
  storage?: WorkspaceStorage;
  /** The workspace's panel settings (every key except `tuning`), the layer under every template. */
  defaults?: Omit<PanelSettings, 'tuning'>;
  /** The root panel's template. Unset: the row has an invisible marker entry as its root. */
  root?: PanelTemplate;
  /** The templates panels of this workspace may be made from. */
  templates?: readonly PanelTemplate[];
  /** The developer's panel order, read by every placement whose value is `'order'`. */
  order?: () => readonly PanelId[];
  /** The workspace's tuning leaves; each one left out or out of range takes the library default. */
  tuning?: WorkspaceTuning;
  /** What a template asking for a forced setting does: `'warn'` (default) logs once per panel and setting, `'throw'` throws a PanelManagerError, `'off'` is silent. */
  conflicts?: 'warn' | 'throw' | 'off';
  /** Draws the ids of new panels, for the engine and for the suffix of an anonymous instance; must return a different string each call. Default: a counter. */
  newId?: () => string;
  /** Receives an error the workspace swallows, such as a storage whose save fails. Unset: `console.error`. */
  onError?: (e: unknown) => void;
};

/**
 * A workspace: the panels of one row, the templates they are made from and their saved state.
 * @public
 */
export interface WorkspaceHandle {
  /** The id of the row's root entry: the root template's id, or `'__root__'` without one. */
  readonly rootId: string;
  /** Read access to every panel. */
  readonly panels: PanelManager;
  /** The workspace's tuning, resolved over the library defaults. */
  readonly tuning: ResolvedWorkspaceTuning;
  /** Where the workspace is in its life: `detached`, `loading`, `ready` or `disposed`. */
  readonly status: WorkspaceStatus;
  /**
   * Adds a panel of template `t` (or the registered template with that id) and returns its handle. A singleton is
   * get-or-create by id. Before the workspace is ready this records an intent replayed at every settle, and a `multiple`
   * template then needs an explicit `id`. A panel over its template's `maxInstances` comes back in status `closed`.
   */
  addPanel<P extends JsonValue = JsonValue>(t: PanelTemplate<P> | string, o?: { id?: PanelId; settings?: PanelSettings; params?: P; url?: string }): PanelHandle<P>;
  /** Registers a template with this workspace and the view registry; returns the function that removes it. */
  registerTemplate(t: PanelTemplate): () => void;
  /** Drops the workspace's listeners and intents; a later `addPanel` throws `disposed`. */
  dispose(): void;
}

/** What the provider hook hands the workspace after every commit. */
export interface EngineCommit {
  /** The committed panel list, root and marker included. */
  entries: readonly PanelWindow[];
  /** Engine ids of the parked panels that are held. */
  held: { has(engineId: string): boolean };
  /** Whether the restore has settled. */
  settled: boolean;
  /** Creates a panel in the engine; the workspace has already checked its limits. */
  create(req: CreateRequest): void;
  /** Rebuilds the placeholder entries of a template registered after the restore, and creates the declared panels it was missing. */
  lateRegister(t: PanelTemplate): void;
}

/** One panel `addPanel` asks the engine to create after the workspace is ready. */
export interface CreateRequest {
  /** The panel's id (its key). */
  id: PanelId;
  templateId: string;
  /** The engine id to draw it under, already drawn when the id is anonymous. */
  engineId: string;
  settings?: PanelSettings;
  params?: JsonValue;
  url?: string;
}

/** What the provider hook reads from a workspace and writes back to it. */
export interface EngineBinding {
  readonly rootId: string;
  readonly storage: WorkspaceStorage | undefined;
  readonly defaults: Omit<PanelSettings, 'tuning'> | undefined;
  readonly tuningInput: WorkspaceTuning | undefined;
  readonly tuning: ResolvedWorkspaceTuning;
  readonly order: (() => readonly PanelId[]) | undefined;
  readonly newId: () => string;
  /** Reports an error the hook swallowed: `onError`, else `console.error`. */
  reportError(e: unknown): void;
  /** The workspace's own templates. */
  templates(): readonly PanelTemplate[];
  /** The intents recorded so far, as declarations. */
  declared(): readonly DeclaredPanel[];
  /** The entries the first paint starts with: the root or the marker. */
  initialEntries(): PanelWindow[];
  /** A hook takes the workspace; throws `already-attached` when another holds it. */
  attach(owner: object): void;
  /** The hook that held the workspace unmounted; the panels stay answerable. */
  detach(owner: object): void;
  /** Tells the workspace the list this render draws, so a view mounting in it can read its own panel before the commit publishes. Idempotent; changes no snapshot. */
  observe(entries: readonly PanelWindow[], held: { has(engineId: string): boolean }): void;
  /** Records a commit and publishes a new snapshot when it changed something. */
  publish(commit: EngineCommit): void;
  /** Subscribes to tuning changes (none exist yet) for `useSyncExternalStore`. */
  subscribe(l: () => void): () => void;
}

/** A panel `addPanel` knows by id: its template, its asks and whether the engine refused it. */
interface Rec {
  id: PanelId;
  templateId: string;
  settings: PanelSettings | undefined;
  params: JsonValue | undefined;
  url: string | undefined;
  /** True for a declarative intent, replayed at every settle. */
  intent: boolean;
  /** True when `addPanel` refused it for lack of room. */
  closed: boolean;
}

const CORES = new WeakMap<WorkspaceHandle, Core>();

interface Core {
  binding: EngineBinding;
  view: PanelViewContext;
  reader: PanelReader;
  handle: WorkspaceHandle;
}

const sameState = (a: PanelState, b: PanelState): boolean =>
  a.id === b.id &&
  a.templateId === b.templateId &&
  a.status === b.status &&
  a.held === b.held &&
  a.engineId === b.engineId &&
  a.index === b.index &&
  a.title === b.title &&
  a.url === b.url &&
  a.formFactor === b.formFactor &&
  a.listed === b.listed &&
  a.pinned === b.pinned &&
  JSON.stringify(a.params) === JSON.stringify(b.params) &&
  JSON.stringify(a.deferredPin) === JSON.stringify(b.deferredPin) &&
  sameSettingsValue(a.settings, b.settings);

/**
 * A workspace over `o`. Nothing renders until `useProvidePanels({ workspace })` attaches it; panels added before that
 * are recorded and created when the restore settles.
 * @public
 */
export function createWorkspace(o: WorkspaceOptions = {}): WorkspaceHandle {
  const conflicts = o.conflicts ?? 'warn';
  const defaults = o.defaults;
  const tuning = resolveWorkspaceTuning(o.tuning);
  const root = o.root === undefined ? undefined : definePanel(o.root);
  const rootId = root?.id ?? ROOT_MARKER_ID;
  const newId = o.newId ?? nextEngineId;
  const templates = new Map<string, PanelTemplate>();
  const removers: Array<() => void> = [];
  const records = new Map<PanelId, Rec>();
  const inflight = new Set<PanelId>();
  const warned = new Set<string>();
  const listeners = new Set<() => void>();
  const panelListeners = new Map<PanelId, Set<() => void>>();
  const handles = new Map<PanelId, PanelHandle>();
  const resolutions = new WeakMap<object, { template: PanelTemplate | undefined; settings: PanelSettings | undefined; res: PanelSettingsResolution }>();

  let status: WorkspaceStatus = 'detached';
  let owner: object | undefined;
  let committed: { entries: readonly PanelWindow[]; held: { has(engineId: string): boolean } } | undefined;
  let commit: EngineCommit | undefined;
  let observed: { entries: readonly PanelWindow[]; held: { has(engineId: string): boolean } } | undefined;
  let version = 0;
  let snapshot: PanelSnapshot = { version: 0, status, panels: [] };
  let states = new Map<PanelId, PanelState>();

  const templateOf = (id: string): PanelTemplate | undefined => templates.get(id) ?? (root?.id === id ? root : getTemplate(id));

  const reportError = (e: unknown): void => {
    if (o.onError === undefined) console.error(e);
    else {
      try {
        o.onError(e);
      } catch {
        // A reporter that throws must not break the work that raised the error.
      }
    }
  };

  const reportConflicts = (id: PanelId, res: PanelSettingsResolution): void => {
    if (conflicts === 'off') return;
    for (const c of res.conflicts) {
      if (conflicts === 'throw') throw new PanelManagerError('invalid-settings', `panel '${id}': ${c.message}`, { layer: c.layer, key: c.key });
      const key = `${id}\u0000${c.key}`;
      if (warned.has(key)) continue;
      warned.add(key);
      console.warn(`panel '${id}': ${c.message}`);
    }
  };

  const resolutionFor = (key: object, id: PanelId, templateId: string, settings: PanelSettings | undefined, user: PanelWindow['overrides'], isRoot: boolean): PanelSettingsResolution => {
    const template = templateOf(templateId);
    const cached = resolutions.get(key);
    if (cached !== undefined && cached.template === template && cached.settings === settings) return cached.res;
    const res = resolvePanelSettings(
      { ...(defaults !== undefined ? { workspace: defaults } : {}), ...(template?.settings !== undefined ? { template: template.settings } : {}), ...(settings !== undefined ? { instance: settings } : {}), ...(user !== undefined ? { user } : {}) },
      { lenient: true, root: isRoot },
    );
    resolutions.set(key, { template, settings, res });
    return res;
  };

  const entryResolution = (e: PanelWindow): PanelSettingsResolution => {
    const id = panelKey(e);
    const rec = records.get(id);
    const settings = e.declared === true ? rec?.settings : e.instance;
    const res = resolutionFor(e, id, e.view, settings, e.overrides, e.id === rootId);
    return e.settings === undefined ? { ...res, value: effective(e) } : res;
  };

  const stateOfEntry = (e: PanelWindow, entries: readonly PanelWindow[], held: { has(engineId: string): boolean }, index: number): PanelState => {
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
      formFactor: e.formFactor ?? 'phone',
      listed: e.listed,
      settings: res.value,
      pinned: isPinned(e, entries, res.value.pinning, rootId),
      deferredPin: null,
    };
  };

  const stateOfRecord = (r: Rec): PanelState => {
    const template = templateOf(r.templateId);
    const res = resolutionFor(r, r.id, r.templateId, r.settings, undefined, false);
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
      formFactor: res.value.formFactor,
      listed: res.value.listed,
      settings: res.value,
      pinned: false,
      deferredPin: null,
    };
  };

  /** Rebuilds the snapshot from the last commit and the records; a no-op, and no new version, when nothing changed. */
  const refresh = (): void => {
    const entries = committed?.entries ?? [];
    const held = committed?.held ?? new Set<string>();
    const next: PanelState[] = [];
    const seen = new Set<PanelId>();
    let index = 0;
    for (const e of entries) {
      if (e.marker === true) continue;
      const state = stateOfEntry(e, entries, held, index);
      index += 1;
      seen.add(state.id);
      next.push(state);
    }
    for (const r of records.values()) if (!seen.has(r.id)) next.push(stateOfRecord(r));
    const reused = next.map((s) => {
      const before = states.get(s.id);
      return before !== undefined && sameState(before, s) ? before : s;
    });
    const unchanged = status === snapshot.status && reused.length === snapshot.panels.length && reused.every((s, i) => s === snapshot.panels[i]);
    if (unchanged) return;
    const previous = states;
    states = new Map(reused.map((s) => [s.id, s]));
    version += 1;
    snapshot = { version, status, panels: reused };
    for (const s of reused) if (previous.get(s.id) !== s) for (const l of [...(panelListeners.get(s.id) ?? [])]) l();
    for (const l of [...listeners]) l();
  };

  /** The entry named `id` in the list this render draws, with its place in it. */
  const drawn = (id: PanelId): { entry: PanelWindow; index: number } | undefined => {
    if (observed === undefined) return undefined;
    const entry = observed.entries.find((p) => panelKey(p) === id);
    return entry === undefined ? undefined : { entry, index: observed.entries.filter((p) => p.marker !== true).indexOf(entry) };
  };

  const stateById = (id: PanelId): PanelState => {
    const known = states.get(id);
    if (known !== undefined) return known;
    const entry = drawn(id);
    if (entry !== undefined) return stateOfEntry(entry.entry, observed!.entries, observed!.held, entry.index);
    const r = records.get(id);
    if (r !== undefined) return stateOfRecord(r);
    throw new PanelManagerError('invalid-options', `no panel '${id}' in this workspace`);
  };

  const source: ReadSource = {
    stateOf: stateById,
    settingsOf: (id) => {
      const e = committed?.entries.find((p) => panelKey(p) === id) ?? drawn(id)?.entry;
      if (e !== undefined) return entryResolution(e);
      const r = records.get(id);
      if (r === undefined) throw new PanelManagerError('invalid-options', `no panel '${id}' in this workspace`);
      return resolutionFor(r, r.id, r.templateId, r.settings, undefined, false);
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
      const known = states.get(id) ?? (drawn(id) !== undefined ? stateById(id) : undefined) ?? (records.has(id) ? stateOfRecord(records.get(id)!) : undefined);
      if (known === undefined) return undefined;
      let handle = handles.get(id);
      if (handle === undefined) {
        handle = makeHandle(source, id, known.templateId);
        handles.set(id, handle);
      }
      return handle;
    },
  };
  const panels = makePanelManager(source);
  const reader = makeReader(source);

  const registerOne = (t: PanelTemplate): (() => void) => {
    definePanel(t);
    const existing = templates.get(t.id);
    if (existing !== undefined && existing !== t) throw new PanelManagerError('duplicate-template', `template '${t.id}' is already registered in this workspace`);
    if (existing === t) return () => {};
    const unregisterGlobal = registerGlobalTemplate(t);
    templates.set(t.id, t);
    const remove = (): void => {
      if (templates.get(t.id) === t) templates.delete(t.id);
      unregisterGlobal();
    };
    removers.push(remove);
    return remove;
  };

  const rootEntry = (): PanelWindow => {
    if (root === undefined) return { id: ROOT_MARKER_ID, url: '', title: '', live: true, locked: true, view: ROOT_MARKER_ID, collapsible: false, listed: false, marker: true };
    const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: root.settings }, { root: true });
    return applyTemplate({ ...createHistoryPanel(root.id), title: res.value.title ?? '', view: root.id, ...(root.params !== undefined ? { params: root.params } : {}), key: root.id }, res.value, 'create');
  };

  const instancesOf = (templateId: string): number => {
    const keys = new Set<PanelId>();
    for (const e of committed?.entries ?? []) if (e.view === templateId && e.marker !== true && e.id !== rootId) keys.add(panelKey(e));
    for (const r of records.values()) if (r.templateId === templateId && !r.closed && (r.intent || inflight.has(r.id))) keys.add(r.id);
    return keys.size;
  };

  const validateExplicitId = (id: unknown, t: PanelTemplate): void => {
    if (typeof id !== 'string') throw new PanelManagerError('invalid-options', 'id must be a string');
    let problem: string | undefined;
    try {
      definePanel({ id, view: t.view });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    if (problem === undefined && templateOf(id) !== undefined) problem = `'${id}' is the id of a registered template`;
    if (problem !== undefined) throw new PanelManagerError('invalid-options', `panel id ${JSON.stringify(id)}: ${problem}`);
  };

  const addPanel = <P extends JsonValue>(given: PanelTemplate<P> | string, options?: { id?: PanelId; settings?: PanelSettings; params?: P; url?: string }): PanelHandle<P> => {
    if (status === 'disposed') throw new PanelManagerError('disposed', 'the workspace was disposed');
    let t: PanelTemplate;
    if (typeof given === 'string') {
      const found = templateOf(given);
      if (found === undefined) throw new PanelManagerError('unknown-template', `no template '${given}' is registered`);
      t = found;
    } else {
      t = given as unknown as PanelTemplate;
      definePanel(t);
      const known = templateOf(t.id);
      if (known === undefined) registerOne(t);
      else if (known !== t) throw new PanelManagerError('duplicate-template', `a different template '${t.id}' is already registered`);
    }
    if (options?.id !== undefined) validateExplicitId(options.id, t);
    // Validated here, not at settle, so a bad settings layer throws at the call that wrote it.
    const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: t.settings, ...(options?.settings !== undefined ? { instance: options.settings } : {}) });
    const multiple = res.value.multiple;
    const ready = status === 'ready' && commit !== undefined;
    if (options?.id === undefined && multiple && !ready) throw new PanelManagerError('instance-id-required', `template '${t.id}' is multiple: before the workspace is ready each panel needs an explicit id`);
    const suffix = options?.id === undefined && multiple ? newId() : undefined;
    const id = options?.id ?? (suffix !== undefined ? `${t.id}~${suffix}` : t.id);
    const existing = records.get(id);
    const present = committed?.entries.find((e) => panelKey(e) === id);
    const owned = existing?.templateId ?? present?.view;
    if (owned !== undefined && owned !== t.id) throw new PanelManagerError('invalid-options', `panel id '${id}' already belongs to template '${owned}'`);
    if (existing !== undefined) return source.handleOf(id) as PanelHandle<P>;
    if (present !== undefined) {
      records.set(id, { id, templateId: t.id, settings: options?.settings, params: options?.params, url: options?.url, intent: false, closed: false });
      return source.handleOf(id) as PanelHandle<P>;
    }
    reportConflicts(id, res);
    const count = instancesOf(t.id);
    const over = (!multiple && count > 0) || (res.value.maxInstances !== 'unlimited' && count >= res.value.maxInstances);
    const rec: Rec = { id, templateId: t.id, settings: options?.settings, params: options?.params, url: options?.url, intent: !ready && !over, closed: over };
    records.set(id, rec);
    if (ready && !over) {
      inflight.add(id);
      commit!.create({ id, templateId: t.id, engineId: suffix ?? newId(), ...(options?.settings !== undefined ? { settings: options.settings } : {}), ...(options?.params !== undefined ? { params: options.params } : {}), ...(options?.url !== undefined ? { url: options.url } : {}) });
    }
    if (!ready || over) refresh();
    return source.handleOf(id) as PanelHandle<P>;
  };

  for (const t of o.templates ?? []) registerOne(t);
  if (root !== undefined && !templates.has(root.id)) removers.push(registerGlobalTemplate(root));

  const binding: EngineBinding = {
    rootId,
    storage: o.storage,
    defaults,
    tuningInput: o.tuning,
    tuning,
    order: o.order,
    newId,
    reportError,
    templates: () => [...templates.values()],
    declared: () => [...records.values()].filter((r) => r.intent && !r.closed).map((r) => ({ id: r.id, templateId: r.templateId, ...(r.settings !== undefined ? { settings: r.settings } : {}), ...(r.params !== undefined ? { params: r.params } : {}), ...(r.url !== undefined ? { url: r.url } : {}) })),
    initialEntries: () => [rootEntry()],
    attach: (who) => {
      if (status === 'disposed') throw new PanelManagerError('disposed', 'the workspace was disposed');
      if (owner !== undefined && owner !== who) throw new PanelManagerError('already-attached', 'this workspace is already attached to another useProvidePanels; one workspace feeds one row');
      owner = who;
      committed = undefined;
      commit = undefined;
      observed = undefined;
      inflight.clear();
      status = 'loading';
    },
    detach: (who) => {
      if (owner !== who) return;
      owner = undefined;
      commit = undefined;
      inflight.clear();
      if (status !== 'disposed') status = 'detached';
      refresh();
    },
    observe: (entries, held) => {
      if (status !== 'disposed') observed = { entries, held };
    },
    publish: (c) => {
      if (status === 'disposed' || owner === undefined) return;
      committed = { entries: c.entries, held: c.held };
      commit = c;
      inflight.clear();
      status = c.settled ? 'ready' : 'loading';
      refresh();
    },
    subscribe: () => () => {},
  };

  const handle: WorkspaceHandle = {
    rootId,
    panels,
    tuning,
    get status() {
      return status;
    },
    addPanel,
    registerTemplate: (t) => {
      if (status === 'disposed') throw new PanelManagerError('disposed', 'the workspace was disposed');
      const remove = registerOne(t);
      if (conflicts === 'throw') {
        const res = resolvePanelSettings({ ...(defaults !== undefined ? { workspace: defaults } : {}), template: t.settings });
        const c = res.conflicts[0];
        if (c !== undefined) {
          remove();
          throw new PanelManagerError('invalid-settings', `template '${t.id}': ${c.message}`, { layer: c.layer, key: c.key });
        }
      }
      if (status === 'ready') commit?.lateRegister(t);
      return remove;
    },
    dispose: () => {
      if (status === 'disposed') return;
      status = 'disposed';
      owner = undefined;
      commit = undefined;
      for (const r of records.values()) r.intent = false;
      refresh();
      listeners.clear();
      panelListeners.clear();
      for (const remove of removers.splice(0)) remove();
    },
  };

  const view: PanelViewContext = {
    handleFor: (engineId) => {
      const e = (observed ?? committed)?.entries.find((p) => p.id === engineId);
      return e === undefined || e.marker === true ? undefined : source.handleOf(panelKey(e));
    },
    manager: reader,
  };
  CORES.set(handle, { binding, view, reader, handle });
  return handle;
}

const coreOf = (ws: WorkspaceHandle): Core => {
  const core = CORES.get(ws);
  if (core === undefined) throw new PanelManagerError('invalid-options', 'expected a workspace made by createWorkspace');
  return core;
};

/** What a provider hook reads from and writes to `ws`. Throws `invalid-options` for anything `createWorkspace` did not make. */
export const bindingOf = (ws: WorkspaceHandle): EngineBinding => coreOf(ws).binding;

/** What a row tells its template views about `ws`. */
export const viewContextOf = (ws: WorkspaceHandle): PanelViewContext => coreOf(ws).view;
