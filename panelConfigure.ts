/**
 * The pure half of `configure`, `configureTemplate` and `configureTuning`: which door a key belongs to, the plan a patch
 * makes against the layers a panel resolves under, and the entry that plan writes. Nothing here reads React state or
 * dispatches; the engine takes the plan and applies it in one update.
 */
import type { FormFactor } from './hostApi.js';
import type { ConfigureResult } from './panelManager.js';
import { PanelManagerError } from './panelManagerError.js';
import type { PanelRefusal } from './panelManagerError.js';
import { reparked, withoutDeferral } from './panelPin.js';
import { PANEL_SETTINGS_CATALOG, checkTuningLeaf, resolveUnderTuning, sameSettingsValue, viewMayAsk } from './panelSettings.js';
import type { PanelSettings, PanelSettingsResolution, PanelUserLayer, ResolvedPanelSettings, SettingConflict, SettingDescriptor, SettingNote, WorkspaceTuning } from './panelSettings.js';
import { mergePatch, type SettingsPatch } from './settingsPatch.js';
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
const PANEL_TUNING_LEAVES: readonly string[] = PANEL_SETTINGS_CATALOG.filter((d) => d.configure.doors.includes('instance') && d.name.startsWith('tuning.')).map((d) => d.name.slice('tuning.'.length));

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
      if (TUNING_LEAVES.has(key)) asks.push({ name: `tuning.${key}`, value });
      else if (FLAT_KEYS.has(key)) asks.push({ name: key, value });
      else if (key === 'tuning') asks.push({ name: 'tuning', value });
      else throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown tuning key`, { layer, key });
      continue;
    }
    if (key === 'tuning') {
      if (value === null) {
        for (const leaf of PANEL_TUNING_LEAVES) asks.push({ name: `tuning.${leaf}`, value: null });
      } else if (!isPlain(value)) {
        throw new PanelManagerError('invalid-settings', `${layer}.tuning: expected an object`, { layer, key: 'tuning' });
      } else {
        for (const leaf of Object.keys(value)) {
          if (value[leaf] === undefined) continue;
          if (!TUNING_LEAVES.has(leaf)) throw new PanelManagerError('invalid-settings', `${layer}.tuning.${leaf}: unknown tuning key`, { layer, key: `tuning.${leaf}` });
          asks.push({ name: `tuning.${leaf}`, value: value[leaf] });
        }
      }
      continue;
    }
    if (!FLAT_KEYS.has(key)) throw new PanelManagerError('invalid-settings', `${layer}.${key}: unknown setting`, { layer, key });
    asks.push({ name: key, value });
  }
  for (const ask of asks) {
    if (ask.name === 'tuning') return { refusal: { code: 'wrong-scope', setting: 'tuning', message: `'tuning' cannot be set through configureTuning; give it the tuning keys themselves` } };
    const refusal = refusalFor(call, ask.name, ask.value);
    if (refusal !== undefined) return { refusal };
  }
  return { names: asks.map((a) => a.name) };
}

/** The settings whose configure class acts at this commit; `parkable` and `formFactors` are STATE keys that change what the panel is or may be at once. */
const NOW_STATE: ReadonlySet<string> = new Set(['parkable', 'formFactors']);
/** What a parked or held panel shows or answers at once: its permissions, its listing and its title. The rest waits for it to be drawn. */
const WHILE_PARKED: ReadonlySet<string> = new Set(['closable', 'draggable', 'crossable', 'placeable', 'resizable', 'listed', 'title', 'pinning', 'parkable', 'formFactors']);

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
      /** True when the patch asked for `parkable`: a deferred pin is cancelled. */
      cancelsPin: boolean;
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
  /** The workspace's tuning input: the layer under the template for the four per-panel leaves. */
  tuning: WorkspaceTuning | undefined;
  /** The person's overrides; absent for a closed record. */
  person: PanelUserLayer | undefined;
  /** The settings the entry carries, to tell a `parkable` a pin from code flipped from the layers' own. */
  current: ResolvedPanelSettings | undefined;
  root: boolean;
  /** The tier the entry is at; absent for a closed record. */
  tier: FormFactor | undefined;
  status: 'live' | 'parked' | 'hidden' | 'closed';
}

const EMPTY: PanelSettings = Object.freeze({});

const sameConflict = (a: SettingConflict, b: SettingConflict): boolean => a.key === b.key && a.kind === b.kind && a.rule === b.rule && a.forcedBy === b.forcedBy && a.layer === b.layer;
const sameNote = (a: SettingNote, b: SettingNote): boolean => a.code === b.code && a.key === b.key && a.message === b.message;

/** Whether the layer holds a different value for `name` than `before` does. */
function differs(before: PanelSettings, after: PanelSettings, name: string): boolean {
  if (name.startsWith('tuning.')) {
    const leaf = name.slice('tuning.'.length) as keyof WorkspaceTuning;
    return !sameSettingsValue(before.tuning?.[leaf as never], after.tuning?.[leaf as never]);
  }
  return !sameSettingsValue((before as Record<string, unknown>)[name], (after as Record<string, unknown>)[name]);
}

/**
 * The plan for patching panel layers: the new instance layer, the whole stack resolved again (a bad value throws
 * `invalid-settings`), the refusals a state or a new conflict earns, and the names split into what acts now and what
 * waits. A patch that changes nothing is `changed: false`.
 */
export function planInstance(i: InstanceInput): InstancePlan {
  const base = i.base ?? EMPTY;
  const layer = mergePatch(base, i.patch);
  if (layer === base) return { ok: true, changed: false };
  const asksParkable = (i.patch as Record<string, unknown>).parkable !== undefined;
  const layers = (instance: PanelSettings, user: PanelUserLayer | undefined) => ({
    ...(i.workspace !== undefined ? { workspace: i.workspace } : {}),
    ...(i.template !== undefined ? { template: i.template } : {}),
    instance,
    ...(user !== undefined ? { user } : {}),
  });
  const resolve = (instance: PanelSettings, user: PanelUserLayer | undefined): PanelSettingsResolution => resolveUnderTuning(layers(instance, user), { root: i.root }, i.tuning);
  const plain = resolve(base, i.person);
  // A pin from code flips `parkable` for the session without recording it; the flip outvotes the layers until a patch asks for `parkable` itself.
  const session = i.current !== undefined && i.current.parkable !== plain.value.parkable ? i.current.parkable : undefined;
  const userBefore = session === undefined ? i.person : { ...i.person, parkable: session };
  const before = session === undefined ? plain : resolve(base, userBefore);
  const after = resolve(layer, asksParkable ? i.person : userBefore);

  const fresh = after.conflicts.find((c) => !before.conflicts.some((b) => sameConflict(b, c)));
  if (fresh !== undefined) return { ok: false, code: 'settings-conflict', message: fresh.message, setting: fresh.key };
  if (i.tier !== undefined && before.value.formFactors.includes(i.tier) && !after.value.formFactors.includes(i.tier)) {
    return { ok: false, code: 'tier-not-allowed', message: `the panel is at the ${i.tier} tier, which these settings no longer allow` };
  }

  const changed = i.names.filter((n) => differs(base, layer, n));
  const now = changed.filter((n) => actsNow(n, i.status));
  const later = changed.filter((n) => !now.includes(n));
  const patchValue = (n: string): unknown => (n.startsWith('tuning.') ? (i.patch as { tuning?: Record<string, unknown> | null }).tuning?.[n.slice('tuning.'.length)] : (i.patch as Record<string, unknown>)[n]);
  const shadowed = changed.filter((n) => patchValue(n) !== null && after.source[n] !== 'instance');
  const notes = after.notes.filter((n) => !before.notes.some((b) => sameNote(b, n)));
  return { ok: true, changed: true, layer, resolution: after, now, later, shadowed, notes, cancelsPin: asksParkable };
}

/** The success a plan answers with. */
export function configured(plan: Extract<InstancePlan, { changed: true }>): Extract<ConfigureResult, { ok: true }> {
  return { ok: true, changed: true, shown: false, now: plan.now, later: plan.later, shadowed: plan.shadowed, notes: plan.notes };
}

/** The success of a call that changed nothing. */
export const unchanged = (): Extract<ConfigureResult, { ok: true }> => ({ ok: true, changed: false, shown: false, now: [], later: [], shadowed: [], notes: [] });

/**
 * `entry` carrying what `plan` resolved: the fields that mirror the settings follow, the instance layer is kept for an
 * entry code does not re-declare, a title the patch removed goes, and a panel that became a fixed column is live. The
 * tier, size, anchor, `hostData`, `key`, `overrides` and `applied` are the ones `entry` already had.
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

/** `prev` with `target` replaced by `next`, or `prev` itself when the row no longer holds `target`: something changed the entry between the call and the commit. */
export function applyConfigure(prev: PanelWindow[], target: PanelWindow, next: PanelWindow): PanelWindow[] {
  const at = prev.indexOf(target);
  return at < 0 ? prev : prev.map((p, k) => (k === at ? next : p));
}

/** What the engine's `configure` op is handed by the workspace: an answer, and for a change the entry to write. */
export type ConfigureOutcome = { done: ConfigureResult } | { done: Extract<ConfigureResult, { ok: true }>; next: PanelWindow };

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
  const base = { tuning: current ?? {} } as PanelSettings;
  const merged = mergePatch(base, { tuning: patch } as SettingsPatch);
  if (merged === base) return { changed: false };
  const input = (merged.tuning ?? {}) as WorkspaceTuning;
  const names: string[] = [];
  for (const leaf of Object.keys(patch)) {
    if (patch[leaf] === undefined) continue;
    const after = (input as Record<string, unknown>)[leaf];
    if (after !== undefined) {
      const checked = checkTuningLeaf(leaf as keyof WorkspaceTuning, after);
      const problem = checked.problems[0];
      if (problem !== undefined) throw new PanelManagerError('invalid-settings', `tuning.${problem.key.replace(/^tuning\./, '')}: ${problem.problem}`, { layer: 'tuning', key: problem.key });
    }
    if (!sameSettingsValue((current as Record<string, unknown> | undefined)?.[leaf], after)) names.push(`tuning.${leaf}`);
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
