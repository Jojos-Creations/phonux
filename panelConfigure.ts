/**
 * The pure half of `configure`, `configureTemplate` and `configureTuning`: which door a key belongs to, the plan a patch
 * makes against the layers a panel resolves under, and the entry that plan writes. Nothing here reads React state or
 * dispatches; the engine takes the plan and applies it in one update.
 */
import type { ConfigureResult } from './panelManager.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelRefusal } from './panelManagerError.js';
import { reparked, withoutDeferral, type PinChange } from './panelPin.js';
import { PANEL_SETTINGS_CATALOG, checkTuningLeaf, resolvePanelSettings, sameSettingsValue, viewMayAsk } from './panelSettings.js';
import type { PanelSettings, PanelSettingsResolution, PanelUserLayer, ResolvedPanelSettings, SettingConflict, SettingDescriptor, SettingNote, WorkspaceTuning } from './panelSettings.js';
import { mergePatch, mergeTuningPatch, type SettingsPatch } from './settingsPatch.js';
import type { PanelWindow } from './panelWindow.js';

/** Which call a patch arrives through: a panel's own `configure`, a view's, `configureTemplate` or `configureTuning`. */
export type ConfigureCall = 'panel' | 'view' | 'template' | 'tuning';

/** A refusal before any state is read or changed. */
export interface PatchRefusal {
  code: Extract<PanelRefusal, 'wrong-scope' | 'not-view-settable'>;
  message: string;
  setting: string;
}

const DESCRIPTORS: ReadonlyMap<string, SettingDescriptor> = new Map(PANEL_SETTINGS_CATALOG.map((d) => [d.name, d]));
const FLAT_KEYS: ReadonlySet<string> = new Set(PANEL_SETTINGS_CATALOG.filter((d) => !d.name.startsWith('tuning.')).map((d) => d.name));
const TUNING_LEAVES: ReadonlySet<string> = new Set(PANEL_SETTINGS_CATALOG.filter((d) => d.name.startsWith('tuning.')).map((d) => d.name.slice('tuning.'.length)));

/** The layer name an error for `call` carries. */
const layerOf = (call: ConfigureCall): string => (call === 'tuning' ? 'tuning' : call === 'template' ? 'template' : 'instance');

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the settings in `d`'s door say about `call`: the refusal it earns, or undefined when `call` accepts it. */
function refusalFor(call: ConfigureCall, name: string, value: unknown): PatchRefusal | undefined {
  const d = DESCRIPTORS.get(name)!;
  if (call === 'view') {
    const key = name;
    const ok = d.viewSettable && (value === null || viewMayAsk(key, value));
    return ok ? undefined : { code: 'not-view-settable', setting: name, message: `'${name}' is not a setting a view may change on its own panel` };
  }
  const door = call === 'panel' ? 'instance' : call;
  if (d.configure.doors.includes(door)) return undefined;
  const where = d.configure.doors.map((x) => (x === 'instance' ? 'configure(id, ...)' : x === 'template' ? 'configureTemplate(...)' : 'configureTuning(...)')).join(' or ');
  return { code: 'wrong-scope', setting: name, message: `'${name}' cannot be set through this call; use ${where}` };
}

/**
 * Whether `leaf` is the removed tuning key. Its value is checked and a removed one is reported by `checkTuningLeaf`; nothing is
 * asked of the catalog because the setting no longer has a row there.
 */
function isRemovedTuningLeaf(leaf: string, value: unknown, layer: string): boolean {
  if (leaf !== 'shrinkOutOfView') return false;
  const problem = checkTuningLeaf(leaf, value).problems[0];
  if (problem !== undefined) throw new PanelManagerError('invalid-settings', `${layer}.${problem.key}: ${problem.problem}`, { layer, key: problem.key });
  return true;
}

/**
 * The catalog names a patch touches, or the first refusal it earns. A key the catalog does not know throws
 * `invalid-settings` whatever else the patch holds: that is a programmer error, not a state.
 */
