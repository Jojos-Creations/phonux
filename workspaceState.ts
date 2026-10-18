/**
 * Workspace state as a saved file: the JSON shape, its guard, and the pure pair that turns the panel list into
 * that shape and back. DESIGN.md ("Workspace state persistence") holds the rules; this file holds no React and
 * no host code.
 */
import type { JsonValue } from './hostApi.js';
import { computeRowOrder, deriveAnchorsFromOrder } from './panelRowOrder.js';
import type { AddPlacement } from './panelSettings.js';
import { PANEL_UID_FORM } from './panelUid.js';
import { appendPanel, slotsOf, type PanelWindow } from './panelWindow.js';
import { ALL_SLOTS } from './rowConstants.js';

/**
 * One saved panel. An `anchor` or `scroll` names another entry by its `uid` (its `key` when it has no uid). Never saved: `hostData`, `size`, `locked`, `collapsible`, `anchoredEnter`, the settings
 * themselves and the host's root column. The keys from `key` on are written only for a panel that carries settings;
 * a file without them restores unchanged.
 * @public
 */
export type WorkspacePanelState = {
  /** Read only from a file saved before a panel was named by its `uid`: the name other entries' `anchor.panel` use there. A save never writes it, and a restore ignores it for naming the panel. */
  id?: string;
  /** Id of the template that renders the panel. */
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
  /** Where the panel sits: on `position`'s side of the entry whose `uid` (or `key`) is `panel`, or of the host's root column, ordered by `priority`. */
  anchor: { panel: string; position: 'left' | 'right'; priority: number };
  /** The panel's slot count, written only when it is more than one. */
  slots?: number;
  /** Whether the panel is a permanent column, as `CreatePanelOptions.permanent`. */
  permanent?: boolean;
  /** The stacking tier of the panel's row slot, as `CreatePanelOptions.layer`. */
  layer?: 'base' | 'raised';
  /** An opaque identity that survives save, restore and a copy of the file to another device, so two copies can match panels. Not a name code can ask for; a file or a library without it restores unchanged and mints one. */
  uid?: string;
  /** The panel's stable name: a declared panel's id, a template's id for a singleton, or `templateId~suffix`. */
  key?: string;
  /** The instance settings layer the panel was created under; absent for a panel code declares again at every launch. */
  instance?: { [key: string]: JsonValue };
  /** What the person changed: where the panel sits, its slot count, whether it is parkable. Present (possibly empty) means the panel owns only the keys it holds. */
  overrides?: {
    /** Where the person put the panel; `panel` names another entry of this file as `anchor.panel` does. */
    anchor?: { panel: string; position: 'left' | 'right'; priority: number };
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
  /**
   * Where the row rested, once a person moved it: `panel` is the `uid` of the first panel the window showed at that stop (the root's id for the root),
   * and `offset` how many phone widths the stop lies from that panel's left edge (negative left of it). A reload
   * restores the same stop; a panel that is gone, or a row with no stops, restores as if there were none.
   */
  scroll?: { panel: string; offset: number };
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

/** What a file saved before slots holds as a panel's tier, read as the slot count it stood for: desktop was every visible slot. */
const TIER_SLOTS: Readonly<Record<string, number>> = { phone: 1, tablet: 2, desktop: ALL_SLOTS };
const isTier = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(TIER_SLOTS, value);

/** The most tombstones a file keeps; the oldest go first. */
export const DISMISSED_LIMIT = 256;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSlotCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= ALL_SLOTS;
const isOptional = (value: unknown, type: 'string' | 'boolean'): boolean => value === undefined || typeof value === type;

function isSavedPanel(value: unknown): value is WorkspacePanelState {
  if (!isRecord(value)) return false;
  const { anchor } = value;
  return (
    isOptional(value.id, 'string') &&
    typeof value.view === 'string' &&
    isOptional(value.url, 'string') &&
    typeof value.live === 'boolean' &&
    isOptional(value.title, 'string') &&
    isOptional(value.listed, 'boolean') &&
    isOptional(value.permanent, 'boolean') &&
    (value.formFactor === undefined || isTier(value.formFactor)) &&
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
 * with unique ids where they hold one. Unknown extra keys are accepted (a later optional field is additive); `params` is not deep-checked.
 */
export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.panels)) return false;
  const panels: unknown[] = value.panels;
  if (!panels.every(isSavedPanel)) return false;
  const ids = panels.flatMap((p) => (p.id === undefined ? [] : [p.id]));
  return new Set(ids).size === ids.length;
}

/** What the sanitizer dropped from a saved entry and why. */
export type Dropped = { key: string; message: string };

/**
 * The saved rest of a file: its `scroll` when well formed, otherwise undefined with a drop note for anything but an absent one.
 */
export function cleanSavedScroll(value: unknown, dropped: Dropped[]): NonNullable<WorkspaceState['scroll']> | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value) && typeof value.panel === 'string' && value.panel !== '' && typeof value.offset === 'number' && Number.isFinite(value.offset)) {
    return { panel: value.panel, offset: value.offset };
  }
  dropped.push({ key: 'scroll', message: 'scroll: expected { panel, offset }; dropped' });
  return undefined;
}

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
    if (isTier(value.formFactor)) out.slots = TIER_SLOTS[value.formFactor];
    else dropped.push({ key: 'overrides.formFactor', message: 'overrides.formFactor: expected phone, tablet or desktop; dropped' });
  }
  // A slot count outvotes the tier a file saved before slots holds.
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
/**
 * The entry's `uid` when it is well formed and no earlier entry holds it; otherwise undefined, with a drop note for
 * anything but an absent one. `seen` collects the uids kept so far.
 */
