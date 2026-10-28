/**
 * What a reset does to a row: for each named panel, the person's overrides go, its slot count and
 * `parkable` are the cascade's again, and it is placed by its `placeOnAdd`. Pure: parking what no longer fits is the
 * engine's, because it needs the row's measure.
 */
import { reparked } from './panelConfigure.js';
import { placePanel } from './panelPlacement.js';
import { clearOverrides, slotsOf } from './panelWindow.js';
const slotOf = (row) => row.map((p) => `${p.id}:${p.anchor?.panel ?? ''}:${p.anchor?.position ?? ''}`);
/**
 * `ids` of `row` reset in the order given, each against the row the earlier ones left. A panel the row does not hold,
 * the root, a marker and an entry with no settings are skipped. Overrides are cleared through `clearOverrides`, the
 * one writer of them.
 * @internal
 */
export function resetEntries(row, ids, env) {
    const named = ids.filter((id) => {
        const p = row.find((q) => q.id === id);
        return p !== undefined && p.settings !== undefined && p.marker !== true && id !== env.rootId;
    });
    let next = [...row];
    let notes = [];
    const resized = [];
    let reparkable = false;
    for (const id of named) {
        const entry = next.find((p) => p.id === id);
        const resolution = env.resolveDefaults(entry);
        const value = resolution.value;
        const slots = slotsOf(entry);
        if (slots !== value.slots)
            resized.push(id);
        if (entry.collapsible !== value.parkable)
            reparkable = true;
        const reset = {
            ...reparked(entry, resolution),
            ...(slots === value.slots ? {} : { slots: value.slots }),
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
    const changed = moved || resized.length > 0 || reparkable || overridesCleared;
    return { row: changed ? cleared : row, changed, resized, notes };
}