export function checkPatch(call: ConfigureCall, patch: unknown): { names: string[] } | { refusal: PatchRefusal } {
  const layer = layerOf(call);
  if (!isPlain(patch)) throw new PanelManagerError('invalid-settings', `configure: the patch must be an object`, { layer });
  const asks: { name: string; value: unknown }[] = [];
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    if (call === 'tuning') {
      if (isRemovedTuningLeaf(key, value, layer)) continue;
      if (TUNING_LEAVES.has(key)) asks.push({ name: `tuning.${key}`, value });
      else if (FLAT_KEYS.has(key)) asks.push({ name: key, value });
      else if (key === 'tuning') asks.push({ name: 'tuning', value });
      else throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown tuning key`, { layer, key });
      continue;
    }
    if (key === 'tuning') {
      if (!isPlain(value)) {
        asks.push({ name: 'tuning', value });
        continue;
      }
      for (const leaf of Object.keys(value)) {
        if (value[leaf] === undefined) continue;
        if (isRemovedTuningLeaf(leaf, value[leaf], layer)) continue;
        if (!TUNING_LEAVES.has(leaf)) throw new PanelManagerError('invalid-settings', `${layer}.tuning.${leaf}: unknown tuning key`, { layer, key: `tuning.${leaf}` });
        asks.push({ name: `tuning.${leaf}`, value: value[leaf] });
      }
      continue;
    }
    if (key === 'draggable' || key === 'placeable') throw new PanelManagerError('invalid-settings', `${layer}.${key}: a setting this version no longer has; set 'movable' instead`, { layer, key });
    if (!FLAT_KEYS.has(key)) throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown setting`, { layer, key });
    asks.push({ name: key, value });
  }
  for (const ask of asks) {
    if (ask.name === 'tuning') return { refusal: { code: 'wrong-scope', setting: 'tuning', message: call === 'tuning' ? `'tuning' cannot be set through configureTuning; give it the tuning keys themselves` : `'tuning' belongs to the workspace; use configureTuning(...)` } };
    const refusal = refusalFor(call, ask.name, ask.value);
    if (refusal !== undefined) return { refusal };
  }
  return { names: asks.map((a) => a.name) };
}

/** The settings whose configure class acts at this commit; `parkable` and `maxSlots` are STATE keys that change what the panel is or may be at once. */
const NOW_STATE: ReadonlySet<string> = new Set(['parkable', 'maxSlots']);
/** What a parked or held panel shows or answers at once: its permissions, its listing and its title. The rest waits for it to be drawn. */
const WHILE_PARKED: ReadonlySet<string> = new Set(['closable', 'movable', 'crossable', 'resizable', 'listed', 'title', 'pinning', 'parkable', 'maxSlots']);

/** Whether `name` acts at this commit on a panel in `status`. */
export function actsNow(name: string, status: 'live' | 'parked' | 'hidden' | 'closed'): boolean {
  if (status === 'closed') return false;
  const cls = DESCRIPTORS.get(name)!.configure.cls;
  const now = cls === 'NOW' || NOW_STATE.has(name);
  return status === 'live' ? now : now && WHILE_PARKED.has(name);
}

/** What a plan against one panel's layers decided. */
export type InstancePlan =
  | { ok: false; code: PanelRefusal; message: string; setting?: string }
  | { ok: true; changed: false }
  | {
      ok: true;
      changed: true;
      /** The instance layer after the patch. */
      layer: PanelSettings;
      /** The settings the panel resolves to under that layer. */
      resolution: PanelSettingsResolution;
      now: string[];
      later: string[];
      shadowed: string[];
      notes: SettingNote[];
      /** True when the patch asked for `parkable`: a deferred pin is canceled. */
      cancelsPin: boolean;
      /** The Host-bag split after the patch; undefined for a panel no view created. */
      split: HostSplit | undefined;
    };

/** What `planInstance` reads. */
export interface InstanceInput {
  call: 'panel' | 'view';
  patch: SettingsPatch;
  names: readonly string[];
  /** The instance layer now. */
  base: PanelSettings | undefined;
  workspace: PanelSettings | undefined;
  template: PanelSettings | undefined;
  /** What a view asked for at the Host-bag create of this panel, when it did. */
  split: HostSplit | undefined;
  /** The person's overrides; absent for a closed record. */
  person: PanelUserLayer | undefined;
  /** The settings the entry carries, to tell a `parkable` a pin from code flipped from the layers' own. */
  current: ResolvedPanelSettings | undefined;
  root: boolean;
  /** The slot count the entry is at; absent for a closed record. */
  slots?: number | undefined;
  status: 'live' | 'parked' | 'hidden' | 'closed';
}

