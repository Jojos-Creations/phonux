/**
 * Where a panel lands: the pure half of placeOnAdd, placeOnShow, placeOnReturn, placeFallback and undoPlacement.
 * `resolvePlacement` turns one value into an anchor request against the row as it stands; `placePanel` applies it to
 * a panel already in the row. Placement is the developer's own ask, so nothing here reads `placeable`, and the
 * entry's settings are never written: the person's arrangement is whatever the row's anchors say.
 */
import type { AddPlacement, SettingNote } from './panelSettings.js';
import { panelKey } from './panelSettings.js';
import { anchorPanel, restorePanel, type AnchorRequest, type PanelWindow } from './panelWindow.js';

/** The five positions a value may name without a target; also what `placeFallback` may be. @internal */
export type NamedPlacement = 'row-start' | 'row-end' | 'parkable-start' | 'parkable-end' | 'after-fixed';

/** What a resolution needs beyond the value: where to land when the value cannot be honoured, and the developer's panel order. @internal */
export interface PlacementOptions {
  fallback: NamedPlacement;
  order?: () => readonly string[];
}

const NOTE_CODE = 'placement-fallback';

/** The note raised when a placement could not be honoured and its `placeFallback` was used instead. @internal */
export const placementFallbackNote = (panelId: string | null, why: string): SettingNote => ({
  code: NOTE_CODE,
  ...(panelId !== null ? { panelId } : {}),
  message: `placement: ${why}; the panel landed at its placeFallback`,
});

/** Delivers `notes` to `onNote`, which may throw without breaking the update that raised them. @internal */
export function reportNotes(onNote: ((note: SettingNote) => void) | undefined, notes: readonly SettingNote[]): void {
  for (const note of notes) {
    try {
      onNote?.(note);
    } catch {
      // A reporter that throws must not break the placement it reports on.
    }
  }
}

const matchesName = (p: PanelWindow, name: string): boolean => panelKey(p) === name || p.id === name;

/** `position` against `others`, the row without the panel being placed, in array order. */
function named(others: readonly PanelWindow[], rootId: string, position: NamedPlacement): AnchorRequest {
  const rowStart: AnchorRequest = { panel: rootId, position: 'left' };
  const rowEnd: AnchorRequest = { panel: rootId, position: 'right' };
  if (position === 'row-start') return rowStart;
  if (position === 'row-end') return rowEnd;
  if (position === 'parkable-start') {
    const first = others.find((p) => p.collapsible);
    if (first === undefined) return rowEnd;
    return first === others[0] ? rowStart : { panel: first.id, position: 'left', priority: -1 };
  }
  if (position === 'parkable-end') {
    const parkable = others.filter((p) => p.collapsible);
    const last = parkable[parkable.length - 1];
    if (last === undefined) return rowEnd;
    return last === others[others.length - 1] ? rowEnd : { panel: last.id, position: 'right', priority: -1 };
  }
  const fixed = others.filter((p) => !p.collapsible);
  const lastFixed = fixed[fixed.length - 1];
  return lastFixed === undefined ? rowStart : { panel: lastFixed.id, position: 'right', priority: -1 };
}

/**
 * The anchor request that lands `self` where `value` says, against `row`. Priority -1 on every "immediately next
 * to" request: only -1 lands nearest, because an equal priority on the right goes to the entry earlier in the row.
 * A target that is missing, is the panel itself, or an `order` that cannot place it, lands at `o.fallback` with a
 * note. `self` is the panel's name whether or not it is in `row` yet; null when it has none.
 * @internal
 */
export function resolvePlacement(
  row: readonly PanelWindow[],
  rootId: string,
  self: string | null,
  value: AddPlacement | 'in-place',
  o: PlacementOptions,
): { anchor: AnchorRequest | null; notes: SettingNote[] } {
  if (value === 'in-place') return { anchor: null, notes: [] };
  const selfEntry = self === null ? undefined : row.find((p) => p.id === self || panelKey(p) === self);
  const selfNames = new Set<string>(self === null ? [] : [self, ...(selfEntry === undefined ? [] : [selfEntry.id, panelKey(selfEntry)])]);
  const others = row.filter((p) => p !== selfEntry);
  const fallback = (why: string): { anchor: AnchorRequest; notes: SettingNote[] } => ({ anchor: named(others, rootId, o.fallback), notes: [placementFallbackNote(self, why)] });
  const find = (name: string): PanelWindow | undefined => others.find((p) => panelKey(p) === name) ?? others.find((p) => p.id === name);
  const toward = (name: string, position: 'left' | 'right', priority?: number): { anchor: AnchorRequest; notes: SettingNote[] } => {
    if (selfNames.has(name)) return fallback(`'${name}' is the panel itself`);
    const target = find(name);
    if (target === undefined) return fallback(`'${name}' is not in the row`);
    return { anchor: { panel: target.id, position, ...(priority === undefined ? {} : { priority }) }, notes: [] };
  };
  if (value === 'order') {
    const list = o.order?.();
    if (list === undefined) return fallback('order has no list');
    const at = list.findIndex((name) => selfNames.has(name));
    if (at < 0) return fallback('the order list does not name this panel');
    for (let i = at - 1; i >= 0; i--) {
      const before = find(list[i]!);
      if (before !== undefined) return { anchor: { panel: before.id, position: 'right', priority: -1 }, notes: [] };
    }
    for (let i = at + 1; i < list.length; i++) {
      const after = find(list[i]!);
      if (after !== undefined) return { anchor: { panel: after.id, position: 'left', priority: -1 }, notes: [] };
    }
    return fallback('no panel in the order list is in the row');
  }
  if (typeof value === 'string') return { anchor: named(others, rootId, value), notes: [] };
  if ('after' in value) return toward(value.after, 'right', -1);
  if ('before' in value) return toward(value.before, 'left', -1);
  return toward(value.anchor.panel, value.anchor.position, value.anchor.priority);
}

/**
 * `id` moved to where `value` says, in the row that results; a copy of `row` when the value is 'in-place' or `id` is
 * not in it. The panel keeps its live flag and every setting, and only its anchor changes. `o.rootId` names the
 * row's root.
 * @internal
 */
export function placePanel(
  row: readonly PanelWindow[],
  id: string,
  value: AddPlacement | 'in-place',
  o: PlacementOptions & { rootId: string },
): { row: PanelWindow[]; notes: SettingNote[] } {
  if (value === 'in-place' || !row.some((p) => p.id === id)) return { row: [...row], notes: [] };
  const { anchor, notes } = resolvePlacement(row, o.rootId, id, value, o);
  return { row: anchor === null ? [...row] : anchorPanel(row, id, anchor, o.rootId), notes };
}

/**
 * `panel` put back into `row` by `undoPlacement`: 'old-slot' at `index`, exactly as restorePanel does; any other value
 * appends it and places it there, its live flag kept. An id already present leaves `row` unchanged.
 * @internal
 */
export function restorePlaced(
  row: readonly PanelWindow[],
  panel: PanelWindow,
  index: number,
  value: 'old-slot' | AddPlacement,
  o: PlacementOptions & { rootId: string },
): { row: PanelWindow[]; notes: SettingNote[] } {
  if (value === 'old-slot' || row.some((p) => p.id === panel.id)) return { row: restorePanel([...row], panel, index, o.rootId), notes: [] };
  return placePanel(restorePanel([...row], panel, row.length, o.rootId), panel.id, value, o);
}
