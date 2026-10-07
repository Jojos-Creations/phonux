/**
 * Whether a panel reads as pinned: a pure function of the entry, the row and the `pinning` definition. A leaf: it
 * stores nothing, so a drag that re-anchors every entry to the root cannot change what a definition reads.
 */
import type { PanelWindow } from './panelWindow.js';
import type { Pinning } from './panelSettings.js';
import { effective } from './panelSettings.js';

/** The row's root: the marker when there is one, else the first entry that has no anchor. */
function rootOf(row: readonly PanelWindow[]): PanelWindow | undefined {
  return row.find((p) => p.marker === true) ?? row.find((p) => p.anchor === undefined);
}

/** Whether `entry` sits immediately on the left side of the root: by its anchor, else by its place in the array. */
function leftOfRoot(entry: PanelWindow, row: readonly PanelWindow[], rootId: string): boolean {
  if (entry.id === rootId) return false;
  if (entry.anchor !== undefined) return entry.anchor.panel === rootId && entry.anchor.position === 'left';
  return row.findIndex((p) => p.id === entry.id) < row.findIndex((p) => p.id === rootId);
}

/**
 * Whether `entry` reads as pinned under `definition`. A definition naming `parkable` in both halves is read by the
 * entry's resolved `parkable`, whatever its placement; one with `row-start` and `row-end` or `after-fixed` is read
 * by sitting left of the root; both are read when both hold; an empty one reads false. `rootId` names the root; omitted,
 * it is the row's marker or its entry with no anchor.
 * @internal
 */
export function isPinned(entry: PanelWindow, row: readonly PanelWindow[], definition: Pinning, rootId?: string): boolean {
  const { pinned, unpinned } = definition;
  const byParkable = pinned.parkable !== undefined && unpinned.parkable !== undefined && pinned.parkable !== unpinned.parkable;
  const byPlace = pinned.placement === 'row-start' && (unpinned.placement === 'row-end' || unpinned.placement === 'after-fixed');
  if (!byParkable && !byPlace) return false;
  const root = rootId ?? rootOf(row)?.id;
  if (byParkable && effective(entry).parkable !== pinned.parkable) return false;
  if (byPlace && (root === undefined || !leftOfRoot(entry, row, root))) return false;
  return true;
}
