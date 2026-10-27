/**
 * Where an opening panel lands among the panels in view, as a developer's own function decides. Pure: `resolveOpen`
 * turns the function's answer into the anchor the engine places by and the panel that leaves to make room.
 */
import type { AddPlacement, EnterFrom, PanelId } from './panelSettings.js';

/** The row a {@link PlaceOpen} function decides against. @public */
export interface OpenRow {
  /** The ids of the panels in view, left to right; always-shown columns are not slots and are left out. */
  readonly inView: readonly PanelId[];
}

/** What the panel already in the chosen slot does when a panel opens there. @public */
export type OccupantMove = 'shift-left' | 'shift-right' | 'close';

/** Where an opening panel lands and what the panel in that slot does. @public */
export interface OpenPlacement {
  /**
   * The slot the panel takes, counted from 0 at the left of `OpenRow.inView`. A slot at or past `inView.length` lands right
   * of the last panel in view, and a negative one at the first.
   */
  slot: number;
  /**
   * 'shift-left' moves the occupant and every panel left of it one slot left, and 'shift-right' moves it and every panel
   * right of it one slot right; when the row has no room, the panel pushed past that end leaves view. 'close' closes the
   * occupant. A slot past the last panel in view has no occupant, and shifts left. Default 'shift-left'.
   */
  occupant?: OccupantMove;
  /** How the opening panel enters, as its `enterFrom` setting. Default: the panel's own `enterFrom`. */
  enterFrom?: EnterFrom;
}

/**
 * Picks where an opening panel lands; pass it as `addPanel`'s `place`. Without one, a panel lands where its `placeOnAdd`
 * says, which by default is the far right of the row, the leftmost panel in view leaving when there is no room.
 * @public
 */
export type PlaceOpen = (row: OpenRow) => OpenPlacement;

/** What the engine does for one {@link OpenPlacement}: the anchor, the panel that leaves view if room is short, and the one to close. @internal */
export interface ResolvedOpen {
  place: AddPlacement;
  leaves?: PanelId;
  closes?: PanelId;
}

/** `p` against `inView`, the panels in view left to right. @internal */
export function resolveOpen(inView: readonly PanelId[], p: OpenPlacement): ResolvedOpen {
  const n = inView.length;
  if (n === 0) return { place: 'row-end' };
  const slot = Math.max(0, Math.floor(p.slot));
  if (slot >= n) return { place: { after: inView[n - 1]! }, leaves: inView[0]! };
  const occupant = inView[slot]!;
  // The anchor is a neighbor that stays; the occupant still holds its room while its close plays, so it is the one that leaves.
  if (p.occupant === 'close') return { place: slot > 0 ? { after: inView[slot - 1]! } : n > 1 ? { before: inView[1]! } : 'row-end', leaves: occupant, closes: occupant };
  if (p.occupant === 'shift-right') return { place: { before: occupant }, leaves: inView[n - 1]! };
  return { place: { after: occupant }, leaves: inView[0]! };
}