export function cleanSavedUid(entry: WorkspacePanelState, seen: Set<string>, dropped: Dropped[]): string | undefined {
  const raw = (entry as Record<string, unknown>).uid;
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !PANEL_UID_FORM.test(raw)) {
    dropped.push({ key: 'uid', message: 'uid: expected the form u_ and 32 hex characters; dropped' });
    return undefined;
  }
  if (seen.has(raw)) {
    dropped.push({ key: 'uid', message: `uid: '${raw}' repeats an earlier entry's uid; dropped` });
    return undefined;
  }
  seen.add(raw);
  return raw;
}

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
 * `overrides`, `applied` and `closable`. `dismissed` is the tombstone list the caller holds.
 */
export function projectWorkspaceState(panels: readonly PanelWindow[], rootId: string, dismissed: readonly string[] = [], scroll?: NonNullable<WorkspaceState['scroll']>): WorkspaceState {
  const positional = new Map(deriveAnchorsFromOrder(panels, rootId).map((p) => [p.id, p.anchor]));
  const root = panels.find((p) => p.id === rootId);
  // A counter id restarts every launch, so the file names a panel by what outlives one: its uid, else its key.
  const names = new Map(panels.map((p) => [p.id, p.uid ?? p.key ?? p.id]));
  const nameOf = (id: string): string => (id === rootId ? rootId : (names.get(id) ?? id));
  return {
    version: 1,
    panels: panels
      .filter((p) => p.id !== rootId)
      .map((p) => {
        const anchor = p.anchor ?? positional.get(p.id)!;
        const extras: Partial<WorkspacePanelState> = {};
        if (p.settings !== undefined) {
          extras.key = p.key ?? p.id;
          if (p.declared !== true) extras.instance = (jsonSafe(p.instance ?? {}) ?? {}) as { [key: string]: JsonValue };
          if (p.overrides !== undefined) {
            const { anchor: held, ...rest } = p.overrides;
            extras.overrides = { ...(held === undefined ? {} : { anchor: { ...held, panel: nameOf(held.panel) } }), ...rest };
          }
          if (p.applied !== undefined) extras.applied = { placeOnAdd: p.applied.placeOnAdd };
          if (p.locked) extras.closable = false;
        }
        return {
          ...(p.uid !== undefined ? { uid: p.uid } : {}),
          view: p.view,
          url: p.url,
          ...(p.title !== undefined ? { title: p.title } : {}),
          ...(p.params !== undefined ? { params: p.params } : {}),
          ...(p.listed !== undefined ? { listed: p.listed } : {}),
          live: p.live,
          anchor: { panel: nameOf(anchor.panel), position: anchor.position, priority: anchor.priority },
          ...(p.slots !== undefined && p.slots !== 1 ? { slots: p.slots } : {}),
          ...(!p.collapsible ? { permanent: true } : {}),
          ...(p.layer !== undefined ? { layer: p.layer } : {}),
          ...extras,
        };
      }),
    ...(dismissed.length > 0 ? { dismissed: [...dismissed] } : {}),
    ...(root?.settings !== undefined && root.key !== undefined ? { root: root.key } : {}),
    ...(root !== undefined && slotsOf(root) > 1 ? { rootSlots: slotsOf(root) } : {}),
    ...(scroll !== undefined ? { scroll: { panel: nameOf(scroll.panel), offset: scroll.offset } } : {}),
  };
}

