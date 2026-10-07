/**
 * The one pure function that turns a saved file, the registered templates and the code's declarations into the
 * panels a launch starts with. It holds no React: the persistence hook calls it once, inside the load's success
 * handler, and appends what it returns in a single `setPanels`. DESIGN.md ("Workspace state persistence") holds the rules.
 */
import type { JsonValue } from './hostApi.js';
import { placePanel } from './panelPlacement.js';
import type { NamedPlacement } from './panelPlacement.js';
import { computeRowOrder } from './panelRowOrder.js';
import { applyTemplate, resolvePanelSettings, sameSettingsValue } from './panelSettings.js';
import type { AddPlacement, PanelSettings, PanelSettingsLayers, PanelSettingsResolution, ResolvedPanelSettings, SettingNote } from './panelSettings.js';
import type { PanelTemplate } from './panelTemplate.js';
import { TIER_SIZES } from './panelTiers.js';
import { appendPanel, clearOverrides, type PanelWindow } from './panelWindow.js';
import { cleanDismissed, cleanSavedExtras, entryFromSaved, isWorkspaceState } from './workspaceState.js';
import type { Dropped, SavedExtras, WorkspacePanelState } from './workspaceState.js';

/** A panel code declares: created at every launch unless the person dismissed it, and rebuilt from the file when the file has it. */
export type DeclaredPanel = { id: string; templateId: string; settings?: PanelSettings; params?: JsonValue; url?: string };

type SavedEntry = Omit<WorkspacePanelState, 'key' | 'instance' | 'overrides' | 'applied' | 'closable'> & SavedExtras;

/** What `reconcileWorkspace` reads. */
export interface ReconcileInput {
  /** What `load()` resolved, unchecked. */
  saved: unknown;
  /** The templates a saved entry's `view` or a declaration's `templateId` may name. */
  templates: readonly PanelTemplate[];
  /** The panels code declares, in declaration order. */
  declared: readonly DeclaredPanel[] | undefined;
  /** The workspace's panel settings; with neither these, templates nor declarations a restored panel is a 0.1.0 entry with no settings. */
  workspaceDefaults?: Omit<PanelSettings, 'tuning'>;
  /** The row's root id. */
  rootId: string;
  /** The panels already in the row, which a restored entry is placed beside and never duplicates. */
  current: readonly PanelWindow[];
  /** Fresh ids for the new entries; every one is drawn before this returns. */
  freshId(): string;
  /** The developer's panel order, read by every placement whose value is `'order'`. */
  order?: () => readonly string[];
}

/** What `reconcileWorkspace` returns. */
export interface ReconcileResult {
  /** The new entries only (restored and declared), in row order, with their anchors settled against `current`. */
  entries: PanelWindow[];
  /** What the restore dropped, ignored or could not place. */
  notes: SettingNote[];
  /** The tombstones to keep, as the file held them. */
  dismissed: string[];
}

/** The keys of `overrides` the resolver did not drop. */
function keptOverrides(held: NonNullable<WorkspacePanelState['overrides']>, resolution: PanelSettingsResolution): NonNullable<WorkspacePanelState['overrides']> {
  const gone = new Set(resolution.notes.filter((n) => n.code === 'override-dropped').map((n) => n.key));
  const { anchor, formFactor, parkable } = held;
  return {
    ...(anchor !== undefined ? { anchor } : {}),
    ...(formFactor !== undefined && !gone.has('formFactor') ? { formFactor } : {}),
    ...(parkable !== undefined && !gone.has('parkable') ? { parkable } : {}),
  };
}

/** `instance` without the keys the resolver reported as invalid, so the next save does not carry them. */
function keptInstance(instance: PanelSettings, resolution: PanelSettingsResolution): PanelSettings {
  const copy: Record<string, unknown> = { ...instance };
  for (const note of resolution.notes) {
    if (note.code !== 'invalid-saved-setting' || note.key === undefined || !note.message.startsWith('instance')) continue;
    if (note.key.startsWith('tuning.') && typeof copy.tuning === 'object' && copy.tuning !== null) {
      const { [note.key.slice('tuning.'.length)]: _gone, ...rest } = copy.tuning as Record<string, unknown>;
      if (Object.keys(rest).length === 0) delete copy.tuning;
      else copy.tuning = rest;
    } else delete copy[note.key];
  }
  return copy as PanelSettings;
}

/**
 * Rebuilds the row's new entries. Draws every fresh id first; rebuilds a saved entry of a registered template by the
 * cascade (or of a plain view when the row has settings) and hydrates any other as 0.1.0 did; creates each
 * declared panel the file has no entry for unless its key is dismissed; lets `restoreVisibility` decide each `live`;
 * orders the row once. A saved entry owns what its `overrides` hold, and an entry without `overrides` (a 0.1.0 entry)
 * owns its anchor and tier. An untouched entry keeps its saved place only while its resolved `placeOnAdd` equals
 * the one that placed it. Permission settings gate gestures, never a restore.
 */
