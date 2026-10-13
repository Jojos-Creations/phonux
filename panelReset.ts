/**
 * What a reset does to a row: for each named panel, the person's overrides and any deferred pin go, its tier and
 * `parkable` are the cascade's again, and it is placed by its `placeOnAdd`. Pure: parking what no longer fits is the
 * engine's, because it needs the row's measure.
 */
import { reparked } from './panelPin.js';
import { placePanel, type PlacementOptions } from './panelPlacement.js';
import type { PanelSettingsResolution, SettingNote } from './panelSettings.js';
import { TIER_SIZES } from './panelTiers.js';
import { clearOverrides, slotsOf, type PanelWindow } from './panelWindow.js';

/** What a reset needs of the engine: the row's root, the cascade a panel resolves under without the person's layer, and where a placement lands. @internal */
export interface ResetEnv {
  /** The id of the row's root. */
  rootId: string;
  /** `entry`'s settings resolved over its own layers with no person's layer. */
  resolveDefaults(entry: PanelWindow): PanelSettingsResolution;
  /** What a placement of `entry` resolves against: its `placeFallback` and the developer's order. */
  placing(entry: PanelWindow): PlacementOptions;
}

/** The row a reset yields. @internal */
export interface ResetOutcome {
  /** The row with every named panel reset; `row` itself when nothing at all differs. */
  row: PanelWindow[];
  /** False when nothing moved, resized or was cleared. */
  changed: boolean;
  /** The ids whose tier was reset. */
  resized: string[];
  /** The notes the placements raised. */
  notes: SettingNote[];
}

const slotOf = (row: readonly PanelWindow[]): string[] => row.map((p) => `${p.id}:${p.anchor?.panel ?? ''}:${p.anchor?.position ?? ''}`);

/**
 * `ids` of `row` reset in the order given, each against the row the earlier ones left. A panel the row does not hold,
 * the root, a marker and an entry with no settings are skipped. Overrides are cleared through `clearOverrides`, the
 * one writer of them.
 * @internal
 */
export function resetEntries(row: readonly PanelWindow[], ids: readonly string[], env: ResetEnv): ResetOutcome {
  const named = ids.filter((id) => {
    const p = row.find((q) => q.id === id);
    return p !== undefined && p.settings !== undefined && p.marker !== true && id !== env.rootId;
  });
  let next = [...row];
  let notes: SettingNote[] = [];
  const resized: string[] = [];
  let reparkable = false;
  let dropped = false;
  for (const id of named) {
    const entry = next.find((p) => p.id === id)!;
    const resolution = env.resolveDefaults(entry);
    const value = resolution.value;
    const slots = slotsOf(entry);
    if (slots !== value.slots) resized.push(id);
    if (entry.collapsible !== value.parkable) reparkable = true;
    if (entry.deferredPin !== undefined) dropped = true;
    const { deferredPin: _gone, ...bare } = reparked(entry, resolution);
    const reset: PanelWindow = {
      ...bare,
      ...(slots === value.slots ? {} : { slots: value.slots, formFactor: value.formFactor, size: { ...TIER_SIZES[value.formFactor] } }),
      applied: { placeOnAdd: value.placeOnAdd },
    };
    next = next.map((p) => (p.id === id ? reset : p));
    const placed = placePanel(next, id, value.placeOnAdd, { ...env.placing(reset), rootId: env.rootId });
    next = placed.row;
    notes = [...notes, ...placed.notes];
  }
  const cleared = clearOverrides(next, named);
  const overridesCleared = cleared !== next;
  const moved = slotOf(next).join() !== slotOf(row).join();
  const changed = moved || resized.length > 0 || reparkable || overridesCleared || dropped;
  return { row: changed ? cleared : (row as PanelWindow[]), changed, resized, notes };
}