const EMPTY: PanelSettings = Object.freeze({});

/**
 * What a view asked for at a Host-bag create, and which of those keys a configure has set since. The file keeps the asks
 * merged into the instance layer; the resolver reads them as the host layer, under the instance layer, until a configure
 * sets the key, so a `null` shows the ask again.
 */
export interface HostSplit {
  readonly host: PanelSettings;
  readonly touched: ReadonlySet<string>;
}

/** `merged` as the resolver's instance layer: without the keys only the view's ask holds, which the host layer carries. */
export function ownLayer(merged: PanelSettings | undefined, split: HostSplit | undefined): PanelSettings | undefined {
  if (merged === undefined || split === undefined) return merged;
  const hostOnly = Object.keys(merged).filter((k) => k in split.host && !split.touched.has(k));
  if (hostOnly.length === 0) return merged;
  const own: Record<string, unknown> = { ...merged };
  for (const k of hostOnly) delete own[k];
  return own as PanelSettings;
}

const sameConflict = (a: SettingConflict, b: SettingConflict): boolean => a.key === b.key && a.kind === b.kind && a.rule === b.rule && a.forcedBy === b.forcedBy && a.layer === b.layer;
const sameNote = (a: SettingNote, b: SettingNote): boolean => a.code === b.code && a.key === b.key && a.message === b.message;

/** Whether the layer holds a different value for `name` than `before` does. */
function differs(before: PanelSettings, after: PanelSettings, name: string): boolean {
  return !sameSettingsValue((before as Record<string, unknown>)[name], (after as Record<string, unknown>)[name]);
}

/**
 * The plan for patching panel layers: the new instance layer, the whole stack resolved again (a bad value throws
 * `invalid-settings`), the refusals a state or a new conflict earns, and the names split into what acts now and what
 * waits. A patch that changes nothing is `changed: false`.
 */
export function planInstance(i: InstanceInput): InstancePlan {
  const base = i.base ?? EMPTY;
  const asked = i.patch as Record<string, unknown>;
  let layer = mergePatch(base, i.patch);
  if (layer === base) return { ok: true, changed: false };
  let split = i.split;
  if (split !== undefined) {
    // A `null` on a key the view asked for puts its ask back into the merged layer the file keeps; any other value makes the key the instance layer's own.
    const touched = new Set(split.touched);
    const restored: Record<string, unknown> = { ...layer };
    for (const key of Object.keys(split.host)) {
      if (asked[key] === undefined) continue;
      if (asked[key] === null) {
        touched.delete(key);
        restored[key] = (split.host as Record<string, unknown>)[key];
      } else {
        touched.add(key);
      }
    }
    if (sameSettingsValue(restored, base)) return { ok: true, changed: false };
    layer = restored as PanelSettings;
    split = { host: split.host, touched };
  }
  const asksParkable = asked.parkable !== undefined;
  const layers = (instance: PanelSettings, user: PanelUserLayer | undefined, of: HostSplit | undefined) => ({
    ...(i.workspace !== undefined ? { workspace: i.workspace } : {}),
    ...(i.template !== undefined ? { template: i.template } : {}),
    ...(of !== undefined ? { host: of.host } : {}),
    instance: ownLayer(instance, of) ?? instance,
    ...(user !== undefined ? { user } : {}),
  });
  const resolve = (instance: PanelSettings, user: PanelUserLayer | undefined, of: HostSplit | undefined): PanelSettingsResolution => resolvePanelSettings(layers(instance, user, of), { root: i.root });
  const plain = resolve(base, i.person, i.split);
  // A pin from code flips `parkable` for the session without recording it; the flip outvotes the layers until a patch asks for `parkable` itself.
  const session = i.current !== undefined && i.current.parkable !== plain.value.parkable ? i.current.parkable : undefined;
  const userBefore = session === undefined ? i.person : { ...i.person, parkable: session };
  const before = session === undefined ? plain : resolve(base, userBefore, i.split);
  const after = resolve(layer, asksParkable ? i.person : userBefore, split);

  const fresh = after.conflicts.find((c) => !before.conflicts.some((b) => sameConflict(b, c)));
  if (fresh !== undefined) return { ok: false, code: 'settings-conflict', message: fresh.message, setting: fresh.key };
  if (i.slots !== undefined && i.slots <= before.value.maxSlots && i.slots > after.value.maxSlots) {
    return { ok: false, code: 'slots-above-max', message: `the panel is ${i.slots} slots wide, which these settings no longer allow` };
  }

  const changed = i.names.filter((n) => differs(base, layer, n));
  const now = changed.filter((n) => actsNow(n, i.status));
  const later = changed.filter((n) => !now.includes(n));
  const shadowed = changed.filter((n) => asked[n] !== null && after.source[n] !== 'instance');
  const notes = after.notes.filter((n) => !before.notes.some((b) => sameNote(b, n)));
  return { ok: true, changed: true, layer, resolution: after, now, later, shadowed, notes, cancelsPin: asksParkable, split };
}