export function reconcileWorkspace(i: ReconcileInput): ReconcileResult {
  const notes: SettingNote[] = [];
  const topDrops: Dropped[] = [];
  let file: { panels: SavedEntry[]; drops: Dropped[][]; dismissed: string[] } | undefined;
  if (i.saved !== null && i.saved !== undefined) {
    if (!isWorkspaceState(i.saved)) {
      notes.push({ code: 'workspace-ignored', message: 'Ignored the saved workspace: it is not a version 1 workspace file.' });
    } else {
      const seen = new Set<string>();
      const drops: Dropped[][] = [];
      const panels = i.saved.panels.map((s) => {
        const entryDrops: Dropped[] = [];
        const plain: Record<string, unknown> = { ...s };
        for (const key of ['key', 'instance', 'overrides', 'applied', 'closable']) delete plain[key];
        drops.push(entryDrops);
        return { ...(plain as SavedEntry), ...cleanSavedExtras(s, seen, entryDrops) };
      });
      file = { panels, drops, dismissed: cleanDismissed((i.saved as { dismissed?: unknown }).dismissed, topDrops) };
    }
  }
  for (const d of topDrops) notes.push({ code: 'invalid-saved-setting', key: d.key, message: d.message });

  const saved = file?.panels ?? [];
  const declared = i.declared ?? [];
  const workspace = i.workspaceDefaults ?? {};
  const settingsOn = i.workspaceDefaults !== undefined || i.templates.length > 0 || declared.length > 0;
  const templateOf = (id: string): PanelTemplate | undefined => i.templates.find((t) => t.id === id);
  const have = new Set(i.current.map((p) => p.key ?? p.id));

  // Every id is drawn before anything else, so a saved id that happens to equal a fresh one is never reused.
  const fresh = saved.map(() => i.freshId());
  const freshOf = new Map(saved.map((s, k) => [s.id, fresh[k]!]));
  let missing: string | undefined;
  const targetOf = (savedId: string): string => {
    if (savedId === i.rootId) return i.rootId;
    const mapped = freshOf.get(savedId);
    if (mapped !== undefined) return mapped;
    missing ??= i.freshId();
    return missing;
  };
  const anchorOf = (a: { panel: string; position: 'left' | 'right'; priority: number }): { panel: string; position: 'left' | 'right'; priority: number } => ({ panel: targetOf(a.panel), position: a.position, priority: a.priority });

  // A declaration claims the saved entry carrying its id, else the first unkeyed (0.1.0) entry of its template, so a 0.1.0 singleton is not made twice.
  const claims = new Map<number, DeclaredPanel>();
  for (const d of declared) {
    let at = saved.findIndex((s, k) => s.key === d.id && !claims.has(k));
    if (at < 0) at = saved.findIndex((s, k) => s.key === undefined && s.view === d.templateId && !claims.has(k));
    if (at >= 0) claims.set(at, d);
  }

  const built: PanelWindow[] = [];
  const replace: { id: string; value: AddPlacement; fallback: NamedPlacement }[] = [];
  saved.forEach((s, k) => {
    const id = fresh[k]!;
    const claim = claims.get(k);
    const template = templateOf(claim?.templateId ?? s.view);
    const key = claim?.id ?? (template !== undefined ? s.key : undefined);
    if (key !== undefined && have.has(key)) return;
    for (const d of file!.drops[k]!) notes.push({ code: 'invalid-saved-setting', panelId: id, key: d.key, message: d.message });
    const base = entryFromSaved(s, id, anchorOf(s.anchor), i.rootId);
    if (!settingsOn) {
      built.push(s.closable === false ? { ...base, locked: true } : base);
      return;
    }

    const legacy = s.owned === undefined;
    const ask: PanelSettings = claim !== undefined ? { ...claim.settings } : { ...(s.instance as PanelSettings | undefined) };
    // A saved `closable: false` binds a view no template rebuilds; a registered template says what its panel may do.
    const plainAsk: PanelSettings = template === undefined && s.closable === false ? { ...ask, closable: false } : ask;
    const layers: PanelSettingsLayers = legacy
      ? {
          workspace,
          ...(template !== undefined ? { template: template.settings } : {}),
          host: { listed: base.listed, layer: base.layer ?? 'base', formFactor: base.formFactor ?? 'phone' },
          instance: { ...plainAsk, parkable: base.collapsible },
        }
      : { workspace, ...(template !== undefined ? { template: template.settings } : {}), instance: plainAsk };
    const first = resolvePanelSettings(layers, { lenient: true });
    // The saved anchor names another saved entry; the live one names its fresh id.
    const heldOverrides = s.owned === undefined ? undefined : { ...s.owned, ...(s.owned.anchor !== undefined ? { anchor: anchorOf(s.owned.anchor) } : {}) };
    const owns = !legacy && first.value.rememberLayout && Object.keys(heldOverrides!).length > 0;
    const resolution = owns ? resolvePanelSettings({ ...layers, user: heldOverrides }, { lenient: true }) : first;
    const settings = resolution.value;
    for (const n of resolution.notes) notes.push({ ...n, panelId: id });

    const tier = settings.formFactor;
    const reconfigured = applyTemplate(base, settings, 'reconfigure');
    const live = settings.restoreVisibility === 'saved' ? base.live : settings.restoreVisibility === 'live';
    let anchor = base.anchor;
    let applied: PanelWindow['applied'];
    if (!legacy) {
      if (owns && heldOverrides!.anchor !== undefined) {
        anchor = heldOverrides!.anchor;
        applied = s.applied ?? { placeOnAdd: settings.placeOnAdd };
      } else {
        applied = { placeOnAdd: settings.placeOnAdd };
        // A panel that remembers nothing has no saved place worth keeping: the default places it again.
        if (!settings.rememberLayout || !sameSettingsValue(s.applied?.placeOnAdd, settings.placeOnAdd)) replace.push({ id, value: settings.placeOnAdd, fallback: settings.placeFallback });
      }
    }
    built.push({
      ...reconfigured,
      live,
      formFactor: tier,
      size: base.size?.formFactor === tier ? base.size : { ...TIER_SIZES[tier] },
      ...(anchor !== undefined ? { anchor } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(claim !== undefined ? { declared: true as const } : { instance: keptInstance(plainAsk, resolution) }),
      ...(legacy ? {} : { overrides: owns ? keptOverrides(heldOverrides!, resolution) : heldOverrides }),
      ...(applied !== undefined ? { applied } : {}),
    });
  });

  const dismissed = file?.dismissed ?? [];
  const restoredKeys = new Set(built.map((p) => p.key));
  const released = new Set<string>();
  for (const d of declared) {
    if (restoredKeys.has(d.id) || have.has(d.id)) continue;
    const template = templateOf(d.templateId);
    if (template === undefined) {
      if (!dismissed.includes(d.id)) notes.push({ code: 'unknown-template', key: d.templateId, message: `declared panel '${d.id}' names template '${d.templateId}', which is not registered; it was not created` });
      continue;
    }
    const resolution = resolvePanelSettings({ workspace, template: template.settings, instance: d.settings }, { lenient: true });
    const settings = resolution.value;
    // A tombstone keeps a panel closed only while the panel can be closed and stays closed after it: a stale one never hides a locked or returning panel.
    if (dismissed.includes(d.id)) {
      if (settings.closable && settings.afterClose === 'stay-closed') continue;
      released.add(d.id);
    }
    const id = i.freshId();
    for (const n of resolution.notes) notes.push({ ...n, panelId: id });
    const skeleton = appendPanel(
      [],
      { url: d.url ?? '', view: template.id, title: settings.title, params: d.params ?? template.params, listed: settings.listed, layer: settings.layer, formFactor: settings.formFactor, permanent: !settings.parkable },
      id,
      i.rootId,
    )[0]!;
    built.push({ ...applyTemplate({ ...skeleton, key: d.id }, settings, 'create'), declared: true, overrides: {}, applied: { placeOnAdd: settings.placeOnAdd } });
    replace.push({ id, value: settings.placeOnAdd, fallback: settings.placeFallback });
  }

  let row = computeRowOrder([...i.current, ...built], i.rootId);
  for (const r of replace) {
    const placed = placePanel(row, r.id, r.value, { fallback: r.fallback, rootId: i.rootId, ...(i.order !== undefined ? { order: i.order } : {}) });
    row = placed.row;
    notes.push(...placed.notes);
  }
  const added = new Set(built.map((p) => p.id));
  return { entries: row.filter((p) => added.has(p.id)), notes, dismissed: dismissed.filter((k) => !restoredKeys.has(k) && !released.has(k)) };
}

/**
 * `row`, which holds a just-built entry `id`, with that entry resolved by `settings`: carrying its `instance` layer,
 * empty `overrides` and the `placeOnAdd` that places it, and placed there unless the caller gave an anchor itself.
 * `name` is a template panel's key; absent, the entry's key is its id.
 */
export function finishCreated(i: { row: PanelWindow[]; id: string; settings: ResolvedPanelSettings; instance: PanelSettings; name: string | undefined; callerPlaced: boolean; rootId: string; order?: () => readonly string[] }): PanelWindow[] {
  const made = i.row.find((p) => p.id === i.id)!;
  const built: PanelWindow = {
    ...applyTemplate(i.name === undefined ? made : { ...made, key: i.name }, i.settings, 'create'),
    instance: i.instance,
    applied: { placeOnAdd: i.settings.placeOnAdd },
  };
  const row = clearOverrides(
    i.row.map((p) => (p.id === i.id ? built : p)),
    [i.id],
  );
  if (i.callerPlaced || i.settings.placeOnAdd === 'row-end') return row;
  return placePanel(row, i.id, i.settings.placeOnAdd, { fallback: i.settings.placeFallback, rootId: i.rootId, ...(i.order !== undefined ? { order: i.order } : {}) }).row;
}

/** The notes a host-bag create's conflicts raise, one per setting the cascade overrode or refused. */
export function conflictNotes(panelId: string, conflicts: PanelSettingsResolution['conflicts']): SettingNote[] {
  return conflicts.map((c) => ({ code: c.kind, panelId, key: c.key, message: c.message }));
}
