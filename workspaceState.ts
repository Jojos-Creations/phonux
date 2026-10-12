/**
 * Workspace state as a saved file: the JSON shape, its guard, and the pure pair that turns the panel list into
 * that shape and back. DESIGN.md ("Workspace state persistence") holds the rules; this file holds no React and
 * no host code.
 */
import type { FormFactor, JsonValue } from './hostApi.js';
import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import type { AddPlacement } from './panelSettings.js';
import { appendPanel, slotsOf, type PanelWindow } from './panelWindow.js';
import { ALL_SLOTS, slotsOfTier, tierOfSlots } from './rowConstants.js';

/**
 * One saved panel. `id` only names this panel inside its own file, so an `anchor` can point at another entry;
 * it is replaced on restore. Never saved: `hostData`, `size`, `locked`, `collapsible`, `anchoredEnter`, the settings
 * themselves and the host's root column. The keys from `key` on are written only for a panel that carries settings;
 * a file without them is a 0.1.0 file and restores unchanged.
 * @public
 */
export type WorkspacePanelState = {
  /** Names this panel within its own file; other entries' `anchor.panel` may point at it. */
  id: string;
  /** Key of the registered view that renders the panel. */
  view: string;
  /** The URL the panel shows; a file without one restores a panel with none. */
  url?: string;
  /** The panel's title, when it had one. */
  title?: string;
  /** Opaque per-panel data, as `CreatePanelOptions.params`. */
  params?: JsonValue;
  /** Whether the panel appears in `PanelsAPI.panelList`, as `CreatePanelOptions.listed`. */
  listed?: boolean;
  /** Whether the panel was mounted in the row (true) or parked (false). */
  live: boolean;
  // Inline, not PanelAnchor: an interface is not assignable to JsonValue.
  /** Where the panel sits: on `position`'s side of the entry with id `panel` (or the host's root column), ordered by `priority`. */
  anchor: { panel: string; position: 'left' | 'right'; priority: number };
  /** The panel's tier: the tier of its slots. */
  formFactor?: FormFactor;
  /** The panel's slot count, written only when its tier does not already say it (3 slots is the desktop tier, which says "every visible slot"). */
  slots?: number;
  /** Whether the panel is a permanent column, as `CreatePanelOptions.permanent`. */
  permanent?: boolean;
  /** The stacking tier of the panel's row slot, as `CreatePanelOptions.layer`. */
  layer?: 'base' | 'raised';
  /** The panel's stable name: a declared panel's id, a template's id for a singleton, or `templateId~suffix`. */
  key?: string;
  /** The instance settings layer the panel was created under; absent for a panel code declares again at every launch. */
  instance?: { [key: string]: JsonValue };
  /** What the person changed: where the panel sits, its tier, whether it is parkable. Present (possibly empty) means the panel owns only the keys it holds. */
  overrides?: {
    /** Where the person put the panel; `panel` names another entry of this file. */
    anchor?: { panel: string; position: 'left' | 'right'; priority: number };
    /** The tier the person chose; a file saved before slots holds this instead of `slots`. */
    formFactor?: FormFactor;
    /** The slot count the person chose. */
    slots?: number;
    /** Whether the person made the panel parkable. */
    parkable?: boolean;
  };
  /** The `placeOnAdd` that placed the panel; the saved place is kept only while the resolved `placeOnAdd` still equals it. */
  applied?: { placeOnAdd: AddPlacement };
  /** Written as `false` for a panel that cannot be closed. */
  closable?: false;
};

/**
 * The saved workspace: a version and one entry per saved panel, in row order. The host's root column is not in it.
 * @public
 */
export type WorkspaceState = {
  /** The file format version; always 1. */
  version: 1;
  /** The saved panels, in row order. */
  panels: WorkspacePanelState[];
  /** Keys of declared panels the person closed and that must not be recreated, at most 256, oldest first. */
  dismissed?: string[];
  /** The key of the root panel, when it has one. */
  root?: string;
  /** How many slots wide the root panel (History) was, when more than one. A file saved before slots has none. */
  rootSlots?: number;
};