/** The slot count the tier of an entry saved before slots stood for, or undefined for an entry with no tier. */
function savedTierSlots(s: WorkspacePanelState): number | undefined {
  const tier = (s as { formFactor?: unknown }).formFactor;
  return isTier(tier) ? TIER_SLOTS[tier] : undefined;
}

/**
 * The settings-free skeleton of one saved entry under `id`: appendPanel owns the creation rules (permanent forces listed
 * false and one slot, size comes from the slots), and a permanent column is never parked, so one saved as parked is live.
 * `anchor` is the entry's saved anchor with its target already mapped.
 */
export function entryFromSaved(s: WorkspacePanelState, id: string, anchor: PanelWindow['anchor'], rootId: string, uid?: string): PanelWindow {
  const entry = appendPanel(
    [],
    { ...(s.url !== undefined ? { url: s.url } : {}), view: s.view, title: s.title, params: s.params, listed: s.listed, layer: s.layer, slots: s.slots ?? savedTierSlots(s), permanent: s.permanent },
    id,
    rootId,
    ...(uid !== undefined ? [uid] : []),
  )[0]!;
  return { ...entry, live: s.permanent === true ? true : s.live, ...(anchor === undefined ? {} : { anchor }) };
}

/**
 * What each name an entry answers to maps to in `values` (parallel to the entries): its `uid`, its `key`, and the `id`
 * a file saved before panels were named by uid holds. A name claimed twice goes to the first, and a uid outranks
 * an id outranks a key, so a name an older file gave a counter id is read as that id.
 */
export function savedNames<T>(entries: readonly { id?: string; uid?: unknown; key?: unknown }[], values: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const field of ['uid', 'id', 'key'] as const) {
    entries.forEach((e, k) => {
      const name = e[field];
      if (typeof name === 'string' && name !== '' && !out.has(name)) out.set(name, values[k]!);
    });
  }
  return out;
}

/**
 * The panels `state` describes, in row order and without the root, each under a fresh id from `freshId`. `hostData`
 * is left for the caller: only the host knows what a new panel carries.
 */
export function hydrateWorkspaceState(state: WorkspaceState, freshId: () => string, rootId: string): PanelWindow[] {
  // Every entry's id is drawn before anything else, so a saved name that happens to equal a fresh id is never reused.
  const fresh = state.panels.map(() => freshId());
  const freshOf = savedNames(state.panels, fresh);
  // One id nothing else holds stands in for every anchor target the file does not contain: a name kept as it
  // is could equal a fresh id (both count up from 1 each launch) and attach the panel to a stranger.
  let missing: string | undefined;
  const targetOf = (saved: string): string => {
    if (saved === rootId) return rootId;
    const mapped = freshOf.get(saved);
    if (mapped !== undefined) return mapped;
    missing ??= freshId();
    return missing;
  };
  const seenUids = new Set<string>();
  const built = state.panels.map((s, i) => {
    const entry = entryFromSaved(s, fresh[i]!, { panel: targetOf(s.anchor.panel), position: s.anchor.position, priority: s.anchor.priority }, rootId, cleanSavedUid(s, seenUids, []));
    return s.closable === false ? { ...entry, locked: true } : entry;
  });
  // One pass over the whole set: placing entries one at a time would rewrite an anchor that names a later entry.
  return computeRowOrder(built, rootId);
}
