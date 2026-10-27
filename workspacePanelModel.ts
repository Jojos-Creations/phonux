import type { ReactNode } from 'react';
import type { PhonuxLabels } from './labels.js';

/**
 * The plain model behind `WorkspacePanel`: its tile sizes and counts, its drop order, and the title a tile shows.
 * Nothing here touches React, so it can be checked without a mounted panel.
 */

/** The tile size a `WorkspacePanel` draws at. @public */
export type WorkspaceTileSize = 'small' | 'medium' | 'large';

/** How many tiles fill one row at each size. @public */
export interface WorkspaceTileCounts {
  /** Tiles per row at the small size. */
  readonly small: number;
  /** Tiles per row at the medium size. */
  readonly medium: number;
  /** Tiles per row at the large size. */
  readonly large: number;
}

/** The tiles per row a `WorkspacePanel` uses when `tileCounts` leaves a size out. */
export const DEFAULT_WORKSPACE_TILE_COUNTS: WorkspaceTileCounts = { small: 5, medium: 4, large: 3 };

/** The labels a workspace grid draws, read from the host's `PhonuxLabels`. */
export type WorkspaceLabels = Pick<
  PhonuxLabels,
  'workspaceUntitled' | 'workspaceEmpty'
>;

/**
 * One entry a `WorkspacePanel` lists as a tile. The host supplies these, or the panel derives them from the workspace.
 * @public
 */
export interface WorkspacePanelEntry {
  /** The id the tile reports on activate, drop and trash. */
  readonly id: string;
  /** The title the tile shows. */
  readonly title: string;
  /** Whether the entry is in the row now; `false` means parked. The tile carries it as `data-live` for the host's styles. */
  readonly live: boolean;
  /** An image URL drawn in the tile until a picture of the panel is taken. */
  readonly placeholder?: string;
  /** The panel's width in slots (a positive integer). The tile spans that many grid columns, capped at the grid's columns. @defaultValue `1` */
  readonly slots?: number;
  /** The host's own element drawn before the tile's title. The panel sets no size or colour on it. Left out, the caption shows the title alone. */
  readonly icon?: ReactNode;
}

/**
 * The ids in the order a drop of `movedId` onto `overId` leaves them: `movedId` takes `overId`'s place and the ids between
 * the two shift one place, as a sortable list does. Unchanged when either id is absent or they are the same.
 */
export function reorderWorkspaceIds(ids: readonly string[], movedId: string, overId: string): string[] {
  const from = ids.indexOf(movedId);
  const to = ids.indexOf(overId);
  const next = [...ids];
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(from, 1);
  next.splice(to, 0, movedId);
  return next;
}

/**
 * The grid columns a tile spans: its panel's width in slots, capped at the grid's column count, and 1 when the entry gives no slots.
 * @throws RangeError when `slots` is not a positive integer.
 */
export function workspaceTileSpan(slots: number | undefined, columns: number): number {
  if (slots === undefined) return 1;
  if (!Number.isInteger(slots) || slots < 1) throw new RangeError(`WorkspacePanel: an entry's slots must be a positive integer, got ${String(slots)}`);
  return Math.min(slots, columns);
}

/**
 * A tile's picture ratio: `span` phone widths by one phone height, so a tile of any span in a row has the same height as a
 * one-column tile and the row lines up.
 */
export function workspaceTileRatio(span: number, size: { width: number; height: number }): string {
  return `${span * size.width} / ${size.height}`;
}

/** The title a tile shows: the panel's title, else its url, else `untitled`. */
export function workspaceTileTitle(title: string | undefined, url: string | undefined, untitled: string): string {
  if (title !== undefined && title.trim() !== '') return title;
  if (url !== undefined && url !== '') return url;
  return untitled;
}

/**
 * The tiles per row at `size`, from the defaults overlaid with `counts`.
 * @throws RangeError when the count for `size` is not a positive integer.
 */
export function workspaceTileColumns(size: WorkspaceTileSize, counts: Partial<WorkspaceTileCounts> | undefined): number {
  const n = counts?.[size] ?? DEFAULT_WORKSPACE_TILE_COUNTS[size];
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`WorkspacePanel: the ${size} tile count must be a positive integer, got ${String(n)}`);
  return n;
}