/**
 * What a host implements to keep the workspace between launches. `load` resolves the saved state, or `null` when
 * there is none. `save` may return nothing or a promise; a rejection or a throw is reported, and the next change saves again.
 * @public
 */
export type WorkspaceStorage = {
  /** Resolves the saved state, or `null` when there is none. */
  load(): Promise<WorkspaceState | null>;
  /**
   * Stores `state`. Returning nothing, or a promise that resolves, tells the workspace the state is saved. A throw or a
   * rejection is reported once through `WorkspaceOptions.onError` (`console.error` when it is unset), and the next
   * change to the panels saves the full current state again; nothing retries on a timer.
   */
  save(state: WorkspaceState): void | Promise<void>;
};

const FORM_FACTORS: readonly unknown[] = ['phone', 'tablet', 'desktop'];

/** The most tombstones a file keeps; the oldest go first. */
export const DISMISSED_LIMIT = 256;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSlotCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= ALL_SLOTS;
const isOptional = (value: unknown, type: 'string' | 'boolean'): boolean => value === undefined || typeof value === type;

function isSavedPanel(value: unknown): value is WorkspacePanelState {
  if (!isRecord(value)) return false;
  const { anchor } = value;
  return (
    typeof value.id === 'string' &&
    typeof value.view === 'string' &&
    isOptional(value.url, 'string') &&
    typeof value.live === 'boolean' &&
    isOptional(value.title, 'string') &&
    isOptional(value.listed, 'boolean') &&
    isOptional(value.permanent, 'boolean') &&
    (value.formFactor === undefined || FORM_FACTORS.includes(value.formFactor)) &&
    (value.slots === undefined || isSlotCount(value.slots)) &&
    (value.layer === undefined || value.layer === 'base' || value.layer === 'raised') &&
    isRecord(anchor) &&
    typeof anchor.panel === 'string' &&
    (anchor.position === 'left' || anchor.position === 'right') &&
    typeof anchor.priority === 'number' &&
    Number.isFinite(anchor.priority)
  );
}

/**
 * Whether `value` is a workspace file this version understands: version 1, a `panels` array of well-typed entries
 * with unique ids. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 */
export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels)) return false;
  const panels: unknown[] = value.panels;
  if (!panels.every(isSavedPanel)) return false;
  return new Set(panels.map((p) => p.id)).size === panels.length;
}

/** What the sanitizer dropped from a saved entry and why. */
export type Dropped = { key: string; message: string };

/** The additive keys of a saved entry once cleaned. The person's changes are `owned` here, so only the functions that own the panel field named `overrides` ever write one. */
export type SavedExtras = Pick<WorkspacePanelState, 'key' | 'instance' | 'applied' | 'closable'> & { owned?: WorkspacePanelState['overrides'] };

function cleanAnchor(value: unknown): { panel: string; position: 'left' | 'right'; priority: number } | undefined {
  if (!isRecord(value) || typeof value.panel !== 'string' || (value.position !== 'left' && value.position !== 'right')) return undefined;
  if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) return undefined;
  return { panel: value.panel, position: value.position, priority: value.priority };
}

/** `overrides` reduced to the members that are well formed; `undefined` for anything that is not an object. */
function cleanOverrides(value: unknown, dropped: Dropped[]): NonNullable<WorkspacePanelState['overrides']> | undefined {
  if (!isRecord(value)) {
    dropped.push({ key: 'overrides', message: 'overrides: expected an object; dropped' });
    return undefined;
  }
  const out: NonNullable<WorkspacePanelState['overrides']> = {};
  if (value.anchor !== undefined) {
    const anchor = cleanAnchor(value.anchor);
    if (anchor === undefined) dropped.push({ key: 'overrides.anchor', message: 'overrides.anchor: expected { panel, position, priority }; dropped' });
    else out.anchor = anchor;
  }
  if (value.formFactor !== undefined) {
    if (FORM_FACTORS.includes(value.formFactor)) out.formFactor = value.formFactor as FormFactor;
    else dropped.push({ key: 'overrides.formFactor', message: 'overrides.formFactor: expected phone, tablet or desktop; dropped' });
  }
  if (value.slots !== undefined) {
    if (isSlotCount(value.slots)) out.slots = value.slots;
    else dropped.push({ key: 'overrides.slots', message: 'overrides.slots: expected an integer of at least 1; dropped' });
  }
  if (value.parkable !== undefined) {
    if (typeof value.parkable === 'boolean') out.parkable = value.parkable;
    else dropped.push({ key: 'overrides.parkable', message: 'overrides.parkable: expected a boolean; dropped' });
  }
  return out;
}