/** The success a plan answers with. */
export function configured(plan: Extract<InstancePlan, { changed: true }>): Extract<ConfigureResult, { ok: true }> {
  return { ok: true, changed: true, shown: false, now: plan.now, later: plan.later, shadowed: plan.shadowed, notes: plan.notes };
}

/** The success of a call that changed nothing. */
export const unchanged = (): Extract<ConfigureResult, { ok: true }> => ({ ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] });

/** The refusal a plan carries, as the result for panel `name`. */
export const refusedPlan = (name: string, plan: Extract<InstancePlan, { ok: false }>): Extract<ConfigureResult, { ok: false }> => ({
  ok: false,
  code: plan.code,
  message: `panel '${name}': ${plan.message}`,
  ...(plan.setting === undefined ? {} : { setting: plan.setting }),
});

/** The success of a call whose only effect was to cancel a flip of `parkable` waiting on the panel. */
export const cancelled = (): Extract<ConfigureResult, { ok: true }> => ({ ok: true, changed: true, shown: false, now: [], later: [], shadowed: [], notes: [] });

/** The success of a flip that showed the panel: `plan` answers as it would for a live one, with `shown` true. */
export const shownResult = (plan: Extract<InstancePlan, { changed: true }>): Extract<ConfigureResult, { ok: true }> => ({ ...configured(plan), shown: true });

/** The refusal of a flip of `parkable` that the panel's `pinningWhenNotLive` turns away. */
export const refusedFlip = (name: string, code: PanelRefusal): Extract<ConfigureResult, { ok: false }> => ({ ok: false, code, message: `panel '${name}': its pinningWhenNotLive does not let configure change parkable while it is not live` });

/**
 * The flip of `parkable` that `plan` asks of a panel reading `reads` now, or undefined when the patch does not name
 * `parkable` or leaves the panel reading what it did: already as asked, or outvoted by the person's override.
 */
export function askedFlip(patch: SettingsPatch, plan: Extract<InstancePlan, { changed: true }>, reads: boolean): PinChange | undefined {
  const asks = plan.resolution.value.parkable;
  return patch.parkable === undefined || asks === reads ? undefined : { parkable: asks };
}

/** `patch` and `names` without `parkable`: what a flip that waits or shows leaves for the ordinary write. */
export function withoutFlip(patch: SettingsPatch, names: readonly string[]): { patch: SettingsPatch; names: string[] } {
  const { parkable: _flip, ...rest } = patch;
  return { patch: rest, names: names.filter((n) => n !== 'parkable') };
}

/** Whether `stored` is the very change `flip` asks for. */
export const sameDeferral = (stored: PinChange | undefined, flip: PinChange): boolean => JSON.stringify(stored) === JSON.stringify(flip);

/** What a flip that waits answers: the rest of the patch as `rest` plans it, and `parkable` among `later` when the flip is new. */
export function deferredResult(rest: Extract<InstancePlan, { ok: true }>, fresh: boolean): Extract<ConfigureResult, { ok: true }> {
  if (!rest.changed) return fresh ? { ...unchanged(), changed: true, later: ['parkable'] } : unchanged();
  return { ok: true, changed: true, shown: false, now: rest.now, later: fresh ? [...rest.later, 'parkable'] : rest.later, shadowed: rest.shadowed, notes: rest.notes };
}

/**
 * `entry` carrying what `plan` resolved: the fields that mirror the settings follow, the instance layer is kept for an
 * entry code does not re-declare, a title the patch removed goes, and a panel that became a fixed column is live. The
 * slots, size, anchor, `hostData`, `key`, `overrides` and `applied` are the ones `entry` already had.
 */