/**
 * The additive keys of one saved entry, each kept only when well formed; what is not is reported in `dropped` and
 * the entry restores without it. `seen` holds the keys earlier entries claimed: a repeat is dropped.
 */
export function cleanSavedExtras(entry: WorkspacePanelState, seen: Set<string>, dropped: Dropped[]): SavedExtras {
  const raw = entry as Record<string, unknown>;
  const out: SavedExtras = {};
  if (raw.key !== undefined) {
    if (typeof raw.key !== 'string' || raw.key === '') dropped.push({ key: 'key', message: 'key: expected a non-empty string; dropped' });
    else if (seen.has(raw.key)) dropped.push({ key: 'key', message: `key: '${raw.key}' repeats an earlier entry's key; dropped` });
    else {
      seen.add(raw.key);
      out.key = raw.key;
    }
  }
  if (raw.instance !== undefined) {
    if (isRecord(raw.instance)) out.instance = raw.instance as { [key: string]: JsonValue };
    else dropped.push({ key: 'instance', message: 'instance: expected an object; dropped' });
  }
  if (raw.overrides !== undefined) {
    out.owned = cleanOverrides(raw.overrides, dropped);
  }
  if (raw.applied !== undefined) {
    if (isRecord(raw.applied) && raw.applied.placeOnAdd !== undefined) out.applied = { placeOnAdd: raw.applied.placeOnAdd as AddPlacement };
    else dropped.push({ key: 'applied', message: 'applied: expected { placeOnAdd }; dropped' });
  }
  if (raw.closable === false) out.closable = false;
  else if (raw.closable !== undefined) dropped.push({ key: 'closable', message: 'closable: only false is saved; dropped' });
  return out;
}

/** The tombstone list of `value`: strings only, each once, the newest 256. Anything that is not an array reads as empty. */
export function cleanDismissed(value: unknown, dropped: Dropped[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    dropped.push({ key: 'dismissed', message: 'dismissed: expected an array of keys; dropped' });
    return [];
  }
  const keys = value.filter((k): k is string => typeof k === 'string' && k !== '');
  const unique = keys.filter((k, i) => keys.lastIndexOf(k) === i);
  return unique.slice(-DISMISSED_LIMIT);
}

/** Drops what JSON cannot hold (a function, `undefined`) from `value`, so a settings layer is safe to save. */
function jsonSafe(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item) ?? null);
  if (isRecord(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const k of Object.keys(value)) {
      const kept = jsonSafe(value[k]);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return undefined;
}

/**
 * The saved form of `panels`: every entry but the root, with only the documented keys. `permanent` is derived
 * (`!collapsible`) because PanelWindow has no such field, and an absent optional stays absent so no key holds
 * `undefined`. An entry that carries settings also writes `key`, `instance` (unless code declares it again),
 * `overrides`, `applied` and `closable`; one whose `persist` is 'session' is not written, and an anchor that named
 * one is read again from the order that remains. `dismissed` is the tombstone list the caller holds.
 */
export function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string, dismissed: readonly string[] = []): WorkspaceState {
  const kept = panels.filter((p) => p.settings?.persist !== 'session');
  const unsaved = new Set(panels.filter((p) => p.settings?.persist === 'session').map((p) => p.id));
  const positional = new Map(deriveAnchorsFromOrder(kept, rootId).map((p) => [p.id, p.anchor]));
  const names = (id: string): boolean => !unsaved.has(id);
  // An anchor that named an unsaved panel forces every anchor to be read off the order: mixing the two numberings would reorder the row.
  const rederive = kept.some((p) => (p.anchor !== undefined && !names(p.anchor.panel)) || (p.overrides?.anchor !== undefined && !names(p.overrides.anchor.panel)));
  const root = kept.find((p) => p.id === rootId);
  return {
    version: 1,
    panels: kept
      .filter((p) => p.id !== rootId)
      .map((p) => {
        const anchor = rederive ? positional.get(p.id)! : (p.anchor ?? positional.get(p.id)!);
        const extras: Partial<WorkspacePanelState> = {};
        if (p.settings !== undefined) {
          extras.key = p.key ?? p.id;
          if (p.declared !== true) extras.instance = (jsonSafe(p.instance ?? {}) ?? {}) as { [key: string]: JsonValue };
          if (p.overrides !== undefined) {
            const { anchor: held, ...rest } = p.overrides;
            extras.overrides = { ...(held === undefined ? {} : { anchor: names(held.panel) ? { ...held } : { panel: anchor.panel, position: anchor.position, priority: anchor.priority } }), ...rest };
          }
          if (p.applied !== undefined) extras.applied = { placeOnAdd: p.applied.placeOnAdd };
          if (p.locked) extras.closable = false;
        }
        return {
          id: p.id,
          view: p.view,
          url: p.url,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.params !== undefined ? { params: p.params } : {}),
          ...(p.listed !== undefined ? { listed: p.listed } : {}),
          live: p.live,
          anchor: { panel: anchor.panel, position: anchor.position, priority: anchor.priority },
          ...(p.formFactor !== undefined ? { formFactor: p.formFactor } : {}),
          ...(p.slots !== undefined && p.slots !== slotsOfTier(p.formFactor ?? 'phone') ? { slots: p.slots } : {}),
          ...(!p.collapsible ? { permanent: true } : {}),
          ...(p.layer !== undefined ? { layer: p.layer } : {}),
          ...extras,
        };
      }),
    ...(dismissed.length > 0 ? { dismissed: [...dismissed] } : {}),
    ...(root?.settings !== undefined && root.key !== undefined ? { root: root.key } : {}),
    ...(root !== undefined && slotsOf(root) > 1 ? { rootSlots: slotsOf(root) } : {}),
  };
}

/**
 * The 0.1.0 skeleton of one saved entry under `id`: appendPanel owns the creation rules (permanent forces listed
 * false and phone, size comes from the tier), and a permanent column is never parked, so one saved as parked is live.
 * `anchor` is the entry's saved anchor with its target already mapped.
 */
export function entryFromSaved(s: WorkspacePanelState, id: string, anchor: PanelWindow['anchor'], rootId: string): PanelWindow {
  const entry = appendPanel(
    [],
    { ...(s.url !== undefined ? { url: s.url } : {}), view: s.view, title: s.title, params: s.params, listed: s.listed, layer: s.layer, formFactor: s.formFactor, permanent: s.permanent },
    id,
    rootId,
  )[0]!;
  const slots = s.permanent === true ? undefined : s.slots;
  return { ...entry, ...(slots === undefined ? {} : { slots, formFactor: tierOfSlots(slots) }), live: s.permanent === true ? true : s.live, ...(anchor === undefined ? {} : { anchor }) };
}

/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[] {
  // Every entry's id is drawn before anything else, so a saved id that happens to equal a fresh one is never reused.
  const fresh = state.panels.map(() => freshId());
  const freshOf = new Map(state.panels.map((s, i) => [s.id, fresh[i]!]));
  // One id nothing else holds stands in for every anchor target the file does not contain: a saved id kept as it
  // is could equal a fresh one (both count up from 1 each launch) and attach the panel to a stranger.
  let missing: string | undefined;
  const targetOf = (saved: string): string => {
    if (saved === rootId) return rootId;
    const mapped = freshOf.get(saved);
    if (mapped !== undefined) return mapped;
    missing ??= freshId();
    return missing;
  };
  const built = state.panels.map((s, i) => {
    const entry = entryFromSaved(s, fresh[i]!, { panel: targetOf(s.anchor.panel), position: s.anchor.position, priority: s.anchor.priority }, rootId);
    return s.closable === false ? { ...entry, locked: true } : entry;
  });
  // One pass over the whole set: placing entries one at a time would rewrite an anchor that names a later entry.
  return computeRowOrder(built, rootId);
}