export function reconfigured(entry: PanelWindow, plan: Extract<InstancePlan, { changed: true }>, patch: SettingsPatch): PanelWindow {
  let next = reparked(entry, plan.resolution);
  if (entry.declared !== true) next = { ...next, instance: plan.layer };
  if (patch.title !== undefined && plan.resolution.value.title === undefined) {
    const { title: _gone, ...rest } = next;
    next = rest;
  }
  return plan.cancelsPin ? withoutDeferral(next) : next;
}

/** `entry` with the rest of the patch written and `flip` waiting on it, or `entry` itself when that changes nothing. */
export function deferredEntry(entry: PanelWindow, rest: Extract<InstancePlan, { ok: true }>, patch: SettingsPatch, flip: PinChange): PanelWindow {
  const settled = rest.changed ? reconfigured(entry, rest, patch) : entry;
  return sameDeferral(entry.deferredPin, flip) ? settled : { ...settled, deferredPin: flip };
}

/** `entry` as it is handed to the show path of a flip: the rest of the patch written, the whole patch's instance layer, and nothing left waiting. */
export function shownEntry(entry: PanelWindow, rest: Extract<InstancePlan, { ok: true }>, patch: SettingsPatch, plan: Extract<InstancePlan, { changed: true }>): PanelWindow {
  const settled = rest.changed ? reconfigured(entry, rest, patch) : entry;
  return withoutDeferral(entry.declared === true ? settled : { ...settled, instance: plan.layer });
}

/** `prev` with `target` replaced by `next`, or `prev` itself when the row no longer holds `target`: something changed the entry between the call and the commit. */
export function applyConfigure(prev: PanelWindow[], target: PanelWindow, next: PanelWindow): PanelWindow[] {
  const at = prev.indexOf(target);
  return at < 0 ? prev : prev.map((p, k) => (k === at ? next : p));
}

/** What the engine's `configure` op is handed by the workspace: an answer, and for a change the entry to write and, when the flip shows the panel, the change its show path applies. */
export type ConfigureOutcome = { done: ConfigureResult } | { done: Extract<ConfigureResult, { ok: true }>; next: PanelWindow; show?: PinChange };

/** What `planTuning` decided. */
export type TuningPlan =
  | { changed: false }
  | {
      changed: true;
      /** The workspace tuning input after the patch. */
      input: WorkspaceTuning;
      now: string[];
      later: string[];
      /** True when the patch moves `rowGap`, which re-prices the row. */
      reprices: boolean;
    };

/** The plan for patching the workspace tuning input; a leaf that is out of range throws `invalid-settings`. */
export function planTuning(current: WorkspaceTuning | undefined, patch: Record<string, unknown>): TuningPlan {
  const base = current ?? {};
  const input = mergeTuningPatch(base, patch);
  if (input === base) return { changed: false };
  const names: string[] = [];
  for (const leaf of Object.keys(patch)) {
    if (patch[leaf] === undefined) continue;
    const after = (input as Record<string, unknown>)[leaf];
    if (after !== undefined) {
      const checked = checkTuningLeaf(leaf as keyof WorkspaceTuning, after);
      const problem = checked.problems[0];
      if (problem !== undefined) throw new PanelManagerError('invalid-settings', `tuning.${problem.key.replace(/^tuning\./, '')}: ${problem.problem}`, { layer: 'tuning', key: problem.key });
    }
    if (leaf !== 'shrinkOutOfView' && !sameSettingsValue((current as Record<string, unknown> | undefined)?.[leaf], after)) names.push(`tuning.${leaf}`);
  }
  if (names.length === 0) return { changed: false };
  return { changed: true, input, now: names.filter((n) => actsNow(n, 'live')), later: names.filter((n) => !actsNow(n, 'live')), reprices: names.includes('tuning.rowGap') };
}

/** The layer of the three template-scope keys after a patch, or the same layer when nothing changed. */
export function planTemplate(base: PanelSettings | undefined, patch: SettingsPatch): { layer: PanelSettings; changed: boolean } {
  const from = base ?? EMPTY;
  const layer = mergePatch(from, patch);
  return { layer, changed: layer !== from };
}
